// background/background.js
// Background script (Firefox event page)

const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_MODEL = 'glm-4v-flash';
const DEFAULT_API_KEY = '1508089119b8403dbdf587f551c819e1.pmXHkV7ayy52WYjq';

// First install: auto-save default API key
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['apiKey'], (result) => {
    if (!result.apiKey) {
      chrome.storage.local.set({ apiKey: DEFAULT_API_KEY });
    }
  });
});

// Helper: get API key with fallback to default
function getApiKey(callback) {
  chrome.storage.local.get(['apiKey'], (result) => {
    callback(result.apiKey || DEFAULT_API_KEY);
  });
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // --- Excel multi-file management ---
  if (message.type === 'GET_EXCEL_LIST') {
    chrome.storage.local.get(['excelList'], (result) => {
      sendResponse({ list: result.excelList || [] });
    });
    return true;
  }

  if (message.type === 'ADD_EXCEL_DATA') {
    chrome.storage.local.get(['excelList'], (result) => {
      const list = result.excelList || [];
      const idx = list.findIndex((item) => item.fileName === message.data.fileName);
      if (idx >= 0) {
        list[idx] = message.data;
      } else {
        list.push(message.data);
      }
      chrome.storage.local.set({ excelList: list }, () => {
        sendResponse({ success: true, count: list.length });
      });
    });
    return true;
  }

  if (message.type === 'REMOVE_EXCEL') {
    chrome.storage.local.get(['excelList'], (result) => {
      const list = (result.excelList || []).filter((item) => item.fileName !== message.fileName);
      chrome.storage.local.set({ excelList: list }, () => {
        sendResponse({ success: true, count: list.length });
      });
    });
    return true;
  }

  // Legacy single-excel support (used by content script QUERY_PART)
  if (message.type === 'GET_EXCEL_DATA') {
    chrome.storage.local.get(['excelList'], (result) => {
      const list = result.excelList || [];
      if (list.length > 0) {
        // Merge all rows from all excel files
        const merged = { rows: [] };
        list.forEach((item) => {
          merged.rows = merged.rows.concat(item.rows || []);
        });
        sendResponse({ data: merged });
      } else {
        sendResponse({ data: null });
      }
    });
    return true;
  }

  // --- API Key ---
  if (message.type === 'SAVE_API_KEY') {
    chrome.storage.local.set({ apiKey: message.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_API_KEY') {
    getApiKey((apiKey) => {
      sendResponse({ apiKey });
    });
    return true;
  }

  // --- Query part from all loaded excels ---
  if (message.type === 'QUERY_PART') {
    chrome.storage.local.get(['excelList'], (result) => {
      const list = result.excelList || [];
      if (list.length === 0) {
        sendResponse({ found: false, error: '未导入关键件清单Excel' });
        return;
      }
      // Search across all loaded Excel files
      let allRows = [];
      list.forEach((item) => {
        allRows = allRows.concat(item.rows || []);
      });
      const queryResult = queryPartFromData(allRows, message.partName, message.partCode);
      sendResponse(queryResult);
    });
    return true;
  }

  // --- Image Recognition ---
  if (message.type === 'RECOGNIZE_IMAGE') {
    getApiKey((apiKey) => {
      recognizeImage(apiKey, message.imageBase64, message.imageType, message.context)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === 'RECOGNIZE_PDF') {
    getApiKey((apiKey) => {
      recognizeImage(apiKey, message.imageBase64, 'pdf', message.context)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }
});

/**
 * Call ZhipuAI GLM-4V-Flash to recognize product image
 */
async function recognizeImage(apiKey, imageBase64, imageType, context) {
  const prompt = buildRecognitionPrompt(context);

  const mimeType = imageType === 'png' ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const requestBody = {
    model: ZHIPU_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt }
        ]
      }
    ],
    max_tokens: 1000,
    temperature: 0.1
  };

  try {
    const response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `API请求失败(${response.status}): ${errText}` };
    }

    const result = await response.json();
    const content = result.choices[0].message.content;
    const parsed = extractJSON(content);
    return parsed
      ? { success: true, data: parsed, raw: content }
      : { success: true, data: null, raw: content };
  } catch (err) {
    return { success: false, error: `API调用异常: ${err.message}` };
  }
}

function buildRecognitionPrompt(context) {
  const type = context.type || 'general';
  const expectedModel = context.expectedModel || '';
  const expectedPartNumber = context.expectedPartNumber || '';

  if (type === 'ccc') {
    return `这是一个汽车零部件的实物照片。请仔细识别：

1. 照片中是否存在CCC认证标志？CCC标志是中国强制性产品认证标志，通常是圆形图案里有"CCC"字母，可能印刷、模压或贴标在零件上。
2. 如果有CCC标志，描述其位置和样式。
3. 识别标签/零件上的所有其他文字。

请严格按JSON格式回复（不要加markdown标记）：
{"has_ccc": true或false, "ccc_detail": "CCC标志的位置和样式描述，没有则写无", "all_text": "所有可识别的文字", "confidence": "high或medium或low"}`;
  }

  if (type === 'model') {
    let prompt = `这是一个汽车零部件的实物照片。请仔细识别标签/铭牌上的所有文字信息。

重点关注：
1. 型号代码（通常格式如 XXXX-XX-XX，例如ZCUD-00-01）
2. 零件号（通常为8位数字）
3. 供应商代码（通常为7位数字）
4. 是否有CCC认证标志`;

    if (expectedModel) {
      prompt += `\n\n参考信息：期望的型号代码为"${expectedModel}"，请特别确认是否能在实物上找到此型号。`;
    }
    if (expectedPartNumber) {
      prompt += `\n参考信息：期望的零件号为"${expectedPartNumber}"。`;
    }

    prompt += `\n\n请严格按JSON格式回复（不要加markdown标记）：
{"has_ccc": true或false, "model_code": "识别到的型号代码", "part_number": "识别到的零件号", "supplier_code": "识别到的供应商代码", "all_text": "标签上所有可识别的完整文字", "model_match": true或false, "confidence": "high或medium或low"}`;

    return prompt;
  }

  return `这是一个汽车零部件的实物照片。请仔细识别照片中所有标签、铭牌上的文字信息。

重点识别：
1. 是否有CCC认证标志（中国强制性产品认证，圆形图案中有CCC字母）？
2. 型号代码（格式通常如XXXX-XX-XX）
3. 零件号（通常为8位数字）
4. 供应商代码（通常为7位数字）
5. 生产企业名称

请严格按JSON格式回复（不要加markdown标记）：
{"has_ccc": true或false, "ccc_detail": "CCC标志描述，没有则写无", "model_code": "型号代码", "part_number": "零件号", "supplier_code": "供应商代码", "manufacturer_text": "生产企业文字", "all_text": "所有可识别文字", "confidence": "high或medium或low"}`;
}

function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try { return JSON.parse(match[1].trim()); } catch (e2) { /* ignore */ }
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch (e3) { /* ignore */ }
    }
  }
  return null;
}

function queryPartFromData(rows, partName, partCode) {
  const results = [];

  for (const row of rows) {
    const colB = (row.partComponentName || '').trim();
    const colN = (row.chinesePartName || '').trim();
    const colO = (row.partNumber || '').trim();
    let matched = false;

    if (colN && partName) {
      const names = colN.split(/[,，]/);
      for (const name of names) {
        const cleanName = name.replace(/^[A-Z][:：]/, '').trim();
        if (cleanName && (partName.includes(cleanName) || cleanName.includes(partName))) {
          matched = true;
          break;
        }
      }
    }
    if (!matched && colB && partName) {
      if (partName.includes(colB) || colB.includes(partName)) matched = true;
    }
    if (!matched && colO && partCode) {
      const codes = colO.split(/[,，;；]/);
      for (const code of codes) {
        const cleanCode = code.replace(/^[A-Z][:：]/, '').trim();
        if (cleanCode && partCode.includes(cleanCode)) { matched = true; break; }
      }
    }
    if (matched) results.push(row);
  }

  return results.length > 0
    ? { found: true, results }
    : { found: false, error: `未找到零件: ${partName || partCode}` };
}

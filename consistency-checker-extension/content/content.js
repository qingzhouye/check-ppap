// content/content.js
// Content Script - runs on sq.sgmw.com.cn pages

(function () {
  'use strict';

  // ============ Message Listener ============
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'EXTRACT_TASK_LIST':
        sendResponse(extractTaskList());
        break;
      case 'AUTO_CHECK_DETAIL':
        autoCheckDetail().then(sendResponse);
        return true; // async
      case 'BATCH_CHECK_TASK':
        batchCheckTask(message.taskData).then(sendResponse);
        return true; // async
      case 'AUTO_APPROVE':
        autoApprove().then(sendResponse);
        return true;
      default:
        sendResponse({ success: false, error: '未知操作' });
    }
  });

  // ============ 1. Extract Task List ============
  function extractTaskList() {
    try {
      const tasks = [];
      const tableBody = document.querySelector('.layui-table-body.layui-table-main tbody');
      if (!tableBody) {
        return { success: false, error: '未找到任务列表表格，请确认在正确的页面' };
      }

      const rows = tableBody.querySelectorAll('tr');
      rows.forEach((tr) => {
        const getCellText = (field) => {
          const td = tr.querySelector(`td[data-field="${field}"]`);
          return td ? td.textContent.trim() : '';
        };

        const task = {
          index: getCellText('1'),
          overtime: getCellText('overtime'),
          uniformityCheckNum: getCellText('uniformityCheckNum'),
          currentNode: getCellText('currentNodeStr'),
          carPlatform: getCellText('carPlatform'),
          carType: getCellText('carType'),
          source: getCellText('sourceStr'),
          latestPartsCode: getCellText('latestPartsCode'),
          initialPartsCode: getCellText('initialPartsCode'),
          partsName: getCellText('partsName'),
          supplierCode: getCellText('supplierCode'),
          supplierName: getCellText('supplierName'),
          createDate: getCellText('createdate'),
          updateDate: getCellText('previousNodeAuditTime'),
          sqeName: getCellText('sqeName'),
          applicantName: getCellText('applicantName'),
        };

        if (task.partsName || task.latestPartsCode) {
          tasks.push(task);
        }
      });

      return { success: true, tasks };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============ 2. Auto Check Detail Page ============
  async function autoCheckDetail() {
    try {
      const detailPopup = document.querySelector('#layui-layer2 #handleTaskPopup')
        || document.querySelector('#handleTaskPopup');
      if (!detailPopup) {
        return { success: false, error: '未检测到详情弹窗，请先打开一条任务的详情页' };
      }

      const results = [];

      // --- 2.1 Extract basic info ---
      const supplierName = getText('#basicsSupplierName');
      const supplierCode = getText('#basicsSupplierCode');
      const partsName = getText('#basicsPartsName');
      const latestPartsCode = getText('#basicsLatestPartsCode');
      const carType = getText('#basicsCarType');

      results.push({
        item: '基本信息',
        result: `零件: ${partsName}, 零件号: ${latestPartsCode}, 车型: ${carType}`,
        passed: true
      });

      // --- 2.2 Check manufacturer name consistency ---
      const manufacturerNames = extractManufacturerNames(detailPopup);

      if (manufacturerNames.length > 0) {
        const manufacturerMatch = manufacturerNames.some(
          (name) => name === supplierName || supplierName.includes(name) || name.includes(supplierName)
        );
        results.push({
          item: '生产企业名称一致性',
          result: manufacturerMatch
            ? `一致 (${manufacturerNames.join(', ')})`
            : `不一致! 供应商: ${supplierName}, 生产企业: ${manufacturerNames.join(', ')}`,
          passed: manufacturerMatch
        });
      } else {
        results.push({
          item: '生产企业名称一致性',
          result: '未找到生产企业信息',
          passed: false
        });
      }

      // --- 2.3 Check CCC info on page ---
      const isCccOnPage = checkCccStatus(detailPopup);

      // --- 2.4 Check model info on page ---
      const pageModels = extractModelInfo(detailPopup);

      // --- 2.5 Query Excel for comparison ---
      const excelResult = await queryExcel(partsName, latestPartsCode);

      let expectedModel = pageModels.length > 0 ? pageModels[0] : '';

      if (excelResult.found) {
        const excelRow = excelResult.results[0];

        // CCC check
        const excelIsCcc = excelRow.ccc === '●' || excelRow.ccc === '是';
        const cccMatch = isCccOnPage === excelIsCcc;
        results.push({
          item: '是否CCC件',
          result: cccMatch
            ? `一致 (${excelIsCcc ? '是CCC件' : '非CCC件'})`
            : `不一致! 页面: ${isCccOnPage ? '是' : '否'}, Excel: ${excelIsCcc ? '是' : '否'}`,
          passed: cccMatch
        });

        // Model check
        const excelModels = parseMultiValue(excelRow.modelSpec);
        if (excelModels.length > 0 && excelModels[0] !== 'N/A') {
          expectedModel = excelModels[0]; // Use Excel model as expected
          if (pageModels.length > 0) {
            const modelMatch = excelModels.some((em) =>
              pageModels.some((pm) => pm.includes(em) || em.includes(pm))
            );
            results.push({
              item: '型号信息(与Excel)',
              result: modelMatch
                ? `一致 (${pageModels.join(', ')})`
                : `不一致! 页面: ${pageModels.join(', ')}, Excel: ${excelModels.join(', ')}`,
              passed: modelMatch
            });
          } else {
            results.push({
              item: '型号信息(与Excel)',
              result: `页面无型号数据, Excel型号: ${excelModels.join(', ')}`,
              passed: false
            });
          }
        } else {
          results.push({
            item: '型号信息(与Excel)',
            result: 'Excel中型号为N/A，无需检查',
            passed: true
          });
        }

        // Manufacturer from Excel
        const excelManufacturers = parseMultiValue(excelRow.manufacturer);
        if (excelManufacturers.length > 0 && excelManufacturers[0] !== 'N/A') {
          const mfMatch = excelManufacturers.some((em) =>
            manufacturerNames.some((mn) => mn.includes(em) || em.includes(mn))
          );
          results.push({
            item: '生产企业(与Excel)',
            result: mfMatch
              ? `一致 (${excelManufacturers.join(', ')})`
              : `不一致! 页面: ${manufacturerNames.join(', ')}, Excel: ${excelManufacturers.join(', ')}`,
            passed: mfMatch
          });
        }
      } else {
        results.push({
          item: 'Excel查询',
          result: excelResult.error || '未在关键件清单中找到此零件',
          passed: false
        });
      }

      // --- 2.6 AI Image Recognition ---
      // CCC attachment
      if (isCccOnPage) {
        const cccResult = await recognizeAttachmentImage(
          detailPopup, '#cccFile', 'ccc', expectedModel, latestPartsCode
        );
        results.push(cccResult);
      }

      // Model attachment
      const modelResult = await recognizeAttachmentImage(
        detailPopup, '#modelFile', 'model', expectedModel, latestPartsCode
      );
      results.push(modelResult);

      // Display results panel
      showCheckResultPanel(results);

      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============ AI Image Recognition ============

  /**
   * Extract image from attachment area and call AI recognition
   */
  async function recognizeAttachmentImage(detailPopup, containerSelector, recognitionType, expectedModel, expectedPartNumber) {
    const itemLabel = recognitionType === 'ccc' ? 'CCC标识(AI识别)' : '型号标识(AI识别)';
    const container = detailPopup.querySelector(containerSelector);

    if (!container) {
      return { item: itemLabel, result: '未找到标识区域', passed: false, needManual: true };
    }

    // Try to find image element
    const imgEl = container.querySelector('.modal-small-card-typeIcon img');

    if (imgEl && imgEl.src) {
      try {
        const base64 = await getImageBase64(imgEl);
        if (base64) {
          return await callAIAndInterpret(base64, recognitionType, expectedModel, expectedPartNumber);
        }
      } catch (err) {
        // Fall through to file download attempt
      }
    }

    // Try to find downloadable file
    const downloadBtn = container.querySelector('button[onclick*="fileDownload"]');
    if (downloadBtn) {
      const onclickStr = downloadBtn.getAttribute('onclick') || '';
      const fileIdMatch = onclickStr.match(/fileDownload\('([^']+)'\)/);

      // Check file type from the name
      const fileNameEl = container.querySelector('.modal-small-card-typeName span');
      const fileName = fileNameEl ? fileNameEl.textContent.trim() : '';
      const isPdf = fileName.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        return {
          item: itemLabel,
          result: `附件为PDF文件(${fileName})，请人工下载查看确认`,
          passed: false,
          needManual: true
        };
      }

      if (fileIdMatch) {
        try {
          const base64 = await fetchFileAsBase64(fileIdMatch[1]);
          if (base64) {
            return await callAIAndInterpret(base64, recognitionType, expectedModel, expectedPartNumber);
          }
        } catch (err) {
          // Fall through
        }
      }

      return {
        item: itemLabel,
        result: `有附件(${fileName})但无法自动提取，请人工确认`,
        passed: false,
        needManual: true
      };
    }

    // No attachment at all
    return {
      item: itemLabel,
      result: '无附件',
      passed: false,
      needManual: true
    };
  }

  /**
   * Get image element as base64
   */
  async function getImageBase64(imgElement) {
    return new Promise((resolve, reject) => {
      if (imgElement.src && imgElement.src.startsWith('data:')) {
        resolve(imgElement.src.split(',')[1]);
        return;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          resolve(dataUrl.split(',')[1]);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = imgElement.src;
    });
  }

  /**
   * Download file by ID and convert to base64
   */
  async function fetchFileAsBase64(fileId) {
    const response = await fetch(`/api/unifomity/file/download?id=${fileId}`);
    if (!response.ok) throw new Error('下载失败');
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Send image to background for AI recognition, then interpret results
   */
  async function callAIAndInterpret(imageBase64, type, expectedModel, expectedPartNumber) {
    const itemLabel = type === 'ccc' ? 'CCC标识(AI识别)' : '型号标识(AI识别)';

    const aiResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'RECOGNIZE_IMAGE',
        imageBase64: imageBase64,
        imageType: 'jpg',
        context: {
          type: type,
          expectedModel: expectedModel || '',
          expectedPartNumber: expectedPartNumber || ''
        }
      }, resolve);
    });

    if (!aiResult || !aiResult.success) {
      return {
        item: itemLabel,
        result: `AI识别失败: ${aiResult ? aiResult.error : '无响应'}，请人工确认`,
        passed: false,
        needManual: true
      };
    }

    const data = aiResult.data;
    if (!data) {
      return {
        item: itemLabel,
        result: `AI返回无法解析，原始: ${truncate(aiResult.raw || '', 80)}，请人工确认`,
        passed: false,
        needManual: true
      };
    }

    // Interpret based on type
    if (type === 'ccc') {
      return interpretCccResult(data);
    } else {
      return interpretModelResult(data, expectedModel, expectedPartNumber);
    }
  }

  /**
   * Interpret CCC recognition result
   */
  function interpretCccResult(data) {
    const confidence = data.confidence || 'low';
    const hasCcc = data.has_ccc;
    const detail = data.ccc_detail || '';

    if (confidence === 'high') {
      return {
        item: 'CCC标识(AI识别)',
        result: hasCcc
          ? `实物上发现CCC标志。${detail}`
          : `实物上未发现CCC标志。${detail}`,
        passed: hasCcc,
        needManual: false
      };
    }
    // medium / low -> need manual confirmation
    return {
      item: 'CCC标识(AI识别)',
      result: `[置信度:${confidence}] AI判断${hasCcc ? '有' : '无'}CCC标志，建议人工复核。${detail}`,
      passed: false,
      needManual: true
    };
  }

  /**
   * Interpret model code recognition result
   */
  function interpretModelResult(data, expectedModel, expectedPartNumber) {
    const confidence = data.confidence || 'low';
    const recognizedModel = data.model_code || '';
    const recognizedPartNum = data.part_number || '';

    // Collect all recognized text for flexible matching
    let allText = '';
    if (typeof data.all_text === 'string') {
      allText = data.all_text;
    } else if (data.all_text && typeof data.all_text === 'object') {
      allText = Object.values(data.all_text).join(' ');
    }

    // Check if expected model appears anywhere in recognized content
    let modelFound = false;
    if (expectedModel) {
      modelFound = allText.includes(expectedModel)
        || recognizedModel.includes(expectedModel)
        || expectedModel.includes(recognizedModel);
    }

    // Check part number
    let partNumFound = false;
    if (expectedPartNumber) {
      partNumFound = allText.includes(expectedPartNumber)
        || recognizedPartNum.includes(expectedPartNumber);
    }

    if (confidence === 'high') {
      if (modelFound) {
        let msg = `在实物上确认找到型号"${expectedModel}"`;
        if (partNumFound) msg += `，零件号"${expectedPartNumber}"也匹配`;
        msg += `。识别文字: ${truncate(allText, 60)}`;
        return { item: '型号标识(AI识别)', result: msg, passed: true, needManual: false };
      }
      // Model not found but high confidence
      return {
        item: '型号标识(AI识别)',
        result: `实物型号可能不一致! 期望:"${expectedModel}", AI识别:"${recognizedModel}"。识别文字: ${truncate(allText, 60)}`,
        passed: false,
        needManual: true
      };
    }

    // Low/medium confidence
    return {
      item: '型号标识(AI识别)',
      result: `[置信度:${confidence}] AI识别型号:"${recognizedModel}", 期望:"${expectedModel}"。建议人工复核。识别文字: ${truncate(allText, 50)}`,
      passed: false,
      needManual: true
    };
  }

  // ============ 3. Batch Check Task ============
  async function batchCheckTask(taskData) {
    try {
      // 第一步：在任务列表中找到并点击该任务
      const clickResult = await clickTaskInList(taskData);
      if (!clickResult.success) {
        return { success: false, error: clickResult.error };
      }
      
      // 等待详情页加载
      await waitForDetailPopup();
      
      // 执行校验
      const checkResult = await autoCheckDetail();
      
      if (!checkResult.success) {
        return { success: false, error: checkResult.error };
      }
      
      // 关闭详情页，返回列表
      await closeDetailPopup();
      
      // 分析结果
      const allPassed = checkResult.results.every(r => r.passed);
      const hasWarning = checkResult.results.some(r => r.needManual);
      
      return {
        success: true,
        allPassed: allPassed,
        hasWarning: hasWarning,
        results: checkResult.results
      };
      
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  
  // 在任务列表中点击指定任务
  async function clickTaskInList(taskData) {
    return new Promise((resolve) => {
      const tableBody = document.querySelector('.layui-table-body.layui-table-main tbody');
      if (!tableBody) {
        resolve({ success: false, error: '未找到任务列表' });
        return;
      }
      
      const rows = tableBody.querySelectorAll('tr');
      let found = false;
      
      rows.forEach((tr) => {
        if (found) return;
        
        const partsNameTd = tr.querySelector('td[data-field="partsName"]');
        const latestPartsCodeTd = tr.querySelector('td[data-field="latestPartsCode"]');
        
        const partsName = partsNameTd ? partsNameTd.textContent.trim() : '';
        const latestPartsCode = latestPartsCodeTd ? latestPartsCodeTd.textContent.trim() : '';
        
        // 匹配任务（通过零件名称或零件号）
        if (partsName === taskData.partsName || latestPartsCode === taskData.latestPartsCode) {
          found = true;
          
          // 找到操作列的按钮并点击
          const operationTd = tr.querySelector('td[data-field="8"]'); // 操作列
          if (operationTd) {
            const handleBtn = operationTd.querySelector('button');
            if (handleBtn) {
              handleBtn.click();
              resolve({ success: true });
            } else {
              resolve({ success: false, error: '未找到处理按钮' });
            }
          } else {
            // 尝试双击行
            tr.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            resolve({ success: true });
          }
        }
      });
      
      if (!found) {
        resolve({ success: false, error: '未找到匹配的任务: ' + taskData.partsName });
      }
    });
  }
  
  // 等待详情页加载
  async function waitForDetailPopup() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 20; // 最多等待2秒
      
      const checkInterval = setInterval(() => {
        attempts++;
        const detailPopup = document.querySelector('#layui-layer2 #handleTaskPopup')
          || document.querySelector('#handleTaskPopup');
        
        if (detailPopup) {
          clearInterval(checkInterval);
          // 额外等待一下确保内容加载完成
          setTimeout(resolve, 500);
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          resolve(); // 超时也继续
        }
      }, 100);
    });
  }
  
  // 关闭详情页
  async function closeDetailPopup() {
    return new Promise((resolve) => {
      // 尝试点击关闭按钮
      const closeBtn = document.querySelector('#layui-layer2 .layui-layer-close')
        || document.querySelector('.layui-layer-close');
      
      if (closeBtn) {
        closeBtn.click();
      }
      
      // 等待关闭动画
      setTimeout(resolve, 300);
    });
  }

  // ============ 4. Auto Approve (监测组审核) ============
  async function autoApprove() {
    try {
      const detailPopup = document.querySelector('#layui-layer2 #handleTaskPopup')
        || document.querySelector('#handleTaskPopup');
      if (!detailPopup) {
        return { success: false, error: '未检测到详情弹窗' };
      }

      const partslistSet = setRadioValue(detailPopup, 'supervisionGroupIsPartslistUni', '1');
      const resultSet = setRadioValue(detailPopup, 'supervisionGroupCheckResult', '1');

      if (!partslistSet && !resultSet) {
        return {
          success: false,
          error: '监测组审核栏位可能为只读状态(disabled)，请确认当前节点为"监测组待审批"'
        };
      }

      const submitBtn = findSubmitButton(detailPopup);

      return {
        success: true,
        message: '已选择: 关键件清单一致=是, 确认结果=同意' +
          (submitBtn ? '。请手动点击提交按钮确认。' : '。未找到提交按钮，请手动提交。')
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============ DOM Helper Functions ============

  function getText(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  function parseMultiValue(value) {
    if (!value) return [];
    return value.split(/[,，;；]/).map((v) => v.replace(/^[A-Z][:：]/, '').trim()).filter(Boolean);
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    if (typeof str !== 'string') str = String(str);
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  function queryExcel(partName, partCode) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'QUERY_PART', partName, partCode },
        (response) => resolve(response || { found: false, error: '通信失败' })
      );
    });
  }

  function extractManufacturerNames(detailPopup) {
    const names = [];
    const allTableViews = detailPopup.querySelectorAll('.layui-table-view');
    allTableViews.forEach((tv) => {
      const headers = tv.querySelectorAll('.layui-table-header th');
      let isManufacturerTable = false;
      headers.forEach((th) => {
        if (th.textContent.includes('生产企业名称') || th.textContent.includes('生产企业')) {
          isManufacturerTable = true;
        }
      });
      if (isManufacturerTable) {
        const body = tv.querySelector('.layui-table-main tbody');
        if (body) {
          body.querySelectorAll('tr').forEach((tr) => {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 2) {
              const name = tds[1].textContent.trim();
              if (name) names.push(name);
            }
          });
        }
      }
    });
    return names;
  }

  function checkCccStatus(detailPopup) {
    const radios = detailPopup.querySelectorAll('input[name="isCccParts"]');
    let isCcc = false;
    radios.forEach((radio) => {
      const wrapper = radio.nextElementSibling;
      if (wrapper && wrapper.classList.contains('layui-form-radioed')) {
        isCcc = radio.value === '1';
      }
    });
    return isCcc;
  }

  function extractModelInfo(detailPopup) {
    const models = [];
    const allTableViews = detailPopup.querySelectorAll('.layui-table-view');
    allTableViews.forEach((tv) => {
      const headers = tv.querySelectorAll('.layui-table-header th');
      let isModelTable = false;
      headers.forEach((th) => {
        const text = th.textContent.trim();
        if (text === '型号' || (text.includes('型号') && !text.includes('车型') && !text.includes('标识'))) {
          isModelTable = true;
        }
      });
      if (isModelTable) {
        const body = tv.querySelector('.layui-table-main tbody');
        if (body) {
          body.querySelectorAll('tr').forEach((tr) => {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 2) {
              const model = tds[1].textContent.trim();
              if (model) models.push(model);
            }
          });
        }
      }
    });
    return models;
  }

  function setRadioValue(container, name, value) {
    const radios = container.querySelectorAll(`input[name="${name}"]`);
    let found = false;

    radios.forEach((radio) => {
      if (radio.disabled) return;
      const wrapper = radio.nextElementSibling;
      if (radio.value === value) {
        radio.checked = true;
        if (wrapper) wrapper.classList.add('layui-form-radioed');
        found = true;
      } else {
        radio.checked = false;
        if (wrapper) wrapper.classList.remove('layui-form-radioed');
      }
    });

    if (!found) {
      radios.forEach((radio) => {
        if (radio.value === value) {
          radio.disabled = false;
          radio.checked = true;
          radio.click();
          const wrapper = radio.nextElementSibling;
          if (wrapper) {
            wrapper.classList.remove('layui-disabled', 'layui-radio-disbaled');
            wrapper.classList.add('layui-form-radioed');
          }
          found = true;
        }
      });
    }

    return found;
  }

  function findSubmitButton(container) {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text.includes('提交') || text.includes('审批')) {
        return btn;
      }
    }
    return null;
  }

  // ============ Results Display Panel ============
  function showCheckResultPanel(results) {
    const existing = document.getElementById('consistency-check-panel');
    if (existing) existing.remove();

    const passedCount = results.filter((r) => r.passed).length;
    const manualCount = results.filter((r) => r.needManual).length;
    const allPassed = results.every((r) => r.passed);

    let summaryClass = 'ccp-summary-ok';
    let summaryText = `通过: ${passedCount}/${results.length}`;
    if (allPassed) {
      summaryText += ' - 全部通过!';
    } else if (manualCount > 0) {
      summaryClass = 'ccp-summary-warn';
      summaryText += ` | ${manualCount}项需人工确认`;
    } else {
      summaryClass = 'ccp-summary-fail';
      summaryText += ' - 存在不一致项!';
    }

    const panel = document.createElement('div');
    panel.id = 'consistency-check-panel';
    panel.innerHTML = `
      <div class="ccp-header">
        <span class="ccp-title">一致性校验结果</span>
        <span class="ccp-close" id="ccp-close-btn">&times;</span>
      </div>
      <div class="ccp-body">
        ${results.map((r) => {
          const cls = r.passed ? 'ccp-pass' : (r.needManual ? 'ccp-manual' : 'ccp-fail');
          const icon = r.passed ? '&#10004;' : (r.needManual ? '&#9888;' : '&#10008;');
          return `<div class="ccp-row ${cls}">
            <span class="ccp-icon">${icon}</span>
            <span class="ccp-item">${r.item}：</span>
            <span class="ccp-result">${r.result}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="ccp-footer">
        <div class="ccp-summary ${summaryClass}">${summaryText}</div>
      </div>
    `;

    document.body.appendChild(panel);
    document.getElementById('ccp-close-btn').addEventListener('click', () => panel.remove());
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }

  // ============ Floating Button ============
  function injectFloatingButton() {
    if (document.getElementById('consistency-float-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'consistency-float-btn';
    btn.innerHTML = '<span class="cfb-icon">&#9989;</span><span class="cfb-text">一致性助手</span>';
    btn.title = '一致性确认助手';

    const menu = document.createElement('div');
    menu.id = 'consistency-float-menu';
    menu.style.display = 'none';
    menu.innerHTML = `
      <div class="cfm-item" data-action="extract">提取任务列表</div>
      <div class="cfm-item" data-action="check">一键校验(含AI识别)</div>
      <div class="cfm-item" data-action="approve">自动审核</div>
    `;

    btn.addEventListener('click', () => {
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });

    menu.addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      menu.style.display = 'none';

      if (action === 'extract') {
        const result = extractTaskList();
        showNotification(
          result.success ? `成功提取${result.tasks.length}条任务` : result.error,
          result.success ? 'success' : 'error'
        );
      } else if (action === 'check') {
        showNotification('正在校验中，AI识别请稍候...', 'info');
        const result = await autoCheckDetail();
        if (result.success) {
          const p = result.results.filter((r) => r.passed).length;
          const m = result.results.filter((r) => r.needManual).length;
          let msg = `校验完成: ${p}/${result.results.length}项通过`;
          if (m > 0) msg += `，${m}项需人工确认`;
          showNotification(msg, result.results.every((r) => r.passed) ? 'success' : 'warn');
        } else {
          showNotification(result.error, 'error');
        }
      } else if (action === 'approve') {
        if (confirm('确认要自动填写监测组审核吗？\n请确保已校验所有信息无误！')) {
          const result = await autoApprove();
          showNotification(
            result.success ? result.message : result.error,
            result.success ? 'success' : 'error'
          );
        }
      }
    });

    document.body.appendChild(btn);
    document.body.appendChild(menu);
  }

  function showNotification(msg, type) {
    const existing = document.getElementById('consistency-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'consistency-notification';
    notification.className = `cn-${type || 'info'}`;
    notification.textContent = msg;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }

  // ============ Initialize ============
  if (document.readyState === 'complete') {
    injectFloatingButton();
  } else {
    window.addEventListener('load', injectFloatingButton);
  }

  const observer = new MutationObserver(() => injectFloatingButton());
  observer.observe(document.body, { childList: true, subtree: false });

})();

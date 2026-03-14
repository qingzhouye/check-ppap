// content/content.js
// Content Script - runs on sq.sgmw.com.cn pages

(function () {
  'use strict';

  // 直接从页面JS环境读取layui table cache（不注入脚本，避免CSP问题）
  function getLayuiTableCache() {
    return new Promise((resolve) => {
      try {
        // 直接访问页面全局变量 - 根据实际网页分析，表格ID是 'table-task-finish'
        if (window.layui && window.layui.table && window.layui.table.cache) {
          // 优先尝试已知的表格ID
          const knownTableIds = ['table-task-finish', 'tableTaskFinish', 'task-finish'];
          for (const tableId of knownTableIds) {
            const cache = window.layui.table.cache[tableId];
            if (cache && cache.length > 0) {
              console.log(`[Cache] 直接从window.layui.table.cache['${tableId}']获取:`, cache.length, '条');
              resolve({ key: tableId, data: cache });
              return;
            }
          }
          
          // 如果没有找到已知的，遍历所有cache
          const cacheKeys = Object.keys(window.layui.table.cache);
          for (const key of cacheKeys) {
            const cache = window.layui.table.cache[key];
            if (cache && cache.length > 0 && cache[0].id) {
              console.log(`[Cache] 从window.layui.table.cache['${key}']获取:`, cache.length, '条');
              resolve({ key: key, data: cache });
              return;
            }
          }
        }
        
        resolve(null);
      } catch (e) {
        console.log('[Cache] 获取cache出错:', e.message);
        resolve(null);
      }
    });
  }

  // ============ Message Listener ============
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'EXTRACT_TASK_LIST':
        extractTaskList().then(sendResponse);
        return true; // async
      case 'AUTO_CHECK_DETAIL':
        autoCheckDetail().then(sendResponse);
        return true; // async
      case 'BATCH_CHECK_TASK':
        batchCheckTask(message.taskData).then(sendResponse);
        return true; // async
      case 'BATCH_APPROVE_TASK':
        batchApproveTask(message.taskData).then(sendResponse);
        return true; // async
      case 'AUTO_APPROVE':
        autoApprove().then(sendResponse);
        return true;
      default:
        sendResponse({ success: false, error: '未知操作' });
    }
  });

  // 通过API直接获取任务列表 - 支持分页获取大量数据
  async function fetchTaskListByAPI() {
    try {
      console.log('[API List] 尝试通过API获取任务列表...');
      
      // 尝试不同的分页参数格式，优先获取500条
      const pageSize = 500;
      const baseUrl = `${window.location.origin}/api/unifomity/uniformityCheckSWTaskSearch/listUniCheckTaskSearch`;
      
      // 尝试多种分页参数格式
      const urlsToTry = [
        `${baseUrl}?pageSize=${pageSize}&pageNum=1`,
        `${baseUrl}?limit=${pageSize}&page=1`,
        `${baseUrl}?rows=${pageSize}&page=1`,
        `${baseUrl}?size=${pageSize}&current=1`,
        baseUrl // 原始URL作为fallback
      ];
      
      let lastError = null;
      
      for (const apiUrl of urlsToTry) {
        try {
          console.log(`[API List] 尝试URL: ${apiUrl}`);
          
          const response = await fetch(apiUrl, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
              'Accept': 'application/json'
            }
          });
          
          if (!response.ok) {
            console.log(`[API List] URL请求失败: ${response.status}`);
            continue;
          }
          
          const result = await response.json();
          
          if (result.respCode === 0 || result.ok === true || result.data) {
            const list = result.data?.list || result.data || [];
            console.log(`[API List] ✅ 成功获取 ${list.length} 条任务 (URL: ${apiUrl})`);
            
            // 转换为统一格式
            const tasks = list.map((item, index) => ({
              id: item.id || '',
              index: String(index + 1),
              overtime: item.overtime || '',
              uniformityCheckNum: item.uniformityCheckNum || '',
              currentNode: item.currentNodeStr || '',
              carPlatform: item.carPlatform || '',
              carType: item.carType || '',
              source: item.sourceStr || '',
              latestPartsCode: item.latestPartsCode || '',
              initialPartsCode: item.initialPartsCode || '',
              partsName: item.partsName || '',
              supplierCode: item.supplierCode || '',
              supplierName: item.supplierName || '',
              createDate: item.createdate || '',
              updateDate: item.previousNodeAuditTime || '',
              sqeName: item.sqeName || '',
              applicantName: item.applicantName || '',
            }));
            
            return { success: true, tasks, source: 'api', total: result.data?.total || tasks.length };
          }
        } catch (err) {
          console.log(`[API List] URL尝试失败: ${err.message}`);
          lastError = err;
        }
      }
      
      return { success: false, error: lastError?.message || '所有API请求方式均失败' };
    } catch (err) {
      console.log('[API List] ❌ API获取失败:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ============ 1. Extract Task List ============
  async function extractTaskList() {
    try {
      // 首先尝试通过API获取列表
      const apiResult = await fetchTaskListByAPI();
      if (apiResult.success && apiResult.tasks.length > 0) {
        const tasksWithId = apiResult.tasks.filter(t => t.id).length;
        console.log(`[Extract] API获取成功: ${apiResult.tasks.length} 条任务，其中 ${tasksWithId} 条有ID`);
        return apiResult;
      }
      
      // API失败，回退到DOM解析
      console.log('[Extract] API获取失败或为空，回退到DOM解析');
      
      const tasks = [];
      // 根据实际网页分析，使用更精确的选择器
      const tableBody = document.querySelector('#table-task-finish + .layui-table-view .layui-table-body tbody')
        || document.querySelector('.layui-table-body.layui-table-main tbody')
        || document.querySelector('.layui-table-view .layui-table-body tbody');
        
      if (!tableBody) {
        return { success: false, error: '未找到任务列表表格，请确认在正确的页面' };
      }

      // 获取layui table cache数据
      console.log('[Extract] 正在获取layui table cache...');
      let tableCache = null;
      let cacheKey = '';
      
      const cacheResult = await getLayuiTableCache();
      if (cacheResult && cacheResult.data) {
        tableCache = cacheResult.data;
        cacheKey = cacheResult.key;
        console.log(`[Extract] 从layui cache[${cacheKey}]获取:`, tableCache.length, '条');
      } else {
        console.log('[Extract] 无法从layui获取数据，将尝试从DOM解析');
      }

      const rows = tableBody.querySelectorAll('tr');
      console.log('[Extract] 表格行数:', rows.length);
      
      rows.forEach((tr, index) => {
        const getCellText = (field) => {
          const td = tr.querySelector(`td[data-field="${field}"]`);
          return td ? td.textContent.trim() : '';
        };

        // 获取行索引，用于从layui table cache中获取完整数据
        const rowIndex = tr.getAttribute('data-index') || index;
        let taskId = '';
        let cacheData = null;
        
        // 方式1：尝试从layui table cache中获取ID（主要方式，最可靠）
        // 根据实际网页分析，ID存储在 layui.table.cache['table-task-finish'][index].id
        if (tableCache && tableCache[rowIndex]) {
          cacheData = tableCache[rowIndex];
          taskId = cacheData.id || '';
          if (taskId) {
            console.log(`[Extract] 行${index}从cache获取ID:`, taskId.substring(0, 16) + '...');
          }
        }
        
        // 如果cache中有数据，直接使用cache中的字段
        if (cacheData) {
          const task = {
            id: taskId,
            index: String(index + 1),
            overtime: cacheData.overtime || '',
            uniformityCheckNum: cacheData.uniformityCheckNum || '',
            currentNode: cacheData.currentNodeStr || '',
            carPlatform: cacheData.carPlatform || '',
            carType: cacheData.carType || '',
            source: cacheData.sourceStr || '',
            latestPartsCode: cacheData.latestPartsCode || '',
            initialPartsCode: cacheData.initialPartsCode || '',
            partsName: cacheData.partsName || '',
            supplierCode: cacheData.supplierCode || '',
            supplierName: cacheData.supplierName || '',
            createDate: cacheData.createdate || '',
            updateDate: cacheData.previousNodeAuditTime || '',
            sqeName: cacheData.sqeName || '',
            applicantName: cacheData.applicantName || '',
          };
          
          if (task.partsName || task.latestPartsCode) {
            tasks.push(task);
          }
          return; // 跳过下面的DOM解析
        }
        
        // 方式2：如果cache中没有，尝试从行上的各种属性获取
        if (!taskId) {
          // 尝试多个可能的属性
          const possibleAttrs = ['data-id', 'data-task-id', 'data-taskid', 'data-key'];
          for (const attr of possibleAttrs) {
            taskId = tr.getAttribute(attr) || '';
            if (taskId && taskId.length === 40) {
              console.log(`[Extract] 行${index}从${attr}获取ID:`, taskId.substring(0, 16) + '...');
              break;
            } else {
              taskId = '';
            }
          }
        }
        
        // 方式3：尝试从checkbox的data-id属性获取
        if (!taskId) {
          const checkbox = tr.querySelector('input[type="checkbox"]');
          if (checkbox) {
            // 尝试多个可能的属性
            const idAttrs = ['data-id', 'value', 'name'];
            for (const attr of idAttrs) {
              let val = checkbox.getAttribute(attr) || '';
              // 过滤掉无效值
              if (val && val !== 'on' && val !== 'layTableCheckbox' && !val.startsWith('layTableCheckbox')) {
                // 检查是否是40位ID
                if (val.length === 40 && /^[a-f0-9]+$/i.test(val)) {
                  taskId = val;
                  console.log(`[Extract] 行${index}从checkbox ${attr}获取ID:`, taskId.substring(0, 16) + '...');
                  break;
                }
              }
            }
          }
        }
        
        // 方式4：尝试从行的onclick属性中解析ID
        if (!taskId) {
          const onclickAttr = tr.getAttribute('onclick') || '';
          const idMatch = onclickAttr.match(/['"]([a-f0-9]{40})['"]/i);
          if (idMatch) {
            taskId = idMatch[1];
            console.log(`[Extract] 行${index}从onclick解析ID:`, taskId.substring(0, 16) + '...');
          }
        }
        
        // 方式5：尝试从行内的按钮/链接的onclick属性获取
        if (!taskId) {
          const btn = tr.querySelector('button[onclick], a[onclick]');
          if (btn) {
            const onclickAttr = btn.getAttribute('onclick') || '';
            const idMatch = onclickAttr.match(/['"]([a-f0-9]{40})['"]/i);
            if (idMatch) {
              taskId = idMatch[1];
              console.log(`[Extract] 行${index}从按钮onclick解析ID:`, taskId.substring(0, 16) + '...');
            }
          }
        }
        
        // 方式6：尝试从操作列的任意元素获取ID
        if (!taskId) {
          const opCell = tr.querySelector('td[data-field="8"], td:last-child');
          if (opCell) {
            const allElements = opCell.querySelectorAll('*');
            for (const el of allElements) {
              for (const attr of ['data-id', 'id', 'value']) {
                const val = el.getAttribute(attr) || '';
                if (val.length === 40 && /^[a-f0-9]+$/i.test(val)) {
                  taskId = val;
                  console.log(`[Extract] 行${index}从操作列元素${attr}获取ID:`, taskId.substring(0, 16) + '...');
                  break;
                }
              }
              if (taskId) break;
            }
          }
        }
        
        // 验证任务ID格式（应该是40位的十六进制字符串）
        if (taskId && taskId.length !== 40) {
          console.log(`[Extract] 行${index}的任务ID格式不正确:`, taskId);
          // 如果格式不对，尝试其他方式
          taskId = '';
        }

        const task = {
          id: taskId,
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

        // 只添加有零件名称或零件号的任务
        if (task.partsName || task.latestPartsCode) {
          tasks.push(task);
        }
      });

      // 统计有ID的任务数量
      const tasksWithId = tasks.filter(t => t.id).length;
      console.log(`[Extract] 成功提取 ${tasks.length} 条任务，其中 ${tasksWithId} 条有任务ID`);
      
      return { success: true, tasks };
    } catch (err) {
      console.log('[Extract] 提取任务列表出错:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ============ 2. Auto Check Detail Page ============
  async function autoCheckDetail() {
    try {
      // 更宽松的弹窗检测
      const detailPopup = document.querySelector('.layui-layer.layui-layer-page')
        || document.querySelector('#layui-layer2')
        || document.querySelector('#handleTaskPopup')
        || document.querySelector('.layui-layer-dialog')
        || document.querySelector('[class*="layui-layer"]');
        
      if (!detailPopup) {
        return { success: false, error: '未检测到详情弹窗，请先打开一条任务的详情页' };
      }
      
      console.log('[AutoCheck] 检测到详情弹窗，开始校验...');

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
  // 配置：是否强制使用API模式（设为true则API失败时不会降级到弹窗）
  // 当前设为false，让API失败时可以降级到弹窗模式
  const FORCE_API_MODE = false;
  
  async function batchCheckTask(taskData) {
    console.log(`[BatchCheck] ===============================`);
    console.log(`[BatchCheck] 开始校验任务: ${taskData.partsName || '未知零件'}`);
    console.log(`[BatchCheck] 任务ID: ${taskData.id || '无ID'}`);
    console.log(`[BatchCheck] 任务ID长度: ${taskData.id ? taskData.id.length : 0}`);
    console.log(`[BatchCheck] 强制API模式: ${FORCE_API_MODE}`);
    console.log(`[BatchCheck] ===============================`);
    
    try {
      // 验证任务ID格式（应该是40位的十六进制字符串）
      if (!taskData.id || taskData.id.length !== 40) {
        console.log(`[BatchCheck] ⚠️ 任务ID格式不正确，使用弹窗方式`);
        return await batchCheckTaskByPopup(taskData);
      }
      
      // 使用API直接获取任务详情数据
      console.log('[BatchCheck] 尝试使用API获取任务详情...');
      const detailData = await fetchTaskDetailByAPI(taskData.id);
      
      if (detailData.success) {
        console.log('[BatchCheck] API获取成功，使用API数据进行校验');
        // 执行校验（使用API返回的数据）
        const checkResult = await autoCheckDetailByAPI(detailData.data, taskData);
        
        if (!checkResult.success) {
          return { success: false, error: checkResult.error };
        }
        
        // 分析结果
        const allPassed = checkResult.results.every(r => r.passed);
        const hasWarning = checkResult.results.some(r => r.needManual);
        
        return {
          success: true,
          allPassed: allPassed,
          hasWarning: hasWarning,
          results: checkResult.results,
          source: 'api' // 标记数据来源
        };
      }
      
      // API获取失败
      console.log(`[BatchCheck] ❌ API获取失败: ${detailData.error}`);
      
      // 显示错误通知
      showNotification(`API获取失败: ${detailData.error}`, 'error');
      
      if (FORCE_API_MODE) {
        // 强制API模式：不降级，直接返回错误
        console.log('[BatchCheck] ⚠️ 强制API模式开启，不使用弹窗降级');
        return { 
          success: false, 
          error: `API获取失败: ${detailData.error}`,
          apiError: detailData.error,
          rawResponse: detailData.rawResponse
        };
      }
      
      // 非强制模式：降级到弹窗方式
      console.log('[BatchCheck] 降级到弹窗方式');
      return await batchCheckTaskByPopup(taskData);
      
    } catch (err) {
      console.log(`[BatchCheck] API方式异常: ${err.message}`);
      
      if (FORCE_API_MODE) {
        return { 
          success: false, 
          error: `API异常: ${err.message}`
        };
      }
      
      return await batchCheckTaskByPopup(taskData);
    }
  }
  
  // 使用弹窗方式获取任务详情并校验（备用方案）- 全自动流程
  async function batchCheckTaskByPopup(taskData) {
    console.log(`[PopupMode] ====== 开始弹窗模式校验 ======`);
    console.log(`[PopupMode] 任务: ${taskData.partsName || taskData.latestPartsCode}`);
    
    try {
      // 第一步：在任务列表中找到并点击该任务
      console.log('[PopupMode] 步骤1: 自动点击任务行...');
      const clickResult = await clickTaskInList(taskData);
      if (!clickResult.success) {
        console.log(`[PopupMode] ❌ 点击失败: ${clickResult.error}`);
        return { success: false, error: clickResult.error };
      }
      console.log(`[PopupMode] ✓ 点击成功 (${clickResult.method})`);
      
      // 第二步：等待详情页加载
      console.log('[PopupMode] 步骤2: 等待详情页加载...');
      const popupResult = await waitForDetailPopup({ timeout: 10000, checkContent: false });
      if (!popupResult.success) {
        console.log(`[PopupMode] ❌ 等待弹窗失败: ${popupResult.error}`);
        return { success: false, error: popupResult.error };
      }
      console.log('[PopupMode] ✓ 详情页已加载');
      if (popupResult.warning) {
        console.log(`[PopupMode] ⚠️ ${popupResult.warning}`);
      }
      
      // 额外等待确保内容渲染完成
      console.log('[PopupMode] 等待内容渲染...');
      await new Promise(r => setTimeout(r, 1500));
      
      // 第三步：执行校验
      console.log('[PopupMode] 步骤3: 执行一致性校验...');
      const checkResult = await autoCheckDetail();
      
      if (!checkResult.success) {
        console.log(`[PopupMode] ❌ 校验失败: ${checkResult.error}`);
        // 即使校验失败也要关闭弹窗
        await closeDetailPopup();
        return { success: false, error: checkResult.error };
      }
      console.log('[PopupMode] ✓ 校验完成');
      
      // 第四步：关闭详情页，返回列表
      console.log('[PopupMode] 步骤4: 关闭详情页...');
      await closeDetailPopup();
      console.log('[PopupMode] ✓ 详情页已关闭');
      
      // 分析结果
      const allPassed = checkResult.results.every(r => r.passed);
      const hasWarning = checkResult.results.some(r => r.needManual);
      
      console.log(`[PopupMode] ====== 弹窗模式完成 ======`);
      console.log(`[PopupMode] 结果: ${allPassed ? '通过' : (hasWarning ? '需人工' : '不通过')}`);
      
      return {
        success: true,
        allPassed: allPassed,
        hasWarning: hasWarning,
        results: checkResult.results,
        source: 'popup'
      };
      
    } catch (err) {
      console.log(`[PopupMode] ❌ 异常: ${err.message}`);
      // 异常时尝试关闭弹窗
      try {
        await closeDetailPopup();
      } catch (e) {
        // 忽略关闭错误
      }
      return { success: false, error: err.message };
    }
  }

  // API请求缓存
  const apiCache = new Map();
  const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
  
  // 获取缓存键
  function getCacheKey(taskId) {
    return `task_${taskId}`;
  }
  
  // 获取缓存数据
  function getCachedData(taskId) {
    const key = getCacheKey(taskId);
    const cached = apiCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[API Cache] 命中缓存: ${taskId.substring(0, 16)}...`);
      return cached.data;
    }
    return null;
  }
  
  // 设置缓存数据
  function setCachedData(taskId, data) {
    const key = getCacheKey(taskId);
    apiCache.set(key, { data, timestamp: Date.now() });
  }
  
  // 清理过期缓存
  function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of apiCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        apiCache.delete(key);
      }
    }
  }
  
  // 定期清理缓存
  setInterval(cleanExpiredCache, 60000);

  // 通过API获取任务详情 - 优化版本，支持缓存和重试
  async function fetchTaskDetailByAPI(taskId, options = {}) {
    const { useCache = true, retryCount = 2 } = options;
    
    try {
      if (!taskId) {
        console.log('[API] 任务ID为空，无法获取详情');
        return { success: false, error: '任务ID为空' };
      }
      
      // 检查缓存
      if (useCache) {
        const cached = getCachedData(taskId);
        if (cached) {
          return { success: true, data: cached, fromCache: true };
        }
      }
      
      console.log(`[API] 开始获取任务详情, ID: ${taskId}`);
      
      // 构建完整的API URL（使用当前页面的origin）
      const apiUrl = `${window.location.origin}/api/unifomity/uniformityCheckSWTaskSearch/getUniCheckTaskInfo`;
      console.log(`[API] 请求URL: ${apiUrl}`);
      
      // 重试机制
      let lastError = null;
      for (let attempt = 0; attempt <= retryCount; attempt++) {
        if (attempt > 0) {
          console.log(`[API] 第${attempt}次重试...`);
          await new Promise(r => setTimeout(r, 500 * attempt)); // 递增延迟
        }
        
        try {
          // 尝试方式1: JSON格式（根据实际网页分析）
          console.log('[API] 尝试JSON格式请求...');
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ id: taskId }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          console.log(`[API] 响应状态: ${response.status}`);
          
          if (!response.ok) {
            const errorMsg = `API请求失败: ${response.status} ${response.statusText}`;
            console.log(`[API] ${errorMsg}`);
            lastError = errorMsg;
            continue; // 继续重试
          }
          
          const result = await response.json();
          console.log('[API] 响应数据:', result);
          
          // 检查响应格式：respCode为"0"表示成功
          let data = null;
          if (result.respCode === '0' && result.data) {
            console.log('[API] ✅ 成功获取任务详情数据');
            data = result.data;
          } else if (result.ok === true && result.data) {
            console.log('[API] ✅ 成功获取任务详情数据（ok格式）');
            data = result.data;
          } else if (result.data) {
            // 只要有data就尝试使用
            console.log('[API] ✅ 获取到数据（无明确成功标识）');
            data = result.data;
          }
          
          if (data) {
            // 缓存数据
            if (useCache) {
              setCachedData(taskId, data);
            }
            return { success: true, data };
          }
          
          // API返回了业务错误
          const errorMsg = result.message || result.msg || `服务器错误(respCode: ${result.respCode})`;
          console.log(`[API] ❌ 服务器返回错误: ${errorMsg}`);
          lastError = errorMsg;
          
        } catch (err) {
          if (err.name === 'AbortError') {
            console.log('[API] ❌ 请求超时');
            lastError = '请求超时';
          } else {
            console.log(`[API] ❌ 请求异常: ${err.message}`);
            lastError = err.message;
          }
        }
      }
      
      // 所有重试都失败了
      return { success: false, error: lastError || '请求失败' };
      
    } catch (err) {
      console.log(`[API] ❌ 请求异常: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
  
  // 在任务列表中点击指定任务 - 增强版，支持多种匹配方式和点击策略
  async function clickTaskInList(taskData) {
    console.log(`[AutoClick] 开始查找任务: ${taskData.partsName || taskData.latestPartsCode}`);
    
    return new Promise(async (resolve) => {
      const tableBody = document.querySelector('.layui-table-body.layui-table-main tbody');
      if (!tableBody) {
        console.log('[AutoClick] ❌ 未找到任务列表表格');
        resolve({ success: false, error: '未找到任务列表' });
        return;
      }
      
      const rows = tableBody.querySelectorAll('tr');
      console.log(`[AutoClick] 表格行数: ${rows.length}`);
      
      let foundRow = null;
      let matchMethod = '';
      
      // 第一轮：精确匹配（通过任务ID）
      if (taskData.id) {
        for (const tr of rows) {
          const rowId = tr.getAttribute('data-id') || '';
          const checkbox = tr.querySelector('input[type="checkbox"]');
          const checkboxId = checkbox ? checkbox.getAttribute('data-id') || '' : '';
          
          if (rowId === taskData.id || checkboxId === taskData.id) {
            foundRow = tr;
            matchMethod = 'ID匹配';
            console.log(`[AutoClick] ✓ 通过ID匹配到任务`);
            break;
          }
        }
      }
      
      // 第二轮：精确匹配（零件名称+零件号）
      if (!foundRow) {
        for (const tr of rows) {
          const partsNameTd = tr.querySelector('td[data-field="partsName"]');
          const latestPartsCodeTd = tr.querySelector('td[data-field="latestPartsCode"]');
          
          const partsName = partsNameTd ? partsNameTd.textContent.trim() : '';
          const latestPartsCode = latestPartsCodeTd ? latestPartsCodeTd.textContent.trim() : '';
          
          // 优先同时匹配两个字段
          if (partsName && latestPartsCode && 
              partsName === taskData.partsName && 
              latestPartsCode === taskData.latestPartsCode) {
            foundRow = tr;
            matchMethod = '双字段匹配';
            console.log(`[AutoClick] ✓ 通过零件名称+零件号匹配到任务`);
            break;
          }
        }
      }
      
      // 第三轮：单字段匹配
      if (!foundRow) {
        for (const tr of rows) {
          const partsNameTd = tr.querySelector('td[data-field="partsName"]');
          const latestPartsCodeTd = tr.querySelector('td[data-field="latestPartsCode"]');
          
          const partsName = partsNameTd ? partsNameTd.textContent.trim() : '';
          const latestPartsCode = latestPartsCodeTd ? latestPartsCodeTd.textContent.trim() : '';
          
          if (partsName === taskData.partsName || latestPartsCode === taskData.latestPartsCode) {
            foundRow = tr;
            matchMethod = '单字段匹配';
            console.log(`[AutoClick] ✓ 通过单字段匹配到任务`);
            break;
          }
        }
      }
      
      if (!foundRow) {
        console.log(`[AutoClick] ❌ 未找到匹配的任务: ${taskData.partsName || taskData.latestPartsCode}`);
        resolve({ success: false, error: '未找到匹配的任务: ' + (taskData.partsName || taskData.latestPartsCode) });
        return;
      }
      
      console.log(`[AutoClick] 匹配方式: ${matchMethod}`);
      
      // 高亮显示要点击的行（方便用户观察）
      foundRow.style.backgroundColor = '#e3f2fd';
      foundRow.style.transition = 'background-color 0.3s';
      
      // 尝试多种点击策略
      let clicked = false;
      let clickPromise = null;
      
      // 策略1：点击操作列按钮
      const operationTd = foundRow.querySelector('td[data-field="8"]');
      if (operationTd) {
        const handleBtn = operationTd.querySelector('button');
        if (handleBtn) {
          console.log('[AutoClick] 点击操作列按钮');
          foundRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
          clickPromise = new Promise((resolve) => {
            setTimeout(() => {
              handleBtn.click();
              clicked = true;
              resolve();
            }, 300);
          });
        }
      }
      
      // 策略2：如果没有操作按钮，尝试双击行
      if (!clicked && !clickPromise) {
        console.log('[AutoClick] 双击行打开详情');
        foundRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clickPromise = new Promise((resolve) => {
          setTimeout(() => {
            // 模拟真实双击事件
            const dblclickEvent = new MouseEvent('dblclick', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            foundRow.dispatchEvent(dblclickEvent);
            clicked = true;
            resolve();
          }, 300);
        });
      }
      
      // 策略3：尝试查找行内的链接或点击区域
      if (!clicked && !clickPromise) {
        const clickable = foundRow.querySelector('a, .layui-table-cell, td');
        if (clickable) {
          console.log('[AutoClick] 点击行内元素');
          foundRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
          clickPromise = new Promise((resolve) => {
            setTimeout(() => {
              clickable.click();
              clicked = true;
              resolve();
            }, 300);
          });
        }
      }
      
      // 等待点击完成
      if (clickPromise) {
        await clickPromise;
      }
      
      // 恢复行背景色
      setTimeout(() => {
        foundRow.style.backgroundColor = '';
      }, 1000);
      
      if (clicked) {
        console.log('[AutoClick] ✅ 点击成功');
        resolve({ success: true, method: matchMethod });
      } else {
        console.log('[AutoClick] ❌ 点击失败');
        resolve({ success: false, error: '无法点击任务行' });
      }
    });
  }
  
  // 等待详情页加载 - 增强版，支持检测加载状态
  async function waitForDetailPopup(options = {}) {
    const { timeout = 10000, checkContent = true } = options;
    
    return new Promise((resolve) => {
      const startTime = Date.now();
      let found = false;
      
      console.log('[WaitPopup] 开始等待详情页加载...');
      
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        
        // 查找弹窗元素 - 更精确的选择器
        const detailPopup = document.querySelector('.layui-layer.layui-layer-page')
          || document.querySelector('#layui-layer2')
          || document.querySelector('#handleTaskPopup')
          || document.querySelector('.layui-layer-dialog')
          || document.querySelector('[class*="layui-layer"]');
        
        if (detailPopup && !found) {
          found = true;
          console.log(`[WaitPopup] ✓ 找到弹窗元素 (耗时${elapsed}ms)`);
          
          // 如果需要检查内容加载
          if (checkContent) {
            // 检查关键元素是否存在
            const contentLoaded = detailPopup.querySelector('#basicsPartsName') 
              || detailPopup.querySelector('[id*="basics"]')
              || detailPopup.querySelector('.layui-tab-content')
              || detailPopup.querySelector('.layui-form')
              || detailPopup.querySelector('table')
              || detailPopup.querySelector('input[name]')
              || detailPopup.querySelector('button');
            
            if (contentLoaded) {
              console.log(`[WaitPopup] ✓ 内容已加载 (耗时${elapsed}ms)`);
              clearInterval(checkInterval);
              // 额外等待确保渲染完成
              setTimeout(() => resolve({ success: true, element: detailPopup }), 800);
            } else if (elapsed > timeout) {
              console.log(`[WaitPopup] ⚠️ 超时但弹窗已出现`);
              clearInterval(checkInterval);
              resolve({ success: true, element: detailPopup, warning: '内容可能未完全加载' });
            }
          } else {
            clearInterval(checkInterval);
            setTimeout(() => resolve({ success: true, element: detailPopup }), 800);
          }
        } else if (elapsed > timeout && !found) {
          console.log(`[WaitPopup] ❌ 等待超时 (${timeout}ms)`);
          clearInterval(checkInterval);
          resolve({ success: false, error: '等待详情页超时' });
        }
      }, 150);
    });
  }
  
  // 关闭详情页 - 增强版，支持多种关闭方式
  async function closeDetailPopup() {
    return new Promise((resolve) => {
      console.log('[ClosePopup] 尝试关闭详情页...');
      
      let closed = false;
      
      // 方式1：点击关闭按钮
      const closeBtn = document.querySelector('#layui-layer2 .layui-layer-close')
        || document.querySelector('.layui-layer-close')
        || document.querySelector('.layui-layer-setwin .layui-layer-close');
      
      if (closeBtn) {
        console.log('[ClosePopup] 点击关闭按钮');
        closeBtn.click();
        closed = true;
      }
      
      // 方式2：点击取消按钮（如果有）
      if (!closed) {
        const cancelBtn = document.querySelector('#layui-layer2 button[data-type="cancel"]')
          || document.querySelector('#handleTaskPopup button[data-type="cancel"]')
          || document.querySelector('#layui-layer2 .layui-btn[lay-filter="cancel"]');
        
        if (cancelBtn) {
          console.log('[ClosePopup] 点击取消按钮');
          cancelBtn.click();
          closed = true;
        }
      }
      
      // 方式3：触发ESC键
      if (!closed) {
        console.log('[ClosePopup] 触发ESC键关闭');
        const escEvent = new KeyboardEvent('keydown', {
          key: 'Escape',
          keyCode: 27,
          bubbles: true
        });
        document.dispatchEvent(escEvent);
      }
      
      // 等待关闭动画并确认关闭
      let checkCount = 0;
      const checkClose = setInterval(() => {
        checkCount++;
        const popup = document.querySelector('#layui-layer2')
          || document.querySelector('#handleTaskPopup')
          || document.querySelector('.layui-layer');
        
        if (!popup || checkCount > 30) {
          clearInterval(checkClose);
          console.log('[ClosePopup] ✓ 弹窗已关闭');
          resolve({ success: true });
        }
      }, 100);
    });
  }

  // ============ 3.4 Auto Check Detail by API Data ============
  async function autoCheckDetailByAPI(apiData, taskData) {
    try {
      const results = [];
      
      // --- 3.4.1 Extract basic info from API data ---
      const supplierName = apiData.supplierName || '';
      const supplierCode = apiData.supplierCode || '';
      const partsName = apiData.partsName || '';
      const latestPartsCode = apiData.latestPartsCode || '';
      const carType = apiData.carType || '';

      results.push({
        item: '基本信息',
        result: `零件: ${partsName}, 零件号: ${latestPartsCode}, 车型: ${carType}`,
        passed: true
      });

      // --- 3.4.2 Check manufacturer name consistency ---
      // 从API数据中获取生产企业列表
      const manufacturerList = apiData.manufacturerList || apiData.manufacturerVos || [];
      const manufacturerNames = manufacturerList.map(m => m.manufacturerName || m.name || '').filter(Boolean);

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

      // --- 3.4.3 Check CCC info from API ---
      const isCccOnPage = apiData.isCccParts === '1' || apiData.isCccParts === 1 || apiData.cccFlag === true;

      // --- 3.4.4 Check model info from API ---
      const modelList = apiData.modelList || apiData.modelVos || [];
      const pageModels = modelList.map(m => m.model || m.modelCode || '').filter(Boolean);

      // --- 3.4.5 Query Excel for comparison ---
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

      // --- 3.4.6 AI Image Recognition (from API attachments) ---
      // 从API数据中获取附件信息
      const cccAttachment = apiData.cccFile || apiData.cccAttachment || {};
      const modelAttachment = apiData.modelFile || apiData.modelAttachment || {};
      
      // CCC attachment
      if (isCccOnPage) {
        const cccResult = await recognizeAttachmentFromAPI(cccAttachment, 'ccc', expectedModel, latestPartsCode);
        results.push(cccResult);
      }

      // Model attachment
      const modelResult = await recognizeAttachmentFromAPI(modelAttachment, 'model', expectedModel, latestPartsCode);
      results.push(modelResult);

      // Display results panel
      showCheckResultPanel(results);

      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 从API附件数据识别图片
  async function recognizeAttachmentFromAPI(attachmentData, recognitionType, expectedModel, expectedPartNumber) {
    const itemLabel = recognitionType === 'ccc' ? 'CCC标识(AI识别)' : '型号标识(AI识别)';
    
    // 检查附件数据
    if (!attachmentData || !attachmentData.fileId) {
      return {
        item: itemLabel,
        result: '无附件',
        passed: false,
        needManual: true
      };
    }

    const fileName = attachmentData.fileName || '';
    const fileId = attachmentData.fileId;
    
    // 检查是否是PDF
    if (fileName.toLowerCase().endsWith('.pdf')) {
      return {
        item: itemLabel,
        result: `附件为PDF文件(${fileName})，请人工下载查看确认`,
        passed: false,
        needManual: true
      };
    }

    try {
      // 下载文件并识别
      const base64 = await fetchFileAsBase64(fileId);
      if (base64) {
        return await callAIAndInterpret(base64, recognitionType, expectedModel, expectedPartNumber);
      }
    } catch (err) {
      return {
        item: itemLabel,
        result: `附件下载失败: ${err.message}，请人工确认`,
        passed: false,
        needManual: true
      };
    }

    return {
      item: itemLabel,
      result: `有附件(${fileName})但无法自动提取，请人工确认`,
      passed: false,
      needManual: true
    };
  }

  // ============ 3.5 Batch Approve Task ============
  async function batchApproveTask(taskData) {
    try {
      // 第一步：使用API获取任务详情（预校验，确保任务可以审核）
      const detailData = await fetchTaskDetailByAPI(taskData.id);
      
      if (!detailData.success) {
        return { success: false, error: detailData.error };
      }
      
      // 第二步：在任务列表中找到并点击该任务（审核需要打开页面操作表单）
      const clickResult = await clickTaskInList(taskData);
      if (!clickResult.success) {
        return { success: false, error: clickResult.error };
      }
      
      // 等待详情页加载
      await waitForDetailPopup();
      
      // 执行自动审核
      const approveResult = await autoApproveWithSubmit();
      
      if (!approveResult.success) {
        // 关闭详情页再返回错误
        await closeDetailPopup();
        return { success: false, error: approveResult.error };
      }
      
      // 关闭详情页，返回列表
      await closeDetailPopup();
      
      return {
        success: true,
        message: approveResult.message
      };
      
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 自动审核并提交（带自动点击提交按钮）
  async function autoApproveWithSubmit() {
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

      // 等待一下确保表单状态更新
      await new Promise(resolve => setTimeout(resolve, 200));

      // 尝试点击提交按钮
      const submitBtn = findSubmitButton(detailPopup);
      let submitResult = '';
      
      if (submitBtn) {
        submitBtn.click();
        submitResult = '，已自动点击提交按钮';
        // 等待提交完成
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        submitResult = '，未找到提交按钮，请手动提交';
      }

      return {
        success: true,
        message: '已选择: 关键件清单一致=是, 确认结果=同意' + submitResult
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
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
    
    // 使校验结果面板可拖动（通过标题栏拖动）
    makeDraggable(panel, '.ccp-header');
  }

  // ============ Floating Button ============
  function injectFloatingButton() {
    if (document.getElementById('consistency-float-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'consistency-float-btn';
    btn.innerHTML = '<span class="cfb-icon">&#9989;</span><span class="cfb-text">一致性助手</span>';
    btn.title = '一致性确认助手（可拖动）';

    const menu = document.createElement('div');
    menu.id = 'consistency-float-menu';
    menu.style.display = 'none';
    menu.innerHTML = `
      <div class="cfm-header">一致性助手菜单</div>
      <div class="cfm-item" data-action="extract">提取任务列表</div>
      <div class="cfm-item" data-action="check">一键校验(含AI识别)</div>
      <div class="cfm-item" data-action="approve">自动审核</div>
    `;

    // 点击按钮打开/关闭菜单（区分点击和拖动）
    let dragStartTime = 0;
    btn.addEventListener('mousedown', () => {
      dragStartTime = Date.now();
    });
    
    btn.addEventListener('click', (e) => {
      // 如果拖动时间超过200ms，认为是拖动而不是点击
      const dragDuration = Date.now() - dragStartTime;
      if (dragDuration > 200) {
        e.stopPropagation();
        return;
      }
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
    
    // 使悬浮按钮和菜单可拖动
    makeDraggable(btn);
    makeDraggable(menu, '.cfm-header');
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

  // ============ Drag Functionality ============
  function makeDraggable(element, handleSelector) {
    if (!element) return;
    
    const handle = handleSelector ? element.querySelector(handleSelector) : element;
    if (!handle) return;
    
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    
    // 获取当前位置
    function getCurrentPosition() {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    }
    
    handle.addEventListener('mousedown', (e) => {
      // 如果点击的是按钮、输入框等交互元素，不触发拖动
      if (e.target.tagName === 'BUTTON' || 
          e.target.tagName === 'INPUT' || 
          e.target.tagName === 'SELECT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.closest('.ccp-close') ||
          e.target.closest('.cfm-item')) {
        return;
      }
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      const pos = getCurrentPosition();
      initialLeft = pos.left;
      initialTop = pos.top;
      
      // 改为绝对定位
      element.style.position = 'fixed';
      element.style.left = initialLeft + 'px';
      element.style.top = initialTop + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
      element.style.cursor = 'grabbing';
      
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;
      
      // 限制在视窗内
      const rect = element.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));
      
      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.style.cursor = '';
      }
    });
    
    // 触摸设备支持
    handle.addEventListener('touchstart', (e) => {
      if (e.target.tagName === 'BUTTON' || 
          e.target.tagName === 'INPUT' || 
          e.target.tagName === 'SELECT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.closest('.ccp-close') ||
          e.target.closest('.cfm-item')) {
        return;
      }
      
      isDragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      
      const pos = getCurrentPosition();
      initialLeft = pos.left;
      initialTop = pos.top;
      
      element.style.position = 'fixed';
      element.style.left = initialLeft + 'px';
      element.style.top = initialTop + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    }, { passive: false });
    
    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      
      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;
      
      const rect = element.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));
      
      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';
      e.preventDefault();
    }, { passive: false });
    
    document.addEventListener('touchend', () => {
      isDragging = false;
    });
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

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
        // 强制使用API模式，从页面获取任务ID后调用API校验
        autoCheckDetailByAPIFromPage().then(sendResponse);
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
      case 'OPEN_TASK_DETAIL':
        openTaskDetailPage(message.taskId, message.detailPath, message.taskData).then(sendResponse);
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
              // 列表API中独有的型号标识字段
              models: item.models || '',
              modelMarkPositions: item.modelMarkPositions || '',
              modelMarkApplicateMethods: item.modelMarkApplicateMethods || '',
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
            // 列表API中独有的型号标识字段
            models: cacheData.models || '',
            modelMarkPositions: cacheData.modelMarkPositions || '',
            modelMarkApplicateMethods: cacheData.modelMarkApplicateMethods || '',
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
  
  // 从页面获取任务ID（用于详情页一键检验）
  function extractTaskIdFromPage() {
    // 尝试从URL中获取
    const urlParams = new URLSearchParams(window.location.search);
    const urlTaskId = urlParams.get('taskId') || urlParams.get('id');
    if (urlTaskId) return urlTaskId;
    
    // 尝试从layui table cache中获取当前选中的任务
    try {
      if (window.layui && window.layui.table && window.layui.table.cache) {
        const knownTableIds = ['table-task-finish', 'tableTaskFinish', 'task-finish'];
        for (const tableId of knownTableIds) {
          const cache = window.layui.table.cache[tableId];
          if (cache && cache.length > 0) {
            // 返回第一个有ID的任务（通常是当前选中的）
            const taskWithId = cache.find(t => t.id);
            if (taskWithId) return taskWithId.id;
          }
        }
      }
    } catch (e) {
      console.log('[ExtractTaskId] 从cache获取失败:', e.message);
    }
    
    // 尝试从当前高亮/选中的行获取
    try {
      const highlightedRow = document.querySelector('.layui-table-click, .layui-table-selected');
      if (highlightedRow) {
        const checkbox = highlightedRow.querySelector('input[type="checkbox"], input.layui-checkbox');
        if (checkbox) {
          const id = checkbox.getAttribute('data-id') || checkbox.value;
          if (id && id.length === 40) return id;
        }
      }
    } catch (e) {
      console.log('[ExtractTaskId] 从选中行获取失败:', e.message);
    }
    
    return null;
  }
  
  // 使用API从页面进行校验（强制API模式）
  async function autoCheckDetailByAPIFromPage() {
    console.log('[AutoCheckAPI] 强制API模式，从页面获取任务ID...');
    
    // 获取任务ID
    const taskId = extractTaskIdFromPage();
    if (!taskId) {
      return { 
        success: false, 
        error: '无法从页面获取任务ID，请确保已选择任务。如果问题持续，请使用批量校验功能。' 
      };
    }
    
    console.log('[AutoCheckAPI] 获取到任务ID:', taskId.substring(0, 16) + '...');
    
    // 构建taskData
    const taskData = { id: taskId };
    
    // 调用批量校验的API方式（复用逻辑）
    return await batchCheckTask(taskData);
  }
  
  async function autoCheckDetail(apiAttachmentData = null) {
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
      if (apiAttachmentData) {
        console.log('[AutoCheck] 使用API附件数据:', apiAttachmentData);
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
          (name) => isNormalizedEqual(name, supplierName) || isNormalizedIncludes(supplierName, name) || isNormalizedIncludes(name, supplierName)
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
              pageModels.some((pm) => isNormalizedIncludes(pm, em) || isNormalizedIncludes(em, pm))
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
            manufacturerNames.some((mn) => isNormalizedIncludes(mn, em) || isNormalizedIncludes(em, mn))
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
      console.log('[AutoCheck] 开始附件识别，apiAttachmentData:', apiAttachmentData ? '有数据' : '无数据');
      if (apiAttachmentData) {
        console.log('[AutoCheck] CCC附件:', apiAttachmentData.cccAttachment ? apiAttachmentData.cccAttachment.fileName : '无');
        console.log('[AutoCheck] 型号附件:', apiAttachmentData.modelAttachment ? apiAttachmentData.modelAttachment.fileName : '无');
      }
      
      // CCC attachment
      if (isCccOnPage) {
        const cccAttachment = apiAttachmentData && apiAttachmentData.cccAttachment ? apiAttachmentData.cccAttachment : null;
        console.log('[AutoCheck] 传递CCC附件:', cccAttachment ? cccAttachment.fileName : '无');
        const cccResult = await recognizeAttachmentImage(
          detailPopup, '#cccFile', 'ccc', expectedModel, latestPartsCode,
          cccAttachment
        );
        results.push(cccResult);
      }

      // Model attachment
      const modelAttachment = apiAttachmentData && apiAttachmentData.modelAttachment ? apiAttachmentData.modelAttachment : null;
      console.log('[AutoCheck] 传递型号附件:', modelAttachment ? modelAttachment.fileName : '无');
      const modelResult = await recognizeAttachmentImage(
        detailPopup, '#modelFile', 'model', expectedModel, latestPartsCode,
        modelAttachment
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
   * @param {HTMLElement} detailPopup - 详情弹窗DOM元素
   * @param {string} containerSelector - 附件容器选择器
   * @param {string} recognitionType - 识别类型 ('ccc' 或 'model')
   * @param {string} expectedModel - 期望的型号
   * @param {string} expectedPartNumber - 期望的零件号
   * @param {Object} apiAttachment - API获取的附件数据 (可选)
   */
  async function recognizeAttachmentImage(detailPopup, containerSelector, recognitionType, expectedModel, expectedPartNumber, apiAttachment = null) {
    const itemLabel = recognitionType === 'ccc' ? 'CCC标识(AI识别)' : '型号标识(AI识别)';
    
    console.log(`[recognizeAttachmentImage] 开始识别 - 类型: ${recognitionType}, API附件:`, apiAttachment ? '有' : '无');
    if (apiAttachment) {
      console.log(`[recognizeAttachmentImage] API附件数据:`, JSON.stringify(apiAttachment));
    }
    
    // 如果提供了API附件数据，优先使用API数据
    if (apiAttachment && apiAttachment.fileId) {
      console.log(`[recognizeAttachmentImage] 使用API附件数据:`, apiAttachment.fileName);
      return await recognizeAttachmentFromAPI(apiAttachment, recognitionType, expectedModel, expectedPartNumber);
    }
    console.log(`[recognizeAttachmentImage] API附件数据无效，回退到DOM查询`);
    
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
    const response = await fetch(`/api/unifomity/uniformityFileManagemant/fileDownload?fileId=${fileId}`);
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
    // 使用规范化比对，将φ/Φ视为相同字符
    let modelFound = false;
    if (expectedModel) {
      modelFound = isNormalizedIncludes(allText, expectedModel)
        || isNormalizedIncludes(recognizedModel, expectedModel)
        || isNormalizedIncludes(expectedModel, recognizedModel);
    }

    // Check part number
    let partNumFound = false;
    if (expectedPartNumber) {
      partNumFound = isNormalizedIncludes(allText, expectedPartNumber)
        || isNormalizedIncludes(recognizedPartNum, expectedPartNumber);
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
  // 当前设为false，让API失败时可以降级到弹窗模式以正确获取CCC状态
  const FORCE_API_MODE = false; // 禁用强制API模式，允许降级到弹窗方式获取CCC信息
  
  async function batchCheckTask(taskData) {
    console.log(`[BatchCheck] ===============================`);
    console.log(`[BatchCheck] 开始校验任务: ${taskData ? (taskData.partsName || '未知零件') : 'taskData为空!'}`);
    
    // 检查 taskData 是否有效
    if (!taskData) {
      console.error(`[BatchCheck] ❌ taskData 为 null/undefined!`);
      return { success: false, error: 'taskData为空' };
    }
    
    console.log(`[BatchCheck] 任务ID: ${taskData.id || '无ID'}`);
    console.log(`[BatchCheck] 任务ID长度: ${taskData.id ? taskData.id.length : 0}`);
    console.log(`[BatchCheck] taskData 完整内容:`, JSON.stringify(taskData, null, 2));
    console.log(`[BatchCheck] 强制API模式: ${FORCE_API_MODE}`);
    console.log(`[BatchCheck] ===============================`);
    
    try {
      // 验证任务ID是否存在
      if (!taskData.id) {
        console.error(`[BatchCheck] ❌ 任务ID为空`);
        return { success: false, error: '任务ID为空' };
      }
      
      // 使用API直接获取任务详情数据
      console.log('[BatchCheck] 尝试使用API获取任务详情...');
      const detailData = await fetchTaskDetailByAPI(taskData.id);
      
      if (detailData.success) {
        console.log('[BatchCheck] API获取成功，使用API数据进行校验');
        console.log('[BatchCheck] 调用前 taskData 类型:', typeof taskData);
        console.log('[BatchCheck] 调用前 taskData 值:', taskData);
        console.log('[BatchCheck] 调用前 taskData.id:', taskData ? taskData.id : 'taskData为空');
        
        // 执行校验（使用API返回的数据）
        // autoCheckDetailByAPI会在内部处理CCC状态获取：
        // - 优先从API数据中获取CCC字段
        // - 如果API没有CCC字段，会自动打开弹窗仅获取CCC状态
        // - 其他信息（供应商、零件名称等）始终使用API数据
        const currentTaskData = taskData;
        console.log('[BatchCheck] currentTaskData 赋值后:', currentTaskData ? currentTaskData.id : 'null');
        const checkResult = await autoCheckDetailByAPI(detailData.data, currentTaskData);
        
        if (!checkResult.success) {
          return { success: false, error: checkResult.error };
        }
        
        // 分析结果
        const allPassed = checkResult.results.every(r => r.passed);
        // 修改：当所有检验项中有一项不满足（passed为false）时，需要人工确认
        const hasWarning = !allPassed;
        
        return {
          success: true,
          allPassed: allPassed,
          hasWarning: hasWarning,
          results: checkResult.results,
          source: 'api' // 标记数据来源（即使CCC从弹窗获取，其他数据仍来自API）
        };
      }
      
      // API获取失败 - 强制API模式下直接返回错误
      console.log(`[BatchCheck] ❌ API获取失败: ${detailData.error}`);
      showNotification(`API获取失败: ${detailData.error}`, 'error');
      return { 
        success: false, 
        error: `API获取失败: ${detailData.error}`,
        apiError: detailData.error,
        rawResponse: detailData.rawResponse
      };
      
    } catch (err) {
      console.log(`[BatchCheck] API方式异常: ${err.message}`);
      return { 
        success: false, 
        error: `API异常: ${err.message}`
      };
    }
  }
  
  // 使用弹窗方式获取任务详情并校验（备用方案）- 全自动流程
  // silentMode: 静默模式，隐藏弹窗界面，用户看不到操作过程
  async function batchCheckTaskByPopup(taskData, silentMode = true) {
    console.log(`[PopupMode] ====== 开始弹窗模式校验 ======`);
    console.log(`[PopupMode] 任务: ${taskData.partsName || taskData.latestPartsCode}`);
    console.log(`[PopupMode] 静默模式: ${silentMode ? '开启' : '关闭'}`);
    
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
      const popupResult = await waitForDetailPopup({ timeout: 15000, checkContent: false });
      if (!popupResult.success) {
        console.log(`[PopupMode] ❌ 等待弹窗失败: ${popupResult.error}`);
        return { success: false, error: popupResult.error };
      }
      console.log('[PopupMode] ✓ 详情页已加载');
      if (popupResult.warning) {
        console.log(`[PopupMode] ⚠️ ${popupResult.warning}`);
      }
      
      // 静默模式：隐藏弹窗，用户看不到操作过程
      let popupElement = popupResult.element;
      if (silentMode && popupElement) {
        console.log('[PopupMode] 静默模式：隐藏弹窗界面');
        popupElement.style.visibility = 'hidden';
        popupElement.style.opacity = '0';
        // 同时隐藏遮罩层
        const shade = document.querySelector('.layui-layer-shade');
        if (shade) {
          shade.style.visibility = 'hidden';
          shade.style.opacity = '0';
        }
      }
      
      // 额外等待确保内容渲染完成
      console.log('[PopupMode] 等待内容渲染...');
      await new Promise(r => setTimeout(r, 1500));
      
      // 第三步：通过API获取附件数据（解决DOM查询可能找不到附件的问题）
      console.log('[PopupMode] 步骤3: 通过API获取附件数据...');
      let apiAttachmentData = null;
      try {
        const taskId = taskData.id;
        if (taskId) {
          const attachApiUrl = `${window.location.origin}/api/unifomity/uniformityCheckSWTaskWaitFile/getUniformityCheckFile?uniformityCheckTaskId=${taskId}`;
          console.log('[PopupMode] 附件API URL:', attachApiUrl);
          
          const attachResponse = await fetch(attachApiUrl, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
          });
          
          if (attachResponse.ok) {
            const attachResult = await attachResponse.json();
            if (attachResult.ok && attachResult.data && attachResult.data.length > 0) {
              const attachmentList = attachResult.data;
              console.log('[PopupMode] 获取到附件列表:', attachmentList.length, '个');
              
              // 筛选CCC标识和型号标识附件
              // type: 0=CCC标识, 1=型号标识
              const cccAttachment = attachmentList.find(a => a.type === '0' || a.type === 0);
              const modelAttachment = attachmentList.find(a => a.type === '1' || a.type === 1);
              
              apiAttachmentData = {
                cccAttachment: cccAttachment,
                modelAttachment: modelAttachment
              };
              
              console.log('[PopupMode] CCC附件:', cccAttachment ? cccAttachment.fileName : '无', 'fileId:', cccAttachment ? cccAttachment.fileId : '无');
              console.log('[PopupMode] 型号附件:', modelAttachment ? modelAttachment.fileName : '无', 'fileId:', modelAttachment ? modelAttachment.fileId : '无');
              console.log('[PopupMode] apiAttachmentData 结构:', JSON.stringify({
                hasCcc: !!apiAttachmentData.cccAttachment,
                hasModel: !!apiAttachmentData.modelAttachment,
                cccFileId: apiAttachmentData.cccAttachment?.fileId,
                modelFileId: apiAttachmentData.modelAttachment?.fileId
              }));
            } else {
              console.log('[PopupMode] 附件API返回无数据');
            }
          } else {
            console.log('[PopupMode] 附件API请求失败，状态码:', attachResponse.status);
          }
        }
      } catch (err) {
        console.log('[PopupMode] 获取附件信息失败:', err.message);
        // 继续执行，不阻断主流程
      }
      
      // 第四步：执行校验（传入API附件数据）
      console.log('[PopupMode] 步骤4: 执行一致性校验...');
      const checkResult = await autoCheckDetail(apiAttachmentData);
      
      if (!checkResult.success) {
        console.log(`[PopupMode] ❌ 校验失败: ${checkResult.error}`);
        // 即使校验失败也要关闭弹窗
        await closeDetailPopup();
        return { success: false, error: checkResult.error };
      }
      console.log('[PopupMode] ✓ 校验完成');
      
      // 第五步：关闭详情页，返回列表
      console.log('[PopupMode] 步骤5: 关闭详情页...');
      await closeDetailPopup();
      console.log('[PopupMode] ✓ 详情页已关闭');
      
      // 分析结果
      const allPassed = checkResult.results.every(r => r.passed);
      // 修改：当所有检验项中有一项不满足（passed为false）时，需要人工确认
      const hasWarning = !allPassed;
      
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

  // ============ 附件获取辅助函数 ============
  
  /**
   * 从主任务详情API响应中提取附件信息
   * 有些任务状态下，附件信息可能直接包含在主API响应中
   * @param {Object} apiData - 主任务详情API响应数据
   * @returns {Array} 附件列表
   */
  function extractAttachmentsFromApiData(apiData) {
    const attachments = [];
    
    if (!apiData) return attachments;
    
    // 检查可能的附件字段
    const possibleAttachmentFields = [
      'attachmentList', 'attachments', 'fileList', 'files', 
      'cccFile', 'modelFile', 'cccAttachment', 'modelAttachment',
      'uniformityCheckFileList', 'checkFiles', 'fileData'
    ];
    
    console.log('[API] 检查主API响应中的附件字段...');
    
    for (const field of possibleAttachmentFields) {
      if (apiData[field]) {
        console.log(`[API] 发现可能的附件字段: ${field}`, apiData[field]);
        
        const data = apiData[field];
        if (Array.isArray(data) && data.length > 0) {
          // 如果是数组，直接添加到附件列表
          for (const item of data) {
            if (item.fileId || item.fileName) {
              attachments.push({
                fileId: item.fileId || item.id,
                fileName: item.fileName || item.name,
                fileType: item.fileType || item.type,
                type: item.type || determineAttachmentType(item.fileName || item.name)
              });
            }
          }
        } else if (typeof data === 'object' && data !== null) {
          // 如果是单个对象
          if (data.fileId || data.fileName) {
            attachments.push({
              fileId: data.fileId || data.id,
              fileName: data.fileName || data.name,
              fileType: data.fileType || data.type,
              type: data.type || determineAttachmentType(data.fileName || data.name)
            });
          }
        }
      }
    }
    
    // 检查嵌套结构
    if (attachments.length === 0) {
      // 检查data内部是否有附件相关字段
      const allKeys = Object.keys(apiData);
      const attachmentKeys = allKeys.filter(k => 
        k.toLowerCase().includes('file') || 
        k.toLowerCase().includes('attachment') ||
        k.toLowerCase().includes('ccc') ||
        k.toLowerCase().includes('model')
      );
      
      if (attachmentKeys.length > 0) {
        console.log('[API] 可能的附件相关字段:', attachmentKeys);
        
        for (const key of attachmentKeys) {
          const val = apiData[key];
          if (Array.isArray(val) && val.length > 0) {
            console.log(`[API] 从字段 ${key} 获取数据:`, val);
            for (const item of val) {
              if (item && (item.fileId || item.fileName || item.id)) {
                attachments.push({
                  fileId: item.fileId || item.id,
                  fileName: item.fileName || item.name || `${key}_file`,
                  fileType: item.fileType || item.fileSuffix,
                  type: item.type || determineAttachmentType(item.fileName || item.name)
                });
              }
            }
          }
        }
      }
    }
    
    return attachments;
  }
  
  /**
   * 根据文件名判断附件类型
   * @param {string} fileName - 文件名
   * @returns {string} 附件类型 ('0'=CCC标识, '1'=型号标识)
   */
  function determineAttachmentType(fileName) {
    if (!fileName) return '1'; // 默认型号标识
    
    const lowerName = fileName.toLowerCase();
    if (lowerName.includes('ccc') || lowerName.includes('3c')) {
      return '0'; // CCC标识
    }
    return '1'; // 型号标识
  }
  
  /**
   * 尝试备用附件API端点
   * 当主要附件API失败时，尝试其他可能的端点
   * @param {string} taskId - 任务ID
   * @returns {Array} 附件列表
   */
  async function tryAlternativeAttachmentApis(taskId) {
    const attachments = [];
    
    // 备用API端点列表
    const alternativeApis = [
      // 原始端点（可能不同参数格式）
      { 
        url: `${window.location.origin}/api/unifomity/uniformityCheckSWTaskWaitFile/getUniformityCheckFile`,
        method: 'POST',
        body: JSON.stringify({ uniformityCheckTaskId: taskId })
      },
      // 可能的变体端点
      { 
        url: `${window.location.origin}/api/unifomity/uniformityCheckFile/getUniformityCheckFile?uniformityCheckTaskId=${taskId}`,
        method: 'GET'
      },
      { 
        url: `${window.location.origin}/api/unifomity/uniformityCheckSWTaskFile/getUniformityCheckFile?uniformityCheckTaskId=${taskId}`,
        method: 'GET'
      },
      { 
        url: `${window.location.origin}/api/unifomity/uniformityFile/getUniformityCheckFile?uniformityCheckTaskId=${taskId}`,
        method: 'GET'
      },
      // 使用任务详情端点获取附件
      { 
        url: `${window.location.origin}/api/unifomity/uniformityCheckSWTaskSearch/getUniCheckTaskInfo`,
        method: 'POST',
        body: JSON.stringify({ id: taskId }),
        extractField: 'attachmentList'
      }
    ];
    
    for (let i = 0; i < alternativeApis.length; i++) {
      const api = alternativeApis[i];
      console.log(`[API] 尝试备用端点 ${i + 1}:`, api.url);
      
      try {
        const options = {
          method: api.method,
          credentials: 'same-origin',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        };
        
        if (api.body) {
          options.body = api.body;
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
        options.signal = controller.signal;
        
        const response = await fetch(api.url, options);
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const result = await response.json();
          console.log(`[API] 备用端点 ${i + 1} 响应:`, result);
          
          if (result.ok && result.data) {
            let data = result.data;
            
            // 如果需要从特定字段提取
            if (api.extractField && data[api.extractField]) {
              data = data[api.extractField];
            }
            
            if (Array.isArray(data) && data.length > 0) {
              for (const item of data) {
                if (item.fileId || item.fileName) {
                  attachments.push({
                    fileId: item.fileId || item.id,
                    fileName: item.fileName || item.name,
                    fileType: item.fileType || item.type,
                    type: item.type || determineAttachmentType(item.fileName || item.name)
                  });
                }
              }
              
              if (attachments.length > 0) {
                console.log(`[API] 备用端点 ${i + 1} 成功获取 ${attachments.length} 个附件`);
                break; // 成功获取，跳出循环
              }
            }
          }
        }
      } catch (err) {
        console.log(`[API] 备用端点 ${i + 1} 失败:`, err.message);
      }
    }
    
    return attachments;
  }

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
            // 打印数据结构以便调试
            console.log('[API] 返回数据字段:', Object.keys(data));
            // 查找可能包含生产企业和型号的字段
            const allKeys = Object.keys(data);
            const manufacturerKeys = allKeys.filter(k => 
              k.toLowerCase().includes('manufacturer') || 
              k.toLowerCase().includes('product') ||
              k.toLowerCase().includes('enterprise')
            );
            const modelKeys = allKeys.filter(k => 
              k.toLowerCase().includes('model') || 
              k.toLowerCase().includes('type')
            );
            if (manufacturerKeys.length > 0) {
              console.log('[API] 生产企业相关字段:', manufacturerKeys);
              manufacturerKeys.forEach(k => console.log(`[API] ${k}:`, data[k]));
            }
            if (modelKeys.length > 0) {
              console.log('[API] 型号相关字段:', modelKeys);
              modelKeys.forEach(k => console.log(`[API] ${k}:`, data[k]));
            }
            
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
  
  // 备选方案：通过零件号直接查找并点击任务
  async function clickTaskByPartsCode(partsCode) {
    console.log(`[ClickByCode] 尝试通过零件号查找: ${partsCode}`);
    
    return new Promise(async (resolve) => {
      // 查找所有包含该零件号的单元格
      const allCells = document.querySelectorAll('td[data-field="latestPartsCode"]');
      console.log(`[ClickByCode] 找到 ${allCells.length} 个零件号单元格`);
      
      let targetCell = null;
      for (const cell of allCells) {
        const cellText = cell.textContent.trim();
        if (cellText === partsCode || cellText.includes(partsCode)) {
          targetCell = cell;
          console.log(`[ClickByCode] 找到匹配的单元格: ${cellText}`);
          break;
        }
      }
      
      if (!targetCell) {
        console.log('[ClickByCode] ❌ 未找到匹配的零件号单元格');
        resolve({ success: false, error: '未找到匹配的零件号' });
        return;
      }
      
      // 获取所在行
      const row = targetCell.closest('tr');
      if (!row) {
        console.log('[ClickByCode] ❌ 无法获取所在行');
        resolve({ success: false, error: '无法获取所在行' });
        return;
      }
      
      // 高亮显示
      row.style.backgroundColor = '#e3f2fd';
      row.style.transition = 'background-color 0.3s';
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // 处理复选框（确保只勾选一条）
      console.log('[ClickByCode] 0.1 取消所有已勾选的复选框...');
      
      // 查找页面上所有可能的复选框
      const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
      let uncheckedCount = 0;
      
      allCheckboxes.forEach(cb => {
        if (cb.checked) {
          cb.checked = false;
          uncheckedCount++;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          
          // 如果是layui复选框，移除选中样式
          const wrapper = cb.closest('.layui-form-checkbox');
          if (wrapper && wrapper.classList.contains('layui-form-checked')) {
            wrapper.classList.remove('layui-form-checked');
          }
        }
      });
      
      console.log(`[ClickByCode] 已取消 ${uncheckedCount} 个复选框的勾选状态`);
      
      // 尝试触发layui的form.render来更新UI
      if (typeof layui !== 'undefined' && layui.form) {
        layui.form.render('checkbox');
      }
      
      // 等待UI更新
      await new Promise(r => setTimeout(r, 300));
      
      // 0.2 勾选当前行的复选框
      console.log('[ClickByCode] 0.2 勾选当前行复选框...');
      const rowCheckbox = row.querySelector('input[type="checkbox"]');
      const checkboxWrapper = row.querySelector('.layui-form-checkbox');
      
      if (checkboxWrapper) {
        // 优先点击layui的复选框包装元素
        checkboxWrapper.click();
        console.log('[ClickByCode] ✓ 已点击layui复选框包装元素');
      } else if (rowCheckbox) {
        rowCheckbox.checked = true;
        rowCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        rowCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[ClickByCode] ✓ 已勾选复选框');
      }
      
      // 等待layui更新UI状态
      await new Promise(r => setTimeout(r, 800));
      
      // 尝试点击"查看详情"按钮
      console.log('[ClickByCode] 尝试点击"查看详情"按钮...');
      const detailBtn = document.querySelector('button');
      if (detailBtn && detailBtn.textContent.includes('查看')) {
        setTimeout(() => {
          detailBtn.click();
          console.log('[ClickByCode] ✓ 已点击"查看详情"按钮');
          resolve({ success: true, method: '零件号直接查找' });
        }, 800);
      } else {
        // 如果没有找到按钮，尝试双击行
        console.log('[ClickByCode] 未找到按钮，尝试双击行...');
        setTimeout(() => {
          const dblclickEvent = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
          row.dispatchEvent(dblclickEvent);
          console.log('[ClickByCode] ✓ 已双击行');
          resolve({ success: true, method: '零件号-双击行' });
        }, 800);
      }
      
      // 恢复行背景色
      setTimeout(() => {
        row.style.backgroundColor = '';
      }, 1000);
    });
  }
  
  // 通过滚动查找任务（适用于表格需要滚动加载的情况）
  async function findTaskByScrolling(taskData) {
    console.log(`[ScrollFind] 开始滚动查找任务: ${taskData.partsName || taskData.latestPartsCode}`);
    
    return new Promise(async (resolve) => {
      const tableBody = document.querySelector('.layui-table-body.layui-table-main');
      if (!tableBody) {
        console.log('[ScrollFind] ❌ 未找到表格主体');
        resolve({ success: false, error: '未找到表格主体' });
        return;
      }
      
      const maxScrollAttempts = 10;
      let scrollAttempts = 0;
      let found = false;
      
      // 先滚动到顶部
      tableBody.scrollTop = 0;
      await new Promise(r => setTimeout(r, 500));
      
      while (scrollAttempts < maxScrollAttempts && !found) {
        // 获取当前可见的行
        const rows = tableBody.querySelectorAll('tbody tr');
        console.log(`[ScrollFind] 第${scrollAttempts + 1}次滚动，当前可见行数: ${rows.length}`);
        
        // 在当前可见行中查找
        for (const tr of rows) {
          const partsNameTd = tr.querySelector('td[data-field="partsName"]');
          const latestPartsCodeTd = tr.querySelector('td[data-field="latestPartsCode"]');
          
          const partsName = partsNameTd ? partsNameTd.textContent.trim() : '';
          const latestPartsCode = latestPartsCodeTd ? latestPartsCodeTd.textContent.trim() : '';
          
          // 检查是否匹配
          const nameMatch = taskData.partsName && (
            partsName === taskData.partsName ||
            partsName.includes(taskData.partsName) ||
            taskData.partsName.includes(partsName)
          );
          
          const codeMatch = taskData.latestPartsCode && (
            latestPartsCode === taskData.latestPartsCode ||
            latestPartsCode.includes(taskData.latestPartsCode) ||
            taskData.latestPartsCode.includes(latestPartsCode)
          );
          
          if (nameMatch || codeMatch) {
            console.log(`[ScrollFind] ✓ 找到匹配的行`);
            console.log(`[ScrollFind] 零件名称: ${partsName}`);
            console.log(`[ScrollFind] 零件号: ${latestPartsCode}`);
            
            // 高亮显示
            tr.style.backgroundColor = '#e3f2fd';
            tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // 处理复选框
            await handleCheckboxForRow(tr);
            
            // 点击"查看详情"按钮
            const detailBtn = document.querySelector('button');
            if (detailBtn && detailBtn.textContent.includes('查看')) {
              setTimeout(() => {
                detailBtn.click();
                console.log('[ScrollFind] ✓ 已点击"查看详情"按钮');
                resolve({ success: true });
              }, 800);
            } else {
              setTimeout(() => {
                const dblclickEvent = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
                tr.dispatchEvent(dblclickEvent);
                console.log('[ScrollFind] ✓ 已双击行');
                resolve({ success: true });
              }, 800);
            }
            
            found = true;
            return;
          }
        }
        
        // 如果没有找到，继续滚动
        const scrollHeight = tableBody.scrollHeight;
        const clientHeight = tableBody.clientHeight;
        const currentScroll = tableBody.scrollTop;
        
        if (currentScroll + clientHeight >= scrollHeight) {
          console.log('[ScrollFind] 已滚动到底部，未找到任务');
          break;
        }
        
        // 向下滚动一屏
        tableBody.scrollTop += clientHeight * 0.8;
        scrollAttempts++;
        
        // 等待内容加载
        await new Promise(r => setTimeout(r, 800));
      }
      
      if (!found) {
        console.log('[ScrollFind] ❌ 滚动查找失败，未找到任务');
        resolve({ success: false, error: '滚动查找未找到任务' });
      }
    });
  }
  
  // 辅助函数：处理行的复选框
  async function handleCheckboxForRow(row) {
    console.log('[HandleCheckbox] 处理复选框...');
    
    // 1. 取消所有复选框
    const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
    allCheckboxes.forEach(cb => {
      if (cb.checked) {
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        const wrapper = cb.closest('.layui-form-checkbox');
        if (wrapper && wrapper.classList.contains('layui-form-checked')) {
          wrapper.classList.remove('layui-form-checked');
        }
      }
    });
    
    if (typeof layui !== 'undefined' && layui.form) {
      layui.form.render('checkbox');
    }
    
    await new Promise(r => setTimeout(r, 300));
    
    // 2. 勾选当前行
    const checkboxWrapper = row.querySelector('.layui-form-checkbox');
    const rowCheckbox = row.querySelector('input[type="checkbox"]');
    
    if (checkboxWrapper) {
      checkboxWrapper.click();
      console.log('[HandleCheckbox] ✓ 已点击layui复选框包装元素');
    } else if (rowCheckbox) {
      rowCheckbox.checked = true;
      rowCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rowCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[HandleCheckbox] ✓ 已勾选复选框');
    }
    
    await new Promise(r => setTimeout(r, 800));
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
      console.log('[AutoClick] 任务数据:', {
        id: taskData.id,
        partsName: taskData.partsName,
        latestPartsCode: taskData.latestPartsCode
      });
      
      if (taskData.id) {
        console.log(`[AutoClick] 尝试ID匹配，目标ID: ${taskData.id.substring(0, 16)}...`);
        
        for (const tr of rows) {
          // 尝试多种可能的ID存储位置
          const rowId = tr.getAttribute('data-id') || '';
          const checkbox = tr.querySelector('input[type="checkbox"]');
          const checkboxId = checkbox ? checkbox.getAttribute('data-id') || '' : '';
          const checkboxValue = checkbox ? checkbox.value || '' : '';
          
          // 调试：输出第一行的ID信息
          if (rows.length > 0 && tr === rows[0]) {
            console.log('[AutoClick] 第1行rowId:', rowId ? rowId.substring(0, 16) + '...' : '无');
            console.log('[AutoClick] 第1行checkboxId:', checkboxId ? checkboxId.substring(0, 16) + '...' : '无');
            console.log('[AutoClick] 第1行checkboxValue:', checkboxValue ? checkboxValue.substring(0, 16) + '...' : '无');
          }
          
          if (rowId === taskData.id || checkboxId === taskData.id || checkboxValue === taskData.id) {
            foundRow = tr;
            matchMethod = 'ID匹配';
            console.log(`[AutoClick] ✓ 通过ID匹配到任务`);
            break;
          }
        }
        
        if (!foundRow) {
          console.log('[AutoClick] ID匹配失败，尝试其他匹配方式...');
        }
      } else {
        console.log('[AutoClick] 任务数据中没有ID，跳过ID匹配');
      }
      
      // 第二轮：精确匹配（零件名称+零件号）
      if (!foundRow) {
        console.log('[AutoClick] 尝试双字段匹配...');
        console.log('[AutoClick] 目标零件名称:', JSON.stringify(taskData.partsName));
        console.log('[AutoClick] 目标零件号:', JSON.stringify(taskData.latestPartsCode));
        
        for (const tr of rows) {
          const partsNameTd = tr.querySelector('td[data-field="partsName"]');
          const latestPartsCodeTd = tr.querySelector('td[data-field="latestPartsCode"]');
          
          const partsName = partsNameTd ? partsNameTd.textContent.trim() : '';
          const latestPartsCode = latestPartsCodeTd ? latestPartsCodeTd.textContent.trim() : '';
          
          // 调试：输出前3行的内容
          if (rows.length > 0 && tr === rows[0]) {
            console.log('[AutoClick] 第1行零件名称:', JSON.stringify(partsName));
            console.log('[AutoClick] 第1行零件号:', JSON.stringify(latestPartsCode));
          }
          
          // 优先同时匹配两个字段（使用包含匹配，更灵活）
          if (partsName && latestPartsCode) {
            const nameMatch = partsName === taskData.partsName || 
                             partsName.includes(taskData.partsName) || 
                             taskData.partsName.includes(partsName);
            const codeMatch = latestPartsCode === taskData.latestPartsCode ||
                             latestPartsCode.includes(taskData.latestPartsCode) ||
                             taskData.latestPartsCode.includes(latestPartsCode);
            
            if (nameMatch && codeMatch) {
              foundRow = tr;
              matchMethod = '双字段匹配';
              console.log(`[AutoClick] ✓ 通过零件名称+零件号匹配到任务`);
              console.log(`[AutoClick] 匹配到的零件名称:`, JSON.stringify(partsName));
              console.log(`[AutoClick] 匹配到的零件号:`, JSON.stringify(latestPartsCode));
              break;
            }
          }
        }
      }
      
      // 第三轮：单字段匹配（零件号优先）
      if (!foundRow) {
        console.log('[AutoClick] 尝试单字段匹配（零件号优先）...');
        
        for (const tr of rows) {
          const latestPartsCodeTd = tr.querySelector('td[data-field="latestPartsCode"]');
          const latestPartsCode = latestPartsCodeTd ? latestPartsCodeTd.textContent.trim() : '';
          
          // 优先匹配零件号（更精确）
          if (latestPartsCode && taskData.latestPartsCode) {
            const codeMatch = latestPartsCode === taskData.latestPartsCode ||
                             latestPartsCode.includes(taskData.latestPartsCode) ||
                             taskData.latestPartsCode.includes(latestPartsCode);
            
            if (codeMatch) {
              foundRow = tr;
              matchMethod = '零件号匹配';
              console.log(`[AutoClick] ✓ 通过零件号匹配到任务:`, JSON.stringify(latestPartsCode));
              break;
            }
          }
        }
      }
      
      // 第四轮：单字段匹配（零件名称）
      if (!foundRow) {
        console.log('[AutoClick] 尝试单字段匹配（零件名称）...');
        
        for (const tr of rows) {
          const partsNameTd = tr.querySelector('td[data-field="partsName"]');
          const partsName = partsNameTd ? partsNameTd.textContent.trim() : '';
          
          if (partsName && taskData.partsName) {
            const nameMatch = partsName === taskData.partsName || 
                             partsName.includes(taskData.partsName) || 
                             taskData.partsName.includes(partsName);
            
            if (nameMatch) {
              foundRow = tr;
              matchMethod = '零件名称匹配';
              console.log(`[AutoClick] ✓ 通过零件名称匹配到任务`);
              break;
            }
          }
        }
      }
      
      if (!foundRow) {
        console.log(`[AutoClick] ❌ 在当前表格中未找到匹配的任务`);
        console.log(`[AutoClick] 目标零件名称:`, JSON.stringify(taskData.partsName));
        console.log(`[AutoClick] 目标零件号:`, JSON.stringify(taskData.latestPartsCode));
        
        // 备选方案1：尝试通过零件号在页面上直接查找并点击
        if (taskData.latestPartsCode) {
          console.log('[AutoClick] 尝试备选方案1：通过零件号直接查找并点击...');
          const altResult = await clickTaskByPartsCode(taskData.latestPartsCode);
          if (altResult.success) {
            console.log('[AutoClick] ✓ 备选方案1成功');
            resolve({ success: true, method: '备选方案1-' + altResult.method });
            return;
          }
        }
        
        // 备选方案2：尝试滚动查找（如果表格支持滚动加载）
        console.log('[AutoClick] 尝试备选方案2：滚动查找...');
        const scrollResult = await findTaskByScrolling(taskData);
        if (scrollResult.success) {
          console.log('[AutoClick] ✓ 备选方案2成功');
          resolve({ success: true, method: '滚动查找' });
          return;
        }
        
        resolve({ success: false, error: '未找到匹配的任务: ' + (taskData.partsName || taskData.latestPartsCode) });
        return;
      }
      
      console.log(`[AutoClick] 匹配方式: ${matchMethod}`);
      
      // 高亮显示要点击的行（方便用户观察）
      foundRow.style.backgroundColor = '#e3f2fd';
      foundRow.style.transition = 'background-color 0.3s';
      
      // 步骤0：先处理复选框勾选（系统要求必须先勾选才能查看详情，且只能勾选一条）
      console.log('[AutoClick] 步骤0: 处理复选框勾选（确保只勾选当前行）...');
      
      // 0.1 先取消所有行的勾选（包括表格内和页面上的所有复选框）
      console.log('[AutoClick] 0.1 取消所有已勾选的复选框...');
      
      // 查找页面上所有可能的复选框
      const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
      let uncheckedCount = 0;
      
      allCheckboxes.forEach((cb) => {
        if (cb.checked) {
          cb.checked = false;
          uncheckedCount++;
          
          // 触发change事件以通知layui更新UI状态
          const changeEvent = new Event('change', { bubbles: true });
          cb.dispatchEvent(changeEvent);
          
          // 如果是layui复选框，尝试点击其包装元素来取消
          const wrapper = cb.closest('.layui-form-checkbox');
          if (wrapper && wrapper.classList.contains('layui-form-checked')) {
            wrapper.classList.remove('layui-form-checked');
          }
        }
      });
      
      console.log(`[AutoClick] 已取消 ${uncheckedCount} 个复选框的勾选状态`);
      
      // 尝试触发layui的form.render来更新UI
      if (typeof layui !== 'undefined' && layui.form) {
        layui.form.render('checkbox');
        console.log('[AutoClick] 已触发layui.form.render("checkbox")');
      }
      
      // 等待UI更新
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 0.2 勾选当前行的复选框
      // 复选框可能在行的第一个单元格中（根据截图，在最左侧列）
      const firstCell = foundRow.querySelector('td:first-child, td.layui-table-col-special');
      let rowCheckbox = null;
      let checkboxWrapper = null;
      
      if (firstCell) {
        rowCheckbox = firstCell.querySelector('input[type="checkbox"], input.layui-checkbox, input.layui-form-checkbox');
        // 查找layui的复选框包装元素
        checkboxWrapper = firstCell.querySelector('.layui-form-checkbox, .layui-checkbox');
      }
      
      // 如果没找到，尝试在整个行中查找
      if (!rowCheckbox) {
        rowCheckbox = foundRow.querySelector('input[type="checkbox"], input.layui-checkbox, input.layui-form-checkbox');
      }
      
      if (rowCheckbox || checkboxWrapper) {
        console.log('[AutoClick] 找到复选框，准备勾选...');
        
        // 方法1：直接点击复选框元素（触发layui的点击事件）
        if (checkboxWrapper) {
          console.log('[AutoClick] 点击layui复选框包装元素');
          checkboxWrapper.click();
        } else if (rowCheckbox) {
          // 方法2：设置checked属性并触发事件
          rowCheckbox.checked = true;
          
          // 触发多种事件以确保layui识别
          const clickEvent = new MouseEvent('click', { bubbles: true });
          rowCheckbox.dispatchEvent(clickEvent);
          
          const changeEvent = new Event('change', { bubbles: true });
          rowCheckbox.dispatchEvent(changeEvent);
          
          // 尝试触发layui特定事件
          if (typeof layui !== 'undefined' && layui.form) {
            layui.form.render('checkbox');
          }
        }
        
        console.log('[AutoClick] ✓ 已勾选当前行复选框');
        
        // 等待layui更新UI状态（增加等待时间确保系统识别）
        await new Promise(resolve => setTimeout(resolve, 800));
      } else {
        console.log('[AutoClick] ⚠️ 当前行没有复选框，继续执行点击操作');
      }
      
      // 尝试多种点击策略
      let clicked = false;
      let clickPromise = null;
      
      // 策略1：点击页面工具栏上的"查看详情"按钮（主要策略）
      // 根据截图，按钮在表格左上方的工具栏区域
      console.log('[AutoClick] 策略1: 查找页面工具栏的"查看详情"按钮...');
      
      // 方法1：通过按钮文本查找
      const allButtons = document.querySelectorAll('button');
      let detailButton = null;
      for (const btn of allButtons) {
        const text = btn.textContent.trim();
        // 精确匹配"查看详情"或包含"查看"和"详情"
        if (text === '查看详情' || (text.includes('查看') && text.includes('详情'))) {
          detailButton = btn;
          console.log('[AutoClick] 找到"查看详情"按钮:', text);
          break;
        }
      }
      
      // 方法2：如果没找到，尝试查找包含"查看"文本的按钮
      if (!detailButton) {
        for (const btn of allButtons) {
          const text = btn.textContent.trim();
          if (text === '查看' || text === '详情') {
            detailButton = btn;
            console.log('[AutoClick] 找到按钮:', text);
            break;
          }
        }
      }
      
      // 方法3：尝试通过layui的样式类查找工具栏按钮
      if (!detailButton) {
        const toolbarBtns = document.querySelectorAll('.layui-btn, .layui-btn-sm, .layui-btn-normal');
        for (const btn of toolbarBtns) {
          const text = btn.textContent.trim();
          if (text.includes('查看')) {
            detailButton = btn;
            console.log('[AutoClick] 通过样式类找到按钮:', text);
            break;
          }
        }
      }
      
      if (detailButton) {
        console.log('[AutoClick] 点击工具栏的"查看详情"按钮');
        clickPromise = new Promise((resolve) => {
          setTimeout(() => {
            detailButton.click();
            clicked = true;
            resolve();
          }, 1000); // 增加延迟确保复选框状态已生效并被系统识别
        });
      } else {
        console.log('[AutoClick] ⚠️ 未找到"查看详情"按钮');
      }
      
      // 策略2：查找行内的"查看详情"按钮（备用策略）
      if (!clicked && !clickPromise) {
        const viewDetailBtn = foundRow.querySelector('button');
        if (viewDetailBtn) {
          const btnText = viewDetailBtn.textContent.trim();
          console.log('[AutoClick] 策略2: 找到行内按钮，文本:', btnText);
          if (btnText.includes('查看') || btnText.includes('详情') || btnText.includes('处理')) {
            console.log('[AutoClick] 点击行内"查看详情"按钮');
            foundRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            clickPromise = new Promise((resolve) => {
              setTimeout(() => {
                viewDetailBtn.click();
                clicked = true;
                resolve();
              }, 500);
            });
          }
        }
      }
      
      // 策略3：点击操作列按钮（通用方式）
      if (!clicked && !clickPromise) {
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
              }, 500);
            });
          }
        }
      }
      
      // 策略3：如果没有操作按钮，尝试双击行
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
          }, 500);
        });
      }
      
      // 策略4：尝试查找行内的链接或点击区域
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
            }, 500);
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
          || document.querySelector('#layui-layer1')
          || document.querySelector('#handleTaskPopup')
          || document.querySelector('.layui-layer-dialog')
          || document.querySelector('.layui-layer-iframe')
          || document.querySelector('[class*="layui-layer"]')
          || document.querySelector('.layui-layer');
        
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

  // 从弹窗获取CCC状态（仅用于获取CCC信息，不获取其他数据）
  async function getCccStatusFromPopup(taskData) {
    console.log('[GetCCCFromPopup] ====== 开始从弹窗获取CCC状态 ======');
    console.log(`[GetCCCFromPopup] 任务: ${taskData.partsName || taskData.latestPartsCode}`);
    
    try {
      // 第一步：在任务列表中找到并点击该任务
      console.log('[GetCCCFromPopup] 步骤1: 自动点击任务行...');
      const clickResult = await clickTaskInList(taskData);
      if (!clickResult.success) {
        console.log(`[GetCCCFromPopup] ❌ 点击失败: ${clickResult.error}`);
        return { success: false, error: clickResult.error };
      }
      console.log(`[GetCCCFromPopup] ✓ 点击成功 (${clickResult.method})`);
      
      // 第二步：等待详情页加载
      console.log('[GetCCCFromPopup] 步骤2: 等待详情页加载...');
      const popupResult = await waitForDetailPopup({ timeout: 15000, checkContent: false });
      if (!popupResult.success) {
        console.log(`[GetCCCFromPopup] ❌ 等待弹窗失败: ${popupResult.error}`);
        return { success: false, error: popupResult.error };
      }
      console.log('[GetCCCFromPopup] ✓ 详情页已加载');
      
      // 额外等待确保内容完全渲染（特别是layui表单）
      console.log('[GetCCCFromPopup] 等待内容完全渲染...');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // 第三步：从弹窗中获取CCC状态
      console.log('[GetCCCFromPopup] 步骤3: 从弹窗获取CCC状态...');
      const detailPopup = popupResult.element;
      
      // 如果layui存在，尝试重新渲染表单以确保状态正确
      if (typeof layui !== 'undefined' && layui.form) {
        layui.form.render();
        console.log('[GetCCCFromPopup] 已触发layui.form.render()');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      const isCcc = checkCccStatus(detailPopup);
      console.log(`[GetCCCFromPopup] ✓ 获取到CCC状态: ${isCcc ? '是CCC件' : '非CCC件'}`);
      
      // 第四步：关闭详情页
      console.log('[GetCCCFromPopup] 步骤4: 关闭详情页...');
      await closeDetailPopup();
      console.log('[GetCCCFromPopup] ✓ 详情页已关闭');
      
      console.log('[GetCCCFromPopup] ====== 完成 ======');
      return {
        success: true,
        isCcc: isCcc,
        source: 'popup'
      };
      
    } catch (err) {
      console.log(`[GetCCCFromPopup] ❌ 异常: ${err.message}`);
      // 异常时尝试关闭弹窗
      try {
        await closeDetailPopup();
      } catch (e) {
        // 忽略关闭错误
      }
      return { success: false, error: err.message };
    }
  }

  // ============ 3.4 Auto Check Detail by API Data ============
  async function autoCheckDetailByAPI(apiData, taskData) {
    try {
      const results = [];
      
      // 调试：检查传入的参数
      console.log('[autoCheckDetailByAPI] ========== 函数开始 ==========');
      console.log('[autoCheckDetailByAPI] 参数1 - apiData 类型:', typeof apiData);
      console.log('[autoCheckDetailByAPI] 参数2 - taskData 类型:', typeof taskData);
      console.log('[autoCheckDetailByAPI] 参数2 - taskData 值:', taskData);
      console.log('[autoCheckDetailByAPI] 参数2 - taskData 是否存在:', !!taskData);
      
      // 检查 arguments 对象
      console.log('[autoCheckDetailByAPI] arguments 长度:', arguments.length);
      console.log('[autoCheckDetailByAPI] arguments[0] 类型:', typeof arguments[0]);
      console.log('[autoCheckDetailByAPI] arguments[1] 类型:', typeof arguments[1]);
      
      if (taskData) {
        console.log('[autoCheckDetailByAPI] taskData.id:', taskData.id);
        console.log('[autoCheckDetailByAPI] taskData.partsName:', taskData.partsName);
        console.log('[autoCheckDetailByAPI] taskData.models:', taskData.models);
      } else {
        console.log('[autoCheckDetailByAPI] ⚠️ taskData 为空! 尝试使用 arguments[1]:', arguments[1]);
        // 如果 taskData 为空但 arguments[1] 有值，使用 arguments[1]
        if (arguments[1]) {
          taskData = arguments[1];
          console.log('[autoCheckDetailByAPI] 已使用 arguments[1] 作为 taskData:', taskData.id);
        }
      }
      
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

      // --- 3.4.1b Fetch attachment info from separate API ---
      // 附件数据需要通过独立的API获取（多策略尝试）
      let attachmentList = [];
      try {
        // 安全检查：确保 taskData 存在
        const taskId = (taskData && taskData.id) ? taskData.id : (apiData && apiData.id ? apiData.id : null);
        console.log('[API] 附件检测 - taskData:', taskData ? '存在' : '不存在', ', apiData.id:', apiData ? apiData.id : '无', ', 最终taskId:', taskId);
        
        if (taskId) {
          // 策略1: 尝试从主任务详情API响应中查找附件信息
          console.log('[API] 策略1: 从主任务详情API响应中查找附件信息...');
          attachmentList = extractAttachmentsFromApiData(apiData);
          
          if (attachmentList.length > 0) {
            console.log('[API] 策略1成功: 从主API响应中获取到附件列表:', attachmentList.length, '个');
            attachmentList.forEach((att, idx) => {
              console.log(`[API] 附件${idx + 1}:`, att.fileName, 'type:', att.type);
            });
          } else {
            console.log('[API] 策略1: 主API响应中未找到附件信息，尝试专用附件API...');
            
            // 策略2: 尝试专用附件API
            console.log('[API] 策略2: 尝试专用附件API...');
            const attachApiUrl = `${window.location.origin}/api/unifomity/uniformityCheckSWTaskWaitFile/getUniformityCheckFile?uniformityCheckTaskId=${taskId}`;
            console.log('[API] 附件API URL:', attachApiUrl);
            
            try {
              const attachResponse = await fetch(attachApiUrl, {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                  'Accept': 'application/json'
                }
              });
              
              console.log('[API] 附件API响应状态:', attachResponse.status);
              
              if (attachResponse.ok) {
                const attachResult = await attachResponse.json();
                console.log('[API] 附件API响应:', attachResult);
                if (attachResult.ok && attachResult.data && attachResult.data.length > 0) {
                  attachmentList = attachResult.data;
                  console.log('[API] 策略2成功: 从专用附件API获取到附件列表:', attachmentList.length, '个');
                  attachmentList.forEach((att, idx) => {
                    console.log(`[API] 附件${idx + 1}:`, att.fileName, 'type:', att.type);
                  });
                } else {
                  console.log('[API] 策略2: 专用附件API返回无数据:', attachResult.message || '空数据');
                }
              } else {
                console.log('[API] 策略2: 专用附件API请求失败，状态码:', attachResponse.status);
              }
            } catch (attachErr) {
              console.log('[API] 策略2: 专用附件API调用失败:', attachErr.message);
            }
            
            // 策略3: 如果前两个策略都失败，尝试其他可能的附件API端点
            if (attachmentList.length === 0) {
              console.log('[API] 策略3: 尝试备用附件API端点...');
              attachmentList = await tryAlternativeAttachmentApis(taskId);
            }
          }
        } else {
          console.log('[API] 无法获取任务ID，跳过附件检测');
        }
      } catch (err) {
        console.log('[API] 获取附件信息失败:', err.message);
        console.error('[API] 附件检测异常:', err);
      }

      // --- 3.4.2 Check manufacturer name consistency ---
      // 根据实际API验证：API中没有独立的manufacturerList字段
      // 生产企业名称通过 supplierName 字段获取
      console.log('[API] 查找生产企业信息，apiData字段:', Object.keys(apiData));
      
      // 优先尝试专用的生产企业列表字段
      let manufacturerList = apiData.manufacturerList || apiData.manufacturerVos || apiData.manufacturers || [];
      
      // 如果有嵌套结构则从中提取
      if (!manufacturerList || manufacturerList.length === 0) {
        const possibleKeys = Object.keys(apiData).filter(k => 
          k.toLowerCase().includes('manufacturer') || 
          k.toLowerCase().includes('enterprise') ||
          k.toLowerCase().includes('factory')
        );
        console.log('[API] 可能的生产企业字段:', possibleKeys);
        
        for (const key of possibleKeys) {
          const val = apiData[key];
          if (Array.isArray(val) && val.length > 0) {
            manufacturerList = val;
            console.log(`[API] 从字段 ${key} 获取到生产企业列表:`, manufacturerList);
            break;
          }
        }
      }
      
      let manufacturerNames = manufacturerList.map(m => {
        if (typeof m === 'string') return m;
        return m.manufacturerName || m.name || m.enterpriseName || m.factoryName || 
               m.manufacturer || m.enterprise || m.companyName || m.company || '';
      }).filter(Boolean);

      // 根据实际API验证：若无独立生产企业字段，直接使用 supplierName 作为生产企业名称
      if (manufacturerNames.length === 0 && supplierName) {
        console.log('[API] 未找到独立生产企业字段，使用 supplierName 作为生产企业:', supplierName);
        manufacturerNames = [supplierName];
      }

      console.log('[API] 提取到的生产企业名称:', manufacturerNames);

      if (manufacturerNames.length > 0) {
        const manufacturerMatch = manufacturerNames.some(
          (name) => isNormalizedEqual(name, supplierName) || isNormalizedIncludes(supplierName, name) || isNormalizedIncludes(name, supplierName)
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
      // 增强CCC件判断逻辑，支持多种可能的字段名和值类型
      // 优先从 taskData（列表API数据）中获取，如果没有再从 apiData（详情API）中获取
      function checkCccFromData(data, sourceName) {
        // 可能的字段名（按优先级排序）
        const possibleFields = [
          'isCccParts', 'cccFlag', 'isCcc', 'ccc', 'hasCcc', 
          'isCCC', 'CCC', 'cccStatus', 'cccParts', 'isCCCParts'
        ];
        
        for (const field of possibleFields) {
          if (data.hasOwnProperty(field)) {
            const value = data[field];
            console.log(`[API CCC] 在${sourceName}中找到字段 ${field}:`, value, `(类型: ${typeof value})`);
            
            // 支持多种值类型表示"是"
            if (value === '1' || value === 1 || value === true || 
                value === 'true' || value === '是' || value === 'yes' || 
                value === 'Y' || value === 'y') {
              console.log(`[API CCC] 字段 ${field} 值为 '${value}'，判定为CCC件`);
              return { isCcc: true, source: sourceName, field: field, value: value };
            }
            // 支持多种值类型表示"否"
            if (value === '0' || value === 0 || value === false || 
                value === 'false' || value === '否' || value === 'no' || 
                value === 'N' || value === 'n') {
              console.log(`[API CCC] 字段 ${field} 值为 '${value}'，判定为非CCC件`);
              return { isCcc: false, source: sourceName, field: field, value: value };
            }
          }
        }
        
        return null;
      }
      
      // 优先从 taskData（列表API数据）中查找CCC信息
      let cccResult = null;
      if (taskData) {
        cccResult = checkCccFromData(taskData, 'taskData(列表API)');
      }
      
      // 如果 taskData 中没有，再从 apiData（详情API）中查找
      if (!cccResult) {
        cccResult = checkCccFromData(apiData, 'apiData(详情API)');
      }
      
      // 如果都没有找到，尝试通过弹窗获取CCC状态（混合模式）
      if (!cccResult) {
        console.log('[API CCC] 未在API数据中找到CCC字段，尝试通过弹窗获取CCC状态...');
        
        // 尝试打开弹窗获取CCC状态
        const popupCccResult = await getCccStatusFromPopup(taskData);
        
        if (popupCccResult.success) {
          console.log(`[API CCC] 从弹窗获取到CCC状态: ${popupCccResult.isCcc ? '是CCC件' : '非CCC件'}`);
          cccResult = {
            isCcc: popupCccResult.isCcc,
            source: 'popup',
            field: 'checkCccStatus',
            value: popupCccResult.isCcc
          };
        } else {
          console.log('[API CCC] 弹窗获取CCC状态失败，默认返回非CCC件:', popupCccResult.error);
          cccResult = { isCcc: false, source: 'default', field: null, value: null };
        }
      }
      
      const isCccOnPage = cccResult.isCcc;
      console.log(`[API CCC] 最终CCC判定结果: ${isCccOnPage ? '是CCC件' : '非CCC件'} (来源: ${cccResult.source}, 字段: ${cccResult.field})`);

      // --- 3.4.4 Check model info from API ---
      // 根据实际API验证：型号信息在列表API的 models 字段（字符串）中，详情API中可能不含
      // 优先使用从 taskData 传入的列表API数据
      console.log('[API] 查找型号信息...');
      
      // 优先从 taskData（列表API数据）中获取型号字段
      let pageModels = [];
      if (taskData && taskData.models) {
        // models 字段可能是字符串（单个型号）或逗号分隔
        const modelsRaw = String(taskData.models).trim();
        if (modelsRaw && modelsRaw !== '0') {
          pageModels = modelsRaw.split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
          console.log('[API] 从 taskData.models 获取型号:', pageModels);
        }
      }

      // 如果 taskData 中没有，再从详情API数据中查找
      if (pageModels.length === 0) {
        let modelList = apiData.modelList || apiData.modelVos || [];
        
        if (!modelList || modelList.length === 0) {
          const possibleModelKeys = Object.keys(apiData).filter(k => 
            k.toLowerCase().includes('model') || 
            k.toLowerCase().includes('spec')
          );
          console.log('[API] 可能的型号字段:', possibleModelKeys);
          
          for (const key of possibleModelKeys) {
            const val = apiData[key];
            if (Array.isArray(val) && val.length > 0) {
              modelList = val;
              console.log(`[API] 从字段 ${key} 获取到型号列表:`, modelList);
              break;
            } else if (typeof val === 'string' && val.trim() && val !== '0') {
              pageModels = val.split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
              console.log(`[API] 从字段 ${key} (字符串) 获取型号:`, pageModels);
              break;
            }
          }
        }
        
        if (pageModels.length === 0 && modelList.length > 0) {
          pageModels = modelList.map(m => {
            if (typeof m === 'string') return m;
            return m.model || m.modelCode || m.modelName || m.type || m.typeCode || 
                   m.spec || m.specification || m.name || '';
          }).filter(Boolean);
        }
      }
      
      console.log('[API] 提取到的型号:', pageModels);
      // 记录型号标识位置和方法（来自列表API）
      if (taskData && taskData.modelMarkPositions) {
        console.log('[API] 型号标识位置:', taskData.modelMarkPositions);
      }
      if (taskData && taskData.modelMarkApplicateMethods) {
        console.log('[API] 型号标识方法:', taskData.modelMarkApplicateMethods);
      }

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
              pageModels.some((pm) => isNormalizedIncludes(pm, em) || isNormalizedIncludes(em, pm))
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
            manufacturerNames.some((mn) => isNormalizedIncludes(mn, em) || isNormalizedIncludes(em, mn))
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
      // 注意：attachmentList为空数组表示无附件
      console.log(`[API] 附件检测完成，共找到 ${attachmentList.length} 个附件`);
      
      // 从附件列表中筛选CCC标识和型号标识附件
      // type: 0=CCC标识, 1=型号标识
      const cccAttachment = attachmentList.find(a => a.type === '0' || a.type === 0) || {};
      const modelAttachment = attachmentList.find(a => a.type === '1' || a.type === 1) || {};
      
      console.log('[API] CCC附件:', cccAttachment.fileName || '无');
      console.log('[API] 型号附件:', modelAttachment.fileName || '无');
      
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

  // ============ 5. Open Task Detail Page ============
  // 在当前页面打开任务单详情
  async function openTaskDetailPage(taskId, detailPath, taskData) {
    try {
      console.log('[OpenDetail] 开始打开任务详情页, taskId:', taskId);
      
      if (!taskId) {
        return { success: false, error: '任务ID为空' };
      }
      
      // 尝试通过API获取任务详情，然后使用popupCenter打开详情弹窗
      try {
        // 先获取任务详情，确认任务存在
        const response = await fetch(
          `${window.location.origin}/api/unifomity/uniformityCheckSWTaskSearch/getUniCheckTaskInfo`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ id: taskId })
          }
        );
        
        if (!response.ok) {
          throw new Error(`HTTP 错误: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('[OpenDetail] API响应:', result.respCode || result.ok);
        
        if ((result.ok || result.respCode === 0) && result.data) {
          // 设置全局变量，供详情页使用
          window.fileParrentId = taskId;
          
          // 使用layui的admin.popupCenter打开详情弹窗
          if (typeof layui !== 'undefined' && layui.adc) {
            var data = result.data;
            layui.adc.popupCenter({
              title: '一致性确认零件信息查询列表查看详情',
              path: detailPath,
              offset: 'auto',
              area: ['100%', '100%'],
              shadeClose: true,
              success: function() {
                // 获取当前登录用户信息
                var localData = {};
                try {
                  var stored = localStorage.getItem('loginInfo') || sessionStorage.getItem('loginInfo');
                  if (stored) localData = JSON.parse(stored);
                } catch(e) {}
                data.loginName = localData.supplierJc || '';
                data.roleName = localData.roleName || '';
                if (typeof setValue === 'function') {
                  setValue(data);
                }
              }
            });
            return { success: true };
          } else {
            // 如果layui不可用，尝试直接跳转到详情页URL
            var detailUrl = window.location.origin + '/' + detailPath + '?id=' + taskId;
            window.open(detailUrl, '_blank');
            return { success: true };
          }
        } else {
          throw new Error('任务信息获取失败: ' + (result.message || '未知错误'));
        }
      } catch (apiErr) {
        console.log('[OpenDetail] API方式失败, 尝试直接在列表中点击任务:', apiErr.message);
        
        // 如果API失败，尝试在列表中找到该任务并点击打开详情
        const clickResult = await clickTaskInList(taskData);
        if (!clickResult.success) {
          return { success: false, error: '无法打开任务详情: ' + clickResult.error };
        }
        return { success: true };
      }
    } catch (err) {
      console.log('[OpenDetail] 异常:', err.message);
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

  /**
   * 规范化字符串，将相似的字符统一处理
   * 例如：φ(小写) 和 Φ(大写) 视为相同字符
   */
  function normalizeString(str) {
    if (!str) return '';
    if (typeof str !== 'string') str = String(str);
    // 将 φ (U+03C6, 小写希腊字母phi) 和 Φ (U+03A6, 大写希腊字母Phi) 统一为 φ
    // 同时处理其他可能的变体：∅(U+2205), ⌀(U+2300), ϕ(U+03D5)
    return str
      .replace(/[Φϕ∅⌀]/g, 'φ')
      .trim();
  }

  /**
   * 规范化比对：比较两个字符串是否相等（忽略φ/Φ差异）
   */
  function isNormalizedEqual(str1, str2) {
    return normalizeString(str1) === normalizeString(str2);
  }

  /**
   * 规范化包含检查：检查str1是否包含str2（忽略φ/Φ差异）
   */
  function isNormalizedIncludes(str1, str2) {
    return normalizeString(str1).includes(normalizeString(str2));
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
    console.log('[checkCccStatus] 开始检测CCC状态...');
    
    // 方法1: 通过单选按钮判断（原有逻辑）
    console.log('[checkCccStatus] 方法1: 查找单选按钮...');
    
    // 查找所有radio input，包括name包含ccc或value为1/0、是/否的
    const radios = detailPopup.querySelectorAll('input[type="radio"]');
    console.log(`[checkCccStatus] 找到 ${radios.length} 个radio input`);
    
    let isCcc = false;
    let foundRadio = false;
    
    // 先查找"是否CCC件"附近的radio
    let cccRadios = [];
    
    for (const radio of radios) {
      // 检查radio的name、value或周围的文本
      const name = radio.name || '';
      const value = radio.value || '';
      const parent = radio.parentElement;
      const grandparent = parent ? parent.parentElement : null;
      const containerText = (parent ? parent.textContent : '') + ' ' + (grandparent ? grandparent.textContent : '');
      
      // 如果name包含ccc，或者周围文本包含"是否CCC件"
      if (name.toLowerCase().includes('ccc') || 
          containerText.includes('是否CCC件') ||
          containerText.includes('CCC')) {
        cccRadios.push({
          radio: radio,
          name: name,
          value: value,
          checked: radio.checked,
          containerText: containerText.substring(0, 50)
        });
      }
    }
    
    console.log(`[checkCccStatus] 找到 ${cccRadios.length} 个CCC相关radio`);
    
    // 检查这些radio的选中状态
    for (const item of cccRadios) {
      console.log(`[checkCccStatus] CCC radio: name=${item.name}, value=${item.value}, checked=${item.checked}`);
      
      if (item.checked) {
        foundRadio = true;
        // 判断value是否为"是"的状态
        if (item.value === '1' || item.value === 'true' || item.value === '是' || item.value === 'yes' || item.value === 'Y') {
          isCcc = true;
        } else if (item.value === '0' || item.value === 'false' || item.value === '否' || item.value === 'no' || item.value === 'N') {
          isCcc = false;
        }
        console.log(`[checkCccStatus] 找到选中的CCC radio，value=${item.value}, isCcc=${isCcc}`);
      }
    }
    
    // 如果找到了选中的radio，直接返回结果
    if (foundRadio) {
      console.log(`[checkCccStatus] ✓ 通过单选按钮确定CCC状态: ${isCcc}`);
      return isCcc;
    }
    
    // 备选：查找所有radio，看是否有value为"是"或"否"的
    console.log('[checkCccStatus] 方法1b: 查找所有radio中的"是/否"...');
    let yesRadioInput = null;
    let noRadioInput = null;
    
    for (const radio of radios) {
      const value = radio.value || '';
      const parentText = radio.parentElement ? radio.parentElement.textContent.trim() : '';
      
      if (value === '1' || value === 'true' || value === '是' || value === 'yes' || parentText === '是') {
        yesRadioInput = radio;
      }
      if (value === '0' || value === 'false' || value === '否' || value === 'no' || parentText === '否') {
        noRadioInput = radio;
      }
    }
    
    if (yesRadioInput && yesRadioInput.checked) {
      console.log('[checkCccStatus] ✓ 通过"是"radio input确定CCC状态: true');
      return true;
    }
    if (noRadioInput && noRadioInput.checked) {
      console.log('[checkCccStatus] ✓ 通过"否"radio input确定CCC状态: false');
      return false;
    }
    
    // 方法2: 通过layui的radio样式判断（根据截图，CCC信息使用layui radio）
    console.log('[checkCccStatus] 方法2: 查找layui radio样式...');
    
    // 先查找"是否CCC件"标签附近的radio
    const allElements = detailPopup.querySelectorAll('*');
    let cccLabelElement = null;
    
    for (const el of allElements) {
      if (el.textContent && el.textContent.includes('是否CCC件')) {
        cccLabelElement = el;
        console.log('[checkCccStatus] 找到"是否CCC件"标签:', el.tagName);
        break;
      }
    }
    
    if (cccLabelElement) {
      // 在"是否CCC件"标签的父元素或兄弟元素中查找radio
      const parent = cccLabelElement.parentElement;
      const grandparent = parent ? parent.parentElement : null;
      
      // 尝试在多个层级查找radio
      let radioContainer = parent;
      if (!radioContainer || !radioContainer.querySelector('.layui-form-radio')) {
        radioContainer = grandparent;
      }
      
      if (radioContainer) {
        const layuiRadios = radioContainer.querySelectorAll('.layui-form-radio');
        console.log(`[checkCccStatus] 在"是否CCC件"附近找到 ${layuiRadios.length} 个layui radio`);
        
        for (const radio of layuiRadios) {
          const text = radio.textContent.trim();
          const isChecked = radio.classList.contains('layui-form-radioed');
          console.log(`[checkCccStatus] layui radio: 文本="${text}", 选中=${isChecked}`);
          
          if (isChecked) {
            if (text === '是' || text.includes('是')) {
              console.log('[checkCccStatus] ✓ 通过layui radio确定CCC状态: true (选中"是")');
              return true;
            }
            if (text === '否' || text.includes('否')) {
              console.log('[checkCccStatus] ✓ 通过layui radio确定CCC状态: false (选中"否")');
              return false;
            }
          }
        }
      }
    }
    
    // 备选：在整个弹窗中查找所有layui radio
    const allLayuiRadios = detailPopup.querySelectorAll('.layui-form-radio');
    console.log(`[checkCccStatus] 在整个弹窗中找到 ${allLayuiRadios.length} 个layui radio`);
    
    // 查找包含"是"或"否"的radio组合
    let yesRadio = null;
    let noRadio = null;
    
    for (const radio of allLayuiRadios) {
      const text = radio.textContent.trim();
      if (text === '是' || text === 'yes') {
        yesRadio = radio;
      }
      if (text === '否' || text === 'no') {
        noRadio = radio;
      }
    }
    
    // 如果找到了"是/否"radio对，检查哪个被选中
    if (yesRadio && noRadio) {
      if (yesRadio.classList.contains('layui-form-radioed')) {
        console.log('[checkCccStatus] ✓ 通过"是/否"radio对确定CCC状态: true');
        return true;
      }
      if (noRadio.classList.contains('layui-form-radioed')) {
        console.log('[checkCccStatus] ✓ 通过"是/否"radio对确定CCC状态: false');
        return false;
      }
    }
    
    // 方法3: 通过文本内容判断（备选方案）
    console.log('[checkCccStatus] 方法3: 通过文本内容判断...');
    const cccLabels = detailPopup.querySelectorAll('label, span, div, td, p, h1, h2, h3, h4, h5, h6');
    console.log(`[checkCccStatus] 检查 ${cccLabels.length} 个文本元素`);
    
    for (const label of cccLabels) {
      const text = label.textContent.trim();
      
      // 匹配"是否CCC件"相关文本
      if (/是否CCC件|CCC认证|是否.*CCC|CCC.*状态/i.test(text)) {
        console.log(`[checkCccStatus] 找到CCC相关文本: ${text}`);
        
        // 匹配"是"的情况
        if (/[:：]\s*是|[:：]\s*有|[:：]\s*yes|[:：]\s*Y|[:：]\s*1|[:：]\s*true/i.test(text) ||
            /是CCC件|有CCC|是.*CCC|CCC.*是/i.test(text)) {
          console.log('[checkCccStatus] ✓ 通过文本确定CCC状态: true');
          return true;
        }
        
        // 匹配"否"的情况
        if (/[:：]\s*否|[:：]\s*无|[:：]\s*no|[:：]\s*N|[:：]\s*0|[:：]\s*false/i.test(text) ||
            /非CCC件|无CCC|否.*CCC|不是CCC|CCC.*否/i.test(text)) {
          console.log('[checkCccStatus] ✓ 通过文本确定CCC状态: false');
          return false;
        }
      }
    }
    
    // 方法4: 通过隐藏字段或data属性判断
    console.log('[checkCccStatus] 方法4: 查找隐藏字段...');
    const hiddenCccField = detailPopup.querySelector('input[type="hidden"][name*="ccc"], input[type="hidden"][name*="CCC"], input[name*="ccc"], input[name*="CCC"]');
    if (hiddenCccField) {
      const value = hiddenCccField.value;
      console.log(`[checkCccStatus] 找到隐藏字段: name=${hiddenCccField.name}, value=${value}`);
      const result = value === '1' || value === 'true' || value === '是' || value === 'yes' || value === 'Y' || value === 'y';
      console.log(`[checkCccStatus] ✓ 通过隐藏字段确定CCC状态: ${result}`);
      return result;
    }
    
    // 方法5: 通过整个弹窗的文本内容模糊匹配
    console.log('[checkCccStatus] 方法5: 通过弹窗整体文本模糊匹配...');
    const popupText = detailPopup.textContent || '';
    
    // 查找"是否CCC件"附近的内容
    const cccIndex = popupText.indexOf('是否CCC件');
    if (cccIndex !== -1) {
      // 获取"是否CCC件"前后50个字符的文本
      const contextText = popupText.substring(Math.max(0, cccIndex - 50), Math.min(popupText.length, cccIndex + 100));
      console.log(`[checkCccStatus] "是否CCC件"上下文: ${contextText}`);
      
      if (/是|有|yes|Y/.test(contextText.substring(cccIndex, cccIndex + 20))) {
        console.log('[checkCccStatus] ✓ 通过上下文确定CCC状态: true');
        return true;
      }
      if (/否|无|no|N/.test(contextText.substring(cccIndex, cccIndex + 20))) {
        console.log('[checkCccStatus] ✓ 通过上下文确定CCC状态: false');
        return false;
      }
    }
    
    // 默认返回false（非CCC件）
    console.warn('[checkCccStatus] 无法确定CCC状态，默认返回非CCC件');
    console.log('[checkCccStatus] 弹窗HTML片段:', detailPopup.innerHTML.substring(0, 500));
    return false;
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

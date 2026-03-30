// popup/popup.js

const DEFAULT_API_KEY = '1508089119b8403dbdf587f551c819e1.pmXHkV7ayy52WYjq';

// 进度条控制函数
function showProgress(show) {
  var progressEl = document.getElementById('uploadProgress');
  if (progressEl) {
    progressEl.style.display = show ? 'block' : 'none';
  }
}

function updateProgress(percent, text) {
  var fillEl = document.getElementById('progressFill');
  var textEl = document.getElementById('progressText');
  var percentEl = document.getElementById('progressPercent');
  
  if (fillEl && percent !== null && percent !== undefined) fillEl.style.width = percent + '%';
  if (textEl) textEl.textContent = text || '';
  if (percentEl && percent !== null && percent !== undefined) percentEl.textContent = percent + '%';
}

document.addEventListener('DOMContentLoaded', init);

function init() {
  bindEvents();
  initDragFunction(); // 初始化拖拽功能
  initResizeFunction(); // 初始化调整大小功能
  loadExcelList();
  loadApiKeyStatus();
  loadPersistedBatchResults(); // 加载持久化的校验结果
  loadCheckLogs(); // 加载历史日志
  checkAndRestoreBackgroundTask(); // 检查并恢复后台运行的任务
}

// ============ Drag Functionality ============
function initDragFunction() {
  var header = document.getElementById('dragHeader');
  var container = document.querySelector('.popup-container');
  
  if (!header || !container) {
    console.log('[Drag] 未找到拖动元素');
    return;
  }
  
  console.log('[Drag] 初始化拖动功能');
  
  var isDragging = false;
  var startX, startY, initialLeft, initialTop;
  
  // 从存储中恢复位置
  chrome.storage.local.get(['popupPosition'], function(result) {
    if (result.popupPosition) {
      var pos = result.popupPosition;
      // 确保位置在视口内
      var maxLeft = window.innerWidth - container.offsetWidth;
      var maxTop = window.innerHeight - container.offsetHeight;
      
      var left = Math.max(0, Math.min(pos.left, maxLeft));
      var top = Math.max(0, Math.min(pos.top, maxTop));
      
      container.style.position = 'fixed';
      container.style.left = left + 'px';
      container.style.top = top + 'px';
      container.style.right = 'auto';
      container.style.margin = '0';
      console.log('[Drag] 恢复位置:', left, top);
    } else {
      // 默认位置：右上角
      container.style.position = 'fixed';
      container.style.top = '10px';
      container.style.right = '10px';
      container.style.left = 'auto';
      container.style.margin = '0';
    }
  });
  
  header.addEventListener('mousedown', function(e) {
    // 只有左键可以拖动
    if (e.button !== 0) return;
    
    // 如果点击的是按钮，不触发拖动
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    // 获取当前位置
    var rect = container.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    
    // 确保使用fixed定位
    container.style.position = 'fixed';
    container.style.left = initialLeft + 'px';
    container.style.top = initialTop + 'px';
    container.style.right = 'auto';
    container.style.margin = '0';
    
    // 更改光标样式
    header.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    
    e.preventDefault();
    e.stopPropagation();
  });
  
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    
    var newLeft = initialLeft + dx;
    var newTop = initialTop + dy;
    
    // 限制在视口范围内
    var maxLeft = window.innerWidth - container.offsetWidth;
    var maxTop = window.innerHeight - container.offsetHeight;
    
    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));
    
    container.style.left = newLeft + 'px';
    container.style.top = newTop + 'px';
    container.style.right = 'auto';
  });
  
  document.addEventListener('mouseup', function() {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'move';
      document.body.style.cursor = '';
      
      // 保存位置到存储
      var rect = container.getBoundingClientRect();
      chrome.storage.local.set({
        popupPosition: { left: rect.left, top: rect.top }
      });
    }
  });
  
  // 双击标题栏重置位置
  header.addEventListener('dblclick', function(e) {
    // 如果双击的是按钮，不重置
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    
    container.style.left = 'auto';
    container.style.top = '10px';
    container.style.right = '10px';
    container.style.margin = '0';
    
    // 清除保存的位置
    chrome.storage.local.remove('popupPosition');
  });
  
  // 触摸设备支持
  header.addEventListener('touchstart', function(e) {
    isDragging = true;
    var touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    
    var rect = container.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    
    container.style.position = 'fixed';
    container.style.left = initialLeft + 'px';
    container.style.top = initialTop + 'px';
    container.style.right = 'auto';
    container.style.margin = '0';
    
    e.preventDefault();
  }, { passive: false });
  
  document.addEventListener('touchmove', function(e) {
    if (!isDragging) return;
    
    var touch = e.touches[0];
    var dx = touch.clientX - startX;
    var dy = touch.clientY - startY;
    
    var newLeft = initialLeft + dx;
    var newTop = initialTop + dy;
    
    var maxLeft = window.innerWidth - container.offsetWidth;
    var maxTop = window.innerHeight - container.offsetHeight;
    
    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));
    
    container.style.left = newLeft + 'px';
    container.style.top = newTop + 'px';
    e.preventDefault();
  }, { passive: false });
  
  document.addEventListener('touchend', function() {
    if (isDragging) {
      isDragging = false;
      var rect = container.getBoundingClientRect();
      chrome.storage.local.set({
        popupPosition: { left: rect.left, top: rect.top }
      });
    }
  });
}

// ============ Resize Functionality ============
function initResizeFunction() {
  var resizeHandle = document.getElementById('resizeHandle');
  var container = document.querySelector('.popup-container');
  var body = document.body;
  
  if (!resizeHandle || !container) {
    console.log('[Resize] 未找到调整大小元素');
    return;
  }
  
  console.log('[Resize] 初始化调整大小功能');
  
  var isResizing = false;
  var startX, startY, initialWidth, initialHeight;
  
  // 从存储中恢复大小
  chrome.storage.local.get(['popupSize'], function(result) {
    if (result.popupSize) {
      var size = result.popupSize;
      // 只限制最小尺寸，不限制最大尺寸
      var width = Math.max(320, size.width);
      var height = Math.max(300, size.height);
      
      container.style.width = width + 'px';
      container.style.height = height + 'px';
      body.style.width = width + 'px';
      body.style.height = height + 'px';
      console.log('[Resize] 恢复大小:', width, height);
    }
  });
  
  resizeHandle.addEventListener('mousedown', function(e) {
    // 只有左键可以调整大小
    if (e.button !== 0) return;
    
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    
    // 获取当前大小
    var rect = container.getBoundingClientRect();
    initialWidth = rect.width;
    initialHeight = rect.height;
    
    // 更改光标样式
    resizeHandle.style.cursor = 'nwse-resize';
    document.body.style.cursor = 'nwse-resize';
    
    // 防止选中文本
    e.preventDefault();
    e.stopPropagation();
  });
  
  document.addEventListener('mousemove', function(e) {
    if (!isResizing) return;
    
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    
    var newWidth = initialWidth + dx;
    var newHeight = initialHeight + dy;
    
    // 只限制最小尺寸，不限制最大尺寸
    var minWidth = 320;
    var minHeight = 300;
    
    newWidth = Math.max(minWidth, newWidth);
    newHeight = Math.max(minHeight, newHeight);
    
    // 应用新尺寸
    container.style.width = newWidth + 'px';
    container.style.height = newHeight + 'px';
    body.style.width = newWidth + 'px';
    body.style.height = newHeight + 'px';
  });
  
  document.addEventListener('mouseup', function() {
    if (isResizing) {
      isResizing = false;
      resizeHandle.style.cursor = 'nwse-resize';
      document.body.style.cursor = '';
      
      // 保存大小到存储
      var rect = container.getBoundingClientRect();
      chrome.storage.local.set({
        popupSize: { width: rect.width, height: rect.height }
      });
      console.log('[Resize] 保存大小:', rect.width, rect.height);
    }
  });
  
  // 双击调整大小手柄重置为默认大小
  resizeHandle.addEventListener('dblclick', function(e) {
    e.stopPropagation();
    
    var defaultWidth = 400;
    var defaultHeight = 520;
    
    container.style.width = defaultWidth + 'px';
    container.style.height = defaultHeight + 'px';
    body.style.width = defaultWidth + 'px';
    body.style.height = defaultHeight + 'px';
    
    // 清除保存的大小
    chrome.storage.local.remove('popupSize');
    console.log('[Resize] 重置为默认大小');
    
    addLog('窗口大小已重置为默认', 'info');
  });
}

// ============ Logging ============
function addLog(msg, type) {
  var logArea = document.getElementById('logArea');
  var div = document.createElement('div');
  div.className = 'log-item log-' + (type || 'info');
  var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  div.textContent = '[' + time + '] ' + msg;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
  
  // 同时保存到持久化存储
  saveLogToStorage(msg, type);
}

// 保存日志到存储
function saveLogToStorage(msg, type) {
  chrome.runtime.sendMessage({
    type: 'SAVE_CHECK_LOG',
    logEntry: {
      message: msg,
      type: (type || 'info').toUpperCase()
    }
  });
}

// 加载历史日志
function loadCheckLogs() {
  chrome.runtime.sendMessage({ type: 'GET_CHECK_LOGS', options: { limit: 50 } }, function(response) {
    if (response && response.logs && response.logs.length > 0) {
      var logArea = document.getElementById('logArea');
      // 添加分隔线提示历史日志
      var historyDiv = document.createElement('div');
      historyDiv.className = 'log-item log-info';
      historyDiv.style.fontStyle = 'italic';
      historyDiv.style.color = '#999';
      historyDiv.textContent = '--- 以下为历史日志 ---';
      logArea.appendChild(historyDiv);
      
      response.logs.forEach(function(log) {
        var div = document.createElement('div');
        div.className = 'log-item log-' + (log.type || 'info').toLowerCase();
        var time = new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
        div.textContent = '[' + time + '] ' + log.message;
        logArea.appendChild(div);
      });
      
      logArea.scrollTop = logArea.scrollHeight;
    }
  });
}

// ============ Event Binding ============
function bindEvents() {
  // Excel: "新增Excel文件" button
  var fileInput = document.getElementById('excelFile');
  document.getElementById('btnAddExcel').addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function (e) {
    handleExcelFiles(e.target.files);
    fileInput.value = '';
  });

  // API Key
  document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
  document.getElementById('resetApiKey').addEventListener('click', resetApiKey);
  document.getElementById('toggleKeyVisible').addEventListener('click', toggleKeyVisibility);

  // Function buttons
  document.getElementById('btnExtractList').addEventListener('click', extractTaskListWithCarTypeFilter);
  document.getElementById('btnBatchCheck').addEventListener('click', batchCheckTasks);
  document.getElementById('btnAutoApprove').addEventListener('click', autoApprove);

  // Car Type Filter buttons
  document.getElementById('carTypeSelect').addEventListener('change', handleCarTypeChange);
  document.getElementById('btnCheckByCarType').addEventListener('click', checkByCarType);
  document.getElementById('btnRefreshCarTypes').addEventListener('click', extractTaskListWithCarTypeFilter);

  // Close batch result
  document.getElementById('closeBatchResult').addEventListener('click', function() {
    document.getElementById('batchResultSection').style.display = 'none';
  });

  // 批量结果列表的事件委托（用于详情区的人工审核按钮和查看结果按钮）
  document.getElementById('batchResultList').addEventListener('click', function(e) {
    // 处理查看结果按钮（.batch-main-view）- 现在显示校验项详情弹窗
    var viewBtn = e.target.closest('.batch-main-view');
    if (viewBtn) {
      var indexStr = viewBtn.getAttribute('data-index');
      var index = parseInt(indexStr, 10);
      console.log('[EventDelegate] 查看结果按钮被点击, index:', index);
      if (!isNaN(index)) {
        e.stopPropagation();
        showCheckItemDetailsModal(index);
        return;
      }
    }
    
    // 处理详情区的查看完整详情按钮（.batch-view-details-btn）- 现在显示校验项详情弹窗
    var detailsBtn = e.target.closest('.batch-view-details-btn');
    if (detailsBtn) {
      var indexStr = detailsBtn.getAttribute('data-index');
      var index = parseInt(indexStr, 10);
      console.log('[EventDelegate] 查看完整详情按钮被点击, index:', index);
      if (!isNaN(index)) {
        e.stopPropagation();
        showCheckItemDetailsModal(index);
        return;
      }
    }
    
    // 处理详情区的打开任务详情页按钮（.batch-open-detail-btn）
    var openDetailBtn = e.target.closest('.batch-open-detail-btn');
    if (openDetailBtn) {
      var indexStr = openDetailBtn.getAttribute('data-index');
      var index = parseInt(indexStr, 10);
      console.log('[EventDelegate] 打开任务详情页按钮被点击, index:', index);
      if (!isNaN(index)) {
        e.stopPropagation();
        openTaskDetailPage(index);
        return;
      }
    }
    
    // 处理详情区的人工审核按钮（.batch-manual-btn）
    var btn = e.target.closest('.batch-manual-btn');
    if (!btn) return;
    
    var action = btn.getAttribute('data-action');
    var indexStr = btn.getAttribute('data-index');
    var index = parseInt(indexStr, 10);
    
    console.log('[ManualReview] 详情区按钮被点击:', action, index);
    
    if (isNaN(index)) {
      console.error('[ManualReview] 无效的索引:', indexStr);
      return;
    }
    
    // 阻止事件冒泡，防止触发任务行的点击事件
    e.stopPropagation();
    
    if (action === 'manual-confirm') {
      handleManualConfirm(index);
    } else if (action === 'manual-reject') {
      handleManualReject(index);
    }
  });

  // Export results to Excel
  document.getElementById('btnExportResults').addEventListener('click', exportResultsToExcel);

  // Clear persisted results
  document.getElementById('btnClearResults').addEventListener('click', function() {
    if (confirm('确定要清空所有校验结果和日志吗？此操作不可恢复。')) {
      clearAllPersistedData();
    }
  });

  // Export logs
  document.getElementById('btnExportLogs').addEventListener('click', exportLogsToFile);

  // Batch approve button
  document.getElementById('btnBatchApprove').addEventListener('click', batchApproveAll);

  // Clear log
  document.getElementById('clearLog').addEventListener('click', function () {
    document.getElementById('logArea').innerHTML = '';
    addLog('日志已清空', 'info');
  });
}

// ============ Excel Management ============
function handleExcelFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  
  // 显示进度条
  showProgress(true);
  updateProgress(0, '准备处理 ' + fileList.length + ' 个文件...');
  
  var currentIndex = 0;
  
  function processNext() {
    if (currentIndex >= fileList.length) {
      // 所有文件处理完成
      setTimeout(function() {
        showProgress(false);
        updateProgress(0, '');
      }, 1000);
      return;
    }
    
    var file = fileList[currentIndex];
    var progress = Math.round((currentIndex / fileList.length) * 100);
    updateProgress(progress, '正在处理 (' + (currentIndex + 1) + '/' + fileList.length + '): ' + file.name);
    
    handleOneExcelFile(file, function() {
      currentIndex++;
      processNext();
    });
  }
  
  processNext();
}

function handleOneExcelFile(file, callback) {
  if (!file.name.match(/\.xlsx?$/i)) {
    addLog('跳过非Excel文件: ' + file.name, 'error');
    if (callback) callback();
    return;
  }

  addLog('正在读取: ' + file.name + '...', 'info');
  updateProgress(null, '正在读取: ' + file.name);

  var reader = new FileReader();
  
  // 读取进度
  reader.onprogress = function(e) {
    if (e.lengthComputable) {
      var percent = Math.round((e.loaded / e.total) * 50); // 读取占50%
      updateProgress(percent, '读取中: ' + file.name + ' (' + Math.round(e.loaded / 1024) + 'KB/' + Math.round(e.total / 1024) + 'KB)');
    }
  };
  
  reader.onload = function (e) {
    try {
      updateProgress(60, '正在解析: ' + file.name);
      
      var data = new Uint8Array(e.target.result);
      var workbook = XLSX.read(data, { type: 'array' });
      var sheet = workbook.Sheets[workbook.SheetNames[0]];
      
      updateProgress(80, '正在处理数据: ' + file.name);
      var parsedRows = parseExcelSheet(sheet);

      var excelData = {
        fileName: file.name,
        importTime: new Date().toLocaleString('zh-CN'),
        partCount: parsedRows.length,
        rows: parsedRows
      };

      updateProgress(90, '正在保存: ' + file.name);

      // Firefox 兼容性处理：确保后台脚本已连接
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        addLog('错误: 扩展环境未就绪，请刷新页面重试', 'error');
        showProgress(false);
        if (callback) callback();
        return;
      }

      chrome.runtime.sendMessage(
        { type: 'ADD_EXCEL_DATA', data: excelData },
        function (response) {
          // Firefox 兼容性：检查运行时错误
          if (chrome.runtime.lastError) {
            var errorMsg = chrome.runtime.lastError.message || '未知错误';
            addLog('导入失败: ' + file.name + ' - ' + errorMsg, 'error');
            updateProgress(0, '导入失败');
            if (callback) callback();
            return;
          }
          
          if (response && response.success) {
            updateProgress(100, '完成: ' + file.name);
            addLog('导入成功: ' + file.name + ' (' + parsedRows.length + '条记录)', 'success');
            loadExcelList();
          } else {
            var errorMsg = (response && response.error) ? response.error : '未知错误';
            addLog('导入失败: ' + file.name + ' - ' + errorMsg, 'error');
            updateProgress(0, '导入失败');
          }
          
          // 延迟回调，让用户看到100%进度
          setTimeout(function() {
            if (callback) callback();
          }, 300);
        }
      );
    } catch (err) {
      addLog('解析失败: ' + file.name + ' - ' + err.message, 'error');
      updateProgress(0, '解析失败');
      if (callback) callback();
    }
  };
  
  reader.onerror = function() {
    addLog('读取文件失败: ' + file.name, 'error');
    updateProgress(0, '读取失败');
    if (callback) callback();
  };
  
  reader.readAsArrayBuffer(file);
}

function parseExcelSheet(sheet) {
  var rows = [];
  var range = XLSX.utils.decode_range(sheet['!ref']);
  var currentCategory = '';

  for (var r = 7; r <= range.e.r; r++) {
    var getVal = function (col) {
      var cell = sheet[XLSX.utils.encode_cell({ r: r, c: col })];
      return cell ? String(cell.v || '').trim() : '';
    };
    var colA = getVal(0);
    var colB = getVal(1);
    if (colA) currentCategory = colA;
    if (!colB) continue;

    rows.push({
      category: currentCategory,
      partComponentName: colB,
      gonggao: getVal(2),
      huanbao: getVal(3),
      ccc: getVal(4),
      cccCertificate: getVal(5),
      modelSpec: getVal(6),
      manufacturer: getVal(7),
      certNumber: getVal(8),
      applicableModel: getVal(9),
      remark: getVal(10),
      modelApplyMethod: getVal(11),
      modelPositionDesc: getVal(12),
      chinesePartName: getVal(13),
      partNumber: getVal(14),
      englishPartName: getVal(15)
    });
  }
  return rows;
}

function loadExcelList() {
  chrome.runtime.sendMessage({ type: 'GET_EXCEL_LIST' }, function (response) {
    var list = (response && response.list) || [];
    renderExcelList(list);
    var count = list.length;
    document.getElementById('excelCountBrief').textContent = count;
    document.getElementById('excelTotalCount').textContent = count;
    var dot = document.getElementById('dotExcel');
    dot.className = 'status-dot ' + (count > 0 ? 'dot-ok' : 'dot-warn');
  });
}

function renderExcelList(list) {
  var container = document.getElementById('excelFileList');

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-list">暂无导入，点击上方按钮添加</div>';
    return;
  }

  container.innerHTML = list.map(function (item) {
    var name = escapeHtml(item.fileName);
    var time = escapeHtml(item.importTime || '');
    var count = item.partCount || (item.rows ? item.rows.length : 0);
    return '<div class="excel-file-item" data-name="' + name + '">' +
      '<div class="excel-file-icon">XLS</div>' +
      '<div class="excel-file-info">' +
        '<div class="excel-file-name" title="' + name + '">' + name + '</div>' +
        '<div class="excel-file-meta">' + count + '条 | ' + time + '</div>' +
      '</div>' +
      '<button class="excel-file-del" data-name="' + name + '" title="删除">&times;</button>' +
    '</div>';
  }).join('');

  container.querySelectorAll('.excel-file-del').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var fileName = btn.dataset.name;
      if (confirm('确定删除 "' + fileName + '" ？')) {
        chrome.runtime.sendMessage({ type: 'REMOVE_EXCEL', fileName: fileName }, function (resp) {
          if (resp && resp.success) {
            addLog('已删除: ' + fileName, 'info');
            loadExcelList();
          }
        });
      }
    });
  });
}

// ============ API Key Management ============
function loadApiKeyStatus() {
  chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, function (response) {
    var key = response && response.apiKey;
    if (key) {
      var isDefault = (key === DEFAULT_API_KEY);
      document.getElementById('apiStatusText').textContent = isDefault ? '已配置 (内置Key)' : '已配置 (自定义Key)';
      document.getElementById('apiStatusText').className = 'status status-ok';
      document.getElementById('apiKeyInput').placeholder = '当前Key: ...' + key.slice(-8);
      document.getElementById('apiStatusBrief').textContent = '就绪';
      document.getElementById('dotApi').className = 'status-dot dot-ok';
    } else {
      document.getElementById('apiStatusText').textContent = '未配置';
      document.getElementById('apiStatusText').className = 'status status-warn';
      document.getElementById('apiStatusBrief').textContent = '未配置';
      document.getElementById('dotApi').className = 'status-dot dot-warn';
    }
  });
}

function saveApiKey() {
  var input = document.getElementById('apiKeyInput');
  var key = input.value.trim();

  if (!key) {
    addLog('请输入新的API Key', 'error');
    return;
  }

  chrome.runtime.sendMessage({ type: 'SAVE_API_KEY', apiKey: key }, function (response) {
    if (response && response.success) {
      input.value = '';
      addLog('API Key已更新', 'success');
      loadApiKeyStatus();
    }
  });
}

function resetApiKey() {
  chrome.runtime.sendMessage({ type: 'SAVE_API_KEY', apiKey: DEFAULT_API_KEY }, function (response) {
    if (response && response.success) {
      document.getElementById('apiKeyInput').value = '';
      addLog('已恢复为内置默认Key', 'success');
      loadApiKeyStatus();
    }
  });
}

function toggleKeyVisibility() {
  var input = document.getElementById('apiKeyInput');
  if (input.type === 'password') {
    input.type = 'text';
    chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, function (response) {
      if (response && response.apiKey) {
        input.value = response.apiKey;
      }
    });
  } else {
    input.type = 'password';
    input.value = '';
  }
}

// ============ Function Buttons ============
function extractTaskList() {
  addLog('正在提取任务列表...', 'info');
  sendToContentScript({ action: 'EXTRACT_TASK_LIST' }, function (response) {
    if (response && response.success) {
      addLog('提取成功! 共' + response.tasks.length + '条任务', 'success');
      response.tasks.forEach(function (t, i) {
        addLog('  ' + (i + 1) + '. [' + t.carType + '] ' + t.partsName + ' - ' + t.supplierName, 'info');
      });
    } else {
      addLog('提取失败: ' + (response ? response.error : '无法连接到页面'), 'error');
    }
  });
}

function autoCheckDetail() {
  addLog('正在校验详情页(含AI图片识别)...', 'info');
  sendToContentScript({ action: 'AUTO_CHECK_DETAIL' }, function (response) {
    if (response && response.success) {
      addLog('校验完成!', 'success');
      response.results.forEach(function (r) {
        var logType = r.passed ? 'success' : (r.needManual ? 'warn' : 'error');
        var prefix = r.passed ? '[通过]' : (r.needManual ? '[需人工]' : '[不通过]');
        addLog('  ' + prefix + ' ' + r.item + ': ' + r.result, logType);
      });
      var manual = response.results.filter(function (r) { return r.needManual; }).length;
      if (manual > 0) {
        addLog('共' + manual + '项需要人工确认，请查看页面上的校验面板', 'warn');
      }
    } else {
      addLog('校验失败: ' + (response ? response.error : '请先打开任务详情页'), 'error');
    }
  });
}

function autoApprove() {
  if (!confirm('确认要自动填写监测组审核并提交吗？\n请确保已校验所有信息无误！')) return;
  addLog('正在执行自动审核提交...', 'warn');
  sendToContentScript({ action: 'AUTO_APPROVE' }, function (response) {
    if (response && response.success) {
      addLog('审核提交操作已完成!', 'success');
    } else {
      addLog('操作失败: ' + (response ? response.error : '无法连接到页面'), 'error');
    }
  });
}

// ============ Car Type Filter Functions ============
var currentTaskList = []; // 存储当前提取的任务列表
var carTypeFilteredTasks = []; // 存储按车型筛选后的任务列表

// 提取任务列表并显示车型筛选区域
function extractTaskListWithCarTypeFilter() {
  addLog('正在提取任务列表...', 'info');
  sendToContentScript({ action: 'EXTRACT_TASK_LIST' }, function (response) {
    if (response && response.success) {
      currentTaskList = response.tasks || [];
      addLog('提取成功! 共' + currentTaskList.length + '条任务', 'success');
      
      // 显示车型筛选区域
      document.getElementById('carTypeFilterSection').style.display = 'block';
      
      // 填充车型下拉框
      populateCarTypeSelect();
      
      // 显示任务统计
      renderCarTypeStats();
      
      // 显示任务列表摘要
      currentTaskList.forEach(function (t, i) {
        addLog('  ' + (i + 1) + '. [' + t.carType + '] ' + t.partsName + ' - ' + t.supplierName, 'info');
      });
    } else {
      addLog('提取失败: ' + (response ? response.error : '无法连接到页面'), 'error');
    }
  });
}

// 填充车型下拉框
function populateCarTypeSelect() {
  var select = document.getElementById('carTypeSelect');
  var btnCheck = document.getElementById('btnCheckByCarType');
  
  // 清空现有选项（保留默认选项）
  select.innerHTML = '<option value="">-- 请选择车型/机型 --</option>';
  
  if (currentTaskList.length === 0) {
    select.disabled = true;
    btnCheck.disabled = true;
    return;
  }
  
  // 统计各车型的任务数量
  var carTypeCount = {};
  currentTaskList.forEach(function(task) {
    var carType = task.carType || '未知车型';
    if (!carTypeCount[carType]) {
      carTypeCount[carType] = 0;
    }
    carTypeCount[carType]++;
  });
  
  // 按车型名称排序并添加选项
  var sortedCarTypes = Object.keys(carTypeCount).sort();
  sortedCarTypes.forEach(function(carType) {
    var option = document.createElement('option');
    option.value = carType;
    option.textContent = carType + ' (' + carTypeCount[carType] + '条任务)';
    select.appendChild(option);
  });
  
  select.disabled = false;
  btnCheck.disabled = true; // 初始禁用，选择车型后启用
}

// 渲染车型统计信息
function renderCarTypeStats() {
  var statsEl = document.getElementById('carTypeStats');
  
  if (currentTaskList.length === 0) {
    statsEl.innerHTML = '<div style="text-align:center;color:#999;">暂无任务数据</div>';
    return;
  }
  
  // 统计各车型的任务数量
  var carTypeCount = {};
  currentTaskList.forEach(function(task) {
    var carType = task.carType || '未知车型';
    if (!carTypeCount[carType]) {
      carTypeCount[carType] = 0;
    }
    carTypeCount[carType]++;
  });
  
  // 生成统计HTML
  var totalTasks = currentTaskList.length;
  var uniqueCarTypes = Object.keys(carTypeCount).length;
  
  var html = '<div class="stat-item"><span>总任务数:</span><span class="stat-value">' + totalTasks + '</span></div>';
  html += '<div class="stat-item"><span>车型种类:</span><span class="stat-value">' + uniqueCarTypes + '</span></div>';
  html += '<div style="margin-top:6px;border-top:1px solid #ddd;padding-top:6px;">';
  
  // 按数量排序显示前5个车型
  var sortedTypes = Object.keys(carTypeCount).sort(function(a, b) {
    return carTypeCount[b] - carTypeCount[a];
  });
  
  sortedTypes.slice(0, 5).forEach(function(carType) {
    html += '<div class="stat-item"><span>' + escapeHtml(carType) + ':</span><span class="stat-value">' + carTypeCount[carType] + '条</span></div>';
  });
  
  if (sortedTypes.length > 5) {
    html += '<div style="text-align:center;color:#999;margin-top:4px;">...还有' + (sortedTypes.length - 5) + '种车型</div>';
  }
  
  html += '</div>';
  statsEl.innerHTML = html;
}

// 处理车型选择变化
function handleCarTypeChange() {
  var select = document.getElementById('carTypeSelect');
  var btnCheck = document.getElementById('btnCheckByCarType');
  var selectedCarType = select.value;
  
  if (selectedCarType) {
    // 筛选任务
    carTypeFilteredTasks = currentTaskList.filter(function(task) {
      return (task.carType || '未知车型') === selectedCarType;
    });
    
    btnCheck.disabled = false;
    addLog('已选择车型: ' + selectedCarType + '，共' + carTypeFilteredTasks.length + '条任务', 'info');
  } else {
    carTypeFilteredTasks = [];
    btnCheck.disabled = true;
  }
}

// 按车型一键校验
function checkByCarType() {
  if (carTypeFilteredTasks.length === 0) {
    addLog('请先选择车型', 'warn');
    return;
  }
  
  var selectedCarType = document.getElementById('carTypeSelect').value;
  
  if (!confirm('开始校验车型 "' + selectedCarType + '" 的 ' + carTypeFilteredTasks.length + ' 条任务？')) {
    return;
  }
  
  // 使用筛选后的任务列表进行批量校验
  startBatchCheckWithTasks(carTypeFilteredTasks, '车型: ' + selectedCarType);
}

// ============ Batch Check Functions ============
var batchCheckResults = [];
var isBatchChecking = false;

// 加载持久化的批量校验结果
function loadPersistedBatchResults() {
  chrome.runtime.sendMessage({ type: 'GET_BATCH_RESULTS' }, function(response) {
    console.log('[loadPersistedBatchResults] 收到响应:', response);
    if (response && response.results && response.results.length > 0) {
      batchCheckResults = response.results;
      // 检查数据完整性
      var hasResultsCount = batchCheckResults.filter(function(r) { return r.results && r.results.length > 0; }).length;
      console.log('[loadPersistedBatchResults] 恢复 ' + batchCheckResults.length + ' 条记录，其中 ' + hasResultsCount + ' 条有检验结果');
      // 显示结果区域
      document.getElementById('batchResultSection').style.display = 'block';
      renderBatchResults();
      
      // 显示恢复提示
      var lastTime = response.lastCheckTime ? new Date(response.lastCheckTime).toLocaleString('zh-CN') : '之前';
      addLog('已恢复 ' + batchCheckResults.length + ' 条校验记录（' + lastTime + '）', 'info');
    }
  });
}

// 保存批量校验结果到存储
function saveBatchResultsToStorage() {
  chrome.runtime.sendMessage({
    type: 'SAVE_BATCH_RESULTS',
    results: batchCheckResults
  });
}

// 清空所有持久化数据
function clearAllPersistedData() {
  chrome.runtime.sendMessage({ type: 'CLEAR_BATCH_RESULTS' }, function() {
    chrome.runtime.sendMessage({ type: 'CLEAR_CHECK_LOGS' }, function() {
      batchCheckResults = [];
      document.getElementById('batchResultSection').style.display = 'none';
      document.getElementById('logArea').innerHTML = '';
      addLog('已清空所有校验结果和日志', 'info');
    });
  });
}

// 导出校验结果到Excel
function exportResultsToExcel() {
  if (!batchCheckResults || batchCheckResults.length === 0) {
    addLog('暂无校验结果可导出', 'warn');
    return;
  }

  try {
    // 收集所有出现过的检验项名称（保证列完整）
    var allItemNames = [];
    batchCheckResults.forEach(function(r) {
      if (r.results && r.results.length > 0) {
        r.results.forEach(function(chk) {
          if (chk.item && allItemNames.indexOf(chk.item) === -1) {
            allItemNames.push(chk.item);
          }
        });
      }
    });

    // 构建表头
    var header = ['序号', '车型/机型', '零件名称', '供应商', '最新零件号'];
    allItemNames.forEach(function(name) {
      header.push(name);
    });
    header.push('最终结论', '人工审核', '备注');

    // 构建数据行
    var rows = [header];
    batchCheckResults.forEach(function(item, idx) {
      var row = [
        idx + 1,
        item.task.carType || '',
        item.task.partsName || '',
        item.task.supplierName || '',
        item.task.latestPartsCode || ''
      ];

      // 各检验项结果
      allItemNames.forEach(function(name) {
        var chk = null;
        if (item.results && item.results.length > 0) {
          for (var i = 0; i < item.results.length; i++) {
            if (item.results[i].item === name) {
              chk = item.results[i];
              break;
            }
          }
        }
        if (chk) {
          if (chk.passed) {
            row.push('符合');
          } else if (chk.needManual) {
            row.push('需人工确认');
          } else {
            row.push('不符合');
          }
        } else {
          row.push('-');
        }
      });

      // 最终结论
      var conclusion = '';
      if (item.manualStatus === 'confirmed') {
        conclusion = '通过（人工确认）';
      } else if (item.manualStatus === 'rejected') {
        conclusion = '不通过（人工确认）';
      } else if (item.status === 'pass') {
        conclusion = '通过';
      } else if (item.status === 'fail') {
        conclusion = '不通过';
      } else if (item.status === 'warn') {
        conclusion = '待人工确认';
      } else if (item.status === 'checking') {
        conclusion = '校验中';
      } else {
        conclusion = '待处理';
      }
      row.push(conclusion);

      // 人工审核状态
      var manualText = '';
      if (item.manualStatus === 'confirmed') {
        manualText = '人工确认通过';
      } else if (item.manualStatus === 'rejected') {
        manualText = '人工确认不通过';
      }
      row.push(manualText);

      // 备注（人工审核备注）
      row.push(item.manualNote || '');

      rows.push(row);
    });

    // 使用XLSX生成工作簿
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);

    // 设置列宽
    var colWidths = [{ wch: 6 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 18 }];
    allItemNames.forEach(function() { colWidths.push({ wch: 14 }); });
    colWidths.push({ wch: 16 }, { wch: 14 }, { wch: 20 });
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, '校验结果');

    // 构建检验项详细信息工作表
    var detailHeader = ['序号', '车型/机型', '零件名称', '供应商', '最新零件号', '检验项', '结果状态', '详细信息'];
    var detailRows = [detailHeader];
    
    batchCheckResults.forEach(function(item, idx) {
      if (item.results && item.results.length > 0) {
        item.results.forEach(function(chk) {
          var statusText = '';
          if (chk.passed) {
            statusText = '符合';
          } else if (chk.needManual) {
            statusText = '需人工确认';
          } else {
            statusText = '不符合';
          }
          
          var detailRow = [
            idx + 1,
            item.task.carType || '',
            item.task.partsName || '',
            item.task.supplierName || '',
            item.task.latestPartsCode || '',
            chk.item || '',
            statusText,
            chk.result || ''
          ];
          detailRows.push(detailRow);
        });
      }
    });
    
    // 创建检验项详细信息工作表
    var detailWs = XLSX.utils.aoa_to_sheet(detailRows);
    
    // 设置列宽
    var detailColWidths = [
      { wch: 6 },   // 序号
      { wch: 14 },  // 车型/机型
      { wch: 20 },  // 零件名称
      { wch: 18 },  // 供应商
      { wch: 18 },  // 最新零件号
      { wch: 20 },  // 检验项
      { wch: 12 },  // 结果状态
      { wch: 60 }   // 详细信息
    ];
    detailWs['!cols'] = detailColWidths;
    
    XLSX.utils.book_append_sheet(wb, detailWs, '检验项详情');

    // 生成文件名
    var dateStr = new Date().toISOString().slice(0, 10);
    var fileName = '一致性校验结果_' + dateStr + '.xlsx';

    // 触发下载
    XLSX.writeFile(wb, fileName);
    addLog('校验结果已导出: ' + fileName, 'success');
  } catch (err) {
    addLog('导出失败: ' + err.message, 'error');
  }
}

// 导出日志到文件
function exportLogsToFile() {
  chrome.runtime.sendMessage({ type: 'EXPORT_CHECK_LOGS' }, function(response) {
    if (response && response.success) {
      // 创建并下载文件
      var blob = new Blob([response.content], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '一致性校验日志_' + new Date().toISOString().slice(0, 10) + '.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog('日志已导出', 'success');
    } else {
      addLog('日志导出失败', 'error');
    }
  });
}

// 更新任务的人工审核状态
function updateTaskManualStatus(taskIndex, status, note) {
  chrome.runtime.sendMessage({
    type: 'UPDATE_TASK_MANUAL_STATUS',
    taskIndex: taskIndex,
    manualStatus: status,
    manualNote: note
  }, function(response) {
    if (response && response.success) {
      batchCheckResults = response.results;
      renderBatchResultsWithFilter();
      addLog('任务 ' + (taskIndex + 1) + ' 已标记为' + (status === 'confirmed' ? '人工确认通过' : '人工确认不通过'), 'success');
    }
  });
}

function batchCheckTasks() {
  if (isBatchChecking) {
    addLog('批量校验正在进行中，请等待完成', 'warn');
    return;
  }
  
  if (!confirm('开始批量校验任务清单？\n\n注意：这将自动打开每个任务的详情页进行校验，可能需要较长时间。校验任务将在后台运行，您可以关闭此弹窗。')) {
    return;
  }
  
  isBatchChecking = true;
  batchCheckResults = [];
  
  // 显示结果区域
  document.getElementById('batchResultSection').style.display = 'block';
  renderBatchResults();
  
  addLog('开始批量提取任务列表...', 'info');
  
  // 第一步：提取任务列表
  sendToContentScript({ action: 'EXTRACT_TASK_LIST' }, function (response) {
    if (!response || !response.success) {
      addLog('提取任务列表失败: ' + (response ? response.error : '未知错误'), 'error');
      isBatchChecking = false;
      return;
    }
    
    var tasks = response.tasks;
    if (tasks.length === 0) {
      addLog('未找到任何任务', 'warn');
      isBatchChecking = false;
      return;
    }
    
    // 更新当前任务列表并显示车型筛选区域
    currentTaskList = tasks;
    document.getElementById('carTypeFilterSection').style.display = 'block';
    populateCarTypeSelect();
    renderCarTypeStats();
    
    addLog('提取到 ' + tasks.length + ' 条任务，开始后台批量校验...', 'success');
    
    // 初始化结果数组
    batchCheckResults = tasks.map(function(task) {
      return {
        task: task,
        status: 'pending',
        results: [],
        error: null
      };
    });
    
    renderBatchResults();
    
    // 启动后台批量校验（在background脚本中运行）
    chrome.runtime.sendMessage({
      type: 'START_BACKGROUND_BATCH_CHECK',
      tasks: tasks,
      filterLabel: ''
    }, function(startResponse) {
      if (startResponse && startResponse.success) {
        addLog('后台批量校验已启动，共 ' + tasks.length + ' 条任务', 'success');
        // 开始轮询任务状态
        startStatusPolling();
      } else {
        addLog('启动后台校验失败: ' + (startResponse ? startResponse.error : '未知错误'), 'error');
        isBatchChecking = false;
      }
    });
  });
}

// 使用指定的任务列表开始批量校验
function startBatchCheckWithTasks(tasks, filterLabel) {
  if (isBatchChecking) {
    addLog('批量校验正在进行中，请等待完成', 'warn');
    return;
  }
  
  isBatchChecking = true;
  batchCheckResults = [];
  
  // 显示结果区域
  document.getElementById('batchResultSection').style.display = 'block';
  renderBatchResults();
  
  addLog('开始批量校验' + (filterLabel ? ' (' + filterLabel + ')' : '') + '，共' + tasks.length + '条任务...', 'info');
  
  // 初始化结果数组
  batchCheckResults = tasks.map(function(task) {
    return {
      task: task,
      status: 'pending',
      results: [],
      error: null
    };
  });
  
  renderBatchResults();
  
  // 启动后台批量校验（在background脚本中运行）
  chrome.runtime.sendMessage({
    type: 'START_BACKGROUND_BATCH_CHECK',
    tasks: tasks,
    filterLabel: filterLabel
  }, function(startResponse) {
    if (startResponse && startResponse.success) {
      addLog('后台批量校验已启动，共 ' + tasks.length + ' 条任务', 'success');
      // 开始轮询任务状态
      startStatusPolling();
    } else {
      addLog('启动后台校验失败: ' + (startResponse ? startResponse.error : '未知错误'), 'error');
      isBatchChecking = false;
    }
  });
}

function processNextBatchTask(index) {
  if (index >= batchCheckResults.length) {
    // 所有任务校验完成
    addLog('批量校验完成！共 ' + batchCheckResults.length + ' 条任务', 'success');
    isBatchChecking = false;
    renderBatchResults();
    return;
  }
  
  var currentTask = batchCheckResults[index];
  currentTask.status = 'checking';
  renderBatchResults();
  
  addLog('正在校验第 ' + (index + 1) + '/' + batchCheckResults.length + ' 条: [' + currentTask.task.carType + '] ' + currentTask.task.partsName, 'info');
  
  // 发送消息到内容脚本，打开详情页并校验
  sendToContentScript({ 
    action: 'BATCH_CHECK_TASK', 
    taskIndex: index,
    taskData: currentTask.task
  }, function (response) {
    console.log('[processNextBatchTask] 收到响应:', response);
    if (response && response.success) {
      currentTask.status = response.allPassed ? 'pass' : (response.hasWarning ? 'warn' : 'fail');
      currentTask.results = response.results || [];
      currentTask.source = response.source || 'unknown'; // 记录数据来源(api/popup)
      console.log('[processNextBatchTask] 保存结果到 currentTask, results条数:', currentTask.results.length);
      var sourceText = response.source === 'api' ? '[API]' : '[弹窗]';
      addLog('  校验完成' + sourceText + ': ' + (response.allPassed ? '通过' : (response.hasWarning ? '需人工确认' : '不通过')), 
        response.allPassed ? 'success' : (response.hasWarning ? 'warn' : 'error'));
    } else {
      currentTask.status = 'fail';
      currentTask.error = response ? response.error : '校验失败';
      currentTask.results = []; // 确保results为空数组而不是undefined
      addLog('  校验失败: ' + currentTask.error, 'error');
    }
    
    // 根据当前筛选状态调用正确的渲染函数
    renderBatchResultsWithFilter();
    
    // 保存到持久化存储
    console.log('[processNextBatchTask] 保存到存储, batchCheckResults:', batchCheckResults);
    saveBatchResultsToStorage();
    
    // 延迟处理下一个，让用户有时间看到进度
    setTimeout(function() {
      processNextBatchTask(index + 1);
    }, 500);
  });
}

// ============ Background Batch Check Status Polling ============
var statusPollingInterval = null;
var lastPolledIndex = 0;

// 开始轮询后台任务状态
function startStatusPolling() {
  // 清除之前的轮询
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
  }
  
  lastPolledIndex = 0;
  
  // 每2秒轮询一次状态
  statusPollingInterval = setInterval(function() {
    pollBackgroundBatchStatus();
  }, 2000);
  
  // 立即执行一次
  pollBackgroundBatchStatus();
}

// 停止状态轮询
function stopStatusPolling() {
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
  }
}

// 轮询后台批量校验状态
function pollBackgroundBatchStatus() {
  // 获取后台任务状态
  chrome.runtime.sendMessage({ type: 'GET_BACKGROUND_BATCH_STATUS' }, function(status) {
    if (!status) return;
    
    // 获取最新的结果数据
    chrome.runtime.sendMessage({ type: 'GET_BATCH_RESULTS' }, function(response) {
      if (response && response.results) {
        var newResults = response.results;
        
        // 检查是否有新的进度
        var hasNewProgress = false;
        for (var i = lastPolledIndex; i < newResults.length && i < status.currentIndex; i++) {
          if (newResults[i].status !== 'pending' && newResults[i].status !== 'checking') {
            hasNewProgress = true;
            // 更新本地结果
            if (batchCheckResults[i]) {
              var oldStatus = batchCheckResults[i].status;
              batchCheckResults[i] = newResults[i];
              
              // 如果状态变化了，记录日志
              if (oldStatus !== newResults[i].status) {
                var taskName = '[' + newResults[i].task.carType + '] ' + newResults[i].task.partsName;
                var statusText = {
                  'pass': '通过',
                  'fail': '不通过',
                  'warn': '需人工确认'
                }[newResults[i].status] || newResults[i].status;
                var logType = newResults[i].status === 'pass' ? 'success' : (newResults[i].status === 'warn' ? 'warn' : 'error');
                addLog('第 ' + (i + 1) + ' 条完成: ' + statusText + ' - ' + taskName, logType);
              }
            }
          }
        }
        
        lastPolledIndex = status.currentIndex;
        
        // 更新显示
        if (hasNewProgress || status.isRunning) {
          renderBatchResultsWithFilter();
        }
        
        // 如果任务完成，停止轮询
        if (!status.isRunning && status.currentIndex >= status.totalTasks && status.totalTasks > 0) {
          stopStatusPolling();
          isBatchChecking = false;
          addLog('批量校验完成！共 ' + status.totalTasks + ' 条任务', 'success');
          renderBatchResultsWithFilter();
        }
      }
    });
  });
}

// 检查并恢复后台运行的任务
function checkAndRestoreBackgroundTask() {
  chrome.runtime.sendMessage({ type: 'GET_BACKGROUND_BATCH_STATUS' }, function(status) {
    if (status && status.isRunning) {
      // 有正在运行的后台任务，恢复显示
      isBatchChecking = true;
      addLog('检测到正在运行的后台批量校验任务（' + status.currentIndex + '/' + status.totalTasks + '），正在恢复...', 'info');
      
      // 加载已有结果
      chrome.runtime.sendMessage({ type: 'GET_BATCH_RESULTS' }, function(response) {
        if (response && response.results && response.results.length > 0) {
          batchCheckResults = response.results;
          document.getElementById('batchResultSection').style.display = 'block';
          renderBatchResults();
          // 开始轮询
          startStatusPolling();
        }
      });
    }
  });
}

function renderBatchResults() {
  var summaryEl = document.getElementById('batchResultSummary');
  var listEl = document.getElementById('batchResultList');
  var approveArea = document.getElementById('batchApproveArea');
  var approveCount = document.getElementById('batchApproveCount');
  
  // 计算统计
  var total = batchCheckResults.length;
  var passed = batchCheckResults.filter(function(r) { return r.status === 'pass'; }).length;
  var failed = batchCheckResults.filter(function(r) { return r.status === 'fail'; }).length;
  var warning = batchCheckResults.filter(function(r) { return r.status === 'warn'; }).length;
  var pending = batchCheckResults.filter(function(r) { return r.status === 'pending' || r.status === 'checking'; }).length;
  var manualConfirmed = batchCheckResults.filter(function(r) { return r.manualStatus === 'confirmed'; }).length;
  var manualRejected = batchCheckResults.filter(function(r) { return r.manualStatus === 'rejected'; }).length;
  
  // 对结果进行排序：需人工审核的置顶，然后是未处理的，最后是已处理的
  var sortedResults = batchCheckResults.map(function(item, index) {
    return { item: item, originalIndex: index };
  }).sort(function(a, b) {
    // 需人工审核的置顶（且未人工确认）
    var aIsWarn = a.item.status === 'warn' && !a.item.manualStatus;
    var bIsWarn = b.item.status === 'warn' && !b.item.manualStatus;
    if (aIsWarn && !bIsWarn) return -1;
    if (!aIsWarn && bIsWarn) return 1;
    
    // 然后是校验中的
    var aIsChecking = a.item.status === 'checking';
    var bIsChecking = b.item.status === 'checking';
    if (aIsChecking && !bIsChecking) return -1;
    if (!aIsChecking && bIsChecking) return 1;
    
    // 然后是待处理的
    var aIsPending = a.item.status === 'pending';
    var bIsPending = b.item.status === 'pending';
    if (aIsPending && !bIsPending) return -1;
    if (!aIsPending && bIsPending) return 1;
    
    // 保持原始顺序
    return a.originalIndex - b.originalIndex;
  });
  
  // 渲染汇总 - 添加点击筛选功能
  var summaryHtml = 
    '<div class="batch-summary-item"><span>总任务数:</span><span><b>' + total + '</b></span></div>' +
    '<div class="batch-summary-item batch-summary-clickable" data-filter="pass" onclick="filterBatchResults(\'pass\')"><span>已通过:</span><span class="batch-status-pass"><b>' + passed + '</b></span></div>' +
    '<div class="batch-summary-item batch-summary-clickable" data-filter="fail" onclick="filterBatchResults(\'fail\')"><span>不通过:</span><span class="batch-status-fail"><b>' + failed + '</b></span></div>' +
    '<div class="batch-summary-item batch-summary-clickable" data-filter="warn" onclick="filterBatchResults(\'warn\')"><span>需人工:</span><span class="batch-status-warn"><b>' + warning + '</b></span></div>';
  
  // 显示人工审核统计
  if (manualConfirmed > 0 || manualRejected > 0) {
    summaryHtml += '<div class="batch-summary-item batch-summary-clickable" data-filter="confirmed" onclick="filterBatchResults(\'confirmed\')"><span>人工确认:</span><span style="color:#4caf50;"><b>' + manualConfirmed + '</b></span></div>';
    summaryHtml += '<div class="batch-summary-item batch-summary-clickable" data-filter="rejected" onclick="filterBatchResults(\'rejected\')"><span>人工拒绝:</span><span style="color:#f44336;"><b>' + manualRejected + '</b></span></div>';
  }
  
  summaryHtml += '<div class="batch-summary-item batch-summary-clickable" data-filter="pending" onclick="filterBatchResults(\'pending\')"><span>待处理:</span><span class="batch-status-pending"><b>' + pending + '</b></span></div>';
  summaryHtml += '<div class="batch-summary-item batch-summary-clickable batch-summary-reset" onclick="filterBatchResults(\'all\')"><span style="color:#006bb3;">显示全部</span></div>';
  summaryEl.innerHTML = summaryHtml;
  
  // 显示/隐藏批量审核按钮（只有当有通过的任务且不在校验中时显示）
  // 同时包括人工确认通过的任务
  var totalApprovable = passed + manualConfirmed;
  if (total > 0 && pending === 0 && totalApprovable > 0) {
    approveArea.style.display = 'block';
    approveCount.textContent = totalApprovable;
  } else {
    approveArea.style.display = 'none';
  }
  
  // 渲染列表
  if (total === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无数据</div>';
    return;
  }
  
  listEl.innerHTML = sortedResults.map(function(sortedItem, displayIdx) {
    var item = sortedItem.item;
    var idx = sortedItem.originalIndex;
    var statusClass = 'batch-status-' + item.status;
    var statusText = {
      'pending': '待处理',
      'checking': '校验中...',
      'pass': '通过',
      'fail': '不通过',
      'warn': '需人工'
    }[item.status] || item.status;
    
    // 如果已人工审核，优先显示人工审核状态
    if (item.manualStatus === 'confirmed') {
      statusClass = 'batch-status-pass';
      statusText = '人工确认通过';
    } else if (item.manualStatus === 'rejected') {
      statusClass = 'batch-status-fail';
      statusText = '人工确认不通过';
    } else if (item.approved) {
      statusClass = 'batch-status-approved';
      statusText = '已审核';
    }
    
    var title = '[' + item.task.carType + '] ' + item.task.partsName;
    var subtitle = item.task.supplierName + ' | ' + item.task.latestPartsCode;
    
    // 数据来源标记已移除
    
    // 构建详情HTML
    var detailsHtml = '';
    if (item.results && item.results.length > 0) {
      detailsHtml = '<div class="batch-task-details" id="batch-details-' + idx + '" style="display:none;">' +
        item.results.map(function(r) {
          var iconClass = r.passed ? 'pass' : (r.needManual ? 'warn' : 'fail');
          var icon = r.passed ? '✓' : (r.needManual ? '!' : '✗');
          return '<div class="batch-check-item">' +
            '<div class="batch-check-icon ' + iconClass + '">' + icon + '</div>' +
            '<div class="batch-check-content">' +
              '<div class="batch-check-name">' + r.item + '</div>' +
              '<div class="batch-check-result">' + r.result + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      
      // 添加审核结果信息
      if (item.approved) {
        detailsHtml += '<div class="batch-check-item" style="border-top:1px solid #c8e6c9;margin-top:4px;padding-top:8px;">' +
          '<div class="batch-check-icon pass">✓</div>' +
          '<div class="batch-check-content">' +
            '<div class="batch-check-name">审核结果</div>' +
            '<div class="batch-check-result">' + item.approveResult + '</div>' +
          '</div>' +
        '</div>';
      } else if (item.approveError) {
        detailsHtml += '<div class="batch-check-item" style="border-top:1px solid #ffcdd2;margin-top:4px;padding-top:8px;">' +
          '<div class="batch-check-icon fail">✗</div>' +
          '<div class="batch-check-content">' +
            '<div class="batch-check-name">审核失败</div>' +
            '<div class="batch-check-result">' + item.approveError + '</div>' +
          '</div>' +
        '</div>';
      }
      
      // 添加人工审核按钮（仅对需人工审核的任务显示）
      if (item.status === 'warn' && !item.manualStatus && !item.approved) {
        detailsHtml += '<div class="batch-manual-actions" style="border-top:1px solid #ffe0b2;margin-top:8px;padding-top:12px;">' +
          '<div style="font-size:12px;color:#666;margin-bottom:8px;">人工审核操作：</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="batch-manual-btn batch-manual-confirm" data-action="manual-confirm" data-index="' + idx + '">' +
              '<span class="btn-icon">✓</span> 确认通过' +
            '</button>' +
            '<button class="batch-manual-btn batch-manual-reject" data-action="manual-reject" data-index="' + idx + '">' +
              '<span class="btn-icon">✗</span> 确认不通过' +
            '</button>' +
          '</div>' +
          '<div style="margin-top:8px;">' +
            '<input type="text" id="manual-note-' + idx + '" placeholder="审核备注（可选）" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;">' +
          '</div>' +
        '</div>';
        
        // 为需人工审核的任务添加"打开任务详情页"按钮
        detailsHtml += '<div style="border-top:1px solid #e0e0e0;margin-top:8px;padding-top:8px;text-align:center;">' +
          '<button class="batch-manual-btn batch-open-detail-btn" style="background:#ff9800;color:#fff;" data-index="' + idx + '">' +
            '<span class="btn-icon">🔗</span> 打开任务详情页' +
          '</button>' +
        '</div>';
      }
      
      // 显示人工审核结果
      if (item.manualStatus) {
        var manualClass = item.manualStatus === 'confirmed' ? 'pass' : 'fail';
        var manualIcon = item.manualStatus === 'confirmed' ? '✓' : '✗';
        var manualText = item.manualStatus === 'confirmed' ? '人工确认通过' : '人工确认不通过';
        detailsHtml += '<div class="batch-check-item" style="border-top:1px solid #e0e0e0;margin-top:4px;padding-top:8px;">' +
          '<div class="batch-check-icon ' + manualClass + '">' + manualIcon + '</div>' +
          '<div class="batch-check-content">' +
            '<div class="batch-check-name">' + manualText + '</div>' +
            '<div class="batch-check-result">' + (item.manualNote || '无备注') + ' <span style="color:#999;font-size:11px;">(' + new Date(item.manualTime).toLocaleString('zh-CN') + ')</span></div>' +
          '</div>' +
        '</div>';
      }
      
      // 添加查看完整详情按钮
      detailsHtml += '<div style="border-top:1px solid #e0e0e0;margin-top:8px;padding-top:8px;text-align:center;">' +
        '<button class="batch-manual-btn batch-view-details-btn" style="background:#004375;color:#fff;" data-index="' + idx + '">' +
          '<span class="btn-icon">🔍</span> 查看完整详情' +
        '</button>' +
      '</div>';
      
      detailsHtml += '</div>';
    } else if (item.error) {
      detailsHtml = '<div class="batch-task-details" id="batch-details-' + idx + '" style="display:none;">' +
        '<div class="batch-check-item">' +
          '<div class="batch-check-icon fail">✗</div>' +
          '<div class="batch-check-content">' +
            '<div class="batch-check-name">错误</div>' +
            '<div class="batch-check-result">' + item.error + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    
    var headerClass = 'batch-task-header';
    if (item.approved) {
      headerClass += ' approved';
    }
    // 为需人工审核的任务添加特殊标记
    if (item.status === 'warn' && !item.manualStatus && !item.approved) {
      headerClass += ' batch-status-warn-clickable';
    }
    
    // 构建主操作区的按钮
    var mainActionHtml = '';
    
    // 所有任务都显示"查看结果"按钮（如果有实际结果数据或错误信息）
    var hasResults = item.results && item.results.length > 0;
    var hasError = item.error && item.error.length > 0;
    // 只要有结果数据或错误信息，就显示查看按钮（包括待处理状态）
    if (hasResults || hasError) {
      mainActionHtml += '<button class="batch-main-btn batch-main-view" title="查看校验结果" data-index="' + idx + '" style="background:#004375;color:#fff;margin-right:4px;">' +
          '<span class="btn-icon">🔍</span>' +
        '</button>';
    }
    
    // 主操作界面的通过/不通过按钮已移除，改为在校验项详情界面操作
    
    // 显示人工审核结果（在主区域）
    var manualStatusHtml = '';
    if (item.manualStatus) {
      var manualClass = item.manualStatus === 'confirmed' ? 'batch-status-pass' : 'batch-status-fail';
      var manualText = item.manualStatus === 'confirmed' ? '人工通过' : '人工不通过';
      manualStatusHtml = '<span class="batch-status-badge ' + manualClass + '" style="margin-left:5px;">' + manualText + '</span>';
    }
    
    // 根据任务状态决定点击行为：所有任务点击时都可以展开/收起详情
    var clickHandler = 'onclick="toggleBatchDetails(' + idx + ', event)"';
    var dataStatusAttr = '';
    if (item.status === 'warn' && !item.manualStatus && !item.approved) {
      // 需人工审核的任务标记为warn状态
      dataStatusAttr = 'data-status="warn"';
    }
    
    return '<div class="batch-task-item">' +
      '<div class="' + headerClass + '" ' + clickHandler + ' ' + dataStatusAttr + '>' +
        '<div>' +
          '<div class="batch-task-title">' + (idx + 1) + '. ' + escapeHtml(title) + '</div>' +
          '<div style="font-size:10px;color:#999;margin-top:2px;">' + escapeHtml(subtitle) + '</div>' +
        '</div>' +
        '<div class="batch-task-status" style="display:flex;align-items:center;gap:6px;">' +
          mainActionHtml +
          '<span class="batch-status-badge ' + statusClass + '">' + statusText + '</span>' + manualStatusHtml +
          '<span class="batch-toggle-icon" id="batch-toggle-' + idx + '">▼</span>' +
        '</div>' +
      '</div>' +
      detailsHtml +
    '</div>';
  }).join('');
}

function toggleBatchDetails(index, event) {
  // 如果点击来自按钮（详情区或主操作区），不执行展开/收起
  if (event && (event.target.closest('.batch-manual-btn') || event.target.closest('.batch-main-btn'))) {
    return;
  }
  
  var detailsEl = document.getElementById('batch-details-' + index);
  var toggleEl = document.getElementById('batch-toggle-' + index);
  
  if (detailsEl) {
    var isVisible = detailsEl.style.display !== 'none';
    detailsEl.style.display = isVisible ? 'none' : 'block';
    if (toggleEl) {
      toggleEl.classList.toggle('expanded', !isVisible);
    }
    
    // 如果是展开操作且是"需人工"状态的任务，高亮显示一致性检验结果
    if (!isVisible && batchCheckResults[index]) {
      var task = batchCheckResults[index];
      if (task.status === 'warn' && task.results && task.results.length > 0) {
        // 添加视觉反馈，提示用户查看检验结果
        setTimeout(function() {
          detailsEl.style.backgroundColor = '#fff8e1';
          setTimeout(function() {
            detailsEl.style.backgroundColor = '';
          }, 300);
        }, 100);
      }
    }
  }
}

// 显示指定任务的详情弹窗（改为直接打开任务单详情网页）
function showTaskDetailsModal(index) {
  console.log('[showTaskDetailsModal] 被调用, index:', index);
  
  var item = batchCheckResults[index];
  if (!item) {
    console.error('[showTaskDetailsModal] 未找到对应任务, index:', index);
    alert('未找到任务数据，请刷新页面重试');
    return;
  }
  
  console.log('[showTaskDetailsModal] 找到任务:', item);
  
  // 获取任务ID
  var taskId = item.task.id;
  if (!taskId) {
    alert('该任务没有有效的任务ID，无法打开详情页');
    return;
  }
  
  // 根据任务来源确定详情页类型
  // source: 2 = 日常监控任务, 其他 = PPAP或自增任务
  var source = item.task.source;
  var viewPage = (source == '2' || source == 2) 
    ? 'uniformityFinishedMonitoring.html' 
    : 'uniformityFinished.html';
  
  // 构建详情页URL
  var detailPath = 'components/uniformity/' + viewPage;
  
  console.log('[showTaskDetailsModal] 打开任务详情页:', detailPath, '任务ID:', taskId);
  
  // 发送消息到内容脚本，在当前页面打开任务详情
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'OPEN_TASK_DETAIL',
        taskId: taskId,
        detailPath: detailPath,
        taskData: item.task
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('[showTaskDetailsModal] 发送消息失败:', chrome.runtime.lastError);
          alert('无法打开任务详情页，请确保在正确的页面');
          return;
        }
        
        if (response && response.success) {
          console.log('[showTaskDetailsModal] 任务详情页已打开');
        } else {
          var errorMsg = (response && response.error) ? response.error : '未知错误';
          console.error('[showTaskDetailsModal] 打开详情页失败:', errorMsg);
          alert('打开任务详情页失败: ' + errorMsg);
        }
      });
    } else {
      alert('未找到活动标签页');
    }
  });
}

// 打开任务详情页（用于需人工审核任务的跳转按钮）
function openTaskDetailPage(index) {
  console.log('[openTaskDetailPage] 被调用, index:', index);
  
  var item = batchCheckResults[index];
  if (!item) {
    console.error('[openTaskDetailPage] 未找到对应任务, index:', index);
    alert('未找到任务数据，请刷新页面重试');
    return;
  }
  
  console.log('[openTaskDetailPage] 找到任务:', item);
  
  // 获取任务ID
  var taskId = item.task.id;
  if (!taskId) {
    alert('该任务没有有效的任务ID，无法打开详情页');
    return;
  }
  
  // 根据任务来源确定详情页类型
  // source: 2 = 日常监控任务, 其他 = PPAP或自增任务
  var source = item.task.source;
  var viewPage = (source == '2' || source == 2) 
    ? 'uniformityFinishedMonitoring.html' 
    : 'uniformityFinished.html';
  
  // 构建详情页URL
  var detailPath = 'components/uniformity/' + viewPage;
  
  console.log('[openTaskDetailPage] 打开任务详情页:', detailPath, '任务ID:', taskId);
  
  // 发送消息到内容脚本，在当前页面打开任务详情
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'OPEN_TASK_DETAIL',
        taskId: taskId,
        detailPath: detailPath,
        taskData: item.task
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('[openTaskDetailPage] 发送消息失败:', chrome.runtime.lastError);
          alert('无法打开任务详情页，请确保在正确的页面');
          return;
        }
        
        if (response && response.success) {
          console.log('[openTaskDetailPage] 任务详情页已打开');
        } else {
          var errorMsg = (response && response.error) ? response.error : '未知错误';
          console.error('[openTaskDetailPage] 打开详情页失败:', errorMsg);
          alert('打开任务详情页失败: ' + errorMsg);
        }
      });
    } else {
      alert('未找到活动标签页');
    }
  });
}

// 人工确认通过
function handleManualConfirm(index) {
  console.log('[ManualReview] handleManualConfirm 被调用, index:', index);
  
  var noteInputId = 'manual-note-' + index;
  var noteInput = document.getElementById(noteInputId);
  var note = noteInput ? noteInput.value.trim() : '';
  
  console.log('[ManualReview] 备注输入框:', noteInputId, noteInput ? '找到' : '未找到', '备注:', note);
  
  if (!confirm('确认将该任务标记为"人工审核通过"？')) {
    return;
  }
  
  updateTaskManualStatus(index, 'confirmed', note);
}

// 人工确认不通过
function handleManualReject(index) {
  console.log('[ManualReview] handleManualReject 被调用, index:', index);
  
  var noteInputId = 'manual-note-' + index;
  var noteInput = document.getElementById(noteInputId);
  var note = noteInput ? noteInput.value.trim() : '';
  
  console.log('[ManualReview] 备注输入框:', noteInputId, noteInput ? '找到' : '未找到', '备注:', note);
  
  if (!note) {
    alert('请填写审核备注说明不通过原因');
    return;
  }
  
  if (!confirm('确认将该任务标记为"人工审核不通过"？')) {
    return;
  }
  
  updateTaskManualStatus(index, 'rejected', note);
}

// ============ Batch Approve Functions ============
var isBatchApproving = false;

function batchApproveAll() {
  if (isBatchApproving) {
    addLog('批量审核正在进行中，请等待完成', 'warn');
    return;
  }
  
  // 获取所有校验通过的任务
  var passedTasks = batchCheckResults.filter(function(r) { 
    return r.status === 'pass' && !r.approved; 
  });
  
  if (passedTasks.length === 0) {
    addLog('没有待审核的通过任务', 'warn');
    return;
  }
  
  if (!confirm('确认要一键审核通过 ' + passedTasks.length + ' 个任务吗？\n\n注意：这将自动打开每个任务详情页，填写监测组审核意见并提交。')) {
    return;
  }
  
  isBatchApproving = true;
  
  // 显示进度
  document.getElementById('btnBatchApprove').disabled = true;
  document.getElementById('batchApproveProgress').style.display = 'block';
  
  addLog('开始批量审核，共 ' + passedTasks.length + ' 个任务', 'info');
  
  // 开始逐个审核
  processNextBatchApprove(0, passedTasks);
}

function processNextBatchApprove(index, passedTasks) {
  if (index >= passedTasks.length) {
    // 所有任务审核完成
    addLog('批量审核完成！共处理 ' + passedTasks.length + ' 个任务', 'success');
    isBatchApproving = false;
    document.getElementById('btnBatchApprove').disabled = false;
    document.getElementById('batchApproveProgress').style.display = 'none';
    renderBatchResults();
    return;
  }
  
  var currentTaskItem = passedTasks[index];
  var originalIndex = batchCheckResults.indexOf(currentTaskItem);
  
  // 更新进度
  document.getElementById('batchApproveText').textContent = 
    '正在审核 (' + (index + 1) + '/' + passedTasks.length + '): ' + currentTaskItem.task.partsName;
  
  addLog('正在审核第 ' + (index + 1) + '/' + passedTasks.length + ' 条: [' + currentTaskItem.task.carType + '] ' + currentTaskItem.task.partsName, 'info');
  
  // 发送消息到内容脚本，打开详情页并审核
  sendToContentScript({ 
    action: 'BATCH_APPROVE_TASK', 
    taskIndex: originalIndex,
    taskData: currentTaskItem.task
  }, function (response) {
    if (response && response.success) {
      currentTaskItem.approved = true;
      currentTaskItem.approveResult = response.message || '审核成功';
      addLog('  审核完成: ' + (response.message || '成功'), 'success');
    } else {
      currentTaskItem.approveError = response ? response.error : '审核失败';
      addLog('  审核失败: ' + (response ? response.error : '未知错误'), 'error');
    }
    
    renderBatchResults();
    
    // 延迟处理下一个
    setTimeout(function() {
      processNextBatchApprove(index + 1, passedTasks);
    }, 800);
  });
}

// ============ Utils ============
function sendToContentScript(message, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, message, callback);
    } else {
      callback({ success: false, error: '未找到活动标签页' });
    }
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============ Check Item Details Modal ============
// 显示校验项详情弹窗
function showCheckItemDetailsModal(index) {
  console.log('[showCheckItemDetailsModal] 被调用, index:', index);
  
  var item = batchCheckResults[index];
  if (!item) {
    console.error('[showCheckItemDetailsModal] 未找到对应任务, index:', index);
    alert('未找到任务数据，请刷新页面重试');
    return;
  }
  
  console.log('[showCheckItemDetailsModal] 找到任务:', item);
  
  // 移除已存在的弹窗
  var existingModal = document.getElementById('checkItemDetailsModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // 创建弹窗
  var modal = document.createElement('div');
  modal.id = 'checkItemDetailsModal';
  modal.className = 'check-item-modal';
  
  // 构建校验项列表HTML
  var checkItemsHtml = '';
  if (item.results && item.results.length > 0) {
    checkItemsHtml = item.results.map(function(r, rIdx) {
      var iconClass = r.passed ? 'pass' : (r.needManual ? 'warn' : 'fail');
      var icon = r.passed ? '✓' : (r.needManual ? '!' : '✗');
      var itemStatus = r.passed ? '通过' : (r.needManual ? '需人工' : '不通过');
      
      return '<div class="check-item-detail-row" data-idx="' + rIdx + '">' +
        '<div class="check-item-detail-icon ' + iconClass + '">' + icon + '</div>' +
        '<div class="check-item-detail-content">' +
          '<div class="check-item-detail-name">' + escapeHtml(r.item) + '</div>' +
          '<div class="check-item-detail-result">' + escapeHtml(r.result) + '</div>' +
          '<div class="check-item-detail-status">状态: <span class="status-' + iconClass + '">' + itemStatus + '</span></div>' +
        '</div>' +
      '</div>';
    }).join('');
  } else {
    checkItemsHtml = '<div class="check-item-empty">暂无校验项数据</div>';
  }
  
  // 构建人工审核操作区HTML
  var manualActionHtml = '';
  if (item.status === 'warn' && !item.manualStatus && !item.approved) {
    manualActionHtml = '<div class="check-item-manual-actions">' +
      '<div class="check-item-manual-title">人工审核操作</div>' +
      '<div class="check-item-manual-buttons">' +
        '<button class="check-item-btn check-item-btn-pass" onclick="handleDetailManualConfirm(' + index + ')">' +
          '<span class="btn-icon">✓</span> 确认通过' +
        '</button>' +
        '<button class="check-item-btn check-item-btn-fail" onclick="handleDetailManualReject(' + index + ')">' +
          '<span class="btn-icon">✗</span> 确认不通过' +
        '</button>' +
      '</div>' +
      '<div class="check-item-manual-note">' +
        '<input type="text" id="detail-manual-note-' + index + '" placeholder="审核备注（不通过时必填）" class="check-item-note-input">' +
      '</div>' +
    '</div>';
  } else if (item.manualStatus) {
    var manualClass = item.manualStatus === 'confirmed' ? 'pass' : 'fail';
    var manualText = item.manualStatus === 'confirmed' ? '人工确认通过' : '人工确认不通过';
    manualActionHtml = '<div class="check-item-manual-result ' + manualClass + '">' +
      '<div class="check-item-manual-result-title">' + manualText + '</div>' +
      '<div class="check-item-manual-result-note">' + (item.manualNote || '无备注') + '</div>' +
      '<div class="check-item-manual-result-time">' + new Date(item.manualTime).toLocaleString('zh-CN') + '</div>' +
    '</div>';
  }
  
  // 构建弹窗HTML
  var title = '[' + item.task.carType + '] ' + item.task.partsName;
  var subtitle = '供应商: ' + item.task.supplierName + ' | 零件号: ' + item.task.latestPartsCode;
  
  modal.innerHTML = 
    '<div class="check-item-modal-overlay" onclick="closeCheckItemDetailsModal()"></div>' +
    '<div class="check-item-modal-content">' +
      '<div class="check-item-modal-header">' +
        '<div class="check-item-modal-title">' + escapeHtml(title) + '</div>' +
        '<div class="check-item-modal-subtitle">' + escapeHtml(subtitle) + '</div>' +
        '<button class="check-item-modal-close" onclick="closeCheckItemDetailsModal()">&times;</button>' +
      '</div>' +
      '<div class="check-item-modal-body">' +
        '<div class="check-item-summary">' +
          '<div class="check-item-summary-title">校验结果摘要</div>' +
          '<div class="check-item-summary-content">' +
            '<span class="check-item-summary-status ' + (item.status === 'pass' ? 'pass' : (item.status === 'warn' ? 'warn' : (item.status === 'fail' ? 'fail' : 'pending'))) + '">' +
              (item.status === 'pass' ? '✓ 通过' : (item.status === 'warn' ? '! 需人工' : (item.status === 'fail' ? '✗ 不通过' : '○ 待处理'))) +
            '</span>' +
            (item.results ? '<span class="check-item-summary-count">共 ' + item.results.length + ' 项校验</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="check-item-list">' + checkItemsHtml + '</div>' +
        manualActionHtml +
      '</div>' +
      '<div class="check-item-modal-footer">' +
        '<button class="check-item-modal-btn check-item-modal-btn-primary" onclick="openTaskDetailPage(' + index + ')">' +
          '<span class="btn-icon">🔗</span> 打开任务详情页' +
        '</button>' +
        '<button class="check-item-modal-btn" onclick="closeCheckItemDetailsModal()">关闭</button>' +
      '</div>' +
    '</div>';
  
  document.body.appendChild(modal);
  
  // 显示动画
  setTimeout(function() {
    modal.classList.add('show');
  }, 10);
}

// 关闭校验项详情弹窗
function closeCheckItemDetailsModal() {
  var modal = document.getElementById('checkItemDetailsModal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(function() {
      modal.remove();
    }, 300);
  }
}

// 当前筛选状态
var currentFilter = 'all';

// 统一渲染函数 - 根据当前筛选状态自动选择正确的渲染方式
function renderBatchResultsWithFilter() {
  if (currentFilter && currentFilter !== 'all') {
    renderFilteredBatchResults();
  } else {
    renderBatchResults();
  }
}

// 筛选批量校验结果
function filterBatchResults(filter) {
  currentFilter = filter;
  
  // 更新汇总区域的选中状态
  var summaryItems = document.querySelectorAll('.batch-summary-clickable');
  summaryItems.forEach(function(item) {
    item.classList.remove('active');
    if (item.getAttribute('data-filter') === filter) {
      item.classList.add('active');
    }
  });
  
  // 重新渲染列表
  renderFilteredBatchResults();
  
  addLog('已筛选: ' + (filter === 'all' ? '显示全部' : filter === 'pass' ? '已通过' : filter === 'fail' ? '不通过' : filter === 'warn' ? '需人工' : filter === 'confirmed' ? '人工确认' : filter === 'rejected' ? '人工拒绝' : '待处理'), 'info');
}

// 渲染筛选后的批量校验结果
function renderFilteredBatchResults() {
  var listEl = document.getElementById('batchResultList');
  
  if (batchCheckResults.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无数据</div>';
    return;
  }
  
  // 对结果进行排序并筛选
  var filteredSortedResults = batchCheckResults.map(function(item, index) {
    return { item: item, originalIndex: index };
  }).filter(function(sortedItem) {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'pass') return sortedItem.item.status === 'pass';
    if (currentFilter === 'fail') return sortedItem.item.status === 'fail';
    if (currentFilter === 'warn') return sortedItem.item.status === 'warn';
    if (currentFilter === 'confirmed') return sortedItem.item.manualStatus === 'confirmed';
    if (currentFilter === 'rejected') return sortedItem.item.manualStatus === 'rejected';
    if (currentFilter === 'pending') return sortedItem.item.status === 'pending' || sortedItem.item.status === 'checking';
    return true;
  }).sort(function(a, b) {
    // 需人工审核的置顶（且未人工确认）
    var aIsWarn = a.item.status === 'warn' && !a.item.manualStatus;
    var bIsWarn = b.item.status === 'warn' && !b.item.manualStatus;
    if (aIsWarn && !bIsWarn) return -1;
    if (!aIsWarn && bIsWarn) return 1;
    
    // 然后是校验中的
    var aIsChecking = a.item.status === 'checking';
    var bIsChecking = b.item.status === 'checking';
    if (aIsChecking && !bIsChecking) return -1;
    if (!aIsChecking && bIsChecking) return 1;
    
    // 然后是待处理的
    var aIsPending = a.item.status === 'pending';
    var bIsPending = b.item.status === 'pending';
    if (aIsPending && !bIsPending) return -1;
    if (!aIsPending && bIsPending) return 1;
    
    // 保持原始顺序
    return a.originalIndex - b.originalIndex;
  });
  
  if (filteredSortedResults.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">该筛选条件下暂无数据</div>';
    return;
  }
  
  // 使用原始renderBatchResults中的渲染逻辑，但使用筛选后的数据
  listEl.innerHTML = filteredSortedResults.map(function(sortedItem, displayIdx) {
    var item = sortedItem.item;
    var idx = sortedItem.originalIndex;
    var statusClass = 'batch-status-' + item.status;
    var statusText = {
      'pending': '待处理',
      'checking': '校验中...',
      'pass': '通过',
      'fail': '不通过',
      'warn': '需人工'
    }[item.status] || item.status;
    
    // 如果已人工审核，优先显示人工审核状态
    if (item.manualStatus === 'confirmed') {
      statusClass = 'batch-status-pass';
      statusText = '人工确认通过';
    } else if (item.manualStatus === 'rejected') {
      statusClass = 'batch-status-fail';
      statusText = '人工确认不通过';
    } else if (item.approved) {
      statusClass = 'batch-status-approved';
      statusText = '已审核';
    }
    
    var title = '[' + item.task.carType + '] ' + item.task.partsName;
    var subtitle = item.task.supplierName + ' | ' + item.task.latestPartsCode;
    
    // 构建主操作区的按钮
    var mainActionHtml = '';
    
    // 所有任务都显示"查看结果"按钮（如果有实际结果数据或错误信息）
    var hasResults = item.results && item.results.length > 0;
    var hasError = item.error && item.error.length > 0;
    if (hasResults || hasError) {
      mainActionHtml += '<button class="batch-main-btn batch-main-view" title="查看校验结果" data-index="' + idx + '" style="background:#004375;color:#fff;margin-right:4px;">' +
          '<span class="btn-icon">🔍</span>' +
        '</button>';
    }
    
    // 主操作界面的通过/不通过按钮已移除，改为在校验项详情界面操作
    
    // 显示人工审核结果（在主区域）
    var manualStatusHtml = '';
    if (item.manualStatus) {
      var manualClass = item.manualStatus === 'confirmed' ? 'batch-status-pass' : 'batch-status-fail';
      var manualText = item.manualStatus === 'confirmed' ? '人工通过' : '人工不通过';
      manualStatusHtml = '<span class="batch-status-badge ' + manualClass + '" style="margin-left:5px;">' + manualText + '</span>';
    }
    
    // 根据任务状态决定点击行为：所有任务点击时都可以展开/收起详情
    var clickHandler = 'onclick="toggleBatchDetails(' + idx + ', event)"';
    var dataStatusAttr = '';
    if (item.status === 'warn' && !item.manualStatus && !item.approved) {
      dataStatusAttr = 'data-status="warn"';
    }
    
    // 构建详情HTML
    var detailsHtml = '';
    if (item.results && item.results.length > 0) {
      detailsHtml = '<div class="batch-task-details" id="batch-details-' + idx + '" style="display:none;">' +
        item.results.map(function(r) {
          var iconClass = r.passed ? 'pass' : (r.needManual ? 'warn' : 'fail');
          var icon = r.passed ? '✓' : (r.needManual ? '!' : '✗');
          return '<div class="batch-check-item">' +
            '<div class="batch-check-icon ' + iconClass + '">' + icon + '</div>' +
            '<div class="batch-check-content">' +
              '<div class="batch-check-name">' + r.item + '</div>' +
              '<div class="batch-check-result">' + r.result + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      
      // 添加审核结果信息
      if (item.approved) {
        detailsHtml += '<div class="batch-check-item" style="border-top:1px solid #c8e6c9;margin-top:4px;padding-top:8px;">' +
          '<div class="batch-check-icon pass">✓</div>' +
          '<div class="batch-check-content">' +
            '<div class="batch-check-name">审核结果</div>' +
            '<div class="batch-check-result">' + item.approveResult + '</div>' +
          '</div>' +
        '</div>';
      } else if (item.approveError) {
        detailsHtml += '<div class="batch-check-item" style="border-top:1px solid #ffcdd2;margin-top:4px;padding-top:8px;">' +
          '<div class="batch-check-icon fail">✗</div>' +
          '<div class="batch-check-content">' +
            '<div class="batch-check-name">审核失败</div>' +
            '<div class="batch-check-result">' + item.approveError + '</div>' +
          '</div>' +
        '</div>';
      }
      
      // 添加人工审核按钮（仅对需人工审核的任务显示）
      if (item.status === 'warn' && !item.manualStatus && !item.approved) {
        detailsHtml += '<div class="batch-manual-actions" style="border-top:1px solid #ffe0b2;margin-top:8px;padding-top:12px;">' +
          '<div style="font-size:12px;color:#666;margin-bottom:8px;">人工审核操作：</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="batch-manual-btn batch-manual-confirm" data-action="manual-confirm" data-index="' + idx + '">' +
              '<span class="btn-icon">✓</span> 确认通过' +
            '</button>' +
            '<button class="batch-manual-btn batch-manual-reject" data-action="manual-reject" data-index="' + idx + '">' +
              '<span class="btn-icon">✗</span> 确认不通过' +
            '</button>' +
          '</div>' +
          '<div style="margin-top:8px;">' +
            '<input type="text" id="manual-note-' + idx + '" placeholder="审核备注（可选）" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;">' +
          '</div>' +
        '</div>';
        
        // 为需人工审核的任务添加"打开任务详情页"按钮
        detailsHtml += '<div style="border-top:1px solid #e0e0e0;margin-top:8px;padding-top:8px;text-align:center;">' +
          '<button class="batch-manual-btn batch-open-detail-btn" style="background:#ff9800;color:#fff;" data-index="' + idx + '">' +
            '<span class="btn-icon">🔗</span> 打开任务详情页' +
          '</button>' +
        '</div>';
      }
      
      // 显示人工审核结果
      if (item.manualStatus) {
        var manualClass = item.manualStatus === 'confirmed' ? 'pass' : 'fail';
        var manualIcon = item.manualStatus === 'confirmed' ? '✓' : '✗';
        var manualText = item.manualStatus === 'confirmed' ? '人工确认通过' : '人工确认不通过';
        detailsHtml += '<div class="batch-check-item" style="border-top:1px solid #e0e0e0;margin-top:4px;padding-top:8px;">' +
          '<div class="batch-check-icon ' + manualClass + '">' + manualIcon + '</div>' +
          '<div class="batch-check-content">' +
            '<div class="batch-check-name">' + manualText + '</div>' +
            '<div class="batch-check-result">' + (item.manualNote || '无备注') + ' <span style="color:#999;font-size:11px;">(' + new Date(item.manualTime).toLocaleString('zh-CN') + ')</span></div>' +
          '</div>' +
        '</div>';
      }
      
      // 添加查看完整详情按钮
      detailsHtml += '<div style="border-top:1px solid #e0e0e0;margin-top:8px;padding-top:8px;text-align:center;">' +
        '<button class="batch-manual-btn batch-view-details-btn" style="background:#004375;color:#fff;" data-index="' + idx + '">' +
          '<span class="btn-icon">🔍</span> 查看完整详情' +
        '</button>' +
      '</div>';
      
      detailsHtml += '</div>';
    } else if (item.error) {
      detailsHtml = '<div class="batch-task-details" id="batch-details-' + idx + '" style="display:none;">' +
        '<div class="batch-check-item">' +
          '<div class="batch-check-icon fail">✗</div>' +
          '<div class="batch-check-content">' +
            '<div class="batch-check-name">错误</div>' +
            '<div class="batch-check-result">' + item.error + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    
    var headerClass = 'batch-task-header';
    if (item.approved) {
      headerClass += ' approved';
    }
    if (item.status === 'warn' && !item.manualStatus && !item.approved) {
      headerClass += ' batch-status-warn-clickable';
    }
    
    return '<div class="batch-task-item">' +
      '<div class="' + headerClass + '" ' + clickHandler + ' ' + dataStatusAttr + '>' +
        '<div>' +
          '<div class="batch-task-title">' + (displayIdx + 1) + '. ' + escapeHtml(title) + '</div>' +
          '<div style="font-size:10px;color:#999;margin-top:2px;">' + escapeHtml(subtitle) + '</div>' +
        '</div>' +
        '<div class="batch-task-status" style="display:flex;align-items:center;gap:6px;">' +
          mainActionHtml +
          '<span class="batch-status-badge ' + statusClass + '">' + statusText + '</span>' + manualStatusHtml +
          '<span class="batch-toggle-icon" id="batch-toggle-' + idx + '">▼</span>' +
        '</div>' +
      '</div>' +
      detailsHtml +
    '</div>';
  }).join('');
}

// 在校验项详情弹窗中处理人工确认通过
function handleDetailManualConfirm(index) {
  console.log('[handleDetailManualConfirm] 被调用, index:', index);
  
  var noteInput = document.getElementById('detail-manual-note-' + index);
  var note = noteInput ? noteInput.value.trim() : '';
  
  if (!confirm('确认将该任务标记为"人工审核通过"？')) {
    return;
  }
  
  updateTaskManualStatus(index, 'confirmed', note);
  closeCheckItemDetailsModal();
  
  // 重新打开弹窗以更新状态
  setTimeout(function() {
    showCheckItemDetailsModal(index);
  }, 300);
}

// 在校验项详情弹窗中处理人工确认不通过
function handleDetailManualReject(index) {
  console.log('[handleDetailManualReject] 被调用, index:', index);
  
  var noteInput = document.getElementById('detail-manual-note-' + index);
  var note = noteInput ? noteInput.value.trim() : '';
  
  if (!note) {
    alert('请填写审核备注说明不通过原因');
    if (noteInput) noteInput.focus();
    return;
  }
  
  if (!confirm('确认将该任务标记为"人工审核不通过"？')) {
    return;
  }
  
  updateTaskManualStatus(index, 'rejected', note);
  closeCheckItemDetailsModal();
  
  // 重新打开弹窗以更新状态
  setTimeout(function() {
    showCheckItemDetailsModal(index);
  }, 300);
}

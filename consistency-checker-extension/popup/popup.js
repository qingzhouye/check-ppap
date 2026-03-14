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
  loadExcelList();
  loadApiKeyStatus();
  loadPersistedBatchResults(); // 加载持久化的校验结果
  loadCheckLogs(); // 加载历史日志
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
  document.getElementById('btnExtractList').addEventListener('click', extractTaskList);
  document.getElementById('btnAutoCheck').addEventListener('click', autoCheckDetail);
  document.getElementById('btnBatchCheck').addEventListener('click', batchCheckTasks);
  document.getElementById('btnAutoApprove').addEventListener('click', autoApprove);

  // Close batch result
  document.getElementById('closeBatchResult').addEventListener('click', function() {
    document.getElementById('batchResultSection').style.display = 'none';
  });

  // 批量结果列表的事件委托（用于详情区的人工审核按钮和查看结果按钮）
  document.getElementById('batchResultList').addEventListener('click', function(e) {
    // 处理查看结果按钮（.batch-main-view）
    var viewBtn = e.target.closest('.batch-main-view');
    if (viewBtn) {
      var indexStr = viewBtn.getAttribute('data-index');
      var index = parseInt(indexStr, 10);
      console.log('[EventDelegate] 查看结果按钮被点击, index:', index);
      if (!isNaN(index)) {
        e.stopPropagation();
        showTaskDetailsModal(index);
        return;
      }
    }
    
    // 处理详情区的查看完整详情按钮（.batch-view-details-btn）
    var detailsBtn = e.target.closest('.batch-view-details-btn');
    if (detailsBtn) {
      var indexStr = detailsBtn.getAttribute('data-index');
      var index = parseInt(indexStr, 10);
      console.log('[EventDelegate] 查看完整详情按钮被点击, index:', index);
      if (!isNaN(index)) {
        e.stopPropagation();
        showTaskDetailsModal(index);
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
      renderBatchResults();
      addLog('任务 ' + (taskIndex + 1) + ' 已标记为' + (status === 'confirmed' ? '人工确认通过' : '人工确认不通过'), 'success');
    }
  });
}

function batchCheckTasks() {
  if (isBatchChecking) {
    addLog('批量校验正在进行中，请等待完成', 'warn');
    return;
  }
  
  if (!confirm('开始批量校验任务清单？\n\n注意：这将自动打开每个任务的详情页进行校验，可能需要较长时间。')) {
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
    
    addLog('提取到 ' + tasks.length + ' 条任务，开始批量校验...', 'success');
    
    // 初始化结果数组
    batchCheckResults = tasks.map(function(task) {
      return {
        task: task,
        status: 'pending', // pending, checking, pass, fail, warn
        results: [],
        error: null
      };
    });
    
    renderBatchResults();
    
    // 开始逐个校验
    processNextBatchTask(0);
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
    
    renderBatchResults();
    
    // 保存到持久化存储
    console.log('[processNextBatchTask] 保存到存储, batchCheckResults:', batchCheckResults);
    saveBatchResultsToStorage();
    
    // 延迟处理下一个，让用户有时间看到进度
    setTimeout(function() {
      processNextBatchTask(index + 1);
    }, 500);
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
  
  // 渲染汇总
  var summaryHtml = 
    '<div class="batch-summary-item"><span>总任务数:</span><span><b>' + total + '</b></span></div>' +
    '<div class="batch-summary-item"><span>已通过:</span><span class="batch-status-pass"><b>' + passed + '</b></span></div>' +
    '<div class="batch-summary-item"><span>不通过:</span><span class="batch-status-fail"><b>' + failed + '</b></span></div>' +
    '<div class="batch-summary-item"><span>需人工:</span><span class="batch-status-warn"><b>' + warning + '</b></span></div>';
  
  // 显示人工审核统计
  if (manualConfirmed > 0 || manualRejected > 0) {
    summaryHtml += '<div class="batch-summary-item"><span>人工确认:</span><span style="color:#4caf50;"><b>' + manualConfirmed + '</b></span></div>';
    summaryHtml += '<div class="batch-summary-item"><span>人工拒绝:</span><span style="color:#f44336;"><b>' + manualRejected + '</b></span></div>';
  }
  
  summaryHtml += '<div class="batch-summary-item"><span>待处理:</span><span class="batch-status-pending"><b>' + pending + '</b></span></div>';
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
  
  listEl.innerHTML = batchCheckResults.map(function(item, idx) {
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
    
    // 数据来源标记
    var sourceBadge = '';
    if (item.source === 'api') {
      sourceBadge = '<span style="font-size:9px;color:#4caf50;background:#e8f5e9;padding:1px 4px;border-radius:2px;margin-left:5px;">API</span>';
    } else if (item.source === 'popup') {
      sourceBadge = '<span style="font-size:9px;color:#ff9800;background:#fff3e0;padding:1px 4px;border-radius:2px;margin-left:5px;">弹窗</span>';
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
    
    // 所有任务都显示"查看结果"按钮（如果已校验完成且有实际结果数据）
    var hasResults = item.results && item.results.length > 0;
    var hasError = item.error && item.error.length > 0;
    var isCompleted = item.status !== 'pending' && item.status !== 'checking';
    if (isCompleted && (hasResults || hasError)) {
      mainActionHtml += '<button class="batch-main-btn batch-main-view" title="查看校验结果" data-index="' + idx + '" style="background:#004375;color:#fff;margin-right:4px;">' +
          '<span class="btn-icon">🔍</span>' +
        '</button>';
    }
    
    // 需人工审核的任务显示人工确认按钮
    if (item.status === 'warn' && !item.manualStatus && !item.approved) {
      mainActionHtml += '<div class="batch-main-actions" onclick="event.stopPropagation();" style="display:inline-flex;">' +
        '<button class="batch-main-btn batch-main-confirm" title="人工确认通过" onclick="event.stopPropagation(); handleManualConfirm(' + idx + ');">' +
          '<span class="btn-icon">✓</span>' +
        '</button>' +
        '<button class="batch-main-btn batch-main-reject" title="人工确认不通过" onclick="event.stopPropagation(); handleManualReject(' + idx + ');">' +
          '<span class="btn-icon">✗</span>' +
        '</button>' +
      '</div>';
    }
    
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
          '<span class="batch-status-badge ' + statusClass + '">' + statusText + '</span>' + manualStatusHtml + sourceBadge +
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

// 显示指定任务的详情弹窗（用于"需人工"任务的一致性检验结果展示）
function showTaskDetailsModal(index) {
  console.log('[showTaskDetailsModal] 被调用, index:', index);
  console.log('[showTaskDetailsModal] batchCheckResults:', batchCheckResults);
  console.log('[showTaskDetailsModal] batchCheckResults.length:', batchCheckResults.length);
  
  var item = batchCheckResults[index];
  if (!item) {
    console.error('[showTaskDetailsModal] 未找到对应任务, index:', index);
    alert('未找到任务数据，请刷新页面重试');
    return;
  }
  
  console.log('[showTaskDetailsModal] 找到任务:', item);
  console.log('[showTaskDetailsModal] item.results:', item.results);
  console.log('[showTaskDetailsModal] item.error:', item.error);
  console.log('[showTaskDetailsModal] item.status:', item.status);
  
  // 构建详情内容
  var detailsHtml = '';
  if (item.results && item.results.length > 0) {
    console.log('[showTaskDetailsModal] 使用 results 数据, 条数:', item.results.length);
    detailsHtml = item.results.map(function(r) {
      var iconClass = r.passed ? 'pass' : (r.needManual ? 'warn' : 'fail');
      var icon = r.passed ? '✓' : (r.needManual ? '!' : '✗');
      var bgColor = r.passed ? '#e8f5e9' : (r.needManual ? '#fff3e0' : '#ffebee');
      return '<div class="batch-check-item" style="background:' + bgColor + ';padding:8px;border-radius:4px;margin-bottom:6px;">' +
        '<div class="batch-check-icon ' + iconClass + '">' + icon + '</div>' +
        '<div class="batch-check-content">' +
          '<div class="batch-check-name" style="font-size:13px;font-weight:bold;">' + r.item + '</div>' +
          '<div class="batch-check-result" style="font-size:12px;color:#333;margin-top:4px;">' + r.result + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } else if (item.error) {
    console.log('[showTaskDetailsModal] 使用 error 数据:', item.error);
    detailsHtml = '<div class="batch-check-item" style="background:#ffebee;padding:8px;border-radius:4px;">' +
      '<div class="batch-check-icon fail">✗</div>' +
      '<div class="batch-check-content">' +
        '<div class="batch-check-name">错误</div>' +
        '<div class="batch-check-result">' + item.error + '</div>' +
      '</div>' +
    '</div>';
  } else {
    console.log('[showTaskDetailsModal] 无数据可显示');
    detailsHtml = '<div style="text-align:center;color:#999;padding:20px;">暂无检验结果详情</div>';
  }
  
  // 创建弹窗
  var modal = document.createElement('div');
  modal.id = 'task-details-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
  
  var title = '[' + item.task.carType + '] ' + item.task.partsName;
  var subtitle = item.task.supplierName + ' | ' + item.task.latestPartsCode;
  
  // 根据状态确定显示文本和样式
  var statusText = '待处理';
  var statusColor = '#1565c0';
  var statusBg = '#e3f2fd';
  var showActionButtons = false;
  
  if (item.manualStatus === 'confirmed') {
    statusText = '人工确认通过';
    statusColor = '#2e7d32';
    statusBg = '#e8f5e9';
  } else if (item.manualStatus === 'rejected') {
    statusText = '人工确认不通过';
    statusColor = '#c62828';
    statusBg = '#ffebee';
  } else if (item.approved) {
    statusText = '已审核';
    statusColor = '#1565c0';
    statusBg = '#e3f2fd';
  } else if (item.status === 'pass') {
    statusText = '校验通过';
    statusColor = '#2e7d32';
    statusBg = '#e8f5e9';
  } else if (item.status === 'fail') {
    statusText = '校验不通过';
    statusColor = '#c62828';
    statusBg = '#ffebee';
  } else if (item.status === 'warn') {
    statusText = '需人工审核';
    statusColor = '#e65100';
    statusBg = '#fff3e0';
    showActionButtons = true;
  }
  
  modal.innerHTML = 
    '<div style="background:#fff;border-radius:8px;width:90%;max-width:500px;max-height:80%;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.3);">' +
      '<div style="background:linear-gradient(135deg, #004375, #006bb3);color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
          '<div style="font-size:14px;font-weight:bold;">' + escapeHtml(title) + '</div>' +
          '<div style="font-size:11px;opacity:0.8;margin-top:2px;">' + escapeHtml(subtitle) + '</div>' +
        '</div>' +
        '<button id="close-modal-btn" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;">&times;</button>' +
      '</div>' +
      '<div style="padding:16px;max-height:400px;overflow-y:auto;">' +
        '<div style="font-size:12px;color:#666;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #eee;">' +
          '<span style="font-weight:bold;">状态：</span>' +
          '<span style="color:' + statusColor + ';background:' + statusBg + ';padding:2px 8px;border-radius:3px;font-size:11px;">' + statusText + '</span>' +
        '</div>' +
        '<div style="font-size:12px;font-weight:bold;color:#333;margin-bottom:10px;">一致性检验结果：</div>' +
        detailsHtml +
      '</div>' +
      '<div style="padding:12px 16px;border-top:1px solid #eee;background:#f5f5f5;display:flex;justify-content:flex-end;gap:8px;">' +
        (showActionButtons ? 
          '<button id="modal-confirm-btn" style="background:#4caf50;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;">' +
            '<span>✓</span> 确认通过' +
          '</button>' +
          '<button id="modal-reject-btn" style="background:#f44336;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;">' +
            '<span>✗</span> 确认不通过' +
          '</button>' : '') +
        '<button id="modal-close-btn" style="background:#fff;color:#666;border:1px solid #ddd;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">关闭</button>' +
      '</div>' +
    '</div>';
  
  document.body.appendChild(modal);
  
  // 绑定关闭事件
  document.getElementById('close-modal-btn').addEventListener('click', function() {
    document.body.removeChild(modal);
  });
  document.getElementById('modal-close-btn').addEventListener('click', function() {
    document.body.removeChild(modal);
  });
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
  
  // 绑定审核按钮事件（仅在需要时）
  if (showActionButtons) {
    var confirmBtn = document.getElementById('modal-confirm-btn');
    var rejectBtn = document.getElementById('modal-reject-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function() {
        document.body.removeChild(modal);
        handleManualConfirm(index);
      });
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', function() {
        document.body.removeChild(modal);
        handleManualReject(index);
      });
    }
  }
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

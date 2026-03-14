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
  loadExcelList();
  loadApiKeyStatus();
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
    if (response && response.success) {
      currentTask.status = response.allPassed ? 'pass' : (response.hasWarning ? 'warn' : 'fail');
      currentTask.results = response.results || [];
      currentTask.source = response.source || 'unknown'; // 记录数据来源(api/popup)
      var sourceText = response.source === 'api' ? '[API]' : '[弹窗]';
      addLog('  校验完成' + sourceText + ': ' + (response.allPassed ? '通过' : (response.hasWarning ? '需人工确认' : '不通过')), 
        response.allPassed ? 'success' : (response.hasWarning ? 'warn' : 'error'));
    } else {
      currentTask.status = 'fail';
      currentTask.error = response ? response.error : '校验失败';
      addLog('  校验失败: ' + currentTask.error, 'error');
    }
    
    renderBatchResults();
    
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
  
  // 渲染汇总
  summaryEl.innerHTML = 
    '<div class="batch-summary-item"><span>总任务数:</span><span><b>' + total + '</b></span></div>' +
    '<div class="batch-summary-item"><span>已通过:</span><span class="batch-status-pass"><b>' + passed + '</b></span></div>' +
    '<div class="batch-summary-item"><span>不通过:</span><span class="batch-status-fail"><b>' + failed + '</b></span></div>' +
    '<div class="batch-summary-item"><span>需人工:</span><span class="batch-status-warn"><b>' + warning + '</b></span></div>' +
    '<div class="batch-summary-item"><span>待处理:</span><span class="batch-status-pending"><b>' + pending + '</b></span></div>';
  
  // 显示/隐藏批量审核按钮（只有当有通过的任务且不在校验中时显示）
  if (total > 0 && pending === 0 && passed > 0) {
    approveArea.style.display = 'block';
    approveCount.textContent = passed;
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
    
    // 如果已审核，显示审核状态
    if (item.approved) {
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
    
    return '<div class="batch-task-item">' +
      '<div class="' + headerClass + '" onclick="toggleBatchDetails(' + idx + ')">' +
        '<div>' +
          '<div class="batch-task-title">' + (idx + 1) + '. ' + escapeHtml(title) + '</div>' +
          '<div style="font-size:10px;color:#999;margin-top:2px;">' + escapeHtml(subtitle) + '</div>' +
        '</div>' +
        '<div class="batch-task-status">' +
          '<span class="batch-status-badge ' + statusClass + '">' + statusText + '</span>' + sourceBadge +
          '<span class="batch-toggle-icon" id="batch-toggle-' + idx + '">▼</span>' +
        '</div>' +
      '</div>' +
      detailsHtml +
    '</div>';
  }).join('');
}

function toggleBatchDetails(index) {
  var detailsEl = document.getElementById('batch-details-' + index);
  var toggleEl = document.getElementById('batch-toggle-' + index);
  
  if (detailsEl) {
    var isVisible = detailsEl.style.display !== 'none';
    detailsEl.style.display = isVisible ? 'none' : 'block';
    toggleEl.classList.toggle('expanded', !isVisible);
  }
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

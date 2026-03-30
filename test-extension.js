/**
 * 一致性确认助手 - 功能测试脚本
 * 用于检测插件功能是否正常
 */

// 测试配置
const TEST_CONFIG = {
  // 测试页面URL（实际使用时替换为真实页面）
  testPageUrl: 'file:///C:/Users/Administrator/Desktop/AI-%E4%B8%80%E8%87%B4%E6%80%A7%E7%A1%AE%E8%AE%A4/%E4%B8%80%E8%87%B4%E6%80%A7%E7%A1%AE%E8%AE%A4%E9%9B%B6%E4%BB%B6%E4%BF%A1%E6%81%AF%E6%9F%A5%E8%AF%A2%20_%20SGMW.htm',
  // 测试延迟（毫秒）
  delay: 1000
};

// 测试结果存储
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

/**
 * 记录测试结果
 */
function logTest(testName, passed, message) {
  const result = { testName, message, timestamp: new Date().toISOString() };
  if (passed) {
    testResults.passed.push(result);
    console.log(`✓ [通过] ${testName}: ${message}`);
  } else {
    testResults.failed.push(result);
    console.error(`✗ [失败] ${testName}: ${message}`);
  }
}

function logWarning(testName, message) {
  testResults.warnings.push({ testName, message, timestamp: new Date().toISOString() });
  console.warn(`⚠ [警告] ${testName}: ${message}`);
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 测试 1: 检查 popup.html 结构
 */
function testPopupStructure() {
  console.log('\n=== 测试 1: 检查 Popup 结构 ===');
  
  // 检查关键元素是否存在
  const requiredElements = [
    { id: 'dragHeader', name: '拖动标题栏' },
    { id: 'btnExtractList', name: '提取任务列表按钮' },
    { id: 'btnAutoCheck', name: '一键校验按钮' },
    { id: 'btnBatchCheck', name: '批量校验按钮' },
    { id: 'btnAutoApprove', name: '自动审核按钮' },
    { id: 'excelFile', name: 'Excel文件输入' },
    { id: 'apiKeyInput', name: 'API Key输入框' },
    { id: 'logArea', name: '日志区域' }
  ];
  
  requiredElements.forEach(el => {
    const element = document.getElementById(el.id);
    if (element) {
      logTest(`元素检查: ${el.name}`, true, `找到元素 #${el.id}`);
    } else {
      logTest(`元素检查: ${el.name}`, false, `未找到元素 #${el.id}`);
    }
  });
}

/**
 * 测试 2: 检查拖动功能
 */
function testDragFunctionality() {
  console.log('\n=== 测试 2: 检查拖动功能 ===');
  
  // 检查 popup-container 样式
  const container = document.querySelector('.popup-container');
  if (!container) {
    logTest('拖动功能', false, '未找到 .popup-container 元素');
    return;
  }
  
  // 检查当前定位方式
  const computedStyle = window.getComputedStyle(container);
  const position = computedStyle.position;
  
  if (position === 'fixed') {
    logTest('拖动定位', true, `容器定位为 fixed，可以拖动`);
  } else {
    logTest('拖动定位', false, `容器定位为 ${position}，需要改为 fixed 才能拖动`);
  }
  
  // 检查标题栏拖动事件
  const header = document.getElementById('dragHeader');
  if (header) {
    // 检查是否有 mousedown 事件监听
    const hasMouseDown = header.onmousedown || 
      (header._events && header._events.mousedown) ||
      getEventListeners?.(header)?.mousedown?.length > 0;
    
    if (hasMouseDown) {
      logTest('拖动事件', true, '标题栏已绑定 mousedown 事件');
    } else {
      logWarning('拖动事件', '无法确认标题栏是否绑定了拖动事件（可能在JS中动态绑定）');
    }
  }
}

/**
 * 测试 3: 检查批量结果区域结构
 */
function testBatchResultsStructure() {
  console.log('\n=== 测试 3: 检查批量结果区域结构 ===');
  
  const requiredElements = [
    { id: 'batchResultSection', name: '批量结果区域' },
    { id: 'batchResultSummary', name: '结果汇总' },
    { id: 'batchResultList', name: '结果列表' },
    { id: 'batchApproveArea', name: '批量审核区域' }
  ];
  
  requiredElements.forEach(el => {
    const element = document.getElementById(el.id);
    if (element) {
      logTest(`批量结果: ${el.name}`, true, `找到元素 #${el.id}`);
    } else {
      logTest(`批量结果: ${el.name}`, false, `未找到元素 #${el.id}`);
    }
  });
}

/**
 * 测试 4: 模拟批量结果数据，测试点击展开功能
 */
function testBatchResultsClick() {
  console.log('\n=== 测试 4: 测试批量结果点击展开功能 ===');
  
  // 模拟创建批量结果数据
  const mockResults = [
    {
      task: {
        carType: '测试车型A',
        partsName: '测试零件1',
        supplierName: '测试供应商',
        latestPartsCode: 'PART001'
      },
      status: 'warn', // 需人工审核状态
      results: [
        { item: 'CCC标识', passed: false, needManual: true, result: '需要人工确认' },
        { item: '型号信息', passed: true, result: '型号匹配' }
      ]
    },
    {
      task: {
        carType: '测试车型B',
        partsName: '测试零件2',
        supplierName: '测试供应商2',
        latestPartsCode: 'PART002'
      },
      status: 'pass',
      results: [
        { item: 'CCC标识', passed: true, result: 'CCC标识正确' }
      ]
    }
  ];
  
  // 显示批量结果区域
  const batchSection = document.getElementById('batchResultSection');
  if (batchSection) {
    batchSection.style.display = 'block';
    logTest('批量结果显示', true, '批量结果区域已显示');
    
    // 检查 renderBatchResults 函数是否存在
    if (typeof renderBatchResults === 'function') {
      logTest('renderBatchResults函数', true, '函数已定义');
      
      // 设置全局变量并渲染
      window.batchCheckResults = mockResults;
      renderBatchResults();
      
      logTest('批量结果渲染', true, '已渲染模拟数据');
      
      // 检查生成的HTML结构
      const taskHeaders = document.querySelectorAll('.batch-task-header');
      logTest('任务行生成', taskHeaders.length === 2, `生成了 ${taskHeaders.length} 个任务行`);
      
      // 检查第一个任务（warn状态）的点击行为
      const firstHeader = taskHeaders[0];
      if (firstHeader) {
        const hasClickHandler = firstHeader.onclick || firstHeader.getAttribute('onclick');
        const dataStatus = firstHeader.getAttribute('data-status');
        
        logTest('任务行点击属性', dataStatus === 'warn', `data-status="${dataStatus}"`);
        
        if (hasClickHandler) {
          logTest('任务行点击事件', true, '任务行已绑定点击事件');
        } else {
          logTest('任务行点击事件', false, '任务行未绑定点击事件');
        }
      }
    } else {
      logTest('renderBatchResults函数', false, '函数未定义');
    }
  } else {
    logTest('批量结果显示', false, '未找到批量结果区域');
  }
}

/**
 * 测试 5: 检查 showTaskDetailsModal 函数
 */
function testShowTaskDetailsModal() {
  console.log('\n=== 测试 5: 检查详情弹窗函数 ===');
  
  if (typeof showTaskDetailsModal === 'function') {
    logTest('showTaskDetailsModal函数', true, '函数已定义');
  } else {
    logTest('showTaskDetailsModal函数', false, '函数未定义');
  }
}

/**
 * 测试 6: 检查 toggleBatchDetails 函数
 */
function testToggleBatchDetails() {
  console.log('\n=== 测试 6: 检查展开/收起函数 ===');
  
  if (typeof toggleBatchDetails === 'function') {
    logTest('toggleBatchDetails函数', true, '函数已定义');
  } else {
    logTest('toggleBatchDetails函数', false, '函数未定义');
  }
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('========================================');
  console.log('  一致性确认助手 - 功能测试');
  console.log('========================================');
  console.log(`测试时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`页面URL: ${window.location.href}`);
  console.log('');
  
  // 运行所有测试
  testPopupStructure();
  await delay(100);
  
  testDragFunctionality();
  await delay(100);
  
  testBatchResultsStructure();
  await delay(100);
  
  testBatchResultsClick();
  await delay(100);
  
  testShowTaskDetailsModal();
  await delay(100);
  
  testToggleBatchDetails();
  
  // 输出测试总结
  console.log('\n========================================');
  console.log('  测试总结');
  console.log('========================================');
  console.log(`通过: ${testResults.passed.length}`);
  console.log(`失败: ${testResults.failed.length}`);
  console.log(`警告: ${testResults.warnings.length}`);
  
  if (testResults.failed.length > 0) {
    console.log('\n失败的测试:');
    testResults.failed.forEach(f => console.log(`  - ${f.testName}: ${f.message}`));
  }
  
  if (testResults.warnings.length > 0) {
    console.log('\n警告:');
    testResults.warnings.forEach(w => console.log(`  - ${w.testName}: ${w.message}`));
  }
  
  console.log('\n========================================');
  
  return testResults;
}

// 导出测试函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runAllTests, testResults };
} else {
  // 浏览器环境，挂载到全局
  window.ExtensionTester = { runAllTests, testResults };
  
  // 自动运行测试（如果在popup页面）
  if (document.querySelector('.popup-container')) {
    console.log('检测到Popup页面，3秒后自动运行测试...');
    setTimeout(runAllTests, 3000);
  }
}

// 测试完成提示
console.log('测试脚本已加载，运行 ExtensionTester.runAllTests() 开始测试');

/**
 * Excel功能测试脚本
 * 用于测试浏览器扩展的Excel添加功能
 */

// 模拟测试环境
const mockChrome = {
  runtime: {
    lastError: null,
    sendMessage: function(message, callback) {
      console.log('[测试] 发送消息:', message.type);
      
      // 模拟后台脚本响应
      setTimeout(() => {
        switch(message.type) {
          case 'ADD_EXCEL_DATA':
            console.log('[测试] 模拟: Excel数据添加成功');
            callback({ success: true, count: 1 });
            break;
          case 'GET_EXCEL_LIST':
            console.log('[测试] 模拟: 获取Excel列表');
            callback({ list: [] });
            break;
          default:
            callback({ success: false, error: '未知消息类型' });
        }
      }, 100);
      return true;
    }
  },
  storage: {
    local: {
      get: function(keys, callback) {
        callback({});
      },
      set: function(data, callback) {
        if (callback) callback();
      }
    }
  }
};

// 测试1: 检查XLSX库是否可用
function testXLSXLibrary() {
  console.log('\n=== 测试1: XLSX库检查 ===');
  if (typeof XLSX === 'undefined') {
    console.error('❌ XLSX库未加载! 请确保xlsx.full.min.js已正确引入');
    return false;
  }
  console.log('✅ XLSX库已加载');
  console.log('  - 版本:', XLSX.version || 'unknown');
  console.log('  - 可用方法:', Object.keys(XLSX).slice(0, 5).join(', ') + '...');
  return true;
}

// 测试2: 检查manifest配置
function testManifest() {
  console.log('\n=== 测试2: Manifest配置检查 ===');
  const issues = [];
  
  // 注意: 在浏览器扩展环境中，manifest是只读的
  // 这里我们只能检查当前运行环境
  if (typeof chrome === 'undefined') {
    console.error('❌ chrome对象未定义，不在扩展环境中');
    return false;
  }
  
  if (!chrome.runtime) {
    console.error('❌ chrome.runtime未定义');
    return false;
  }
  
  console.log('✅ Chrome扩展API可用');
  
  // 检查storage权限
  if (!chrome.storage) {
    issues.push('缺少storage权限');
  } else {
    console.log('✅ Storage API可用');
  }
  
  // 检查后台脚本
  if (chrome.runtime.getManifest) {
    try {
      const manifest = chrome.runtime.getManifest();
      console.log('✅ Manifest可读取');
      console.log('  - 版本:', manifest.version);
      console.log('  - Background类型:', manifest.background ? '已配置' : '未配置');
      
      // 检查background配置
      if (manifest.background) {
        if (manifest.background.scripts) {
          console.warn('⚠️ 使用了scripts（Manifest V2格式），V3应该使用service_worker');
        }
        if (manifest.background.service_worker) {
          console.log('✅ 使用service_worker（Manifest V3格式）');
        }
      }
    } catch (e) {
      console.warn('⚠️ 无法读取manifest:', e.message);
    }
  }
  
  if (issues.length > 0) {
    console.error('发现的问题:');
    issues.forEach(issue => console.error('  - ' + issue));
  }
  
  return issues.length === 0;
}

// 测试3: 测试FileReader和Excel解析
function testExcelParsing() {
  console.log('\n=== 测试3: Excel解析功能测试 ===');
  
  if (typeof FileReader === 'undefined') {
    console.error('❌ FileReader不可用（非浏览器环境）');
    return false;
  }
  
  console.log('✅ FileReader可用');
  
  if (typeof XLSX === 'undefined') {
    console.error('❌ XLSX库未加载，无法测试解析');
    return false;
  }
  
  // 创建一个简单的测试工作簿
  try {
    const wb = XLSX.utils.book_new();
    const ws_data = [
      ['分类', '零件/总成名称', '公告', '环保', 'CCC', 'CCC证书'],
      ['测试分类', '测试零件', '●', '●', '●', '证书号'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    
    // 尝试写入并读取
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const wb2 = XLSX.read(wbout, { type: 'array' });
    
    console.log('✅ XLSX读写测试通过');
    console.log('  - 工作表数量:', wb2.SheetNames.length);
    console.log('  - 工作表名称:', wb2.SheetNames[0]);
    return true;
  } catch (e) {
    console.error('❌ XLSX读写测试失败:', e.message);
    return false;
  }
}

// 测试4: 测试消息通信
async function testMessageCommunication() {
  console.log('\n=== 测试4: 消息通信测试 ===');
  
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('❌ 不在扩展环境中，跳过通信测试');
    return false;
  }
  
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_EXCEL_LIST' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ 通信失败:', chrome.runtime.lastError.message);
        resolve(false);
        return;
      }
      
      if (response) {
        console.log('✅ 后台通信正常');
        console.log('  - 响应:', JSON.stringify(response).substring(0, 100));
        resolve(true);
      } else {
        console.error('❌ 无响应');
        resolve(false);
      }
    });
  });
}

// 测试5: 检查DOM元素
function testDOMElements() {
  console.log('\n=== 测试5: DOM元素检查 ===');
  
  if (typeof document === 'undefined') {
    console.error('❌ document未定义（非浏览器环境）');
    return false;
  }
  
  const elements = [
    'excelFile',
    'btnAddExcel',
    'excelFileList',
    'uploadProgress',
    'progressFill',
    'progressText',
    'progressPercent'
  ];
  
  let allFound = true;
  elements.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      console.log(`✅ #${id} 存在`);
    } else {
      console.error(`❌ #${id} 不存在`);
      allFound = false;
    }
  });
  
  return allFound;
}

// 运行所有测试
async function runAllTests() {
  console.log('======================================');
  console.log('  Excel功能测试脚本');
  console.log('======================================');
  
  const results = {
    xlsx: testXLSXLibrary(),
    manifest: testManifest(),
    parsing: testExcelParsing(),
    dom: testDOMElements(),
    communication: await testMessageCommunication()
  };
  
  console.log('\n======================================');
  console.log('  测试结果汇总');
  console.log('======================================');
  
  let passCount = 0;
  let totalCount = 0;
  
  for (const [name, passed] of Object.entries(results)) {
    totalCount++;
    if (passed) {
      passCount++;
      console.log(`✅ ${name}: 通过`);
    } else {
      console.error(`❌ ${name}: 失败`);
    }
  }
  
  console.log(`\n总计: ${passCount}/${totalCount} 项通过`);
  
  if (passCount === totalCount) {
    console.log('\n🎉 所有测试通过！');
  } else {
    console.log('\n⚠️ 部分测试失败，请检查上述问题');
  }
  
  return results;
}

// 如果在浏览器控制台运行，自动执行
if (typeof window !== 'undefined') {
  console.log('测试脚本已加载，运行 runAllTests() 开始测试');
  // 导出到全局
  window.ExcelTest = {
    runAllTests,
    testXLSXLibrary,
    testManifest,
    testExcelParsing,
    testDOMElements,
    testMessageCommunication
  };
}

// Node.js环境导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runAllTests };
}

/**
 * Umami Sales - Google Sheets 同步脚本
 * 
 * 设置步骤：
 * 1. 打开你的 Google Sheet
 * 2. 点击 扩展程序 > Apps Script
 * 3. 替换所有代码为以下内容
 * 4. 修改 SPREADSHEET_ID 为你的表格 ID
 * 5. 保存并重新部署
 */

// ==================== 配置 ====================
const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'; // ← 替换为你的表格ID

// ==================== CORS 响应头 ====================
function addCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

// ==================== 处理 OPTIONS 请求 (CORS 预检) ====================
function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ==================== 处理 POST 请求 ====================
function doPost(e) {
  try {
    // 解析请求数据
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      throw new Error('No data received');
    }
    
    // 打开表格并获取活动工作表
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getActiveSheet();
    
    // 检查是否需要添加表头
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        '订单号',
        '时间',
        '支付方式',
        '商品明细',
        '小计 (€)',
        'VAT (€)',
        '总价 (€)',
        '状态'
      ]);
    }
    
    // 格式化商品明细
    const itemsStr = data.items.map(i => i.quantity + 'x ' + i.name).join('; ');
    
    // 添加数据行
    const row = [
      data.orderNumber,
      new Date(data.createdAt).toLocaleString('fi-FI'),
      data.paymentMethod === 'card' ? 'Card' : 'Cash',
      itemsStr,
      data.subtotal.toFixed(2),
      data.vat.toFixed(2),
      data.total.toFixed(2),
      data.status
    ];
    
    sheet.appendRow(row);
    
    // 返回成功响应
    const output = ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Order synced successfully'
    }));
    output.setMimeType(ContentService.MimeType.JSON);
    
    return output;
    
  } catch (error) {
    // 返回错误响应
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==================== 测试函数 ====================
function testAppend() {
  const testData = {
    orderNumber: 'TEST_' + Date.now(),
    createdAt: Date.now(),
    paymentMethod: 'card',
    items: [
      { name: 'Pieni Sushi', quantity: 2 },
      { name: 'Drink', quantity: 1 }
    ],
    subtotal: 25.00,
    vat: 3.38,
    total: 28.38,
    status: 'pending'
  };
  
  // 模拟 doPost
  doPost({
    postData: {
      contents: JSON.stringify(testData)
    }
  });
  
  Logger.log('Test completed');
}

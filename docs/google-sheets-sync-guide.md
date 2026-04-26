/**
 * Umami Sales - Google Sheets 同步脚本
 *
 * 设置步骤：
 * 1. 打开 https://drive.google.com
 * 2. 新建 > Google Sheets > 空白电子表格
 * 3. 记下表格的 ID（URL 中 spreadsheet/d/ 和 /edit 之间的部分）
 *    例如：https://docs.google.com/spreadsheets/d/ABC123XYZ.../edit
 *    ABC123XYZ... 就是你的表格 ID
 * 4. 点击 扩展程序 > Apps Script
 * 5. 删除所有代码，粘贴本脚本
 * 6. 把第 12 行的 SPREADSHEET_ID 替换为你的表格 ID
 * 7. 保存（Ctrl+S）
 * 8. 点击 部署 > 新增部署作业
 *    - 类型：网络应用
 *    - 描述：Umami Sales Sync
 *    - 执行方式：本人
 *    - 可访问权限：任何人
 * 9. 点击"部署"，复制生成的 Web App URL
 * 10. 把这个 URL 填入你的 Umami Sales App 设置中
 */

// ==================== 配置 ====================
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ← 替换为你的 Google Sheets ID

// ==================== 主函数 ====================
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
    const data = JSON.parse(e.postData.contents);
    
    // 添加订单数据行
    const row = [
      data.orderNumber,           // 订单号
      new Date(data.createdAt).toLocaleString('fi-FI'), // 时间
      data.paymentMethod === 'card' ? 'Card' : 'Cash',  // 支付方式
      data.items.map(i => i.quantity + 'x ' + i.name).join('; '), // 商品明细
      data.subtotal.toFixed(2),   // 小计
      data.vat.toFixed(2),        // VAT
      data.total.toFixed(2),      // 总价
      data.status                 // 状态
    ];
    
    sheet.appendRow(row);
    
    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==================== 测试函数（可选） ====================
function testAppend() {
  const testData = {
    orderNumber: 'TEST001',
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
  
  doPost({
    postData: {
      contents: JSON.stringify(testData)
    }
  });
}

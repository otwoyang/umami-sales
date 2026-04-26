# Google Sheets 同步设置指南

## 功能说明
每次完成订单后，数据会自动同步到 Google Sheets 电子表格，方便统计和分析。

## 设置步骤

### 第一步：创建 Google Sheet
1. 打开 https://drive.google.com
2. 点击 **新建** → **Google Sheets** → **空白电子表格**
3. 给表格起个名字，比如 "Umami Sales"
4. 打开表格，记下 URL 中的表格 ID：
   ```
   https://docs.google.com/spreadsheets/d/【这里是ID】/edit
   ```

### 第二步：创建 Apps Script
1. 在 Google Sheet 中，点击 **扩展程序** → **Apps Script**
2. 删除所有现有代码
3. 复制以下代码并粘贴：

```javascript
/**
 * Umami Sales - Google Sheets 同步脚本
 */
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ← 替换为你的表格ID

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
    const data = JSON.parse(e.postData.contents);
    
    const row = [
      data.orderNumber,
      new Date(data.createdAt).toLocaleString('fi-FI'),
      data.paymentMethod === 'card' ? 'Card' : 'Cash',
      data.items.map(i => i.quantity + 'x ' + i.name).join('; '),
      data.subtotal.toFixed(2),
      data.vat.toFixed(2),
      data.total.toFixed(2),
      data.status
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
```

4. 把 `SPREADSHEET_ID` 替换为你在第一步记下的表格 ID
5. 点击 **保存** (Ctrl+S)

### 第三步：部署为 Web App
1. 点击 **部署** → **新建部署作业**
2. 点击 **选择类型** → **网络应用程序**
3. 配置：
   - **说明**：Umami Sales Sync
   - **执行方式**：本人
   - **可访问权限**：任何人
4. 点击 **部署**
5. 授予权限（选择你的 Google 账号）
6. 复制 **Web 应用网址**

### 第四步：在 App 中配置
1. 打开 Umami Sales App
2. 点击右上角菜单 → **📦 Edit Products**
3. 点击底部蓝色的 **📊 Google Sheets** 按钮
4. 粘贴第三步复制的 Web App 网址
5. 点击 **确定**

### 测试同步
1. 完成一个测试订单
2. 查看 Google Sheet，应该能看到新数据

## 同步的数据字段
| 列 | 内容 |
|---|---|
| A | 订单号 |
| B | 时间 |
| C | 支付方式 (Card/Cash) |
| D | 商品明细 |
| E | 小计 (€) |
| F | VAT (€) |
| G | 总价 (€) |
| H | 状态 |

## 常见问题

**Q: 订单没有同步？**
A: 检查：
1. 是否配置了 Web App 网址
2. Web App 是否设置为"任何人"可访问
3. 尝试点击 **📊 Google Sheets** 按钮重新配置

**Q: 如何禁用同步？**
A: 在配置时留空 URL 即可

**Q: 支持离线吗？**
A: 离线时订单会保存在本地 IndexedDB，恢复网络后需要手动同步（未来可实现自动重试）

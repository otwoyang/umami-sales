# Umami Sales PWA - 数据逻辑设计

## 1. 数据存储架构

### 1.1 存储方式
- **IndexedDB**: 主要存储（离线支持、查询效率高）
- **localStorage**: 辅助存储（设置、简单配置）

### 1.2 数据库结构

```
Database: UmamiSalesDB
├── Store: orders
├── Store: products
└── Store: settings
```

---

## 2. 数据模型

### 2.1 Orders (订单)

```javascript
{
  id: string,           // UUID v4
  orderNumber: number,   // 当日订单编号 (1, 2, 3...)
  status: enum,          // 'pending' | 'cooking' | 'completed' | 'deleted'
  items: [
    {
      productId: string,
      name: string,
      price: number,     // 单价（含税）
      quantity: number,
      taxPercent: number,
      lineTotal: number  // 小计 = price * quantity
    }
  ],
  subtotal: number,      // 商品小计
  vat: number,           // 增值税总额
  total: number,         // 最终总价（含税）
  paymentMethod: enum,  // 'card' | 'cash'
  createdAt: timestamp,  // 创建时间
  updatedAt: timestamp,  // 状态更新时间
  completedAt: timestamp // 完成时间
}
```

### 2.2 Products (产品)

```javascript
{
  id: string,            // UUID v4
  name: string,          // 产品名称
  price: number,         // 价格（含税）
  taxPercent: number,    // 税率 (默认 13.5)
  category: string,      // 'sushi' | 'drink' | 'addon' | 'discount'
  icon: string,          // emoji图标
  sortOrder: number,     // 排序顺序
  isActive: boolean,     // 是否启用
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 2.3 Settings (设置)

```javascript
{
  storeName: string,           // 店铺名称
  companyName: string,         // 公司名称
  vatNumber: string,           // VAT税号
  yTunnus: string,             // 芬兰企业号
  email: string,               // 邮箱
  dailyOrderCounter: number,  // 今日订单计数
  lastResetDate: string       // 上次重置日期 (YYYY-MM-DD)
}
```

---

## 3. 订单状态流转

```
┌─────────┐     点击      ┌─────────┐    双击     ┌───────────┐
│ Pending │ ──────────→ │ Cooking │ ────────→ │ Completed │
│ (等待中) │              │ (制作中) │            │  (已完成)  │
└─────────┘              └─────────┘            └───────────┘
     │                       │                       │
     │ 删除                   │ 删除                   │ 删除
     ↓                       ↓                       ↓
┌─────────┐              ┌─────────┐             ┌───────────┐
│ Deleted │              │ Deleted │             │  Deleted  │
│ (已删除) │              │ (已删除) │             │  (已删除)  │
└─────────┘              └─────────┘             └───────────┘
```

### 状态说明
- **pending**: 刚提交的订单，等待厨房开始制作
- **cooking**: 厨房正在制作中
- **completed**: 制作完成
- **deleted**: 被删除的订单（软删除，不物理删除，用于统计）

---

## 4. 统计数据计算逻辑

### 4.1 今日销售总额
```javascript
function getTodaySales() {
  const today = new Date().toDateString();
  return orders
    .filter(o => o.status !== 'deleted')
    .filter(o => new Date(o.createdAt).toDateString() === today)
    .reduce((sum, o) => sum + o.total, 0);
}
```

### 4.2 动态效果阈值
| 销售额范围 | 效果 | CSS Class |
|-----------|------|-----------|
| 0 - 249 | 绿叶围绕 | `effect-leaves` |
| 250 - 399 | 金光环绕 | `effect-gold` |
| 400 - 749 | 火焰环绕 | `effect-fire` |
| 750+ | 大火焰深色 | `effect-blaze` |

---

## 5. VAT 计算逻辑

### 5.1 公式
```
Net (净额) = Gross (总额) / (1 + taxPercent/100)
VAT = Gross - Net
```

### 5.2 示例
```
总额 = €11.50, 税率 = 13.5%
净额 = 11.50 / 1.135 = €10.13
VAT = 11.50 - 10.13 = €1.37
```

---

## 6. IndexedDB 操作 API

### 6.1 数据库初始化
```javascript
const DB_NAME = 'UmamiSalesDB';
const DB_VERSION = 1;

openDB().then(db => {
  // db 对象包含所有 store
});
```

### 6.2 核心操作

| 操作 | 方法 |
|------|------|
| 添加订单 | `orders.add(order)` |
| 更新订单状态 | `orders.update(id, {status: 'cooking'})` |
| 删除订单(软删除) | `orders.update(id, {status: 'deleted'})` |
| 获取今日订单 | `orders.where('createdAt').above(todayStart)` |
| 获取待制作订单 | `orders.where('status').equals('pending')` |
| 获取已完成订单 | `orders.where('status').equals('completed')` |

---

## 7. 跨页面数据同步

由于是纯前端 PWA，两个页面共享同一个 IndexedDB：

- **Order 页面**: 写入新订单
- **kitchen 页面**: 读取、更新订单状态
- **两个页面**: 都监听 `storage` 事件进行同步（可选）

实际使用中，kitchen 页面会定期轮询数据库刷新显示。

---

## 8. 数据导出逻辑

### 8.1 Excel 导出字段
| 列名 | 数据来源 |
|------|----------|
| Order # | orderNumber |
| Time | createdAt (格式化) |
| Items | items 数组 (JSON字符串) |
| Subtotal | subtotal |
| VAT | vat |
| Total | total |
| Payment | paymentMethod |
| Status | status |

### 8.2 导出范围
- 默认导出今日数据
- 可选择日期范围导出

---

## 9. 产品分类

| Category | 说明 | 默认显示位置 |
|----------|------|-------------|
| sushi | 寿司主餐 | 产品区主区域 |
| drink | 饮品 | 产品区主区域 |
| addon | 附加项 | 产品区主区域 |
| discount | 折扣/减免 | 单独区域或底部 |

---

## 10. 默认产品列表

| 名称 | 价格 | 分类 |
|------|------|------|
| Pieni Sushi | €11.50 | sushi |
| Pieni+ Sushi | €14.00 | sushi |
| Medium Sushi | €16.50 | sushi |
| Iso Sushi | €19.50 | sushi |
| Drink | €2.00 | drink |
| Nigri | €1.80 | drink |
| *Take away | €0.00 | addon |
| -Student | €0.00 | discount |
| -Vege | €0.00 | discount |
| -Vegan | €0.00 | discount |
| -All Fry | €0.00 | discount |
| -All Raw | €0.00 | discount |
| -No Mayo | €0.00 | discount |
| -No Dessert | €0.00 | discount |
| -No Tofu(GF) | €0.00 | discount |

---

## 11. Receipt (小票) 内容

```
================================
         UMAIMOST
================================
Guaimost Oy
Y-tunnus: 3287298-9
VAT: FI 32872989
Email: guaimost@gmail.com
================================
Order #: 001
Date: 26/04/2026 14:30
================================
Pieni Sushi      x2   €23.00
Medium Sushi      x1   €16.50
Drink             x2   €4.00
================================
Subtotal:           €38.50
VAT (13.5%):        €4.58
--------------------------------
TOTAL:             €43.08
Payment: Card
================================
      Thank you! / Kiitos!
================================
```

---

## 12. 响应式设计策略

### 12.1 单位选择
- 使用 `vmin` 作为主要缩放单位
- 元素尺寸 = 基准尺寸 × (当前视口 / 设计基准视口)

### 12.2 基准设计视口
- 设计基准: iPad 竖屏 (768px × 1024px)
- 所有元素使用相对单位，保持比例

### 12.3 断点
| 设备 | 视口 | 列数 |
|------|------|------|
| iPhone 竖屏 | < 480px | 2列 |
| iPhone 横屏 | 480-768px | 3列 |
| iPad 竖屏 | 768-1024px | 3列 |
| iPad 横屏 | > 1024px | 4列 |

---

## 13. PWA 离线策略

### 13.1 Cache Strategy
- **App Shell**: Cache First (HTML, CSS, JS, 图标)
- **Data**: IndexedDB (始终最新)

### 13.2 Service Worker 生命周期
1. Install: 缓存所有静态资源
2. Activate: 清理旧缓存
3. Fetch: 拦截请求，返回缓存或网络

---

## 14. 企业信息配置

```javascript
const STORE_CONFIG = {
  companyName: 'Guaimost Oy',
  storeName: 'Umami Sushi',
  yTunnus: '3287298-9',
  vatNumber: 'FI 32872989',
  email: 'guaimost@gmail.com',
  phone: ''
};
```

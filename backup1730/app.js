// Umami Sales PWA - Main Application Logic

// ==================== GLOBAL ERROR HANDLING ====================
// Catch ALL unhandled errors to prevent white screen
function showError(message) {
  console.error('[ERROR]', message);
  try {
    // Try to show error in UI
    const errorEl = document.getElementById('errorDisplay');
    if (errorEl) {
      errorEl.textContent = `Error: ${message}`;
      errorEl.style.display = 'block';
    } else if (document.body) {
      // Fallback: create error banner
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff4444;color:white;padding:10px;text-align:center;z-index:99999;';
      banner.textContent = `Error: ${message}`;
      document.body.insertBefore(banner, document.body.firstChild);
    }
  } catch (e) {
    // Last resort: show alert
    alert('Error: ' + message);
  }
}

// Set up error handlers as early as possible
if (typeof window !== 'undefined') {
  window.onerror = function(msg, url, line, col, error) {
    showError(error?.message || msg);
    return true; // Prevent default error handling
  };

  window.addEventListener('error', (event) => {
    showError(event.error?.message || 'Unknown error');
    event.preventDefault();
    return true;
  });

  window.addEventListener('unhandledrejection', (event) => {
    showError(event.reason?.message || String(event.reason));
    event.preventDefault();
    return false;
  });
}

// ==================== CLEANUP FUNCTIONS ====================

// Clean duplicate products (keep first occurrence by name)
async function cleanDuplicateProducts() {
  try {
    const products = await DB.getAllProducts();
    console.log('[CLEANUP] Found', products.length, 'products');

    // Find duplicates by name
    const seen = new Map();
    const toDelete = [];

    products.forEach(p => {
      if (seen.has(p.name)) {
        // Duplicate found
        toDelete.push(p.id);
        console.log('[CLEANUP] Duplicate:', p.name, '- marked for deletion');
      } else {
        seen.set(p.name, p.id);
      }
    });

    // Delete duplicates
    for (const id of toDelete) {
      await DB.deleteProduct(id);
    }

    console.log('[CLEANUP] Deleted', toDelete.length, 'duplicate products');
    alert('Cleaned ' + toDelete.length + ' duplicate products. Remaining: ' + (products.length - toDelete.length));
    return products.length - toDelete.length;
  } catch (error) {
    console.error('[CLEANUP ERROR]', error);
    alert('Failed to clean products: ' + error.message);
  }
}

window.cleanDuplicateProducts = cleanDuplicateProducts;

// ==================== STATE ====================
let currentOrder = {
  items: [],
  subtotal: 0,
  vat: 0,
  total: 0
};

let products = [];
let todaySales = 0;
let activeModal = null; // Track active modal
let receiptAutoCloseTimer = null; // Timer for auto-closing receipt
let promiseTimeMinutes = 0; // Promise time in minutes (0 means no promise)

function setPromiseTime() {
  const input = prompt('Set promise time (minutes):', '30');
  if (input !== null) {
    const minutes = parseInt(input);
    if (isNaN(minutes) || minutes <= 0) {
      promiseTimeMinutes = 0;
      document.getElementById('promiseBtn').classList.remove('active');
      document.getElementById('promiseBtn').textContent = '⏳';
    } else {
      promiseTimeMinutes = minutes;
      document.getElementById('promiseBtn').classList.add('active');
      document.getElementById('promiseBtn').textContent = `⏳${minutes}`;
    }
  }
}

// ==================== INIT ====================
let isInitialized = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Prevent multiple initializations
  if (isInitialized) {
    console.log('Already initialized, skipping...');
    return;
  }
  isInitialized = true;

  try {
    // Detect if loaded in iframe (split view)
    if (window.location.search.includes('split=true')) {
      document.body.classList.add('iframe-mode');
    }

    // Initialize database
    await DB.initDB();

    // Initialize products
    products = await DB.initializeDefaultProducts();

    // Load page-specific content
    const page = document.body.dataset.page;

    if (page === 'order') {
      await initOrderPage();
    } else if (page === 'kitchen') {
      await initkitchenPage();
    }

    // Setup PWA install prompt
    setupInstallPrompt();

    // Setup offline detection
    setupOfflineDetection();
  } catch (error) {
    console.error('Init error:', error);
    alert('Error: ' + error.message);
  }
});

// ==================== ORDER PAGE ====================
let orderSalesInterval = null;
let orderETAInterval = null;

async function initOrderPage() {
  // Clear existing intervals to prevent duplicates
  if (orderSalesInterval) clearInterval(orderSalesInterval);
  if (orderETAInterval) clearInterval(orderETAInterval);

  renderProducts();
  await updateTodaySales();
  updateOrderDisplay();
  await updateETA();

  // Start polling for sales updates
  orderSalesInterval = setInterval(updateTodaySales, 5000);

  // Start ETA timer updates
  orderETAInterval = setInterval(updateETA, 1000);
}

async function updateETA() {
  const etaEl = document.getElementById('etaValue');
  if (!etaEl) return;

  const allOrders = await DB.getAllOrders();
  const today = new Date().toDateString();

  // Filter today's non-deleted orders
  const todayOrders = allOrders.filter(o => {
    const orderDate = new Date(o.createdAt).toDateString();
    return orderDate === today && o.status !== 'deleted';
  });

  // If no orders, ETA is 15
  if (todayOrders.length === 0) {
    etaEl.textContent = '15';
    return;
  }

  let eta = 0;

  // Check for cooking orders
  const cookingOrders = todayOrders.filter(o => o.status === 'cooking');
  if (cookingOrders.length > 0) {
    // Get the last cooking order
    const lastCooking = cookingOrders[cookingOrders.length - 1];

    // Calculate remaining time for the last cooking order
    const elapsed = Math.floor((Date.now() - lastCooking.createdAt) / 1000);
    const cookingRemaining = 15 * 60 - elapsed; // 15 mins cooking time

    if (cookingRemaining > 0) {
      eta = Math.ceil(cookingRemaining / 60) + 15;
    } else {
      eta = 15;
    }
  } else {
    // No cooking orders, base time is 15
    eta = 15;
  }

  // Check for waiting orders
  const waitingOrders = todayOrders.filter(o => o.status === 'pending');
  if (waitingOrders.length > 2) {
    // More than 2 waiting orders: add 15 more minutes
    eta += 15;
  }

  etaEl.textContent = eta.toString();
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  // Clear grid first to prevent duplicates
  grid.innerHTML = '';

  // Sort products by sortOrder first
  const sortedProducts = [...products].sort((a, b) => a.sortOrder - b.sortOrder);

  // Group products by category
  const categories = {
    sushi: { name: '🍣 Sushi', items: [] },
    drink: { name: '🥤 Drinks', items: [] },
    addon: { name: '➕ Extras', items: [] },
    discount: { name: '💰 Discounts', items: [] }
  };

  sortedProducts.forEach(p => {
    if (categories[p.category]) {
      categories[p.category].items.push(p);
    }
  });

  let html = '';
  for (const cat of Object.values(categories)) {
    if (cat.items.length > 0) {
      cat.items.forEach(product => {
        html += `
          <button class="product-btn ${product.category}"
                  onclick="addToOrder('${product.id}')">
            <span class="product-name">${product.name}</span>
            <span class="product-price">€${product.price.toFixed(2)}</span>
          </button>
        `;
      });
    }
  }

  grid.innerHTML = html;
}

function addToOrder(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  // Check if item already exists
  const existingItem = currentOrder.items.find(i => i.productId === productId);

  if (existingItem) {
    existingItem.quantity++;
  } else {
    currentOrder.items.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      taxPercent: product.taxPercent,
      quantity: 1
    });
  }

  recalculateOrder();
  updateOrderDisplay();
}

function removeFromOrder(productId) {
  const index = currentOrder.items.findIndex(i => i.productId === productId);
  if (index > -1) {
    currentOrder.items.splice(index, 1);
    recalculateOrder();
    updateOrderDisplay();
  }
}

function clearOrder() {
  currentOrder = { items: [], subtotal: 0, vat: 0, total: 0 };
  updateOrderDisplay();
}

function recalculateOrder() {
  currentOrder.subtotal = 0;
  currentOrder.vat = 0;
  currentOrder.total = 0;

  currentOrder.items.forEach(item => {
    const lineTotal = item.price * item.quantity;
    const net = lineTotal / (1 + item.taxPercent / 100);
    const vat = lineTotal - net;

    currentOrder.subtotal += lineTotal;
    currentOrder.vat += vat;
    currentOrder.total += lineTotal;
  });

  // Round to 2 decimal places
  currentOrder.subtotal = Math.round(currentOrder.subtotal * 100) / 100;
  currentOrder.vat = Math.round(currentOrder.vat * 100) / 100;
  currentOrder.total = Math.round(currentOrder.total * 100) / 100;
}

function updateOrderDisplay() {
  const itemsContainer = document.getElementById('orderItems');
  const subtotalEl = document.getElementById('subtotal');
  const vatEl = document.getElementById('vat');
  const totalEl = document.getElementById('total');
  const emptyState = document.getElementById('emptyOrder');
  const payButtons = document.querySelectorAll('.pay-btn');

  if (currentOrder.items.length === 0) {
    itemsContainer.innerHTML = '';
    emptyState.style.display = 'flex';
    payButtons.forEach(btn => btn.disabled = true);
  } else {
    emptyState.style.display = 'none';
    payButtons.forEach(btn => btn.disabled = false);

    let html = '';
    currentOrder.items.forEach(item => {
      html += `
        <div class="order-item">
          <div class="order-item-info">
            <span class="order-item-qty">${item.quantity}</span>
            <span class="order-item-name">${item.name}</span>
          </div>
          <span class="order-item-price">€${(item.price * item.quantity).toFixed(2)}</span>
          <button class="order-item-remove" onclick="removeFromOrder('${item.productId}')">×</button>
        </div>
      `;
    });
    itemsContainer.innerHTML = html;
  }

  if (subtotalEl) subtotalEl.textContent = `€${currentOrder.subtotal.toFixed(2)}`;
  if (vatEl) vatEl.textContent = `€${currentOrder.vat.toFixed(2)}`;
  if (totalEl) totalEl.textContent = `€${currentOrder.total.toFixed(2)}`;
}

async function completeOrder(paymentMethod) {
  if (currentOrder.items.length === 0) return;

  try {
    const order = await DB.addOrder({
      items: [...currentOrder.items],
      subtotal: currentOrder.subtotal,
      vat: currentOrder.vat,
      total: currentOrder.total,
      paymentMethod,
      promiseTime: promiseTimeMinutes // Store promise time
    });

    // Reset promise time after order
    promiseTimeMinutes = 0;
    const promiseBtn = document.getElementById('promiseBtn');
    if (promiseBtn) {
      promiseBtn.classList.remove('active');
      promiseBtn.textContent = '⏳';
    }

    // Show receipt
    showReceipt(order);

    // Clear current order
    clearOrder();

    // Update sales display and ETA
    await updateTodaySales();
    await updateETA();

  } catch (error) {
    console.error('Failed to complete order:', error);
    alert('Failed to complete order. Please try again.');
  }
}

async function updateTodaySales() {
  todaySales = await DB.getTodaySales();

  const displayEl = document.getElementById('todaySalesAmount');
  if (displayEl) {
    displayEl.textContent = `€${todaySales.toFixed(2)}`;

    // Update effect class
    displayEl.className = 'today-sales-amount';
    const container = document.querySelector('.today-sales');

    // Update effect class and orbit emoji
    const orbitItems = container.querySelectorAll('.td-orbit-item');
    if (todaySales >= 750) {
      container.className = 'today-sales td-fire';
      orbitItems.forEach(item => { item.textContent = '🔥'; });
    } else if (todaySales >= 381) {
      container.className = 'today-sales td-wave';
      orbitItems.forEach(item => { item.textContent = '🌊'; });
    } else if (todaySales >= 250) {
      container.className = 'today-sales td-leaves';
      orbitItems.forEach(item => { item.textContent = '🍃'; });
    } else {
      container.className = 'today-sales';
    }
  }
}

// ==================== MODAL MANAGEMENT ====================
function openModal(modalId) {
  // Close any existing modal first
  closeAllModals();
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('show');
    activeModal = modalId;
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.classList.remove('show');
  });
  activeModal = null;
}

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllModals();
  }
});

// ==================== HISTORY ====================
async function showHistory() {
  const list = document.getElementById('historyList');

  const orders = await DB.getTodayOrders();
  // Sort by creation time, newest first
  orders.sort((a, b) => b.createdAt - a.createdAt);

  if (orders.length === 0) {
    list.innerHTML = '<div class="order-empty">No orders today</div>';
  } else {
    let html = '';
    orders.forEach(order => {
      const time = new Date(order.createdAt).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });

      html += `
        <div class="history-item">
          <div class="history-item-info">
            <span class="history-item-number">#${order.orderNumber}</span>
            <span class="history-item-time">${time} · ${order.paymentMethod === 'card' ? '💳' : '💵'} ${order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}</span>
          </div>
          <span class="history-item-total">€${order.total.toFixed(2)}</span>
          <div class="history-item-actions">
            <button class="history-action-btn receipt" onclick="showReceiptFromHistory('${order.id}')">🧾</button>
            <button class="history-action-btn share" onclick="shareHistoryReceipt('${order.id}')">✉️</button>
            <button class="history-action-btn delete" onclick="deleteHistoryOrder('${order.id}')">🗑️</button>
          </div>
        </div>
      `;
    });
    list.innerHTML = html;
  }

  openModal('historyModal');
}

function closeHistory() {
  document.getElementById('historyModal').classList.remove('show');
  if (activeModal === 'historyModal') activeModal = null;
}

async function deleteHistoryOrder(orderId) {
  if (!confirm('Delete this order?')) return;

  try {
    await DB.deleteOrder(orderId);
    showHistory(); // Refresh list
    await updateTodaySales(); // Update sales total
  } catch (error) {
    console.error('Failed to delete order:', error);
    alert('Failed to delete order.');
  }
}

async function showReceiptFromHistory(orderId) {
  const orders = await DB.getTodayOrders();
  const order = orders.find(o => o.id === orderId);
  if (order) {
    showReceipt(order);
  }
}

async function shareHistoryReceipt(orderId) {
  const orders = await DB.getTodayOrders();
  const order = orders.find(o => o.id === orderId);
  if (order) {
    // First show receipt, then share
    showReceipt(order);
    // Trigger share after a short delay
    setTimeout(() => shareReceipt(), 100);
  }
}

async function exportTodayOrders() {
  const orders = await DB.getTodayOrders();

  if (orders.length === 0) {
    alert('No orders to export');
    return;
  }

  // Prepare data for Excel
  const data = orders.map(order => {
    const items = order.items.map(i => `${i.quantity}x ${i.name}`).join('; ');
    return {
      'Order #': String(order.orderNumber),
      'Time': new Date(order.createdAt).toLocaleTimeString('en-GB'),
      'Items': items,
      'Subtotal (€)': order.subtotal,
      'VAT (€)': order.vat,
      'Total (€)': order.total,
      'Payment': order.paymentMethod,
      'Status': order.status
    };
  });

  // Add summary row
  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const totalVAT = orders.reduce((sum, o) => sum + o.vat, 0);

  // Use SheetJS to create Excel
  const ws = XLSX.utils.json_to_sheet(data);

  // Add summary at the end
  const summaryRow = data.length + 2;
  ws[`A${summaryRow}`] = { t: 's', v: 'TOTAL' };
  ws[`E${summaryRow}`] = { t: 'n', v: totalVAT };
  ws[`F${summaryRow}`] = { t: 'n', v: totalSales };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Today Sales');

  const fileName = `Umami_Sales_${new Date().toISOString().split('T')[0]}.xlsx`;
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });

  // Try using Web Share API with files support (iOS Safari 14+)
  if (navigator.canShare && navigator.canShare({ files: [new File([], fileName)] })) {
    const file = new File([blob], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    if (navigator.share) {
      try {
        await navigator.share({
          files: [file],
          title: 'Umami Sales Export',
          text: `Today's sales report - ${new Date().toLocaleDateString()}`
        });
        return; // Success, exit here
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.log('Share cancelled or failed, falling back to download');
        } else {
          return; // User cancelled
        }
      }
    }
  }

  // Fallback: standard browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==================== RECEIPT ====================
function showReceipt(order) {
  const modal = document.getElementById('receiptModal');
  const content = document.getElementById('receiptContent');

  const time = new Date(order.createdAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const date = new Date(order.createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const config = DB.STORE_CONFIG;

  let html = `
    <div class="receipt-header">
      <div class="receipt-company">${config.storeName.toUpperCase()}</div>
      <div class="receipt-info">
        ${config.companyName}<br>
        Y-tunnus: ${config.yTunnus}<br>
        VAT: ${config.vatNumber}<br>
        ${config.email}
      </div>
    </div>
    <div class="receipt-order-info">
      <strong>Order #${order.orderNumber}</strong><br>
      ${date} ${time}
    </div>
    <div class="receipt-items">
  `;

  order.items.forEach(item => {
    const lineTotal = item.price * item.quantity;
    html += `
      <div class="receipt-item">
        <span>${item.name} x${item.quantity}</span>
        <span>€${lineTotal.toFixed(2)}</span>
      </div>
    `;
  });

  html += `
    </div>
    <div class="receipt-totals">
      <div class="receipt-total-row">
        <span>Subtotal:</span>
        <span>€${order.subtotal.toFixed(2)}</span>
      </div>
      <div class="receipt-total-row">
        <span>VAT (13.5%):</span>
        <span>€${order.vat.toFixed(2)}</span>
      </div>
      <div class="receipt-total-row grand-total">
        <span>TOTAL:</span>
        <span>€${order.total.toFixed(2)}</span>
      </div>
      <div class="receipt-total-row" style="margin-top: 1vmin;">
        <span>Payment:</span>
        <span>${order.paymentMethod === 'card' ? '💳 Card' : '💵 Cash'}</span>
      </div>
    </div>
    <div class="receipt-footer">
      <div>Thank you! / Kiitos!</div>
      <div>${config.storeName}</div>
    </div>
  `;

  content.innerHTML = html;
  modal.dataset.orderId = order.id;
  modal.dataset.orderNumber = order.orderNumber;
  openModal('receiptModal');

  // Start auto-close timer (5 seconds of inactivity)
  startReceiptAutoCloseTimer();

  // Scale receipt to fit
  setTimeout(scaleReceiptToFit, 50);
}

function scaleReceiptToFit() {
  const wrapper = document.querySelector('.receipt-content-wrapper');
  const content = document.getElementById('receiptContent');
  if (!wrapper || !content) return;

  const maxHeight = wrapper.clientHeight;
  content.style.transform = 'scale(1)';

  requestAnimationFrame(() => {
    const contentHeight = content.scrollHeight;
    if (contentHeight > maxHeight) {
      const scale = maxHeight / contentHeight;
      content.style.transform = `scale(${scale})`;
    }
  });
}

function closeReceipt() {
  stopReceiptAutoCloseTimer();
  document.getElementById('receiptModal').classList.remove('show');
  if (activeModal === 'receiptModal') activeModal = null;
}

function startReceiptAutoCloseTimer() {
  stopReceiptAutoCloseTimer();
  receiptAutoCloseTimer = setTimeout(() => {
    newOrder();
  }, 10000); // 10 seconds of inactivity
}

function stopReceiptAutoCloseTimer() {
  if (receiptAutoCloseTimer) {
    clearTimeout(receiptAutoCloseTimer);
    receiptAutoCloseTimer = null;
  }
}

function resetReceiptAutoCloseTimer() {
  if (activeModal === 'receiptModal') {
    startReceiptAutoCloseTimer();
  }
}

// Add event listeners for receipt modal buttons to reset timer
document.addEventListener('DOMContentLoaded', () => {
  const receiptModal = document.getElementById('receiptModal');
  if (receiptModal) {
    receiptModal.addEventListener('click', (e) => {
      if (e.target.closest('button')) {
        resetReceiptAutoCloseTimer();
      }
    });
  }
});

function printReceipt() {
  const content = document.getElementById('receiptContent').innerHTML;
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt</title>
      <style>
        body { font-family: 'Courier New', monospace; padding: 20px; max-width: 300px; margin: auto; }
        .receipt-header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
        .receipt-company { font-size: 18px; font-weight: bold; }
        .receipt-info { font-size: 12px; line-height: 1.5; }
        .receipt-order-info { text-align: center; padding: 10px 0; border-bottom: 1px dashed #000; }
        .receipt-items { padding: 10px 0; border-bottom: 1px dashed #000; }
        .receipt-item { display: flex; justify-content: space-between; padding: 2px 0; }
        .receipt-totals { padding: 10px 0; }
        .receipt-total-row { display: flex; justify-content: space-between; padding: 2px 0; }
        .grand-total { font-weight: bold; font-size: 16px; border-top: 1px solid #000; padding-top: 5px; margin-top: 5px; }
        .receipt-footer { text-align: center; padding-top: 10px; border-top: 1px dashed #000; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>${content.innerHTML || content}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
}

// ==================== RECEIPT IMAGE ====================

// Capture receipt as image using html2canvas
async function captureReceiptImage() {
  const content = document.getElementById('receiptContent');
  if (!content) throw new Error('Receipt content not found');

  const canvas = await html2canvas(content, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false
  });

  return canvas;
}

// Download receipt as PNG image
async function downloadReceiptImage() {
  const btn = document.querySelector('.download-btn');
  const originalText = btn.textContent;
  btn.textContent = '⏳ Generating...';
  btn.disabled = true;

  try {
    const canvas = await captureReceiptImage();
    const link = document.createElement('a');
    const orderNum = document.getElementById('receiptModal').dataset.orderNumber || 'Receipt';
    link.download = `Receipt_${orderNum}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    btn.textContent = '✅ Downloaded!';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 2000);
  } catch (error) {
    console.error('Failed to download receipt:', error);
    alert('Failed to generate receipt image');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Share receipt image via system share sheet (AirDrop, Email, WhatsApp, etc.)
async function shareReceipt() {
  const shareBtn = document.getElementById('shareReceiptBtn');
  const originalText = shareBtn.textContent;
  shareBtn.textContent = '⏳ Preparing...';
  shareBtn.disabled = true;

  try {
    const canvas = await captureReceiptImage();
    const orderNum = document.getElementById('receiptModal').dataset.orderNumber || 'Receipt';

    // Convert canvas to Blob for sharing
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const fileName = `Receipt_${orderNum}.png`;

    // Try Web Share API with file support (iOS Safari / Android Chrome)
    if (navigator.share && navigator.canShare) {
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Receipt - Order #${orderNum}`,
          text: `Receipt from ${DB.STORE_CONFIG.storeName} - Order #${orderNum}`,
          files: [file]
        });
        shareBtn.textContent = '✅ Done!';
        setTimeout(() => {
          shareBtn.textContent = originalText;
          shareBtn.disabled = false;
        }, 2000);
        return;
      }
    }

    // Fallback: open mailto with image embedded in body
    shareBtn.textContent = originalText;
    shareBtn.disabled = false;
    const imageData = canvas.toDataURL('image/png');
    const subject = encodeURIComponent(`Receipt - Order #${orderNum}`);
    const body = encodeURIComponent(
      `Receipt from ${DB.STORE_CONFIG.storeName}\n` +
      `Order #${orderNum}\n\n` +
      `The receipt image is shown below:`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  } catch (error) {
    console.error('Failed to share receipt:', error);
    shareBtn.textContent = '❌ Failed';
    setTimeout(() => {
      shareBtn.textContent = originalText;
      shareBtn.disabled = false;
    }, 2000);
  }
}

function newOrder() {
  closeReceipt();
}

// ==================== PRODUCT EDITOR ====================
const EDITOR_PASSWORD = '090909';
const MAX_PRODUCTS = 15; // Fixed product count

async function showProductEditor() {
  // Password check
  const password = prompt('Enter password to edit products:');
  if (password !== EDITOR_PASSWORD) {
    alert('Incorrect password!');
    return;
  }

  const list = document.getElementById('productEditList');

  // Refresh products list
  products = await DB.getAllProducts();
  products.sort((a, b) => a.sortOrder - b.sortOrder);

  let html = '';
  products.forEach(product => {
    html += `
      <div class="product-edit-item" data-id="${product.id}">
        <input type="text" class="p-icon" value="${product.icon || ''}" placeholder="🙂" style="width:5vmin;flex-shrink:0;">
        <input type="text" class="p-name" value="${product.name}" placeholder="Name">
        <input type="number" class="p-price" value="${product.price}" step="0.1" min="0">
        <select class="p-category">
          <option value="sushi" ${product.category === 'sushi' ? 'selected' : ''}>🍣</option>
          <option value="drink" ${product.category === 'drink' ? 'selected' : ''}>🥤</option>
          <option value="addon" ${product.category === 'addon' ? 'selected' : ''}>➕</option>
          <option value="discount" ${product.category === 'discount' ? 'selected' : ''}>💰</option>
        </select>
        <div class="product-edit-actions">
          <button class="save" onclick="saveProduct('${product.id}')">✓</button>
          <button class="delete" onclick="deleteProduct('${product.id}')">✗</button>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;

  // Update product count in footer
  const countEl = document.querySelector('.product-editor-footer .product-count');
  if (countEl) {
    countEl.textContent = `${products.length} / ${MAX_PRODUCTS} products`;
  }

  // Disable "Add New Product" button if at max
  const addBtn = document.getElementById('addNewProductBtn');
  if (addBtn) {
    addBtn.disabled = products.length >= MAX_PRODUCTS;
    addBtn.title = products.length >= MAX_PRODUCTS ? 'Maximum products reached (15)' : 'Add a new product';
  }

  openModal('productEditorModal');
}

function closeProductEditor() {
  document.getElementById('productEditorModal').classList.remove('show');
  if (activeModal === 'productEditorModal') activeModal = null;
}

async function saveProduct(productId) {
  const item = document.querySelector(`.product-edit-item[data-id="${productId}"]`);
  if (!item) return;

  const name = item.querySelector('.p-name').value.trim();
  const price = parseFloat(item.querySelector('.p-price').value) || 0;
  const category = item.querySelector('.p-category').value;
  const icon = item.querySelector('.p-icon').value.trim();

  if (!name) {
    alert('Product name is required');
    return;
  }

  try {
    await DB.updateProduct(productId, { name, price, category, icon, isActive: true });
    await showProductEditor(); // Refresh
    renderProducts(); // Update main display
  } catch (error) {
    console.error('Failed to save product:', error);
    alert('Failed to save product');
  }
}

async function deleteProduct(productId) {
  if (!confirm('Delete this product?')) return;

  try {
    await DB.deleteProduct(productId);
    await showProductEditor(); // Refresh
    products = await DB.getAllProducts();
    renderProducts(); // Update main display
  } catch (error) {
    console.error('Failed to delete product:', error);
    alert('Failed to delete product');
  }
}

async function addNewProduct() {
  // Hard limit: cannot exceed 15 products
  if (products.length >= MAX_PRODUCTS) {
    alert(`Maximum products reached! You can only have ${MAX_PRODUCTS} products.`);
    return;
  }
  
  try {
    const newProduct = await DB.addProduct({
      name: 'New Product',
      price: 0,
      taxPercent: 13.5,
      category: 'sushi',
      icon: '📦',
      sortOrder: products.length + 1,
      isActive: true
    });

    products.push(newProduct);
    await showProductEditor(); // Refresh to show new product

    // Focus the new item's name input
    setTimeout(() => {
      const newItem = document.querySelector(`.product-edit-item[data-id="${newProduct.id}"]`);
      if (newItem) {
        newItem.querySelector('.p-name').focus();
      }
    }, 100);
  } catch (error) {
    console.error('Failed to add product:', error);
    alert('Failed to add product');
  }
}

async function resetAllProducts() {
  if (!confirm('Reset ALL products to default list? This will replace all custom products.')) {
    return;
  }

  try {
    // Force reset by calling initializeDefaultProducts
    products = await DB.initializeDefaultProducts();
    renderProducts();
    await showProductEditor(); // Refresh editor
    alert('Products reset successfully!');
  } catch (error) {
    console.error('Failed to reset products:', error);
    alert('Failed to reset products');
  }
}

// ==================== kitchen PAGE ====================
let kitchenFilter = 'all'; // 'all', 'pending', 'cooking', 'completed'
let kitchenTimerInterval = null;
let kitchenRenderInterval = null;
let lastCookingRemainingSeconds = 0; // Last Cooking order's remaining time

async function initkitchenPage() {
  // Clear existing intervals to prevent duplicates
  if (kitchenRenderInterval) clearInterval(kitchenRenderInterval);
  if (kitchenTimerInterval) clearInterval(kitchenTimerInterval);

  await renderOrders();

  // Poll for updates every 3 seconds
  kitchenRenderInterval = setInterval(renderOrders, 3000);

  // Start timer updates every second
  kitchenTimerInterval = setInterval(updateOrderTimers, 1000);
}

function formatElapsedTime(createdAt) {
  const elapsed = Math.floor((Date.now() - createdAt) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatPromiseCountdown(createdAt, promiseMinutes) {
  const elapsed = Math.floor((Date.now() - createdAt) / 1000);
  const totalSeconds = promiseMinutes * 60;
  const remainingSeconds = totalSeconds - elapsed;
  
  if (remainingSeconds <= 0) {
    return 'Overdue';
  }
  
  const remainingMinutes = Math.floor(remainingSeconds / 60);
  const remainingSecs = remainingSeconds % 60;
  return `${remainingMinutes}:${remainingSecs.toString().padStart(2, '0')} left`;
}

function formatRemainingTime(createdAt, isPending = false, promiseMinutes = 0) {
  if (promiseMinutes > 0) {
    return formatPromiseCountdown(createdAt, promiseMinutes);
  }
  
  if (isPending) {
    // For Waiting orders: last Cooking remaining + 15 mins
    const totalSeconds = lastCookingRemainingSeconds + 15 * 60;
    if (totalSeconds <= 0) {
      return 'Soon';
    }
    const remainingMinutes = Math.ceil(totalSeconds / 60);
    return `Maybe in ${remainingMinutes} mins`;
  }
  
  const elapsed = Math.floor((Date.now() - createdAt) / 1000);
  const remainingSeconds = 15 * 60 - elapsed;
  if (remainingSeconds <= 0) {
    return 'Soon';
  }
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  return `Maybe in ${remainingMinutes} mins`;
}

function updateOrderTimers() {
  document.querySelectorAll('.order-card[data-created-at]').forEach(card => {
    const createdAt = parseInt(card.dataset.createdAt);
    const promiseMinutes = parseInt(card.dataset.promiseTime) || 0;
    const timerEl = card.querySelector('.order-timer');
    const remainingEl = card.querySelector('.order-remaining');
    const isCooking = card.classList.contains('cooking');
    const isPending = card.classList.contains('pending');
    
    if (timerEl) {
      if (promiseMinutes > 0) {
        // For promise orders: show countdown as elapsed time
        timerEl.textContent = formatPromiseCountdown(createdAt, promiseMinutes);
      } else {
        timerEl.textContent = formatElapsedTime(createdAt);
      }
    }
    if (remainingEl) {
      if (promiseMinutes > 0) {
        remainingEl.textContent = '';
        remainingEl.style.display = 'none';
      } else if (isPending) {
        remainingEl.textContent = formatRemainingTime(createdAt, true);
        remainingEl.style.display = '';
      } else {
        remainingEl.textContent = formatRemainingTime(createdAt, false);
        remainingEl.style.display = '';
      }
    }
  });
}

async function renderOrders() {
  const grid = document.getElementById('ordersGrid');
  if (!grid) return;

  const allOrders = await DB.getAllOrders();
  const today = new Date().toDateString();

  // Filter today's non-deleted orders
  let orders = allOrders.filter(o => {
    const orderDate = new Date(o.createdAt).toDateString();
    return orderDate === today && o.status !== 'deleted';
  });

  // Apply filter
  if (kitchenFilter === 'all') {
    // All view: show only pending and cooking, not completed
    orders = orders.filter(o => o.status !== 'completed');
  } else {
    orders = orders.filter(o => o.status === kitchenFilter);
  }

  // Sort: cooking first, then pending, then completed
  orders.sort((a, b) => {
    const statusOrder = { cooking: 0, pending: 1, completed: 2 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return a.createdAt - b.createdAt;
  });

  // Update stats
  const pendingCount = allOrders.filter(o =>
    new Date(o.createdAt).toDateString() === today &&
    o.status === 'pending'
  ).length;

  const cookingCount = allOrders.filter(o =>
    new Date(o.createdAt).toDateString() === today &&
    o.status === 'cooking'
  ).length;

  const completedCount = allOrders.filter(o =>
    new Date(o.createdAt).toDateString() === today &&
    o.status === 'completed'
  ).length;

  document.getElementById('pendingCount').textContent = pendingCount;
  document.getElementById('cookingCount').textContent = cookingCount;
  document.getElementById('completedCount').textContent = completedCount;

  if (orders.length === 0) {
    grid.innerHTML = `
      <div class="empty-orders">
        <div class="empty-orders-icon">📋</div>
        <div>No orders</div>
      </div>
    `;
    return;
  }

  // Group orders by status, each status group in its own row
  const statusGroups = {
    cooking: [],
    pending: [],
    completed: []
  };
  
  orders.forEach(order => {
    statusGroups[order.status].push(order);
  });

  // Calculate last Cooking order's remaining time (last one in the cooking array)
  if (statusGroups.cooking.length > 0) {
    const lastCookingOrder = statusGroups.cooking[statusGroups.cooking.length - 1];
    const elapsed = Math.floor((Date.now() - lastCookingOrder.createdAt) / 1000);
    lastCookingRemainingSeconds = 15 * 60 - elapsed;
    if (lastCookingRemainingSeconds < 0) lastCookingRemainingSeconds = 0;
  } else {
    lastCookingRemainingSeconds = 0;
  }

  let html = '';
  
  // Render each status group as a separate row/section
  const statusLabels = {
    cooking: '🔥 Cooking',
    pending: '⏳ Waiting',
    completed: '✓ Done'
  };

  ['cooking', 'pending', 'completed'].forEach(status => {
    if (statusGroups[status].length === 0) return;
    
    html += `<div class="kitchen-status-row" data-status="${status}">`;
    html += `<div class="kitchen-status-label">${statusLabels[status]}</div>`;
    html += `<div class="kitchen-status-cards">`;
    
    statusGroups[status].forEach(order => {
      const time = new Date(order.createdAt).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });

      let itemsHtml = '';
      order.items.forEach(item => {
        itemsHtml += `
          <div class="order-card-item">
            <span class="order-card-item-qty">${item.quantity}x</span>
            <span class="order-card-item-name">${item.name}</span>
          </div>
        `;
      });

      const promiseMinutes = order.promiseTime || 0;
      let timerHtml = '';
      let remainingHtml = '';
      
      if (promiseMinutes > 0) {
        // Promise order: show countdown
        const countdown = formatPromiseCountdown(order.createdAt, promiseMinutes);
        timerHtml = `<span class="order-timer">${countdown}</span>`;
      } else if (status === 'cooking') {
        const elapsedTime = formatElapsedTime(order.createdAt);
        const remainingTime = formatRemainingTime(order.createdAt, false);
        timerHtml = `<span class="order-timer">${elapsedTime}</span><span class="order-remaining">${remainingTime}</span>`;
      } else if (status === 'pending') {
        const elapsedTime = formatElapsedTime(order.createdAt);
        const remainingTime = formatRemainingTime(order.createdAt, true, promiseMinutes);
        timerHtml = `<span class="order-timer">${elapsedTime}</span><span class="order-remaining pending-remaining">${remainingTime}</span>`;
      }
      
      html += `
        <div class="order-card ${order.status}"
             data-created-at="${order.createdAt}"
             data-promise-time="${promiseMinutes}"
             onclick="handleOrderClick('${order.id}', event)"
             ondblclick="handleOrderDoubleClick('${order.id}')">
          <div class="order-card-header">
            <span class="order-card-number">#${order.orderNumber}</span>
            <span class="order-card-status">${statusLabels[status]}</span>
          </div>
          <div class="order-card-items">
            ${itemsHtml}
          </div>
          <div class="order-card-footer">
            ${timerHtml}
            <span class="order-card-total">€${order.total.toFixed(2)}</span>
          </div>
        </div>
      `;
    });
    
    html += `</div></div>`;
  });

  grid.innerHTML = html || `
    <div class="empty-orders">
      <div class="empty-orders-icon">📋</div>
      <div>No orders</div>
    </div>
  `;
}

function setkitchenFilter(filter) {
  kitchenFilter = filter;

  // Update filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  renderOrders();
}

async function handleOrderClick(orderId, event) {
  // Single click: toggle pending -> cooking
  const order = (await DB.getAllOrders()).find(o => o.id === orderId);
  if (!order) return;

  if (order.status === 'pending') {
    await DB.updateOrderStatus(orderId, 'cooking');
    await renderOrders();
  }
}

async function handleOrderDoubleClick(orderId) {
  // Double click: toggle cooking -> completed
  const order = (await DB.getAllOrders()).find(o => o.id === orderId);
  if (!order) return;

  if (order.status === 'cooking') {
    await DB.updateOrderStatus(orderId, 'completed');
    await renderOrders();
  }
}

// ==================== PWA SETUP ====================
function setupInstallPrompt() {
  let deferredPrompt;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    const prompt = document.getElementById('installPrompt');
    if (prompt) {
      prompt.classList.add('show');

      document.getElementById('installBtn').onclick = async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          console.log(`User response: ${outcome}`);
          deferredPrompt = null;
          prompt.classList.remove('show');
        }
      };

      document.getElementById('dismissInstall').onclick = () => {
        prompt.classList.remove('show');
      };
    }
  });
}

function setupOfflineDetection() {
  const banner = document.getElementById('offlineBanner');

  function updateOnlineStatus() {
    if (navigator.onLine) {
      banner.classList.remove('show');
    } else {
      banner.classList.add('show');
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

// ==================== EXPORTED GLOBALS ====================
window.addToOrder = addToOrder;
window.removeFromOrder = removeFromOrder;
window.clearOrder = clearOrder;
window.completeOrder = completeOrder;
window.setPromiseTime = setPromiseTime;
window.showHistory = showHistory;
window.showReceiptFromHistory = showReceiptFromHistory;
window.shareHistoryReceipt = shareHistoryReceipt;
window.closeHistory = closeHistory;
window.deleteHistoryOrder = deleteHistoryOrder;
window.exportTodayOrders = exportTodayOrders;
window.showReceipt = showReceipt;
window.closeReceipt = closeReceipt;
window.startReceiptAutoCloseTimer = startReceiptAutoCloseTimer;
window.resetReceiptAutoCloseTimer = resetReceiptAutoCloseTimer;
window.printReceipt = printReceipt;
window.sendReceiptEmail = shareReceipt; // Alias: sendReceiptEmail -> shareReceipt (uses mailto fallback)
window.shareReceipt = shareReceipt;
window.downloadReceiptImage = downloadReceiptImage;
window.newOrder = newOrder;
window.scaleReceiptToFit = scaleReceiptToFit;
window.showProductEditor = showProductEditor;
window.closeProductEditor = closeProductEditor;
window.saveProduct = saveProduct;
window.deleteProduct = deleteProduct;
window.addNewProduct = addNewProduct;
window.resetAllProducts = resetAllProducts;
window.setkitchenFilter = setkitchenFilter;
window.handleOrderClick = handleOrderClick;
window.handleOrderDoubleClick = handleOrderDoubleClick;
window.closeAllModals = closeAllModals;

// ==================== SPLIT VIEW ====================
let splitViewActive = false;
let splitViewPolling = null;
let isDragging = false;

function toggleSplitView() {
  const container = document.getElementById('splitViewContainer');
  const mainContent = document.getElementById('mainContent'); // Only exists on index.html
  const header = document.querySelector('.header');
  const todaySales = document.querySelector('.today-sales');

  // Check if split view is supported on this page
  if (!container) {
    console.log('Split view not available on this page');
    return;
  }

  splitViewActive = !splitViewActive;

  if (splitViewActive) {
    // Hide main content and header, show split view
    if (mainContent) mainContent.style.display = 'none';
    if (header) header.style.display = 'none';
    if (todaySales) todaySales.style.display = 'none';
    container.classList.remove('hidden');

    // Setup draggable divider
    setupDraggableDivider();
  } else {
    // Hide split view, show main content and header
    container.classList.add('hidden');
    if (mainContent) mainContent.style.display = '';
    if (header) header.style.display = '';
    if (todaySales) todaySales.style.display = '';
  }
}

function setupDraggableDivider() {
  const divider = document.getElementById('splitDivider');
  const content = document.getElementById('splitViewContent');
  const leftPane = document.getElementById('splitPaneLeft');
  const rightPane = document.getElementById('splitPaneRight');

  if (!divider) return;

  // Prevent duplicate event listeners
  if (divider.dataset.setup) return;
  divider.dataset.setup = 'true';

  let dragStartX = 0;
  let dragStartLeftFlex = 0;

  function handleMouseMove(e) {
    if (!isDragging) return;

    const deltaX = e.clientX - dragStartX;
    const totalWidth = content.getBoundingClientRect().width;
    const startPercent = (dragStartLeftFlex / totalWidth) * 100;
    
    let percentage = startPercent + (deltaX / totalWidth) * 100;
    percentage = Math.max(20, Math.min(80, percentage));

    leftPane.style.flex = `0 0 ${percentage}%`;
    rightPane.style.flex = `0 0 ${100 - percentage}%`;
  }

  function handleMouseUp() {
    isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', handleMouseMove, true);
    window.removeEventListener('mouseup', handleMouseUp, true);
  }

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartLeftFlex = leftPane.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp, true);
  });

  // Touch support
  divider.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDragging = true;
    dragStartX = e.touches[0].clientX;
    dragStartLeftFlex = leftPane.getBoundingClientRect().width;
  }, { passive: false });

  divider.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    e.preventDefault();

    const deltaX = e.touches[0].clientX - dragStartX;
    const totalWidth = content.getBoundingClientRect().width;
    const startPercent = (dragStartLeftFlex / totalWidth) * 100;

    let percentage = startPercent + (deltaX / totalWidth) * 100;
    percentage = Math.max(20, Math.min(80, percentage));

    leftPane.style.flex = `0 0 ${percentage}%`;
    rightPane.style.flex = `0 0 ${100 - percentage}%`;
  }, { passive: false });

  divider.addEventListener('touchend', () => {
    isDragging = false;
  });
}

// Export split view function
window.toggleSplitView = toggleSplitView;
window.setupDraggableDivider = setupDraggableDivider;

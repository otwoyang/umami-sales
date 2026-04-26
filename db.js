// Umami Sales PWA - Supabase + IndexedDB Hybrid Database Module
// Uses Supabase as primary cloud database, IndexedDB as local cache

// ==================== SUPABASE CONFIG ====================
const SUPABASE_URL = 'https://rkydycctjpafgtdwwxqd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJreWR5Y2N0anBhZmd0ZHd3eHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwOTU3NjUsImV4cCI6MjA2MjY3MTc2NX0.2Ue9R5z9dXj9V5e7R8pTj1nY4wX6qB3mK8cL2sN9dQ0';

// Supabase REST API helper
async function supabaseRequest(table, options = {}) {
  const { method = 'GET', body = null, params = {} } = options;
  
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  
  // Build query params
  const queryParts = [];
  if (options.select) queryParts.push(`select=${options.select}`);
  if (options.order) queryParts.push(`order=${options.order}`);
  if (options.limit) queryParts.push(`limit=${options.limit}`);
  if (params.where) {
    Object.entries(params.where).forEach(([key, value]) => {
      queryParts.push(`${key}=eq.${encodeURIComponent(value)}`);
    });
  }
  if (queryParts.length > 0) {
    url += '?' + queryParts.join('&');
  }
  
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : ''
  };
  
  const fetchOptions = { method, headers };
  if (body) fetchOptions.body = JSON.stringify(body);
  
  try {
    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    return { data, error: null };
  } catch (error) {
    console.error(`Supabase ${method} ${table} error:`, error);
    return { data: null, error: error.message };
  }
}

// ==================== INDEXEDDB (Local Cache) ====================
const DB_NAME = 'UmamiSalesDB_v2';
const DB_VERSION = 1;

let dbInstance = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(new Error('Failed to open database'));
    
    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('orders')) {
        const ordersStore = db.createObjectStore('orders', { keyPath: 'id' });
        ordersStore.createIndex('status', 'status');
        ordersStore.createIndex('createdAt', 'createdAt');
      }
      
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

// IndexedDB helper functions
async function idbGetAll(storeName) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(storeName, data) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbClear(storeName) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==================== PRODUCTS ====================

async function getAllProducts() {
  // Try Supabase first
  const result = await supabaseRequest('products', { 
    select: '*',
    order: 'sort_order'
  });
  
  if (result.data && result.data.length > 0) {
    // Update local cache
    await idbClear('products');
    const products = result.data.map(p => ({
      id: p.id,
      name: p.name,
      price: parseFloat(p.price),
      taxPercent: parseFloat(p.tax_percent),
      category: p.category,
      sortOrder: p.sort_order,
      isActive: p.is_active,
      createdAt: new Date(p.created_at).getTime(),
      updatedAt: new Date(p.updated_at).getTime()
    }));
    for (const p of products) {
      await idbPut('products', p);
    }
    return products;
  }
  
  // Fallback to local cache
  return idbGetAll('products');
}

async function initializeDefaultProducts() {
  const products = await getAllProducts();
  
  if (products.length > 0) {
    console.log('[DEBUG] Loaded', products.length, 'products from cloud');
    return products;
  }
  
  console.log('[DEBUG] No products in cloud, using defaults');
  // If cloud is empty, return empty (shouldn't happen with seeded data)
  return [];
}

// ==================== ORDERS ====================

async function getAllOrders() {
  // Try Supabase first
  const result = await supabaseRequest('orders', { 
    select: '*',
    order: 'created_at'
  });
  
  if (result.data && result.data.length > 0) {
    // Update local cache
    await idbClear('orders');
    const orders = result.data.map(o => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
      subtotal: parseFloat(o.subtotal),
      vat: parseFloat(o.vat),
      total: parseFloat(o.total),
      paymentMethod: o.payment_method,
      promiseTime: o.promise_time,
      createdAt: new Date(o.created_at).getTime(),
      updatedAt: new Date(o.updated_at).getTime(),
      completedAt: o.completed_at ? new Date(o.completed_at).getTime() : null
    }));
    for (const o of orders) {
      await idbPut('orders', o);
    }
    return orders;
  }
  
  // Fallback to local cache
  return idbGetAll('orders');
}

async function addOrder(orderData) {
  const orderId = generateUUID();
  const now = new Date();
  const orderNumber = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
  ].join('');
  
  const order = {
    id: orderId,
    order_number: orderNumber,
    status: 'pending',
    items: orderData.items,
    subtotal: orderData.subtotal,
    vat: orderData.vat,
    total: orderData.total,
    payment_method: orderData.paymentMethod || 'cash',
    promise_time: orderData.promiseTime || 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null
  };
  
  // Save to Supabase
  const result = await supabaseRequest('orders', {
    method: 'POST',
    body: order
  });
  
  if (result.error) {
    console.error('Failed to save order to cloud:', result.error);
  }
  
  // Also save locally
  const localOrder = {
    id: orderId,
    orderNumber: orderNumber,
    status: 'pending',
    items: orderData.items,
    subtotal: orderData.subtotal,
    vat: orderData.vat,
    total: orderData.total,
    paymentMethod: orderData.paymentMethod,
    promiseTime: orderData.promiseTime,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    completedAt: null
  };
  await idbPut('orders', localOrder);
  
  return localOrder;
}

async function updateOrderStatus(orderId, newStatus) {
  const now = new Date();
  const updateData = {
    status: newStatus,
    updated_at: now.toISOString()
  };
  
  if (newStatus === 'completed') {
    updateData.completed_at = now.toISOString();
  }
  
  // Update in Supabase
  await supabaseRequest('orders', {
    method: 'PATCH',
    params: { where: { id: orderId } },
    body: updateData
  });
  
  // Update locally
  const orders = await idbGetAll('orders');
  const order = orders.find(o => o.id === orderId);
  if (order) {
    order.status = newStatus;
    order.updatedAt = now.getTime();
    if (newStatus === 'completed') {
      order.completedAt = now.getTime();
    }
    await idbPut('orders', order);
    return order;
  }
  
  return null;
}

async function getTodayOrders() {
  const orders = await getAllOrders();
  const today = new Date().toDateString();
  
  return orders.filter(order => {
    const orderDate = new Date(order.createdAt).toDateString();
    return orderDate === today && order.status !== 'deleted';
  });
}

async function getTodaySales() {
  const orders = await getTodayOrders();
  return orders.reduce((sum, order) => sum + order.total, 0);
}

async function deleteOrder(orderId) {
  return updateOrderStatus(orderId, 'deleted');
}

// ==================== SETTINGS ====================

async function getSetting(key) {
  const result = await supabaseRequest('settings', {
    params: { where: { key: key } }
  });
  
  if (result.data && result.data.length > 0) {
    return result.data[0].value;
  }
  
  // Fallback
  const settings = await idbGetAll('settings');
  const setting = settings.find(s => s.key === key);
  return setting?.value;
}

async function setSetting(key, value) {
  // Save to Supabase
  await supabaseRequest('settings', {
    method: 'POST',
    body: { key, value, updated_at: new Date().toISOString() }
  });
  
  // Save locally
  await idbPut('settings', { key, value, updatedAt: Date.now() });
}

// ==================== CONFIG ====================
const STORE_CONFIG = {
  companyName: 'Guaimost Oy',
  storeName: 'Umami Sushi',
  yTunnus: '3287298-9',
  vatNumber: 'FI 32872989',
  email: 'guaimost@gmail.com',
  address: ''
};

// ==================== EXPORT ====================
window.DB = {
  initDB,
  // Orders
  addOrder,
  getAllOrders,
  getTodayOrders,
  updateOrderStatus,
  deleteOrder,
  getTodaySales,
  // Products
  getAllProducts,
  initializeDefaultProducts,
  // Settings
  getSetting,
  setSetting,
  // Config
  STORE_CONFIG,
  // For compatibility
  getOrdersByStatus: async (status) => {
    const orders = await getAllOrders();
    return orders.filter(o => o.status === status);
  }
};

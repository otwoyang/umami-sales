// Umami Sales PWA - Supabase + IndexedDB Hybrid Database Module
// Uses Supabase as primary cloud database, IndexedDB as local cache
// With automatic cloud sync and retry mechanism

// ==================== SUPABASE CONFIG ====================
const SUPABASE_URL = 'https://rkydycctjpafgtdwwxqd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJreWR5Y2N0anBhZmd0ZHd3eHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwOTU3NjUsImV4cCI6MjA2MjY3MTc2NX0.2Ue9R5z9dXj9V5e7R8pTj1nY4wX6qB3mK8cL2sN9dQ0';

// ==================== SYNC STATUS TRACKING ====================
// Track sync status per order: 'pending' (not synced), 'syncing', 'synced', 'failed'
const SYNC_STORE_NAME = 'syncQueue';

// ==================== SUPABASE HELPERS ====================

// Supabase REST API helper with retry
async function supabaseRequest(table, options = {}, retries = 3) {
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
  
  // Retry logic
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      return { data, error: null };
    } catch (error) {
      console.log(`[Supabase] ${method} ${table} attempt ${attempt}/${retries} failed:`, error.message);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
      } else {
        console.error(`Supabase ${method} ${table} error:`, error);
        return { data: null, error: error.message };
      }
    }
  }
}

// Upload single order to cloud (used by sync queue)
async function uploadOrderToCloud(order) {
  const cloudOrder = {
    id: order.id,
    order_number: order.orderNumber,
    status: order.status,
    items: order.items,
    subtotal: order.subtotal,
    vat: order.vat,
    total: order.total,
    payment_method: order.paymentMethod || 'cash',
    promise_time: order.promiseTime || 0,
    created_at: new Date(order.createdAt).toISOString(),
    updated_at: new Date(order.updatedAt).toISOString(),
    completed_at: order.completedAt ? new Date(order.completedAt).toISOString() : null
  };
  
  const result = await supabaseRequest('orders', {
    method: 'POST',
    body: cloudOrder
  });
  
  return result;
}

// Check if order exists in cloud
async function checkCloudOrderExists(orderId) {
  const result = await supabaseRequest('orders', {
    params: { where: { id: orderId } }
  });
  return result.data && result.data.length > 0;
}

// ==================== SYNC QUEUE (IndexedDB) ====================

function initSyncDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // Version 2 for new store
    request.onerror = () => reject(new Error('Failed to open sync database'));
    request.onsuccess = (event) => resolve(event.target.result);
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
      // New store for sync queue
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'orderId' });
      }
    };
  });
}

async function addToSyncQueue(orderId) {
  const db = await initSyncDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const request = store.put({
      orderId: orderId,
      addedAt: Date.now(),
      retryCount: 0
    });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeFromSyncQueue(orderId) {
  const db = await initSyncDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const request = store.delete(orderId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getSyncQueue() {
  const db = await initSyncDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readonly');
    const store = tx.objectStore('syncQueue');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Process sync queue - call this periodically
let isProcessingSyncQueue = false;

async function processSyncQueue() {
  if (isProcessingSyncQueue) return;
  isProcessingSyncQueue = true;
  
  try {
    const queue = await getSyncQueue();
    if (queue.length === 0) return;
    
    console.log(`[Sync] Processing ${queue.length} orders in sync queue`);
    
    for (const item of queue) {
      try {
        // Check if order has been in queue long enough (2 second delay)
        const timeInQueue = Date.now() - item.addedAt;
        if (timeInQueue < 2000) {
          console.log(`[Sync] Order ${item.orderId} waiting for delay (${Math.ceil((2000-timeInQueue)/1000)}s remaining)`);
          continue;
        }
        
        // Get order from local DB
        const orders = await idbGetAll('orders');
        const order = orders.find(o => o.id === item.orderId);
        
        if (!order) {
          // Order doesn't exist locally, remove from queue
          await removeFromSyncQueue(item.orderId);
          console.log(`[Sync] Order ${item.orderId} not found locally, removed from queue`);
          continue;
        }
        
        // Check if already in cloud
        const exists = await checkCloudOrderExists(item.orderId);
        if (exists) {
          await removeFromSyncQueue(item.orderId);
          console.log(`[Sync] Order ${item.orderId} already in cloud, removed from queue`);
          continue;
        }
        
        // Try to upload
        const result = await uploadOrderToCloud(order);
        if (result.error) {
          console.error(`[Sync] Failed to upload order ${item.orderId}:`, result.error);
          // Keep in queue for retry
        } else {
          await removeFromSyncQueue(item.orderId);
          console.log(`[Sync] Order ${item.orderId} synced successfully`);
        }
      } catch (err) {
        console.error(`[Sync] Error processing order ${item.orderId}:`, err);
      }
    }
  } finally {
    isProcessingSyncQueue = false;
  }
}

// Start periodic sync check
let syncInterval = null;

function startSyncScheduler() {
  if (syncInterval) return;
  
  // Process immediately on start (will process all pending orders)
  setTimeout(processSyncQueue, 2000);
  
  // Then check every 30 seconds
  syncInterval = setInterval(processSyncQueue, 30000);
  console.log('[Sync] Scheduler started - will check every 30 seconds');
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

// Default products (hardcoded fallback)
const DEFAULT_PRODUCTS = [
  { id: 'p1', name: 'Pieni Sushi', price: 11.50, taxPercent: 13.5, category: 'sushi', sortOrder: 1, isActive: true },
  { id: 'p2', name: 'Pieni+ Sushi', price: 14.00, taxPercent: 13.5, category: 'sushi', sortOrder: 2, isActive: true },
  { id: 'p3', name: 'Medium Sushi', price: 16.50, taxPercent: 13.5, category: 'sushi', sortOrder: 3, isActive: true },
  { id: 'p4', name: 'Iso Sushi', price: 19.50, taxPercent: 13.5, category: 'sushi', sortOrder: 4, isActive: true },
  { id: 'p5', name: 'Drink', price: 2.00, taxPercent: 13.5, category: 'drink', sortOrder: 5, isActive: true },
  { id: 'p6', name: 'Nigri', price: 1.80, taxPercent: 13.5, category: 'drink', sortOrder: 6, isActive: true },
  { id: 'p7', name: '*Take away', price: 0, taxPercent: 0, category: 'addon', sortOrder: 7, isActive: true },
  { id: 'p8', name: '-Student', price: 0, taxPercent: 0, category: 'discount', sortOrder: 8, isActive: true },
  { id: 'p9', name: '-Vege', price: 0, taxPercent: 0, category: 'discount', sortOrder: 9, isActive: true },
  { id: 'p10', name: '-Vegan', price: 0, taxPercent: 0, category: 'discount', sortOrder: 10, isActive: true },
  { id: 'p11', name: '-All Fry', price: 0, taxPercent: 0, category: 'discount', sortOrder: 11, isActive: true },
  { id: 'p12', name: '-All Raw', price: 0, taxPercent: 0, category: 'discount', sortOrder: 12, isActive: true },
  { id: 'p13', name: '-No Mayo', price: 0, taxPercent: 0, category: 'discount', sortOrder: 13, isActive: true },
  { id: 'p14', name: '-No Dessert', price: 0, taxPercent: 0, category: 'discount', sortOrder: 14, isActive: true },
  { id: 'p15', name: '-No Tofu(GF)', price: 0, taxPercent: 0, category: 'discount', sortOrder: 15, isActive: true }
];

async function getAllProducts() {
  try {
    // Try Supabase first
    const result = await supabaseRequest('products', { 
      select: '*',
      order: 'sort_order'
    });
    
    if (result.data && result.data.length > 0) {
      console.log('[Products] Loaded', result.data.length, 'products from cloud');
      // Update local cache
      await idbClear('products');
      const products = result.data.map(p => ({
        id: p.id,
        name: p.name,
        price: parseFloat(p.price),
        taxPercent: parseFloat(p.tax_percent || 13.5),
        category: p.category,
        sortOrder: parseInt(p.sort_order) || 0,
        isActive: p.is_active !== false,
        createdAt: new Date(p.created_at).getTime(),
        updatedAt: new Date(p.updated_at).getTime()
      }));
      for (const p of products) {
        await idbPut('products', p);
      }
      return products;
    }
  } catch (err) {
    console.log('[Products] Cloud fetch error:', err.message);
  }
  
  console.log('[Products] Trying local cache...');
  // Fallback to local cache
  try {
    const localProducts = await idbGetAll('products');
    if (localProducts.length > 0) {
      console.log('[Products] Loaded', localProducts.length, 'products from local cache');
      return localProducts;
    }
  } catch (err) {
    console.log('[Products] Local cache error:', err.message);
  }
  
  // Last resort: use defaults
  console.log('[Products] No products found, using defaults');
  try {
    for (const p of DEFAULT_PRODUCTS) {
      await idbPut('products', { ...p, createdAt: Date.now(), updatedAt: Date.now() });
    }
  } catch (err) {
    console.log('[Products] Failed to save defaults to cache:', err.message);
  }
  return DEFAULT_PRODUCTS.map(p => ({ ...p, createdAt: Date.now(), updatedAt: Date.now() }));
}

async function initializeDefaultProducts() {
  try {
    const products = await getAllProducts();
    
    if (products.length > 0) {
      console.log('[DEBUG] Loaded', products.length, 'products');
      return products;
    }
  } catch (err) {
    console.error('[DEBUG] getAllProducts failed:', err);
  }
  
  console.log('[DEBUG] Using hardcoded defaults');
  return DEFAULT_PRODUCTS.map(p => ({ ...p, createdAt: Date.now(), updatedAt: Date.now() }));
}

// ==================== ORDERS ====================

async function getAllOrders() {
  // Try Supabase first
  const result = await supabaseRequest('orders', { 
    select: '*',
    order: 'created_at'
  });
  
  if (result.data && result.data.length > 0) {
    console.log('[Orders] Loaded', result.data.length, 'orders from cloud');
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
      promiseTime: o.promise_time || 0,
      createdAt: new Date(o.created_at).getTime(),
      updatedAt: new Date(o.updated_at).getTime(),
      completedAt: o.completed_at ? new Date(o.completed_at).getTime() : null
    }));
    for (const o of orders) {
      await idbPut('orders', o);
    }
    return orders;
  }
  
  console.log('[Orders] Cloud fetch failed or empty, using local cache');
  // Fallback to local cache (NEVER return empty if local has data)
  const localOrders = await idbGetAll('orders');
  if (localOrders.length > 0) {
    console.log('[Orders] Loaded', localOrders.length, 'orders from local cache');
  }
  return localOrders;
}

async function addOrder(orderData) {
  const orderId = generateUUID();
  const now = new Date();
  // Format: YYYYMMDDHHMMSS + random suffix (2 digits) to ensure uniqueness
  const randomSuffix = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const orderNumber = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
    randomSuffix
  ].join('');

  // Create local order first
  const localOrder = {
    id: orderId,
    orderNumber: orderNumber,
    status: 'pending',
    items: orderData.items,
    subtotal: orderData.subtotal,
    vat: orderData.vat,
    total: orderData.total,
    paymentMethod: orderData.paymentMethod || 'cash',
    promiseTime: orderData.promiseTime || 0,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    completedAt: null
  };

  // Save to local IndexedDB immediately
  await idbPut('orders', localOrder);
  
  // Add to sync queue for delayed cloud upload
  await addToSyncQueue(orderId);
  
  console.log(`[Order] Order #${orderNumber} saved locally, will sync to cloud in 2 seconds`);

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
  // Sync
  startSyncScheduler,
  processSyncQueue,
  // For compatibility
  getOrdersByStatus: async (status) => {
    const orders = await getAllOrders();
    return orders.filter(o => o.status === status);
  }
};

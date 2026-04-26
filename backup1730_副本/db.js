// Umami Sales PWA - IndexedDB Database Module

const DB_NAME = 'UmamiSalesDB';
const DB_VERSION = 1;

// Store configurations
const STORES = {
  orders: {
    keyPath: 'id',
    indexes: [
      { name: 'status', keyPath: 'status' },
      { name: 'createdAt', keyPath: 'createdAt' },
      { name: 'orderNumber', keyPath: 'orderNumber' }
    ]
  },
  products: {
    keyPath: 'id',
    indexes: [
      { name: 'category', keyPath: 'category' },
      { name: 'sortOrder', keyPath: 'sortOrder' }
    ]
  },
  settings: {
    keyPath: 'key'
  }
};

let dbInstance = null;

// Initialize database
function initDB() {
  return new Promise((resolve, reject) => {
    // Always open a fresh connection on iOS Safari
    // to avoid issues with closed connections
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open database'));
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create stores
      if (!db.objectStoreNames.contains('orders')) {
        const ordersStore = db.createObjectStore('orders', { keyPath: 'id' });
        ordersStore.createIndex('status', 'status', { unique: false });
        ordersStore.createIndex('createdAt', 'createdAt', { unique: false });
        ordersStore.createIndex('orderNumber', 'orderNumber', { unique: false });
      }

      if (!db.objectStoreNames.contains('products')) {
        const productsStore = db.createObjectStore('products', { keyPath: 'id' });
        productsStore.createIndex('category', 'category', { unique: false });
        productsStore.createIndex('sortOrder', 'sortOrder', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
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

// ==================== ORDERS ====================

// Generate order number based on date+time: YYYYMMDDHHMI
function generateOrderNumber() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
  ].join('');
}

// Add a new order
async function addOrder(orderData) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['orders'], 'readwrite');
    const ordersStore = transaction.objectStore('orders');

    const order = {
      id: generateUUID(),
      orderNumber: generateOrderNumber(),
      status: 'pending',
      items: orderData.items,
      subtotal: orderData.subtotal,
      vat: orderData.vat,
      total: orderData.total,
      paymentMethod: orderData.paymentMethod,
      promiseTime: orderData.promiseTime || 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null
    };

    const addReq = ordersStore.add(order);
    addReq.onsuccess = () => {
      resolve(order);
    };
    addReq.onerror = () => {
      reject(new Error('Failed to add order'));
    };
  });
}

// Get all orders
async function getAllOrders() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('orders', 'readonly');
    const store = transaction.objectStore('orders');
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error('Failed to get orders'));
    };
  });
}

// Get orders by status
async function getOrdersByStatus(status) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('orders', 'readonly');
    const store = transaction.objectStore('orders');
    const index = store.index('status');
    const request = index.getAll(status);

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error('Failed to get orders by status'));
    };
  });
}

// Get today's orders (non-deleted)
async function getTodayOrders() {
  const orders = await getAllOrders();
  const today = new Date().toDateString();

  return orders.filter(order => {
    const orderDate = new Date(order.createdAt).toDateString();
    return orderDate === today && order.status !== 'deleted';
  });
}

// Update order status
async function updateOrderStatus(orderId, newStatus) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('orders', 'readwrite');
    const store = transaction.objectStore('orders');
    const getReq = store.get(orderId);

    getReq.onsuccess = () => {
      const order = getReq.result;
      if (!order) {
        reject(new Error('Order not found'));
        return;
      }

      order.status = newStatus;
      order.updatedAt = Date.now();
      if (newStatus === 'completed') {
        order.completedAt = Date.now();
      }

      const putReq = store.put(order);
      putReq.onsuccess = () => {
        resolve(order);
      };
      putReq.onerror = () => {
        reject(new Error('Failed to update order'));
      };
    };
  });
}

// Soft delete order
async function deleteOrder(orderId) {
  return updateOrderStatus(orderId, 'deleted');
}

// Get today's total sales
async function getTodaySales() {
  const orders = await getTodayOrders();
  return orders.reduce((sum, order) => sum + order.total, 0);
}

// ==================== PRODUCTS ====================

// Add a product
async function addProduct(productData) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readwrite');
    const store = transaction.objectStore('products');

    const product = {
      id: generateUUID(),
      ...productData,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const addReq = store.add(product);
    addReq.onsuccess = () => {
      resolve(product);
    };
    addReq.onerror = () => {
      reject(new Error('Failed to add product'));
    };
  });
}

// Get all products
async function getAllProducts() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readonly');
    const store = transaction.objectStore('products');
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error('Failed to get products'));
    };
  });
}

// Get active products sorted by sortOrder
async function getActiveProducts() {
  const products = await getAllProducts();
  return products
    .filter(p => p.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// Update product
async function updateProduct(productId, updates) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readwrite');
    const store = transaction.objectStore('products');
    const getReq = store.get(productId);

    getReq.onsuccess = () => {
      const product = getReq.result;
      if (!product) {
        reject(new Error('Product not found'));
        return;
      }

      const updatedProduct = {
        ...product,
        ...updates,
        id: productId,
        updatedAt: Date.now()
      };

      const putReq = store.put(updatedProduct);
      putReq.onsuccess = () => {
        resolve(updatedProduct);
      };
      putReq.onerror = () => {
        reject(new Error('Failed to update product'));
      };
    };
  });
}

// Delete product
async function deleteProduct(productId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('products', 'readwrite');
    const store = transaction.objectStore('products');
    const deleteReq = store.delete(productId);

    deleteReq.onsuccess = () => {
      resolve();
    };
    deleteReq.onerror = () => {
      reject(new Error('Failed to delete product'));
    };
  });
}

// Initialize default products
// Use IndexedDB setting + sessionStorage to prevent race conditions between iframes
const PRODUCTS_INIT_KEY = 'productsInitialized';

// Force reset products - declare early so it's available immediately
window.forceResetProducts = async function forceResetProducts() {
  console.log('[FORCE RESET] Starting...');
  
  // Clear products
  const db = await initDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite');
    const req = tx.objectStore('products').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    req.onerror = () => reject(req.error);
  });
  
  // Clear initialization flags
  await setSetting(PRODUCTS_INIT_KEY, false);
  try { sessionStorage.removeItem('productsInitLock'); } catch(e) {}
  
  console.log('[FORCE RESET] Done. Reloading...');
  location.reload();
};

async function initializeDefaultProducts() {
  // First check: sessionStorage lock to prevent race conditions between iframes
  try {
    if (sessionStorage.getItem('productsInitLock') === 'true') {
      console.log('[DEBUG] Another page is initializing products, waiting...');
      // Wait and then return products
      await new Promise(resolve => setTimeout(resolve, 2000));
      const products = await getAllProducts();
      console.log('[DEBUG] Returning products after wait:', products.length);
      return products;
    }
    sessionStorage.setItem('productsInitLock', 'true');
  } catch(e) {
    console.log('[DEBUG] sessionStorage not available');
  }
  
  // Check existing products FIRST - before any initialization logic
  const existingProducts = await getAllProducts();
  const expectedCount = 15; // We expect exactly 15 products
  
  console.log('[DEBUG] initializeDefaultProducts - existing products:', existingProducts.length, 'expected:', expectedCount);
  
  // CRITICAL: If we have 15 products (or more), just return them - DO NOT reinitialize
  // This prevents duplicate products from being added
  if (existingProducts.length >= expectedCount) {
    console.log('[DEBUG] Already have', existingProducts.length, 'products, using existing. No reinitialization needed.');
    try { sessionStorage.removeItem('productsInitLock'); } catch(e) {}
    return existingProducts;
  }
  
  // If we get here, we have < 15 products (either 0 or partial). Need to reset to 15.
  console.log('[DEBUG] Product count is', existingProducts.length, '- resetting to', expectedCount, 'defaults');

  // Clear existing products first
  const dbForClear = await initDB();
  await new Promise((resolve, reject) => {
    const tx = dbForClear.transaction('products', 'readwrite');
    const req = tx.objectStore('products').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    req.onerror = () => reject(req.error);
  });
  
  // Mark as initialized
  await setSetting(PRODUCTS_INIT_KEY, true);

  const defaultProducts = [
    { name: 'Pieni Sushi', price: 11.5, taxPercent: 13.5, category: 'sushi', sortOrder: 1, isActive: true },
    { name: 'Pieni+ Sushi', price: 14, taxPercent: 13.5, category: 'sushi', sortOrder: 2, isActive: true },
    { name: 'Medium Sushi', price: 16.5, taxPercent: 13.5, category: 'sushi', sortOrder: 3, isActive: true },
    { name: 'Iso Sushi', price: 19.5, taxPercent: 13.5, category: 'sushi', sortOrder: 4, isActive: true },
    { name: 'Drink', price: 2, taxPercent: 13.5, category: 'drink', sortOrder: 5, isActive: true },
    { name: 'Nigri', price: 1.8, taxPercent: 13.5, category: 'drink', sortOrder: 6, isActive: true },
    { name: '*Take away', price: 0, taxPercent: 13.5, category: 'addon', sortOrder: 7, isActive: true },
    { name: '-Student', price: 0, taxPercent: 13.5, category: 'discount', sortOrder: 8, isActive: true },
    { name: '-Vege', price: 0, taxPercent: 13.5, category: 'discount', sortOrder: 9, isActive: true },
    { name: '-Vegan', price: 0, taxPercent: 13.5, category: 'discount', sortOrder: 10, isActive: true },
    { name: '-All Fry', price: 0, taxPercent: 13.5, category: 'discount', sortOrder: 11, isActive: true },
    { name: '-All Raw', price: 0, taxPercent: 13.5, category: 'discount', sortOrder: 12, isActive: true },
    { name: '-No Mayo', price: 0, taxPercent: 13.5, category: 'discount', sortOrder: 13, isActive: true },
    { name: '-No Dessert', price: 0, taxPercent: 13.5, category: 'discount', sortOrder: 14, isActive: true },
    { name: '-No Tofu(GF)', price: 0, taxPercent: 13.5, category: 'discount', sortOrder: 15, isActive: true }
  ];

  const db = await initDB();
  const transaction = db.transaction('products', 'readwrite');
  const store = transaction.objectStore('products');
  const savedProducts = [];

  for (const product of defaultProducts) {
    const savedProduct = {
      id: generateUUID(),
      ...product,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    savedProducts.push(savedProduct);

    await new Promise((resolve, reject) => {
      const req = store.add(savedProduct);
      req.onsuccess = resolve;
      req.onerror = reject;
    });
  }

  // Mark as initialized in settings
  await setSetting(PRODUCTS_INIT_KEY, true);

  return savedProducts;
}

// ==================== SETTINGS ====================

// Get setting
async function getSetting(key) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readonly');
    const store = transaction.objectStore('settings');
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result?.value);
    };
    request.onerror = () => {
      reject(new Error('Failed to get setting'));
    };
  });
}

// Set setting
async function setSetting(key, value) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    const store = transaction.objectStore('settings');
    const request = store.put({ key, value, updatedAt: Date.now() });

    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(new Error('Failed to set setting'));
    };
  });
}

// Store configuration
const STORE_CONFIG = {
  companyName: 'Guaimost Oy',
  storeName: 'Umami Sushi',
  yTunnus: '3287298-9',
  vatNumber: 'FI 32872989',
  email: 'guaimost@gmail.com',
  address: ''
};

// Export all functions
window.DB = {
  initDB,
  // Orders
  addOrder,
  getAllOrders,
  getOrdersByStatus,
  getTodayOrders,
  updateOrderStatus,
  deleteOrder,
  getTodaySales,
  // Products
  addProduct,
  getAllProducts,
  getActiveProducts,
  updateProduct,
  deleteProduct,
  initializeDefaultProducts,
  // Settings
  getSetting,
  setSetting,
  // Config
  STORE_CONFIG
};

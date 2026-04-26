-- Create extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==================== PRODUCTS TABLE ====================
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    tax_percent DECIMAL(5, 2) NOT NULL DEFAULT 13.5,
    category TEXT NOT NULL DEFAULT 'sushi',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for active products sorted by sort_order
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ==================== ORDERS TABLE ====================
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cooking', 'completed', 'deleted')),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
    vat DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    promise_time INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for orders
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(DATE(created_at AT TIME ZONE 'Europe/Helsinki'));

-- ==================== SETTINGS TABLE ====================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================== FUNCTIONS ====================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for auto-updating updated_at
CREATE OR REPLACE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to generate order number (YYYYMMDDHHMI format)
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
    now_val TIMESTAMPTZ;
    order_num TEXT;
    today_count INTEGER;
BEGIN
    now_val := NOW() AT TIME ZONE 'Europe/Helsinki';
    
    -- Count orders today to add sequence number
    SELECT COUNT(*) + 1 INTO today_count
    FROM orders
    WHERE DATE(created_at AT TIME ZONE 'Europe/Helsinki') = DATE(now_val);
    
    order_num := TO_CHAR(now_val, 'YYYYMMDD') || TO_CHAR(now_val, 'HH24MI') || LPAD(today_count::TEXT, 2, '0');
    
    RETURN order_num;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Allow all operations for authenticated users (for now)
CREATE POLICY "Allow all for authenticated users" ON products
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON orders
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all for authenticated users" ON settings
    FOR ALL USING (auth.role() = 'authenticated');

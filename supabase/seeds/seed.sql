-- Seed default products for Umami Sales

-- Clear existing products first
DELETE FROM products WHERE true;

-- Insert default products
INSERT INTO products (name, price, tax_percent, category, sort_order, is_active) VALUES
    ('Pieni Sushi', 11.50, 13.5, 'sushi', 1, true),
    ('Pieni+ Sushi', 14.00, 13.5, 'sushi', 2, true),
    ('Medium Sushi', 16.50, 13.5, 'sushi', 3, true),
    ('Iso Sushi', 19.50, 13.5, 'sushi', 4, true),
    ('Drink', 2.00, 13.5, 'drink', 5, true),
    ('Nigri', 1.80, 13.5, 'drink', 6, true),
    ('*Take away', 0.00, 13.5, 'addon', 7, true),
    ('-Student', 0.00, 13.5, 'discount', 8, true),
    ('-Vege', 0.00, 13.5, 'discount', 9, true),
    ('-Vegan', 0.00, 13.5, 'discount', 10, true),
    ('-All Fry', 0.00, 13.5, 'discount', 11, true),
    ('-All Raw', 0.00, 13.5, 'discount', 12, true),
    ('-No Mayo', 0.00, 13.5, 'discount', 13, true),
    ('-No Dessert', 0.00, 13.5, 'discount', 14, true),
    ('-No Tofu(GF)', 0.00, 13.5, 'discount', 15, true);

-- Seed default settings
DELETE FROM settings WHERE key IN ('storeConfig', 'vatRate');

INSERT INTO settings (key, value) VALUES
    ('storeConfig', '{"companyName":"Guaimost Oy","storeName":"Umami Sushi","yTunnus":"3287298-9","vatNumber":"FI 32872989","email":"guaimost@gmail.com","address":""}'::jsonb),
    ('vatRate', '13.5'::jsonb);

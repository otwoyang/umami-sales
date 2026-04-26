-- 清空 Umami Sales 所有表的数据
-- 在 Supabase Dashboard > SQL Editor 中执行

-- 1. 清空 orders 表
DELETE FROM orders;
-- 或者使用 TRUNCATE (如果支持)
-- TRUNCATE orders CASCADE;

-- 2. 清空 products 表
DELETE FROM products;

-- 3. 清空 settings 表
DELETE FROM settings;

-- 4. 清空 sync_queue 表 (如果有的话)
DELETE FROM sync_queue;

-- 重置自增ID (可选)
-- ALTER SEQUENCE orders_id_seq RESTART WITH 1;
-- ALTER SEQUENCE products_id_seq RESTART WITH 1;

-- 验证结果
SELECT 'orders count:' as table_name, COUNT(*) as count FROM orders
UNION ALL
SELECT 'products count:', COUNT(*) FROM products
UNION ALL
SELECT 'settings count:', COUNT(*) FROM settings;

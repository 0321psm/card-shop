const Database = require('better-sqlite3');
const path = require('path');

// 如果在雲端，存進永久硬碟；如果在電腦，存在目前資料夾
const dataDir = process.env.DATA_PATH || __dirname;
const dbPath = path.join(dataDir, 'cardshop.db');

// 開啟資料庫（better-sqlite3 不需要額外編譯）
const db = new Database(dbPath);

// 建立卡片表
db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 建立訂單表
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_nickname TEXT NOT NULL,
    items TEXT NOT NULL,
    total_price INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = db;
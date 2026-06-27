require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');

app.use(session({
  secret: 'your-secret-key-change-it',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

const uploadDir = process.env.DATA_PATH ? path.join(process.env.DATA_PATH, 'uploads') : path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
app.use('/uploads', express.static(uploadDir));

// ========== 前台 ==========
app.get('/', (req, res) => {
  db.all("SELECT * FROM cards ORDER BY id DESC", (err, cards) => {
    if (err) return res.send('資料庫錯誤');
    res.render('index', { cards });
  });
});

app.get('/checkout', (req, res) => {
  res.render('checkout');
});

app.post('/api/place-order', (req, res) => {
  const { nickname, items } = req.body;
  if (!nickname || !items) return res.json({ success: false, msg: '缺少資料' });

  const orderNumber = 'ORD-' + uuidv4().slice(0, 8).toUpperCase();
  const parsedItems = JSON.parse(items);
  const totalPrice = parsedItems.reduce((sum, i) => sum + (i.price * i.qty), 0);

  db.serialize(() => {
    const stmt = db.prepare("UPDATE cards SET stock = stock - ? WHERE card_code = ? AND stock >= ?");
    let canOrder = true;
    for (let item of parsedItems) {
      stmt.run([item.qty, item.card_code, item.qty], (err) => {
        if (err || this.changes === 0) canOrder = false;
      });
    }
    stmt.finalize();

    if (!canOrder) {
      return res.json({ success: false, msg: '庫存不足' });
    }

    db.run(
      `INSERT INTO orders (order_number, customer_nickname, items, total_price, status) VALUES (?, ?, ?, ?, 'pending')`,
      [orderNumber, nickname, JSON.stringify(parsedItems), totalPrice],
      function(err) {
        if (err) return res.json({ success: false, msg: '下單失敗' });
        res.json({ success: true, orderNumber });
      }
    );
  });
});

// ========== 後台 ==========
app.get('/admin', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin/dashboard');
  res.render('admin_login');
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    res.redirect('/admin/dashboard');
  } else {
    res.send('帳號或密碼錯誤 <a href="/admin">重新登入</a>');
  }
});

app.get('/admin/dashboard', (req, res) => {
  if (!req.session.isAdmin) return res.redirect('/admin');
  const msg = req.query.msg || '';
  db.all("SELECT * FROM cards ORDER BY id DESC", (err, cards) => {
    db.all("SELECT * FROM orders ORDER BY id DESC", (err2, orders) => {
      res.render('admin_dashboard', { cards, orders, msg });
    });
  });
});

app.post('/admin/add-card', upload.single('image'), (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const { card_code, name, category, price, stock } = req.body;
  const image_url = req.file ? '/uploads/' + req.file.filename : null;
  db.run(
    `INSERT INTO cards (card_code, name, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)`,
    [card_code, name, category, parseInt(price), parseInt(stock), image_url],
    (err) => {
      if (err) return res.send('新增失敗，編號可能重複：' + err.message);
      res.redirect('/admin/dashboard?msg=✅ 手動新增卡片成功！');
    }
  );
});

app.post('/admin/delete-card/:id', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  db.run("DELETE FROM cards WHERE id = ?", [req.params.id], () => {
    res.redirect('/admin/dashboard?msg=🗑️ 卡片已刪除');
  });
});

app.post('/admin/cancel-order/:orderNumber', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const orderNumber = req.params.orderNumber;
  db.get("SELECT items FROM orders WHERE order_number = ? AND status = 'pending'", [orderNumber], (err, row) => {
    if (!row) return res.send('訂單不存在或已取消');
    const items = JSON.parse(row.items);
    const stmt = db.prepare("UPDATE cards SET stock = stock + ? WHERE card_code = ?");
    for (let item of items) {
      stmt.run([item.qty, item.card_code]);
    }
    stmt.finalize();
    db.run("UPDATE orders SET status = 'cancelled' WHERE order_number = ?", [orderNumber], () => {
      res.redirect('/admin/dashboard?msg=✅ 訂單已取消，庫存已自動加回');
    });
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin');
});

// ========== 批量匯入 ==========
app.get('/admin/bulk-import', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  fs.readdir(uploadDir, (err, files) => {
    if (err) return res.send('無法讀取資料夾');
    let count = 0, errors = [];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    files.forEach(file => {
      const ext = file.split('.').pop().toLowerCase();
      if (!imageExts.includes(ext)) return;
      const card_code = file.replace(/\.[^/.]+$/, "");
      const image_url = '/uploads/' + file;
      db.get("SELECT * FROM cards WHERE card_code = ?", [card_code], (err, row) => {
        if (row) return;
        db.run(
          `INSERT INTO cards (card_code, name, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)`,
          [card_code, card_code, '未分類', 0, 0, image_url],
          (err) => { if (err) errors.push(card_code); else count++; }
        );
      });
    });
    setTimeout(() => {
      res.redirect(`/admin/dashboard?msg=✅ 批量匯入完成！成功新增 ${count} 張卡片。${errors.length > 0 ? ' ⚠️ 失敗：' + errors.join(',') : ''}`);
    }, 2000);
  });
});

// ========== 一鍵 W?-??? 固定格式 ==========
app.post('/admin/batch-generate-w-codes', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const { prefix, series_start, series_end, seq_start, seq_end, padding } = req.body;
  const p = prefix || 'W';
  const sStart = parseInt(series_start) || 1, sEnd = parseInt(series_end) || 17;
  const seqStart = parseInt(seq_start) || 1, seqEnd = parseInt(seq_end) || 60;
  const pad = parseInt(padding) || 3;
  const expectedCodes = [];
  for (let s = sStart; s <= sEnd; s++) {
    for (let seq = seqStart; seq <= seqEnd; seq++) {
      expectedCodes.push(`${p}${s}-${String(seq).padStart(pad, '0')}`);
    }
  }
  db.all("SELECT id FROM cards ORDER BY id ASC", (err, rows) => {
    if (err || rows.length === 0) return res.send('❌ 沒有卡片，請先匯入');
    const updateCount = Math.min(rows.length, expectedCodes.length);
    const stmt = db.prepare("UPDATE cards SET card_code = ? WHERE id = ?");
    let success = 0;
    for (let i = 0; i < updateCount; i++) {
      stmt.run([expectedCodes[i], rows[i].id], (err) => { if (!err) success++; });
    }
    stmt.finalize();
    setTimeout(() => {
      res.redirect(`/admin/dashboard?msg=✅ 成功更新 ${success} 張！範例：${expectedCodes[0]} ... ${expectedCodes[updateCount-1]}`);
    }, 1500);
  });
});

// ========== 自定義系列編號 ==========
app.post('/admin/batch-custom-seq', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const { mapping, padding } = req.body;
  const pad = parseInt(padding) || 3;
  if (!mapping) return res.send('❌ 請輸入編號規則！');
  const lines = mapping.split('\n').filter(line => line.trim() !== '');
  let expectedCodes = [];
  for (let line of lines) {
    let cleanLine = line.trim().replace(/,/g, '');
    const parts = cleanLine.split(':');
    if (parts.length !== 2) continue;
    const prefix = parts[0].trim();
    const rangeParts = parts[1].trim().split('-');
    if (rangeParts.length !== 2) continue;
    const start = parseInt(rangeParts[0]), end = parseInt(rangeParts[1]);
    if (isNaN(start) || isNaN(end) || start > end) continue;
    for (let i = start; i <= end; i++) {
      expectedCodes.push(`${prefix}-${String(i).padStart(pad, '0')}`);
    }
  }
  if (expectedCodes.length === 0) return res.send('❌ 格式錯誤！請用「前綴:起始-結束」');
  db.all("SELECT id FROM cards ORDER BY id ASC", (err, rows) => {
    if (err || rows.length === 0) return res.send('❌ 沒有卡片');
    const updateCount = Math.min(rows.length, expectedCodes.length);
    const stmt = db.prepare("UPDATE cards SET card_code = ? WHERE id = ?");
    let success = 0;
    for (let i = 0; i < updateCount; i++) {
      stmt.run([expectedCodes[i], rows[i].id], (err) => { if (!err) success++; });
    }
    stmt.finalize();
    setTimeout(() => {
      res.redirect(`/admin/dashboard?msg=✅ 成功更新 ${success} 張！範例：${expectedCodes.slice(0,3).join(', ')} ...`);
    }, 1500);
  });
});

// ========== 批次取代文字 ==========
app.post('/admin/batch-update-codes', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const { old_text, new_text } = req.body;
  if (!old_text || !new_text) return res.send('❌ 請輸入要取代的文字');
  db.run(
    "UPDATE cards SET card_code = REPLACE(card_code, ?, ?) WHERE card_code LIKE ?",
    [old_text, new_text, '%' + old_text + '%'],
    function(err) {
      if (err) return res.send('更新失敗：' + err.message);
      res.redirect(`/admin/dashboard?msg=✅ 成功更新 ${this.changes} 張卡片的編號！`);
    }
  );
});

app.listen(PORT, () => console.log(`✅ 網站已啟動，請打開瀏覽器訪問 http://localhost:${PORT}`));
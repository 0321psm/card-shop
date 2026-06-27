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

// ====== 自動偵測上傳目錄（解決權限問題） ======
let uploadDir;
try {
  if (process.env.DATA_PATH) {
    const testDir = path.join(process.env.DATA_PATH, 'uploads');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(path.join(testDir, '.test'), 'test');
    fs.unlinkSync(path.join(testDir, '.test'));
    uploadDir = testDir;
    console.log('✅ 使用雲端永久硬碟：' + uploadDir);
  } else {
    uploadDir = path.join(__dirname, 'public', 'uploads');
  }
} catch (err) {
  uploadDir = path.join(__dirname, 'public', 'uploads');
  console.log('⚠️ 雲端硬碟無法寫入，改用本機目錄：' + uploadDir);
}
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
app.use('/uploads', express.static(uploadDir));

// ========== 前台 ==========
app.get('/', (req, res) => {
  const cards = db.getCards();
  res.render('index', { cards });
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

  try {
    const data = db.readData();
    for (let item of parsedItems) {
      const card = data.cards.find(c => c.card_code === item.card_code);
      if (!card || card.stock < item.qty) {
        throw new Error(`庫存不足：${item.name}`);
      }
      card.stock -= item.qty;
    }
    const newOrder = {
      order_number: orderNumber,
      customer_nickname: nickname,
      items: JSON.stringify(parsedItems),
      total_price: totalPrice,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    db.addOrder(newOrder);
    db.writeData(data);
    res.json({ success: true, orderNumber });
  } catch (error) {
    res.json({ success: false, msg: error.message });
  }
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
  const cards = db.getCards();
  const orders = db.getOrders();
  res.render('admin_dashboard', { cards, orders, msg });
});

app.post('/admin/add-card', upload.single('image'), (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const { card_code, name, category, price, stock } = req.body;
  const image_url = req.file ? '/uploads/' + req.file.filename : null;
  try {
    db.addCard({
      card_code,
      name,
      category: category || '未分類',
      price: parseInt(price),
      stock: parseInt(stock),
      image_url,
      created_at: new Date().toISOString()
    });
    res.redirect('/admin/dashboard?msg=✅ 手動新增卡片成功！');
  } catch (err) {
    res.send('新增失敗：' + err.message);
  }
});

app.post('/admin/delete-card/:id', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  db.deleteCard(req.params.id);
  res.redirect('/admin/dashboard?msg=🗑️ 卡片已刪除');
});

app.post('/admin/cancel-order/:orderNumber', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const orderNumber = req.params.orderNumber;
  const order = db.getOrder(orderNumber);
  if (!order || order.status !== 'pending') return res.send('訂單不存在或已取消');

  const items = JSON.parse(order.items);
  const data = db.readData();
  for (let item of items) {
    const card = data.cards.find(c => c.card_code === item.card_code);
    if (card) card.stock += item.qty;
  }
  db.updateOrderStatus(orderNumber, 'cancelled');
  db.writeData(data);
  res.redirect('/admin/dashboard?msg=✅ 訂單已取消，庫存已自動加回');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin');
});

// ========== 批量匯入 ==========
app.get('/admin/bulk-import', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const files = fs.readdirSync(uploadDir);
  let count = 0, errors = [];
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  const data = db.readData();
  for (let file of files) {
    const ext = file.split('.').pop().toLowerCase();
    if (!imageExts.includes(ext)) continue;
    const card_code = file.replace(/\.[^/.]+$/, "");
    const image_url = '/uploads/' + file;
    if (data.cards.some(c => c.card_code === card_code)) continue;
    data.cards.push({
      id: Date.now() + Math.random().toString(36).slice(2, 6),
      card_code,
      name: card_code,
      category: '未分類',
      price: 0,
      stock: 0,
      image_url,
      created_at: new Date().toISOString()
    });
    count++;
  }
  db.writeData(data);
  res.redirect(`/admin/dashboard?msg=✅ 批量匯入完成！成功新增 ${count} 張卡片。${errors.length > 0 ? ' ⚠️ 失敗：' + errors.join(',') : ''}`);
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
  const data = db.readData();
  if (data.cards.length === 0) return res.send('❌ 沒有卡片，請先匯入');
  const updateCount = Math.min(data.cards.length, expectedCodes.length);
  for (let i = 0; i < updateCount; i++) {
    data.cards[i].card_code = expectedCodes[i];
  }
  db.writeData(data);
  res.redirect(`/admin/dashboard?msg=✅ 成功更新 ${updateCount} 張！範例：${expectedCodes[0]} ... ${expectedCodes[updateCount-1]}`);
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
  const data = db.readData();
  if (data.cards.length === 0) return res.send('❌ 沒有卡片');
  const updateCount = Math.min(data.cards.length, expectedCodes.length);
  for (let i = 0; i < updateCount; i++) {
    data.cards[i].card_code = expectedCodes[i];
  }
  db.writeData(data);
  res.redirect(`/admin/dashboard?msg=✅ 成功更新 ${updateCount} 張！範例：${expectedCodes.slice(0,3).join(', ')} ...`);
});

// ========== 批次取代文字 ==========
app.post('/admin/batch-update-codes', (req, res) => {
  if (!req.session.isAdmin) return res.status(401).send('Unauthorized');
  const { old_text, new_text } = req.body;
  if (!old_text || !new_text) return res.send('❌ 請輸入要取代的文字');
  const data = db.readData();
  let count = 0;
  for (let card of data.cards) {
    if (card.card_code.includes(old_text)) {
      card.card_code = card.card_code.replaceAll(old_text, new_text);
      count++;
    }
  }
  db.writeData(data);
  res.redirect(`/admin/dashboard?msg=✅ 成功更新 ${count} 張卡片的編號！`);
});

app.listen(PORT, () => console.log(`✅ 網站已啟動，請打開瀏覽器訪問 http://localhost:${PORT}`));
const fs = require('fs');
const path = require('path');

// 資料儲存路徑（雲端用永久硬碟，電腦用目前資料夾）
const dataDir = process.env.DATA_PATH || __dirname;
const dataFile = path.join(dataDir, 'data.json');

// 初始化資料結構（如果檔案不存在）
function initData() {
  if (!fs.existsSync(dataFile)) {
    const defaultData = {
      cards: [],
      orders: []
    };
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
  }
}

// 讀取所有資料
function readData() {
  initData();
  const raw = fs.readFileSync(dataFile);
  return JSON.parse(raw);
}

// 寫入資料
function writeData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// 取得所有卡片
function getCards() {
  return readData().cards;
}

// 新增卡片
function addCard(card) {
  const data = readData();
  // 檢查編號是否重複
  if (data.cards.some(c => c.card_code === card.card_code)) {
    throw new Error('卡片編號已存在');
  }
  card.id = Date.now() + Math.random().toString(36).slice(2, 6);
  data.cards.push(card);
  writeData(data);
  return card;
}

// 刪除卡片
function deleteCard(id) {
  const data = readData();
  data.cards = data.cards.filter(c => c.id !== id);
  writeData(data);
}

// 更新卡片
function updateCard(id, updates) {
  const data = readData();
  const index = data.cards.findIndex(c => c.id === id);
  if (index === -1) throw new Error('卡片不存在');
  data.cards[index] = { ...data.cards[index], ...updates };
  writeData(data);
}

// 取得所有訂單
function getOrders() {
  return readData().orders;
}

// 新增訂單
function addOrder(order) {
  const data = readData();
  order.id = Date.now() + Math.random().toString(36).slice(2, 6);
  data.orders.push(order);
  writeData(data);
  return order;
}

// 更新訂單狀態
function updateOrderStatus(orderNumber, status) {
  const data = readData();
  const order = data.orders.find(o => o.order_number === orderNumber);
  if (!order) throw new Error('訂單不存在');
  order.status = status;
  writeData(data);
  return order;
}

// 取得單筆訂單
function getOrder(orderNumber) {
  const data = readData();
  return data.orders.find(o => o.order_number === orderNumber) || null;
}

// 根據卡片編號取得卡片
function getCardByCode(cardCode) {
  const data = readData();
  return data.cards.find(c => c.card_code === cardCode) || null;
}

// 匯出函式（為了與原本的 db 介面相容，我們包裝成類似的物件）
const db = {
  // 卡片操作
  getCards,
  addCard,
  deleteCard,
  updateCard,
  getCardByCode,
  // 訂單操作
  getOrders,
  addOrder,
  updateOrderStatus,
  getOrder,
  // 原始資料（給批量修改用）
  readData,
  writeData
};

module.exports = db;
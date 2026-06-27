const fs = require('fs');
const path = require('path');

// 使用 /tmp 目录（Render 允许写入）
const dataFile = path.join('/tmp', 'data.json');

// 初始化资料（如果档案不存在）
function initData() {
  if (!fs.existsSync(dataFile)) {
    const defaultData = {
      cards: [],
      orders: []
    };
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
  }
}

// 读取所有资料
function readData() {
  initData();
  const raw = fs.readFileSync(dataFile);
  return JSON.parse(raw);
}

// 写入资料
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
  if (data.cards.some(c => c.card_code === card.card_code)) {
    throw new Error('卡片编号已存在');
  }
  card.id = Date.now() + Math.random().toString(36).slice(2, 6);
  data.cards.push(card);
  writeData(data);
  return card;
}

// 删除卡片
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

// 取得所有订单
function getOrders() {
  return readData().orders;
}

// 新增订单
function addOrder(order) {
  const data = readData();
  order.id = Date.now() + Math.random().toString(36).slice(2, 6);
  data.orders.push(order);
  writeData(data);
  return order;
}

// 更新订单状态
function updateOrderStatus(orderNumber, status) {
  const data = readData();
  const order = data.orders.find(o => o.order_number === orderNumber);
  if (!order) throw new Error('订单不存在');
  order.status = status;
  writeData(data);
  return order;
}

// 取得单笔订单
function getOrder(orderNumber) {
  const data = readData();
  return data.orders.find(o => o.order_number === orderNumber) || null;
}

// 根据卡片编号取得卡片
function getCardByCode(cardCode) {
  const data = readData();
  return data.cards.find(c => c.card_code === cardCode) || null;
}

const db = {
  getCards,
  addCard,
  deleteCard,
  updateCard,
  getCardByCode,
  getOrders,
  addOrder,
  updateOrderStatus,
  getOrder,
  readData,
  writeData
};

module.exports = db;
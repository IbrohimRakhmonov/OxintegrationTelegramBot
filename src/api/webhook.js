const express = require('express');
const router = express.Router();
const { findUserByOxId } = require('../services/userService');
const { getSale, getCustomer } = require('../services/oxApi');
const bot = require('../bot/index')

// Этот endpoint нужно указать в настройках Webhook в OX System
// Настройки → Webhooks → URL: http://ВАШ_СЕРВЕР:3000/webhook/ox
router.post('/ox', async (req, res) => {
  console.log('📨 Webhook headers:', req.headers);
  console.log('📨 Webhook body:', req.body);

  const event = req.body || {};

  // Отвечаем OX сразу, чтобы он не повторял запрос
  res.status(200).json({ received: true, event });

  try {
  await handleOxEvent(event);
} catch (err) {
  console.error('Webhook handler error:', err.message);
}
});


async function handleOxEvent(event) {
  const sale = await getSale(event.id);
  console.log("🛒💵New SALE ", sale);

  let customer = {}
  
  if (!sale?.customer) {
    console.log("❌ Customer is not attached");
    return
  } else {
    customer = await getCustomer(sale.customer)
    console.log('🔎 Customer from OX:', customer);
  }

  const productData = await getProdu

  const user = await findUserByOxId(sale.customer)
  if(!user){
    console.log(`ℹ️ Клиент ${sale.customer} не привязал Telegram`);
    return;
  }

  if(sale.sellRecords.length > 1){
    const productList = sale.sellRecords
    .map((r, i) => {
      const name = r.variationName || 'Без Называния';
      const qty = r.count || 1;
      const price = r.total.UZS; 
      const idProduct = r.id;
    })
  }

  const msg =
    `🛒 *Новый заказ оформлен!*\n\n` +
    `📦 Заказ #${sale.id}\n` +
    `💵 Сумма: ${formatAmount(sale.sellRecords[0].total.UZS)}\n` +
    `📍 Статус: ⏳ Ожидает обработки\n\n` +
    `📍 Продукт: ${sale.sellRecords[1].variationName}\n\n` +

  await bot.telegram.sendMessage(user.telegram_id, msg, {parse_mode: 'Markdown'})
}

function formatAmount(amount) {
  return new Intl.NumberFormat('ru-RU').format(amount) + ' UZS';
}

module.exports = router;

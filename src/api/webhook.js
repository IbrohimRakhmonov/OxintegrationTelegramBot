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

  const user = await findUserByOxId(sale.customer)
  if (!user) {
    console.log(`ℹ️ Клиент ${sale.customer} не привязал Telegram`);
    return;
  }

  const records = sale.sellRecords || [];
  const productList = records
    .map((r, i) => {
      const name = escapeHtml(r.variationName || 'Без названия');
      const qty = r.count || 1;
      const price = r.total?.UZS ?? 0;
      return `${i + 1}. ${name} × ${qty} — ${formatAmount(price)}`;
    })
    .join('\n');

  const total =
    sale.sellTotal?.UZS ??
    records.reduce((sum, r) => sum + Number(r.total?.UZS ?? 0), 0);

  const msg =
    `🛒 <b>Новый заказ оформлен!</b>\n\n` +
    `📦 Заказ #${sale.id}\n` +
    `💵 Сумма: ${formatAmount(total)}\n` +
    `📍 Статус: ⏳ Ожидает обработки\n\n` +
    `🧴 Товары:\n${productList || '—'}`;

  await bot.telegram.sendMessage(user.telegram_id, msg, { parse_mode: 'HTML' });
  console.log(`✅ Уведомление о заказе #${sale.id} отправлено клиенту ${sale.customer}`);
}

function formatAmount(amount) {
  return new Intl.NumberFormat('ru-RU').format(amount) + ' UZS';
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = router;

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { findUserByOxId, markSaleProcessed, unmarkSaleProcessed } = require('../services/userService');
const { getSale } = require('../services/oxApi');
const bot = require('../bot/index')

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// Сравнение секрета за постоянное время, чтобы его нельзя было подобрать по времени ответа
function isValidSecret(given = '') {
  const a = Buffer.from(given);
  const b = Buffer.from(WEBHOOK_SECRET);
  return WEBHOOK_SECRET.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Этот endpoint нужно указать в настройках Webhook в OX System
// Настройки → Webhooks → URL: https://ВАШ_ДОМЕН/webhook/ox/<WEBHOOK_SECRET>
router.post('/ox/:secret', async (req, res) => {
  if (!isValidSecret(req.params.secret)) {
    return res.sendStatus(404);
  }

  // Отвечаем OX сразу, чтобы он не повторял запрос
  res.status(200).json({ received: true });

  const saleId = Number(req.body?.id);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    console.log('⚠️ Webhook без корректного id продажи');
    return;
  }

  try {
    // Каждую продажу обрабатываем один раз — повторы от OX не дублируют уведомления
    const isNew = await markSaleProcessed(saleId);
    if (!isNew) {
      console.log(`ℹ️ Продажа #${saleId} уже обработана`);
      return;
    }

    await withRetry(() => handleOxEvent(saleId), saleId);
  } catch (err) {
    // Не удалось — снимаем отметку, чтобы повторный вебхук по этой продаже снова обработался
    await unmarkSaleProcessed(saleId).catch(() => {});
    console.error(`Webhook handler error (продажа #${saleId}):`, err.message);
  }
});

// Временные сбои OX/Telegram (502, 504, таймауты) — повторяем через 3, 10 и 30 секунд
const RETRY_DELAYS = [3000, 10000, 30000];

async function withRetry(fn, saleId) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRY_DELAYS.length) throw err;
      console.warn(`⚠️ Продажа #${saleId}: ${err.message}, повтор через ${RETRY_DELAYS[attempt] / 1000} с`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}


async function handleOxEvent(saleId) {
  const sale = await getSale(saleId);

  if (!sale?.customer) {
    console.log(`❌ К продаже #${saleId} не привязан клиент`);
    return;
  }

  const user = await findUserByOxId(sale.customer)
  if (!user) {
    console.log(`ℹ️ Клиент ${sale.customer} не привязал Telegram`);
    return;
  }

  const records = (sale.sellRecords || []).filter((r) => !r.deleted);
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
    `📦 Заказ #${sale.printKey || sale.id}\n` +
    `💵 Сумма: ${formatAmount(total)}\n\n` +
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

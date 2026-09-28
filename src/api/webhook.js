const express = require('express');
const router = express.Router();
const { findUserByOxId } = require('../services/userService');
const { getSale, getCustomer } = require('../services/oxApi');

// Этот endpoint нужно указать в настройках Webhook в OX System
// Настройки → Webhooks → URL: http://ВАШ_СЕРВЕР:3000/webhook/ox
router.post('/ox', async (req, res) => {
  console.log('📨 Webhook headers:', req.headers);
  console.log('📨 Webhook body:', req.body);

  const event = req.body || {};

  // Отвечаем OX сразу, чтобы он не повторял запрос
  res.status(200).json({ received: true, event });



  await handleOxEvent(event);
  
});


// const msg =
//         `🛒 *Новый заказ оформлен!*\n\n` +
//         `📦 Заказ #${order.id}\n` +
//         `💵 Сумма: ${formatAmount(order.total)}\n` +
//         `📍 Статус: ⏳ Ожидает обработки\n\n` +
//         `Мы уведомим вас при изменении статуса.`;



async function handleOxEvent(event) {
  const bot = require('../bot');

  const sale = await getSale(event.id);
    console.log(sale);
    console.log("SALE ", sale);
    

  
  const customer = await getCustomer(sale.customer)
  console.log('🔎 Customer from OX:', customer);


  // switch (event.type) {

  //   // Новый заказ / покупка
  //   case 'completed': {
  //     const order = event.data;
  //     const user = await findUserByOxId(order.customer_id);
  //     if (!user) return;



  //     await bot.telegram.sendMessage(user.telegram_id, msg, { parse_mode: 'Markdown' });
  //     break;
  //   }

  //   // Изменение статуса заказа
  //   case 'order.status_changed': {
  //     const order = event.data;
  //     const user = await findUserByOxId(order.customer_id);
  //     if (!user) return;

  //     const statusMessages = {
  //       processing: `🔄 *Заказ #${order.id} в обработке*\n\nВаш заказ принят и передан в работу.`,
  //       shipped: `🚚 *Заказ #${order.id} отправлен!*\n\nВаш заказ в пути. Ожидайте доставку.`,
  //       completed: `✅ *Заказ #${order.id} выполнен!*\n\nСпасибо за покупку!\n💰 Кешбек начислен на ваш счёт.`,
  //       cancelled: `❌ *Заказ #${order.id} отменён*\n\nПо вопросам обращайтесь в поддержку.`,
  //     };

  //     const msg = statusMessages[order.status];
  //     if (msg) {
  //       await bot.telegram.sendMessage(user.telegram_id, msg, { parse_mode: 'Markdown' });
  //     }
  //     break;
  //   }

  //   // Начисление кешбека
  //   case 'cashback.credited': {
  //     const data = event.data;
  //     const user = await findUserByOxId(data.customer_id);
  //     if (!user) return;

  //     const msg =
  //       `💰 *Кешбек начислен!*\n\n` +
  //       `+${formatAmount(data.amount)}\n` +
  //       `Текущий баланс: ${formatAmount(data.balance)}`;

  //     await bot.telegram.sendMessage(user.telegram_id, msg, { parse_mode: 'Markdown' });
  //     break;
  //   }

  //   default:
  //     console.log(`Unhandled event id: ${event.id}`);
  // }
}

function formatAmount(amount) {
  return new Intl.NumberFormat('ru-RU').format(amount) + ' UZS';
}

module.exports = router;

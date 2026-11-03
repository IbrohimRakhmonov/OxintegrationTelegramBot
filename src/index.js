require('dotenv').config();
const express = require('express');
const { initDB } = require('./db');
const bot = require('./bot');
const webhookRouter = require('./api/webhook');
const webhookClients = require('./api/webhook.clients');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain' }));

// Webhook endpoint для OX System
app.use('/clients', webhookClients);
app.use('/webhook', webhookRouter);

// Healthcheck
app.get('/', (req, res) => res.json({ status: 'ok' }));

async function start() {
  try {
    // 1. Инициализируем БД
    await initDB();
    
    // 2. Запускаем Express сервер
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, async () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      if (!process.env.WEBHOOK_SECRET) {
        console.warn('⚠️ WEBHOOK_SECRET не задан — вебхук OX отключён');
      }
    });
    
    // 3. Запускаем Telegram бота (long polling для локальной разработки)
    bot.launch();
    console.log('🤖 Telegram bot started');

    // Graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();

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

    // 4. Бот рекламной рассылки — только если задан его токен.
    //    Ошибки внутри него не роняют основного бота.
    let adminBot = null;
    if (process.env.ADMIN_BOT_TOKEN) {
      try {
        const { startAdminBot } = require('./adminBot');
        adminBot = startAdminBot();
      } catch (err) {
        console.error('❌ Бот рассылки не запустился:', err.message);
      }
    }

    // Graceful shutdown
    const stop = (signal) => {
      // stop() бросает ошибку, если бот не успел запуститься — это не страшно
      for (const b of [bot, adminBot]) {
        try { if (b) b.stop(signal); } catch {}
      }
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));

  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();

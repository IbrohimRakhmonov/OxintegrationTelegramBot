const { Telegraf, Markup } = require('telegraf');
const { findUserByTelegramId, createUser, authorizeUser } = require('../services/userService');
const { findCustomerByPhone, getCustomerOrders, getCashbackBalance } = require('../services/oxApi');
const { buildOrderMessages } = require('./formatOrder');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ─── /start ───────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;


  await createUser(telegramId, username);
  const user = await findUserByTelegramId(telegramId);

  if (user?.is_authorized) {
    return ctx.reply(
      `👋 С возвращением, ${ctx.from.first_name}!\n\nВыберите действие:`,
      mainMenu()
    );
  }

  ctx.reply(
    `👋 Добро пожаловать в S PERFUME! 🌸\n\nЧувствуете этот аромат? Это нотки вашей выгоды! 😍\n\nЧтобы получать уведомления о покупках и копить кешбэк на любимые духи, привяжите ваш аккаунт OX System.\n\nЖмите на кнопку ниже и погружайтесь в мир ароматов: 👇`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📱 Авторизоваться', 'auth_start')]
    ])
  );
});

// ─── АВТОРИЗАЦИЯ ──────────────────────────────────────────────────────────────
bot.action('auth_start', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    '📱 Введите ваш номер телефона в формате:\n+998901234567',
    Markup.forceReply()
  );
});

// Обработка номера телефона
bot.on('text', async (ctx) => {
  const telegramId = ctx.from.id;
  const text = ctx.message.text;

  // Проверяем что это номер телефона
  const phoneRegex = /^\+?[0-9]{10,13}$/;
  if (!phoneRegex.test(text.replace(/\s/g, ''))) {
    // Это не телефон — обрабатываем как обычный текст
    return handleText(ctx);
  }

  const user = await findUserByTelegramId(telegramId);
  if (user?.is_authorized) {
    return ctx.reply('Вы уже авторизованы ✅', mainMenu());
  }

  const phone = text.replace(/\D/g, '');
  await ctx.reply('🔍 Ищем ваш аккаунт...');

  try {
    const oxCustomer = await findCustomerByPhone(phone);
    
    if (!oxCustomer) {
      return ctx.reply(
        '❌ Аккаунт с таким номером не найден в OX System.\n\nПроверьте номер и попробуйте снова.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Попробовать снова', 'auth_start')]
        ])
      );
    }

    await authorizeUser(telegramId, oxCustomer.id, phone);

    ctx.reply(
      `✅ Авторизация успешна!\n\n👤 ${oxCustomer.profile.fullName || oxCustomer.phone}\n\nТеперь вы будете получать уведомления о покупках и можете проверять кешбек.`,
      mainMenu()
    );
  } catch (err) {
    console.error('Auth error:', err.message);
    ctx.reply('⚠️ Ошибка подключения к OX System. Попробуйте позже.');
  }
});

// ─── МОИ ПОКУПКИ ──────────────────────────────────────────────────────────────
bot.action('my_orders', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(ctx.from.id);

  if (!user?.is_authorized) {
    return ctx.reply('Сначала авторизуйтесь 👆');
  }

  try {
    const responce = await getCustomerOrders(user.ox_user_id);
    const message = buildOrderMessages(responce, {limit : 9});

    for(let i = 0; i < message.length; i++){
      const isLast = i === message.length - 1;
      await ctx.reply(message[i], {
        parse_mode: 'HTML',
        ...(isLast ? mainMenu() : {}), // кнопки меню только под последним сообщением
      })
    }

  } catch (err) {
    console.error('Orders error:', err.message);
    ctx.reply('⚠️ Не удалось загрузить покупки. Попробуйте позже.');
  }
});

// ─── КЕШБЕК ───────────────────────────────────────────────────────────────────
bot.action('cashback', async (ctx) => {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(ctx.from.id);

  if (!user?.is_authorized) {
    return ctx.reply('Сначала авторизуйтесь 👆');
  }

  try {
    const cashback = await getCashbackBalance(user.ox_user_id);

    ctx.reply(
      `💰 *Ваш кешбек:*\n\n` +
      `Баланс: *${formatAmount(cashback.balance)}*\n\n` +
      `Кешбек начисляется с каждой покупки и может быть использован при следующем заказе.`,
      { parse_mode: 'Markdown', ...mainMenu() }
    );
  } catch (err) {
    console.error('Cashback error:', err.message);
    ctx.reply('⚠️ Не удалось загрузить кешбек. Попробуйте позже.');
  }
});

// ─── ПОМОЩЬ ───────────────────────────────────────────────────────────────────
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    '❓ *Помощь*\n\n' +
    '📱 *Авторизация* — привяжите ваш номер телефона\n' +
    '🛒 *Мои покупки* — последние 5 заказов\n' +
    '💰 *Кешбек* — текущий баланс бонусов\n\n' +
    'По вопросам обращайтесь в поддержку магазина.',
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});


// ─── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ──────────────────────────────────────────────────
function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛒 Мои покупки', 'my_orders'), Markup.button.callback('💰 Кешбек', 'cashback')],
    [Markup.button.callback('❓ Помощь', 'help')],
  ]);
}

function formatAmount(amount) {
  return new Intl.NumberFormat('ru-RU').format(amount) + ' UZS';
}

function formatStatus(status) {
  const statuses = {
    pending: '⏳ Ожидает',
    processing: '🔄 В обработке',
    completed: '✅ Выполнен',
    cancelled: '❌ Отменён',
  };
  return statuses[status] || status;
}

async function handleText(ctx) {
  const user = await findUserByTelegramId(ctx.from.id);
  if (user?.is_authorized) {
    ctx.reply('Выберите действие:', mainMenu());
  } else {
    ctx.reply(
      'Пожалуйста, авторизуйтесь для начала работы.',
      Markup.inlineKeyboard([[Markup.button.callback('📱 Авторизоваться', 'auth_start')]])
    );
  }
}

module.exports = bot;

// Бот рекламной рассылки (админ-бот). Вход по паролю из .env (ADMIN_PASSWORD).
// Рекламу отправляет ОСНОВНОЙ бот (@s_perfume_bot) — см. broadcaster.js
const { Telegraf, Markup } = require('telegraf');
const mainBot = require('../bot');
const {
  isAdmin, addAdmin, removeAdmin,
  checkPassword, getLockedUntil, registerFailedAttempt, resetAttempts,
  markInterruptedBroadcasts, getRecentBroadcasts, LOCK_MINUTES,
} = require('../services/adminService');
const { loadAudience, listRegions, filterAudience, describeFilters } = require('../services/audienceService');
const { startBroadcast, sendTest, getCurrentBroadcast } = require('./broadcaster');

// Бот может скачать через getFile только файлы до 20 МБ
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
// В инлайн-клавиатуре не больше 100 кнопок — оставляем место под остальные
const MAX_REGION_BUTTONS = 80;

// Черновики рассылок: telegram_id админа → черновик
const drafts = new Map();
let draftCounter = 0;

function startAdminBot() {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('⚠️ ADMIN_BOT_TOKEN задан, но ADMIN_PASSWORD пустой — бот рассылки не запущен');
    return null;
  }

  const bot = new Telegraf(process.env.ADMIN_BOT_TOKEN);

  // Как и в основном боте: обработку запускаем в фоне, чтобы долгая загрузка
  // клиентов из OX не «замораживала» бота
  bot.use((ctx, next) => {
    next().catch((err) => console.error(`AdminBot error (${ctx.updateType}):`, err.message));
  });

  // Только личные чаты. Не-админам доступен лишь ввод пароля
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    if (await isAdmin(ctx.from.id)) return next();
    return handleGuest(ctx);
  });

  // ─── КОМАНДЫ АДМИНА ─────────────────────────────────────────────────────────
  bot.start((ctx) => ctx.reply(helpText()));
  bot.help((ctx) => ctx.reply(helpText()));

  bot.command('cancel', (ctx) => {
    drafts.delete(ctx.from.id);
    return ctx.reply('Черновик удалён. Пришлите новую рекламу, когда будете готовы.');
  });

  bot.command('status', (ctx) => {
    const b = getCurrentBroadcast();
    if (!b) return ctx.reply('Сейчас рассылка не идёт.');
    return ctx.reply(
      `📤 Идёт рассылка #${b.id ?? '…'}: ${b.sent + b.failed + b.blocked} из ${b.total}\n` +
      `✅ ${b.sent}   ❌ ${b.failed + b.blocked}`
    );
  });

  bot.command('history', async (ctx) => {
    const rows = await getRecentBroadcasts(10);
    if (!rows.length) return ctx.reply('Рассылок пока не было.');
    const statusText = { running: '⏳ идёт', done: '✅ готово', error: '⚠️ ошибка', interrupted: '⛔ прервана' };
    const lines = rows.map((r) => {
      const { regionText, genderText } = describeFilters(r.filters || {});
      const when = new Date(r.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
      const text = (r.text || '').replace(/\s+/g, ' ').slice(0, 60);
      return (
        `#${r.id} · ${when} · ${statusText[r.status] || r.status}\n` +
        `👤 админ ${r.admin_telegram_id} · ${typeLabel(r.content_type)}\n` +
        `🎯 ${regionText} · ${genderText}\n` +
        `📊 отправлено ${r.sent} из ${r.total}, ошибок ${r.failed + r.blocked} (блок ${r.blocked})\n` +
        (text ? `📝 ${text}${r.text.length > 60 ? '…' : ''}\n` : '')
      );
    });
    return ctx.reply(lines.join('\n'));
  });

  bot.command('logout', async (ctx) => {
    drafts.delete(ctx.from.id);
    await removeAdmin(ctx.from.id);
    return ctx.reply('Вы вышли. Чтобы войти снова, введите пароль.');
  });

  // ─── НОВАЯ РЕКЛАМА ──────────────────────────────────────────────────────────
  bot.on(['text', 'photo', 'video'], async (ctx) => {
    const msg = ctx.message;
    if (msg.text?.startsWith('/')) return ctx.reply(helpText());
    if (msg.media_group_id) {
      return ctx.reply('⚠️ Альбомы не поддерживаются. Пришлите одно фото или одно видео с подписью.');
    }

    const draft = { token: (++draftCounter).toString(36), regions: new Set(), gender: 'all' };
    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1]; // самое большое
      Object.assign(draft, { type: 'photo', fileId: photo.file_id, fileSize: photo.file_size });
    } else if (msg.video) {
      Object.assign(draft, {
        type: 'video', fileId: msg.video.file_id, fileSize: msg.video.file_size, fileName: msg.video.file_name,
      });
    } else {
      draft.type = 'text';
    }
    // Форматирование (жирный, ссылки и т.д.) сохраняем через entities
    draft.text = msg.text ?? msg.caption ?? '';
    draft.entities = msg.entities ?? msg.caption_entities;

    if (draft.fileSize > MAX_MEDIA_BYTES) {
      return ctx.reply('⚠️ Файл больше 20 МБ — Telegram не даст боту его скачать. Сожмите видео и пришлите снова.');
    }

    const wait = await ctx.reply('⏳ Загружаю клиентов из OX…');
    try {
      draft.audience = await loadAudience();
    } catch (err) {
      console.error('AdminBot: не удалось загрузить клиентов:', err.message);
      return ctx.reply('⚠️ OX не ответил, клиентов загрузить не удалось. Попробуйте позже.');
    } finally {
      ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    }

    if (!draft.audience.length) {
      return ctx.reply('В основном боте пока нет привязанных клиентов — отправлять некому.');
    }
    draft.allRegions = listRegions(draft.audience).slice(0, MAX_REGION_BUTTONS);
    drafts.set(ctx.from.id, draft);

    // Предпросмотр: копия сообщения ровно в том виде, как его увидят клиенты
    await ctx.reply('👀 Предпросмотр:');
    await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, msg.message_id);
    return ctx.reply(filtersText(draft), filtersKeyboard(draft));
  });

  bot.on('message', (ctx) => ctx.reply('Поддерживаются только текст, фото с подписью или видео с подписью.'));

  // ─── КНОПКИ ─────────────────────────────────────────────────────────────────
  // Формат callback_data: действие:токен_черновика[:аргумент]
  bot.action(/^(r|ra|g|next|back|test|send|cancel):(\w+)(?::(.+))?$/, async (ctx) => {
    const [, action, token, arg] = ctx.match;
    const draft = drafts.get(ctx.from.id);

    if (!draft || draft.token !== token) {
      await ctx.answerCbQuery('Этот черновик устарел. Пришлите рекламу заново.', { show_alert: true });
      return ctx.editMessageReplyMarkup(undefined).catch(() => {});
    }

    switch (action) {
      case 'r': { // переключить регион
        const region = draft.allRegions[Number(arg)]?.name;
        if (region) draft.regions.has(region) ? draft.regions.delete(region) : draft.regions.add(region);
        await ctx.answerCbQuery();
        return editSafe(ctx, filtersText(draft), filtersKeyboard(draft));
      }
      case 'ra': // все регионы
        draft.regions.clear();
        await ctx.answerCbQuery();
        return editSafe(ctx, filtersText(draft), filtersKeyboard(draft));

      case 'g':
        if (['all', 'male', 'female'].includes(arg)) draft.gender = arg;
        await ctx.answerCbQuery();
        return editSafe(ctx, filtersText(draft), filtersKeyboard(draft));

      case 'next':
        await ctx.answerCbQuery();
        return editSafe(ctx, confirmText(draft), confirmKeyboard(draft));

      case 'back':
        await ctx.answerCbQuery();
        return editSafe(ctx, filtersText(draft), filtersKeyboard(draft));

      case 'cancel':
        drafts.delete(ctx.from.id);
        await ctx.answerCbQuery('Отменено');
        return editSafe(ctx, '❌ Рассылка отменена.');

      case 'test': {
        await ctx.answerCbQuery('Отправляю тест…');
        const result = await sendTest({
          mainTelegram: mainBot.telegram, adminTelegram: ctx.telegram, draft, chatId: ctx.from.id,
        }).catch((err) => ({ status: 'failed', error: err.message }));
        if (result.status === 'sent') return ctx.reply('🧪 Тест отправлен вам от имени основного бота. Проверьте чат с ним.');
        return ctx.reply(
          `⚠️ Тест не доставлен: ${result.error}\n\n` +
          'Скорее всего, вы ещё не нажали /start в основном боте (или заблокировали его).'
        );
      }

      case 'send': {
        if (getCurrentBroadcast()) {
          return ctx.answerCbQuery('Уже идёт другая рассылка. Дождитесь её окончания (/status).', { show_alert: true });
        }
        const filters = currentFilters(draft);
        const recipients = filterAudience(draft.audience, filters);
        if (!recipients.length) return ctx.answerCbQuery('Под фильтры никто не подходит.', { show_alert: true });

        drafts.delete(ctx.from.id); // повторное нажатие уже ничего не сделает
        let id;
        try {
          id = await startBroadcast({
            mainTelegram: mainBot.telegram,
            adminTelegram: ctx.telegram,
            adminId: ctx.from.id,
            draft,
            recipients,
            filters,
          });
        } catch (err) {
          drafts.set(ctx.from.id, draft); // не потеряли черновик — можно нажать ещё раз позже
          if (err.message === 'ALREADY_RUNNING') {
            return ctx.answerCbQuery('Уже идёт другая рассылка.', { show_alert: true });
          }
          throw err;
        }
        await ctx.answerCbQuery('Рассылка запущена');
        return editSafe(ctx, `🚀 Рассылка #${id} запущена на ${recipients.length} чел. Отчёт пришлю, когда закончу.`);
      }
    }
  });

  // Нажатия на кнопки, которые не подошли под шаблон
  bot.on('callback_query', (ctx) => ctx.answerCbQuery());

  // Рассылки, прерванные перезапуском процесса, помечаем в истории
  markInterruptedBroadcasts()
    .then((n) => n && console.warn(`⚠️ Прерванных рассылок после перезапуска: ${n}`))
    .catch((err) => console.error('AdminBot: markInterruptedBroadcasts:', err.message));

  bot.launch().catch((err) => console.error('❌ Бот рассылки не запустился:', err.message));
  console.log('📣 Admin (broadcast) bot started');
  return bot;
}

// ─── ВХОД ПО ПАРОЛЮ ───────────────────────────────────────────────────────────
async function handleGuest(ctx) {
  // На кнопки и любые сообщения, кроме текста, не-админам не отвечаем
  if (ctx.callbackQuery) return ctx.answerCbQuery().catch(() => {});
  const text = ctx.message?.text;
  if (!text) return;

  if (text === '/start') return ctx.reply('🔒 Введите пароль.');

  // Сообщение с паролем сразу удаляем из чата (и верное, и неверное)
  ctx.deleteMessage().catch(() => {});

  const lockedUntil = await getLockedUntil(ctx.from.id);
  if (lockedUntil) return ctx.reply(`⛔ Слишком много неверных попыток. Попробуйте после ${formatTime(lockedUntil)}.`);

  if (checkPassword(text)) {
    await addAdmin(ctx.from.id, ctx.from.username || ctx.from.first_name);
    await resetAttempts(ctx.from.id);
    console.log(`🔑 Новый админ бота рассылки: ${ctx.from.id} (@${ctx.from.username || '-'})`);
    return ctx.reply('✅ Вход выполнен.\n\n' + helpText());
  }

  const { attemptsLeft, lockedUntil: newLock } = await registerFailedAttempt(ctx.from.id);
  console.warn(`🔒 Неверный пароль от ${ctx.from.id} (@${ctx.from.username || '-'})`);
  if (newLock) {
    return ctx.reply(`⛔ Неверный пароль. Вход заблокирован на ${LOCK_MINUTES} минут (до ${formatTime(newLock)}).`);
  }
  return ctx.reply(`❌ Неверный пароль. Осталось попыток: ${attemptsLeft}.`);
}

// ─── ТЕКСТЫ И КЛАВИАТУРЫ ──────────────────────────────────────────────────────
function helpText() {
  return (
    '📣 Бот рекламной рассылки\n\n' +
    'Пришлите рекламу: текст, фото с подписью или видео с подписью. ' +
    'Я покажу предпросмотр и предложу выбрать регион и пол.\n\n' +
    'Команды:\n' +
    '/history — последние рассылки\n' +
    '/status — прогресс текущей рассылки\n' +
    '/cancel — удалить черновик\n' +
    '/logout — выйти'
  );
}

function currentFilters(draft) {
  return { regions: [...draft.regions], gender: draft.gender };
}

function filtersText(draft) {
  const filters = currentFilters(draft);
  const recipients = filterAudience(draft.audience, filters);
  const noRegion = recipients.filter((p) => !p.region).length;
  const noGender = recipients.filter((p) => !p.gender).length;
  const { regionText, genderText } = describeFilters(filters);
  return (
    '🎯 Выберите фильтры\n\n' +
    `Регион: ${regionText}\n` +
    `Пол: ${genderText}\n\n` +
    `Подходит сейчас: ${recipients.length} из ${draft.audience.length}\n` +
    `(из них без региона: ${noRegion}, без пола: ${noGender} — они получают рекламу всегда)`
  );
}

function filtersKeyboard(draft) {
  const t = draft.token;
  const regionButtons = draft.allRegions.map((r, i) =>
    Markup.button.callback(`${draft.regions.has(r.name) ? '✅' : '⬜'} ${r.name} (${r.count})`, `r:${t}:${i}`)
  );
  const rows = [];
  for (let i = 0; i < regionButtons.length; i += 2) rows.push(regionButtons.slice(i, i + 2));

  const mark = (on) => (on ? '✅ ' : '');
  rows.push([Markup.button.callback(`${mark(draft.regions.size === 0)}🌍 Все регионы`, `ra:${t}`)]);
  rows.push([
    Markup.button.callback(`${mark(draft.gender === 'male')}👨 Мужчины`, `g:${t}:male`),
    Markup.button.callback(`${mark(draft.gender === 'female')}👩 Женщины`, `g:${t}:female`),
    Markup.button.callback(`${mark(draft.gender === 'all')}👥 Все`, `g:${t}:all`),
  ]);
  rows.push([
    Markup.button.callback('➡️ Далее', `next:${t}`),
    Markup.button.callback('❌ Отмена', `cancel:${t}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function confirmText(draft) {
  const filters = currentFilters(draft);
  const count = filterAudience(draft.audience, filters).length;
  const { regionText, genderText } = describeFilters(filters);
  return (
    `📨 Получат ${count} человек\n\n` +
    `Регион: ${regionText}\nПол: ${genderText}\n\n` +
    'Отправка пойдёт от имени основного бота. «🧪 Тест себе» отправит рекламу только вам.'
  );
}

function confirmKeyboard(draft) {
  const t = draft.token;
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Отправить', `send:${t}`), Markup.button.callback('❌ Отмена', `cancel:${t}`)],
    [Markup.button.callback('🧪 Тест себе', `test:${t}`), Markup.button.callback('⬅️ Назад', `back:${t}`)],
  ]);
}

// Telegram ругается «message is not modified», если текст не изменился — это не ошибка
async function editSafe(ctx, text, keyboard) {
  try {
    await ctx.editMessageText(text, keyboard);
  } catch (err) {
    if (!String(err.message).includes('message is not modified')) throw err;
  }
}

function typeLabel(type) {
  return { text: '📝 текст', photo: '🖼 фото', video: '🎬 видео' }[type] || type;
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
}

module.exports = { startAdminBot };

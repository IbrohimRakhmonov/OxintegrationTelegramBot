// Отправка рекламы от имени ОСНОВНОГО бота (@s_perfume_bot)
const axios = require('axios');
const {
  createBroadcast, updateBroadcastProgress, finishBroadcast,
} = require('../services/adminService');

// Telegram разрешает ~30 сообщений в секунду; берём с запасом — не больше 18 в секунду
const MIN_INTERVAL_MS = 55;
// Как часто обновлять прогресс у админа и в БД
const PROGRESS_EVERY_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Текущая рассылка (одновременно может идти только одна)
let current = null;

function getCurrentBroadcast() {
  return current;
}

// ─── ОТПРАВКА ОДНОГО СООБЩЕНИЯ ────────────────────────────────────────────────
// file_id из админ-бота не работает в основном боте. Поэтому медиа один раз скачиваем
// через админ-бота, первому получателю загружаем буфер, а дальше используем file_id,
// который вернул Telegram основному боту.
function createSender({ mainTelegram, adminTelegram, draft }) {
  let mainFileId = null;
  let buffer = null;

  // Скачать медиа через админ-бота (один раз, до начала отправки)
  async function prepare() {
    if (draft.type === 'text' || buffer || mainFileId) return;
    const link = await adminTelegram.getFileLink(draft.fileId);
    const res = await axios.get(link.href, { responseType: 'arraybuffer', timeout: 120000 });
    buffer = Buffer.from(res.data);
    console.log(`📥 Медиа для рассылки скачано: ${(buffer.length / 1024 / 1024).toFixed(2)} МБ`);
  }

  async function getMedia() {
    if (mainFileId) return mainFileId;
    if (!buffer) await prepare();
    const filename = draft.type === 'photo' ? 'photo.jpg' : (draft.fileName || 'video.mp4');
    return { source: buffer, filename };
  }

  // Запоминаем file_id основного бота и освобождаем память
  function rememberFileId(msg) {
    if (mainFileId) return;
    if (draft.type === 'photo') mainFileId = msg.photo?.[msg.photo.length - 1]?.file_id || null;
    if (draft.type === 'video') mainFileId = msg.video?.file_id || null;
    if (mainFileId) buffer = null;
  }

  async function sendOnce(chatId) {
    if (draft.type === 'text') {
      return mainTelegram.sendMessage(chatId, draft.text, { entities: draft.entities });
    }
    const media = await getMedia();
    const extra = { caption: draft.text || undefined, caption_entities: draft.entities };
    const msg = draft.type === 'photo'
      ? await mainTelegram.sendPhoto(chatId, media, extra)
      : await mainTelegram.sendVideo(chatId, media, { ...extra, supports_streaming: true });
    rememberFileId(msg);
    return msg;
  }

  // Доставка с обработкой ошибок. Возвращает { status: 'sent' | 'blocked' | 'failed', error }
  async function deliver(chatId) {
    for (let attempt = 1; ; attempt++) {
      try {
        await sendOnce(chatId);
        return { status: 'sent' };
      } catch (err) {
        const code = err?.response?.error_code;
        const description = err?.response?.description || err.message;

        // 429 — слишком часто: ждём столько, сколько просит Telegram, и повторяем
        if (code === 429 && attempt <= 5) {
          const retryAfter = Number(err.response?.parameters?.retry_after) || 5;
          console.warn(`⏳ 429 от Telegram, ждём ${retryAfter} с`);
          await sleep(retryAfter * 1000 + 250);
          continue;
        }
        // 403 — пользователь заблокировал бота (или удалил аккаунт): просто считаем
        if (code === 403) return { status: 'blocked', error: description };

        // Сетевой сбой (нет кода Telegram) — одна повторная попытка
        if (!code && attempt <= 2) {
          await sleep(2000);
          continue;
        }
        return { status: 'failed', error: description };
      }
    }
  }

  return { prepare, deliver };
}

// ─── ТЕСТ: ОТПРАВИТЬ ТОЛЬКО СЕБЕ ──────────────────────────────────────────────
async function sendTest({ mainTelegram, adminTelegram, draft, chatId }) {
  const sender = createSender({ mainTelegram, adminTelegram, draft });
  await sender.prepare();
  return sender.deliver(chatId);
}

// ─── МАССОВАЯ РАССЫЛКА ────────────────────────────────────────────────────────
// Запускает рассылку в фоне и сразу возвращает её id. Бросает ALREADY_RUNNING,
// если другая рассылка ещё идёт.
async function startBroadcast({ mainTelegram, adminTelegram, adminId, draft, recipients, filters }) {
  if (current) throw new Error('ALREADY_RUNNING');

  // Занимаем «слот» сразу, до любых await — чтобы двойное нажатие не запустило две рассылки
  current = { id: null, total: recipients.length, sent: 0, failed: 0, blocked: 0, startedAt: new Date() };

  try {
    current.id = await createBroadcast({
      adminId,
      contentType: draft.type,
      text: draft.text || null,
      filters,
      total: recipients.length,
    });
  } catch (err) {
    current = null;
    throw err;
  }

  const state = current;
  run({ mainTelegram, adminTelegram, adminId, draft, recipients, state })
    .catch((err) => console.error(`Рассылка #${state.id}: критическая ошибка:`, err.message))
    .finally(() => { current = null; });

  return state.id;
}

async function run({ mainTelegram, adminTelegram, adminId, draft, recipients, state }) {
  const sender = createSender({ mainTelegram, adminTelegram, draft });
  console.log(`📣 Рассылка #${state.id} началась: ${state.total} получателей`);

  // Сообщение с прогрессом у админа (если не получилось — не страшно)
  const progressText = () =>
    `📤 Рассылка #${state.id}: ${state.sent + state.failed + state.blocked} из ${state.total}\n` +
    `✅ ${state.sent}   ❌ ${state.failed + state.blocked}`;
  const progressMsg = await adminTelegram.sendMessage(adminId, progressText()).catch(() => null);

  let lastSendAt = 0;
  let lastProgressAt = Date.now();

  try {
    await sender.prepare();

    for (const person of recipients) {
      // Ограничение скорости
      const wait = lastSendAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastSendAt = Date.now();

      const { status, error } = await sender.deliver(person.telegramId);
      state[status]++;
      if (status === 'failed') console.warn(`⚠️ Рассылка #${state.id}: ${person.telegramId} — ${error}`);

      if (Date.now() - lastProgressAt > PROGRESS_EVERY_MS) {
        lastProgressAt = Date.now();
        await updateBroadcastProgress(state.id, state).catch(() => {});
        if (progressMsg) {
          await adminTelegram.editMessageText(adminId, progressMsg.message_id, undefined, progressText()).catch(() => {});
        }
      }
    }

    await finishBroadcast(state.id, { status: 'done', ...state });
    if (progressMsg) {
      await adminTelegram.editMessageText(adminId, progressMsg.message_id, undefined, progressText()).catch(() => {});
    }

    const undelivered = state.failed + state.blocked;
    const report =
      `✅ Рассылка #${state.id} завершена.\n\n` +
      `Отправлено ${state.sent}, не доставлено ${undelivered} (заблокировали бота ${state.blocked})`;
    console.log(`📣 ${report.replace(/\n+/g, ' ')}`);
    await adminTelegram.sendMessage(adminId, report).catch(() => {});
  } catch (err) {
    // Например, не удалось скачать медиа или упала БД
    await finishBroadcast(state.id, { status: 'error', ...state, error: err.message }).catch(() => {});
    await adminTelegram.sendMessage(
      adminId,
      `⚠️ Рассылка #${state.id} остановлена из-за ошибки: ${err.message}\n` +
      `Успели отправить: ${state.sent}`
    ).catch(() => {});
    throw err;
  }
}

module.exports = { startBroadcast, sendTest, getCurrentBroadcast };

// Админы бота рассылки, попытки входа и история рассылок
const crypto = require('crypto');
const { pool } = require('../db');

const MAX_ATTEMPTS = 5;      // столько неверных попыток подряд
const LOCK_MINUTES = 15;     // на столько минут блокируем

// ─── АДМИНЫ ───────────────────────────────────────────────────────────────────
async function isAdmin(telegramId) {
  const { rowCount } = await pool.query('SELECT 1 FROM admin_users WHERE telegram_id = $1', [telegramId]);
  return rowCount > 0;
}

async function addAdmin(telegramId, username) {
  await pool.query(
    `INSERT INTO admin_users (telegram_id, telegram_username) VALUES ($1, $2)
     ON CONFLICT (telegram_id) DO UPDATE SET telegram_username = $2`,
    [telegramId, username]
  );
}

async function removeAdmin(telegramId) {
  await pool.query('DELETE FROM admin_users WHERE telegram_id = $1', [telegramId]);
}

// ─── ПАРОЛЬ ───────────────────────────────────────────────────────────────────
// Сравниваем хеши за постоянное время, чтобы пароль нельзя было подобрать по времени ответа
function checkPassword(given) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(given ?? '').trim()).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Если пользователь заблокирован — вернёт дату окончания блокировки, иначе null
async function getLockedUntil(telegramId) {
  const { rows } = await pool.query(
    'SELECT locked_until FROM admin_login_attempts WHERE telegram_id = $1 AND locked_until > NOW()',
    [telegramId]
  );
  return rows[0]?.locked_until || null;
}

// Засчитать неверную попытку. Возвращает { attemptsLeft, lockedUntil }.
// Старые ошибки (больше 15 минут назад) не копятся — счёт начинается заново.
async function registerFailedAttempt(telegramId) {
  const { rows } = await pool.query(
    `INSERT INTO admin_login_attempts (telegram_id, failed_count, last_failed_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET
       failed_count = CASE
         WHEN admin_login_attempts.last_failed_at < NOW() - INTERVAL '${LOCK_MINUTES} minutes' THEN 1
         ELSE admin_login_attempts.failed_count + 1
       END,
       last_failed_at = NOW()
     RETURNING failed_count`,
    [telegramId]
  );
  const failed = rows[0].failed_count;

  if (failed >= MAX_ATTEMPTS) {
    const { rows: locked } = await pool.query(
      `UPDATE admin_login_attempts
       SET failed_count = 0, locked_until = NOW() + INTERVAL '${LOCK_MINUTES} minutes'
       WHERE telegram_id = $1
       RETURNING locked_until`,
      [telegramId]
    );
    return { attemptsLeft: 0, lockedUntil: locked[0].locked_until };
  }
  return { attemptsLeft: MAX_ATTEMPTS - failed, lockedUntil: null };
}

async function resetAttempts(telegramId) {
  await pool.query('DELETE FROM admin_login_attempts WHERE telegram_id = $1', [telegramId]);
}

// ─── ИСТОРИЯ РАССЫЛОК ─────────────────────────────────────────────────────────
async function createBroadcast({ adminId, contentType, text, filters, total }) {
  const { rows } = await pool.query(
    `INSERT INTO broadcasts (admin_telegram_id, content_type, text, filters, total)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [adminId, contentType, text, JSON.stringify(filters), total]
  );
  return rows[0].id;
}

async function updateBroadcastProgress(id, { sent, failed, blocked }) {
  await pool.query(
    'UPDATE broadcasts SET sent = $2, failed = $3, blocked = $4 WHERE id = $1',
    [id, sent, failed, blocked]
  );
}

async function finishBroadcast(id, { status, sent, failed, blocked, error = null }) {
  await pool.query(
    `UPDATE broadcasts
     SET status = $2, sent = $3, failed = $4, blocked = $5, error = $6, finished_at = NOW()
     WHERE id = $1`,
    [id, status, sent, failed, blocked, error]
  );
}

// После перезапуска процесса незавершённые рассылки помечаем как прерванные
async function markInterruptedBroadcasts() {
  const { rowCount } = await pool.query(
    `UPDATE broadcasts SET status = 'interrupted', finished_at = NOW() WHERE status = 'running'`
  );
  return rowCount;
}

async function getRecentBroadcasts(limit = 10) {
  const { rows } = await pool.query(
    'SELECT * FROM broadcasts ORDER BY id DESC LIMIT $1',
    [limit]
  );
  return rows;
}

module.exports = {
  isAdmin, addAdmin, removeAdmin,
  checkPassword, getLockedUntil, registerFailedAttempt, resetAttempts,
  createBroadcast, updateBroadcastProgress, finishBroadcast, markInterruptedBroadcasts, getRecentBroadcasts,
  MAX_ATTEMPTS, LOCK_MINUTES,
};

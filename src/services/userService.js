const { pool } = require('../db');

async function findUserByTelegramId(telegramId) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE telegram_id = $1',
    [telegramId]
  );
  return rows[0] || null;
}

async function createUser(telegramId, username) {
  const { rows } = await pool.query(
    `INSERT INTO users (telegram_id, telegram_username)
     VALUES ($1, $2)
     ON CONFLICT (telegram_id) DO UPDATE SET telegram_username = $2
     RETURNING *`,
    [telegramId, username]
  );
  return rows[0];
}

async function authorizeUser(telegramId, oxUserId, phone) {
  const { rows } = await pool.query(
    `UPDATE users
     SET ox_user_id = $1, phone = $2, is_authorized = TRUE
     WHERE telegram_id = $3
     RETURNING *`,
    [oxUserId, phone, telegramId]
  );
  return rows[0];
}

async function findUserByOxId(oxUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE ox_user_id = $1',
    [oxUserId]
  );
  return rows[0] || null;
}

// true — продажа обрабатывается впервые, false — уже была обработана
async function markSaleProcessed(saleId) {
  const { rowCount } = await pool.query(
    'INSERT INTO processed_sales (sale_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [saleId]
  );
  return rowCount > 0;
}

module.exports = { findUserByTelegramId, createUser, authorizeUser, findUserByOxId, markSaleProcessed };

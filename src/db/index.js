const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        telegram_username VARCHAR(255),
        ox_user_id VARCHAR(255),
        phone VARCHAR(20),
        is_authorized BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS processed_sales (
        sale_id BIGINT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Админы бота рассылки (вошли по паролю)
      CREATE TABLE IF NOT EXISTS admin_users (
        telegram_id BIGINT PRIMARY KEY,
        telegram_username VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Неверные попытки ввода пароля (защита от подбора)
      CREATE TABLE IF NOT EXISTS admin_login_attempts (
        telegram_id BIGINT PRIMARY KEY,
        failed_count INT NOT NULL DEFAULT 0,
        last_failed_at TIMESTAMPTZ,
        locked_until TIMESTAMPTZ
      );

      -- История рассылок
      CREATE TABLE IF NOT EXISTS broadcasts (
        id SERIAL PRIMARY KEY,
        admin_telegram_id BIGINT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'running',
        content_type VARCHAR(10) NOT NULL,
        text TEXT,
        filters JSONB,
        total INT NOT NULL DEFAULT 0,
        sent INT NOT NULL DEFAULT 0,
        failed INT NOT NULL DEFAULT 0,
        blocked INT NOT NULL DEFAULT 0,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );
    `);
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };

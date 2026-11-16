// Аудитория рассылки: привязанные клиенты основного бота + их регион и пол из OX
const { pool } = require('../db');
const { getCustomersByIds, extractRegion, extractGender } = require('./oxApi');

// Загрузить всех авторизованных пользователей и дополнить их данными из OX.
// Если OX не ответил, бросаем ошибку: без данных фильтры сработали бы неверно.
async function loadAudience() {
  const { rows } = await pool.query(
    `SELECT telegram_id, telegram_username, ox_user_id
     FROM users
     WHERE is_authorized = TRUE AND ox_user_id IS NOT NULL
     ORDER BY id`
  );

  const ids = [...new Set(rows.map((r) => String(r.ox_user_id)))];
  const customers = ids.length ? await getCustomersByIds(ids) : [];
  const byId = new Map(customers.map((c) => [String(c.id), c]));

  return rows.map((r) => {
    const customer = byId.get(String(r.ox_user_id));
    return {
      telegramId: String(r.telegram_id),
      username: r.telegram_username,
      oxUserId: String(r.ox_user_id),
      name: customer?.profile?.fullName?.trim() || null,
      region: customer ? extractRegion(customer) : null,
      gender: customer ? extractGender(customer) : null,
      foundInOx: Boolean(customer),
    };
  });
}

// Список регионов с количеством клиентов, по алфавиту
function listRegions(audience) {
  const counts = new Map();
  for (const a of audience) {
    if (a.region) counts.set(a.region, (counts.get(a.region) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], 'ru'))
    .map(([name, count]) => ({ name, count }));
}

// Проходит ли клиент фильтры.
// regions: [] — все регионы. gender: 'all' | 'male' | 'female'.
// Правило: у кого регион или пол НЕ указан — получает рекламу всегда.
function matchesFilters(person, { regions = [], gender = 'all' } = {}) {
  if (regions.length > 0 && person.region && !regions.includes(person.region)) return false;
  if (gender !== 'all' && person.gender && person.gender !== gender) return false;
  return true;
}

function filterAudience(audience, filters) {
  return audience.filter((p) => matchesFilters(p, filters));
}

// Человекочитаемое описание фильтров
function describeFilters({ regions = [], gender = 'all' } = {}) {
  const genderText = { all: 'Все', male: 'Мужчины', female: 'Женщины' }[gender] || gender;
  const regionText = regions.length ? regions.join(', ') : 'Все регионы';
  return { regionText, genderText };
}

module.exports = { loadAudience, listRegions, matchesFilters, filterAudience, describeFilters };

// Проверка рассылки БЕЗ отправки: показывает, кого выберет фильтр.
//
// Примеры (запускать из папки проекта):
//   node scripts/broadcastDryRun.js                                  — все клиенты, список регионов
//   node scripts/broadcastDryRun.js --gender female                  — только женщины (+ без пола)
//   node scripts/broadcastDryRun.js --region "Тошкент Шахар" --region "Самарканд" --gender male
//   node scripts/broadcastDryRun.js --inspect 2                      — сырой ответ OX для 2 клиентов
//   node scripts/broadcastDryRun.js --all                            — напечатать всех получателей
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pool } = require('../src/db');
const { getCustomersByIds, extractRegion, extractGender } = require('../src/services/oxApi');
const { loadAudience, listRegions, filterAudience, describeFilters } = require('../src/services/audienceService');

function parseArgs(argv) {
  const args = { regions: [], gender: 'all', inspect: 0, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--region') args.regions.push(String(argv[++i] || '').replace(/\s+/g, ' ').trim());
    else if (a === '--gender') args.gender = argv[++i];
    else if (a === '--inspect') args.inspect = Number(argv[++i]) || 2;
    else if (a === '--all') args.all = true;
  }
  if (!['all', 'male', 'female'].includes(args.gender)) {
    throw new Error('--gender может быть только male, female или all');
  }
  return args;
}

// Показать, что реально приходит от OX: пол и fieldGroups
async function inspect(count) {
  const { rows } = await pool.query(
    'SELECT ox_user_id FROM users WHERE is_authorized = TRUE AND ox_user_id IS NOT NULL ORDER BY id DESC LIMIT $1',
    [count]
  );
  const customers = await getCustomersByIds(rows.map((r) => String(r.ox_user_id)));
  for (const c of customers) {
    console.log(`\n── Клиент OX id=${c.id} (${c.profile?.fullName || 'без имени'})`);
    console.log('profile.gender =', JSON.stringify(c.profile?.gender));
    console.log('fieldGroups =', JSON.stringify(c.fieldGroups, null, 2));
    console.log('→ регион, который увидит бот:', JSON.stringify(extractRegion(c)));
    console.log('→ пол, который увидит бот:', JSON.stringify(extractGender(c)));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.inspect) {
    await inspect(args.inspect);
    return;
  }

  console.log('⏳ Загружаю клиентов из OX…');
  const audience = await loadAudience();
  const notFound = audience.filter((p) => !p.foundInOx).length;

  console.log(`\nВсего привязанных клиентов: ${audience.length} (не найдены в OX: ${notFound})`);
  console.log('\nРегионы:');
  for (const r of listRegions(audience)) console.log(`  ${r.name} — ${r.count}`);
  console.log(`  (регион не указан) — ${audience.filter((p) => !p.region).length}`);
  console.log(`\nПол: мужчины ${audience.filter((p) => p.gender === 'male').length}, ` +
    `женщины ${audience.filter((p) => p.gender === 'female').length}, ` +
    `не указан ${audience.filter((p) => !p.gender).length}`);

  const filters = { regions: args.regions, gender: args.gender };
  const known = new Set(listRegions(audience).map((r) => r.name));
  for (const r of args.regions) {
    if (!known.has(r)) console.warn(`⚠️ Региона «${r}» нет ни у одного клиента — проверьте написание`);
  }

  const recipients = filterAudience(audience, filters);
  const { regionText, genderText } = describeFilters(filters);
  console.log(`\n🎯 Фильтр: регион = ${regionText}; пол = ${genderText}`);
  console.log(`📨 Получат: ${recipients.length} человек\n`);

  const shown = args.all ? recipients : recipients.slice(0, 50);
  console.table(shown.map((p) => ({
    telegram_id: p.telegramId,
    username: p.username,
    ox_id: p.oxUserId,
    name: p.name,
    region: p.region || '—',
    gender: p.gender || '—',
  })));
  if (shown.length < recipients.length) console.log(`…и ещё ${recipients.length - shown.length} (добавьте --all)`);
  console.log('\nℹ️ Ничего не отправлено — это только проверка.');
}

main()
  .catch((err) => {
    console.error('❌ Ошибка:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

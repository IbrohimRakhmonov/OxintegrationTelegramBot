const axios = require('axios');
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const oxClient = axios.create({
  baseURL: process.env.OX_API_URL || 'https://sparfume.ox-sys.com',
  timeout: 8000,
  headers: {
    'auth-token': process.env.OX_TOKEN,
    'Content-Type': 'application/json',
  },
});

// OX иногда «зависает» на отдельном запросе, а повторный проходит за доли секунды.
// Поэтому при таймауте или 5xx один раз повторяем GET-запрос.
oxClient.interceptors.response.use(null, async (err) => {
  const cfg = err.config;
  const status = err.response?.status;
  const retriable = err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' || status >= 500;
  if (!cfg || cfg.method !== 'get' || cfg._retried || !retriable) throw err;

  cfg._retried = true;
  console.warn(`⚠️ OX ${cfg.url}: ${err.message}, повторяем запрос`);
  return oxClient(cfg);
});

// Последние 9 цифр — номер без кода страны, чтобы +998 90… и 90… совпадали
const phoneKey = (phone = '') => String(phone).replace(/\D/g, '').slice(-9);

// Найти клиента в OX по номеру телефона
async function findCustomerByPhone(phone) {
  const normalizedPhone = phone.replace(/\D/g, '');
  const response = await oxClient.get('/customers', {
    params: { q: normalizedPhone },
  });

  // Поиск q неточный (может найти номер по частичному совпадению),
  // поэтому берём только клиента, у которого номер совпадает полностью
  const key = phoneKey(normalizedPhone);
  const items = response.data?.items ?? [];
  return items.find((c) => (c.profile?.phoneNumbers ?? []).some((p) => phoneKey(p) === key)) || null;
}

async function getSale(saleId) {
  const responce = await oxClient.get('/sells-list', {
    params: { 'id[]': saleId }
  })

  return responce.data.items[0] || null;
}

async function getCustomer(customerId) {
  const responce = await oxClient.get('/customers', {
    params: { 'id[]': customerId }
  })

  const item = responce.data?.items?.[0];
  if (!item) return null;

  // У части клиентов нет wallet / fieldGroups — поэтому везде ?.
  const costumer = {
    fullName: item.profile?.fullName,
    firstName: item.profile?.firstName,
    lastName: item.profile?.lastName,
    id: item.profile?.id,
    middleName: item.profile?.middleName,
    phoneNumbers: item.profile?.phoneNumbers,
    birthDate: item.profile?.birthDate,
    gender: item.profile?.gender,
    photos: item.profile?.photos,
    customerId: item.id,
    email: item.email,
    cards: item.cards,
    walletTotalCash: item.wallet?.totalCash ?? 0,
    region: item.fieldGroups?.[0]?.fields?.[0]?.value ?? null,
  }

  return costumer;
}

const getProduct = async (barCode) => {
  const responce = await oxClient.get('/variations', {
    params : {
      barCode: barCode
    }
  })

  return responce
}

// Получить список заказов клиента
async function getCustomerOrders(oxUserId) {
  const allItems = [];
  let page = 1;
  let totalCount = 0;

  do {
    const response = await oxClient.get('/sells-list', {
      params: {
        'customer[0]': oxUserId,          // ← ключ из вашего рабочего запроса
        size: PAGE_SIZE,
        page,
        sort: 'finishedTime desc',
      },
    });

    const items = response.data?.items ?? [];
    totalCount = response.data?.totalCount ?? 0;
    allItems.push(...items);

    if (items.length < PAGE_SIZE) break; // последняя страница
    page++;
  } while (allItems.length < totalCount && page <= MAX_PAGES);

  // страховка: если фильтр по клиенту не сработал, не покажем чужие чеки
  const items = allItems.filter((o) => o.customer === Number(oxUserId));

  return { items, totalCount: items.length };
}

// Получить баланс кешбека клиента: в OX он лежит в кошельке клиента (wallet.bonus)
async function getCashbackBalance(oxUserId) {
  const response = await oxClient.get('/customers', {
    params: { 'id[]': oxUserId }
  });
  const wallet = response.data?.items?.[0]?.wallet;
  return {
    balance: wallet?.bonus?.UZS ?? 0,
    cash: wallet?.cash?.UZS ?? 0,
    currency: 'UZS',
  };
}

// ─── ДЛЯ РАССЫЛКИ ─────────────────────────────────────────────────────────────

// Сколько клиентов запрашиваем у OX за один раз
const CUSTOMERS_BATCH = 50;

// Загрузить сразу нескольких клиентов: GET /customers?id[]=1&id[]=2...
// По умолчанию OX отдаёт 20 записей на страницу, поэтому передаём size и,
// если OX всё равно вернул меньше, догружаем следующие страницы.
async function getCustomersByIds(ids) {
  const result = [];
  for (let i = 0; i < ids.length; i += CUSTOMERS_BATCH) {
    const batch = ids.slice(i, i + CUSTOMERS_BATCH);
    let received = 0;
    for (let page = 1; page <= 10; page++) {
      const response = await oxClient.get('/customers', {
        params: { 'id[]': batch, size: batch.length, page },
      });
      const items = response.data?.items ?? [];
      const total = Number(response.data?.total_count ?? items.length);
      result.push(...items);
      received += items.length;
      if (items.length === 0 || received >= total) break;
    }
  }
  return result;
}

// Название группы полей, где OX хранит регион клиента
const REGION_GROUP_NAME = 'Все клиенты по Регионам';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Регион клиента: fieldGroups → группа «Все клиенты по Регионам» → первое непустое value.
// Нет группы или поле пустое — возвращаем null (такой клиент получает рекламу всегда).
function extractRegion(customer) {
  const groups = Array.isArray(customer?.fieldGroups) ? customer.fieldGroups : [];
  const group = groups.find((g) => norm(g?.name).toLowerCase() === REGION_GROUP_NAME.toLowerCase());
  if (!group) return null;

  for (const field of group.fields ?? []) {
    let value = field?.value;
    // На случай, если значение придёт объектом (поле-список)
    if (value && typeof value === 'object') value = value.name ?? value.title ?? value.value;
    const text = norm(value);
    if (text) return text;
  }
  return null;
}

// Пол клиента: 'male' / 'female' или null, если не указан
function extractGender(customer) {
  const g = String(customer?.profile?.gender ?? '').toLowerCase().trim();
  return g === 'male' || g === 'female' ? g : null;
}

module.exports = {
  findCustomerByPhone, getCustomerOrders, getCashbackBalance, getSale, getCustomer, getProduct,
  getCustomersByIds, extractRegion, extractGender,
};

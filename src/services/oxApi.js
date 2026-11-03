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

module.exports = { findCustomerByPhone, getCustomerOrders, getCashbackBalance, getSale, getCustomer, getProduct };

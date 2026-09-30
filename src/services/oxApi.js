const axios = require('axios');

const oxClient = axios.create({
  baseURL: process.env.OX_API_URL || 'https://sparfume.ox-sys.com',
  headers: {
    'auth-token': process.env.OX_TOKEN,
    'Content-Type': 'application/json',
  },
});

// Найти клиента в OX по номеру телефона
async function findCustomerByPhone(phone) {
  const normalizedPhone = phone.replace(/\D/g, '');
  const response = await oxClient.get('/customers', {
    params: { q: normalizedPhone },
  });
  return response.data?.items?.[0] || null;
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

  const costumer = {
    fullName: responce.data.items[0].profile.fullName,
    firstName: responce.data.items[0].profile.firstName,
    lastName: responce.data.items[0].profile.lastName,
    id: responce.data.items[0].profile.id,
    middleName: responce.data.items[0].profile?.middleName,
    phoneNumbers: responce.data.items[0].profile?.phoneNumbers,
    birthDate: responce.data.items[0].profile?.birthDate,
    gender: responce.data.items[0].profile?.gender,
    photos: responce.data.items[0].profile?.photos,
    customerId: responce.data.items[0].id,
    email: responce.data.items[0]?.email,
    cards: responce.data.items[0]?.cards,
    walletTotalCash: responce.data.items[0].wallet.totalCash,
    region: responce.data.items[0].fieldGroups[0].fields[0].value,
  }

  return costumer
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
  const response = await oxClient.get(`/customers/${oxUserId}/orders`);
  return response.data?.data || [];
}

// Получить баланс кешбека клиента
async function getCashbackBalance(oxUserId) {
  const response = await oxClient.get(`/customers/${oxUserId}/cashback`);
  return response.data?.data || { balance: 0, currency: 'UZS' };
}

module.exports = { findCustomerByPhone, getCustomerOrders, getCashbackBalance, getSale, getCustomer, getProduct };

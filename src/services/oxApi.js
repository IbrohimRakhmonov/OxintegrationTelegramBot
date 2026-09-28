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

  return responce.data || null;
}

async function getCustomer(customerId) {
  const responce = await oxClient.get('/customers', {
    params: { 'id[]': customerId }
  })

  console.log("responce ",responce);
  console.log("responce.data", responce.data);
  

  return responce.data
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

module.exports = { findCustomerByPhone, getCustomerOrders, getCashbackBalance, getSale, getCustomer };

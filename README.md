# OX System — Telegram Bot

## Структура проекта
```
ox-telegram-bot/
├── src/
│   ├── bot/index.js          # Логика бота (команды, кнопки)
│   ├── api/webhook.js        # Принимает события от OX System
│   ├── db/index.js           # Подключение к PostgreSQL
│   └── services/
│       ├── oxApi.js          # Запросы к OX System API
│       └── userService.js    # Работа с БД пользователей
├── .env.example
├── package.json
└── src/index.js              # Точка входа
```

## Быстрый старт

### 1. Установить зависимости
```bash
npm install
```

### 2. Создать .env файл
```bash
cp .env.example .env
```
Заполните `.env`:
- `TELEGRAM_BOT_TOKEN` — получить у @BotFather в Telegram
- `OX_TOKEN` — Token ключ из настроек OX System
- `OX_API_URL` — базовый URL API OX System
- Данные PostgreSQL

### 3. Создать базу данных
```sql
CREATE DATABASE ox_bot;
```
Таблицы создадутся автоматически при запуске.

### 4. Запустить
```bash
# Разработка (с авто-перезапуском)
npm run dev

# Продакшн
npm start
```

## Настройка Webhook в OX System

Задайте в `.env` секрет `WEBHOOK_SECRET` (длинная случайная строка) и укажите в настройках OX System Webhook URL:
```
https://ВАШ_ДОМЕН/webhook/ox/<WEBHOOK_SECRET>
```
Запросы с неверным секретом получают 404. Каждая продажа обрабатывается один раз (таблица `processed_sales`), поэтому повторы от OX не дублируют уведомления.

> Для локальной разработки используйте [ngrok](https://ngrok.com):
> ```bash
> ngrok http 3000
> ```
> Укажите ngrok URL в настройках OX Webhook.

## Что делает вебхук

Получает `id` продажи, загружает её из OX и отправляет клиенту (если он привязал Telegram) уведомление о покупке.

## Команды бота

- `/start` — регистрация / главное меню
- Кнопка "Поделиться номером" — авторизация через OX (только свой номер Telegram)
- Кнопка "Мои покупки" — сводка и последние 9 заказов
- Кнопка "Кешбек" — текущий баланс

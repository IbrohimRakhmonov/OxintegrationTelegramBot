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

После запуска, в настройках OX System укажите Webhook URL:
```
http://localhost:3000/webhook/ox
```

> Для локальной разработки используйте [ngrok](https://ngrok.com):
> ```bash
> ngrok http 3000
> ```
> Укажите ngrok URL в настройках OX Webhook.

## Поддерживаемые события OX Webhook

| Событие | Что делает бот |
|---------|---------------|
| `order.created` | Уведомляет о новом заказе |
| `order.status_changed` | Уведомляет об изменении статуса |
| `cashback.credited` | Уведомляет о начислении кешбека |

## Команды бота

- `/start` — регистрация / главное меню
- Ввод номера телефона — авторизация через OX
- Кнопка "Мои покупки" — последние 5 заказов
- Кнопка "Кешбек" — текущий баланс

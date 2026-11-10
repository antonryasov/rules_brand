# Установка и обновление Worker

Worker — это серверная часть: принимает заказы с сайта, хранит их в базе D1,
обслуживает личный кабинет и пересылает сообщения в Telegram.

Файл для деплоя: **`worker/dist/worker.js`** (один файл, ничего дополнительно
загружать не нужно).

---

## Вариант 1. Через панель Cloudflare (без установки программ)

1. Откройте `worker/dist/worker.js`, нажмите **Raw** (или «Copy raw contents»),
   скопируйте весь код.
2. Cloudflare → **Workers & Pages** → выберите ваш Worker (например `rules-orders`).
3. **Edit code** → выделите всё (Ctrl/Cmd+A) → вставьте новый код → **Deploy**.
4. Проверьте привязку базы: **Settings → Bindings → D1 database**,
   Variable name = `DB`, база = `rules-orders-db`. Если привязки нет — добавьте.
5. Проверьте секреты: **Settings → Variables and Secrets**:

| Имя | Тип | Значение |
|---|---|---|
| `ADMIN_PASSWORD` | Secret | пароль в личный кабинет, **не короче 16 символов** |
| `SESSION_SECRET` | Secret | случайная строка **не короче 32 символов** |
| `TELEGRAM_BOT_TOKEN` | Secret | токен бота, куда приходят заказы |
| `TELEGRAM_CHAT_ID` | Secret | ваш chat_id |
| `CUSTOMER_BOT_TOKEN` | Secret | токен бота для покупателей (другой бот!) |
| `CUSTOMER_BOT_USERNAME` | Variable | например `rules_clients_bot` |
| `WEBHOOK_SECRET` | Secret | латиница/цифры/`_`/`-`, от 16 символов |
| `ALLOWED_ORIGIN` | Variable | `https://antonryasov.github.io` |

6. Создайте таблицы: **Storage & Databases → D1 → rules-orders-db → Console**,
   вставьте содержимое `worker/schema.sql` → Execute. Повторный запуск безопасен.
7. Заложите товары: в том же консольном поле вставьте содержимое `worker/seed.sql` → Execute.
   (Файл `seed.sql` — это заготовка из `data/products.json`. Если его нет —
   выполните `node worker/scripts/seed.mjs` из корня репозитория.)
8. Включите рассылку очереди по расписанию: **Settings → Trigger Events →
   Add Cron Trigger** → `*/5 * * * *`.
9. Откройте `https://ВАШ-WORKER.workers.dev/admin` — должен появиться вход.
10. В кабинете: **Настройки → Подключить бота покупателей** (регистрирует вебхук)
    и **Тест бота для заказов**.

---

## Вариант 2. Через wrangler (если удобнее командная строка)

```bash
cd worker
npm install
# впишите database_id в wrangler.toml (Cloudflare → D1 → rules-orders-db)
npm run schema        # таблицы CRM
npm run seed          # товары из data/products.json
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put CUSTOMER_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

Секреты можно один раз задать и через панель — они сохраняются между деплоями.

---

## Как обновить код после правок в `admin/`

Интерфейс кабинета лежит в `admin/` и вшивается в Worker при сборке:

```bash
cd worker
node build.mjs      # создаст dist/worker.js
```

Дальше — скопировать `dist/worker.js` в Cloudflare (вариант 1) или `npm run deploy`.

---

## Что умеет Worker (карта адресов)

| Адрес | Назначение |
|---|---|
| `GET /catalog` | живой каталог для сайта (CORS разрешён только вашему домену) |
| `POST /order` | приём заказа с сайта, проверка цен и остатков, уведомление в Telegram |
| `POST /telegram` | вебхук бота покупателей (статусы, «Мои заказы», сообщения) |
| `GET /admin` | личный кабинет |
| `/admin/api/*` | API кабинета (вход, заказы, товары, импорт, экспорт) |
| `GET /health` | проверка, что Worker жив |

---

## Таблицы базы

| Таблица | Что хранит |
|---|---|
| `orders` | заказы (как и раньше) |
| `order_items` | состав заказа после правок в кабинете |
| `order_comments` | переписка по заказу: продавец, покупатель, системные записи |
| `order_extra` | оплата, доставка, стоимость доставки |
| `products` | каталог: цены, остатки, описания, фото |
| `subscribers`, `news`, `outbox`, `login_attempts` | рассылка и служебное |

Ничего из старых данных не удаляется: `schema.sql` использует
`CREATE TABLE IF NOT EXISTS`.

---

## Проверка после установки

```bash
curl https://ВАШ-WORKER.workers.dev/health          # {"ok":true,...}
curl https://ВАШ-WORKER.workers.dev/catalog | head  # список товаров
```

В браузере: `https://ВАШ-WORKER.workers.dev/admin` → вход → раздел «Заказы».

---

## Если понадобится сменить домен сайта

1. Поправьте `ALLOWED_ORIGIN` (Cloudflare → Variables and Secrets).
2. Поправьте `data/settings.json` → `api.base`, если меняется адрес Worker.
3. В кабинете нажмите «Подключить бота покупателей» — вебхук привязан к домену Worker.

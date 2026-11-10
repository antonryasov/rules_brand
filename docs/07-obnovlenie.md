# Обновление 2026-11: что исправлено и как это повторить руками

Девять задач: старая цена и бейдж, страницы новых товаров, приглашение в Telegram после заказа,
меню бота покупателей, удобство бота, вложения в переписке, доставка СДЭК (отложена),
**адрес доставки вводится вручную в корзине**, **промокод-подарок RYASOVLOVESYOU**.

Файлы, которые участвуют в правках:

| Файл | Что в нём меняется |
|---|---|
| `worker/src/worker.js` | сервер: каталог, заказ, бот, вложения, СДЭК |
| `worker/worker.js` | **собранный** файл — то, что копируется в Cloudflare (`node build.mjs`) |
| `admin/app.js`, `admin/app.css` | личный кабинет: вложения, поле адреса ПВЗ |
| `assets/js/store.js` | загрузка каталога: страница товара = id |
| `assets/js/render.js` | карточки: бейдж на странице товара, картинка-заглушка |
| `assets/js/cart.js` | корзина: доставка, экран «заказ принят» |
| `index.html` | разметка блока «Доставка» и итогов |
| `assets/css/shop.css`, `assets/css/extra.css` | стили доставки и экрана «заказ принят» |
| `worker/schema.sql` | новые колонки и таблица `bot_state` |

Порядок применения: **1) правки сайта → 2) коммит → 3) `node build.mjs` → 4) новый `worker/worker.js` в Cloudflare → 5) Deploy**.
Схему базы отдельно выполнять не обязательно: Worker добавляет нужные колонки сам при первом запросе.

---

## 1. Старая цена и бейдж не применялись

### Почему

В `worker/src/worker.js` была функция, которая собирала значения полей товара:

```js
/* БЫЛО */
const g = (k, d = '') => (input[k] != null ? input[k] : existing && existing[k] != null ? existing[k] : d);
```

Кабинет отправляет поля в «верблюжьем» написании (`oldPrice`, `fullName`, `typeLabel`),
а база хранит в «змеином» (`old_price`, `full_name`, `type_label`). Вызовы выглядели так:

```js
old_price: int(g('old_price', g('oldPrice', 0)), 0, 0, 10000000),
```

Порядок разбора: сначала искалось `old_price` в запросе — его там нет; затем
`old_price` в базе — там уже было значение (например, 0) — и оно побеждало.
`oldPrice` из кабинета не доходил никогда. Так же молча терялись
**полное название, подпись типа, примечание о доставке, кросс-продажа**.

Бейдж страдал в другом месте: он рисовался только в карточке каталога, а на странице
товара его не было вовсе — казалось, что он «не применился».

### Как исправить

`worker/src/worker.js`, функция `productRowFromInput` — замените начало функции:

```js
function productRowFromInput(input, existing) {
  /* сначала поле из запроса (в любом написании: old_price / oldPrice),
     затем значение из базы, затем значение по умолчанию */
  const g = (k, d = '', alt) => {
    if (input[k] != null) return input[k];
    if (alt && input[alt] != null) return input[alt];
    if (existing && existing[k] != null) return existing[k];
    return d;
  };
  const id = clean(String(g('id', '')), 60).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const name = clean(String(g('name', '')), 120);
  const page = clean(String(g('page', '')), 80) || (id ? id + '.html' : '');
  return {
    id,
    page,
    ...
```

и все «двойные» вызовы перепишите на третий аргумент:

```js
/* БЫЛО → СТАЛО */
g('old_price', g('oldPrice', 0))          →  g('old_price', 0, 'oldPrice')
g('full_name', g('fullName', name))       →  g('full_name', name, 'fullName')
g('type_label', g('typeLabel', ''))       →  g('type_label', '', 'typeLabel')
g('lead', g('description', ''))           →  g('lead', '', 'description')
g('delivery_note', g('deliveryNote', '')) →  g('delivery_note', '', 'deliveryNote')
g('cross_sell', g('crossSell', ''))       →  g('cross_sell', '', 'crossSell')
```

Бейдж на странице товара — `assets/js/render.js`, в шаблоне `R.productPage`, перед строкой со слоганом:

```js
'<div class="pdp-title"><div>' +
  (p.badge ? '<div class="pdp-badge">' + esc(p.badge) + '</div>' : '') +
  (p.tagline ? '<div class="tagline">' + esc(p.tagline) + '</div>' : '') +
```

Стиль — `assets/css/extra.css`:

```css
.pdp-badge{display:inline-block;margin-bottom:14px;font-size:11px;letter-spacing:.18em;
  text-transform:uppercase;font-weight:700;background:var(--emerald2);color:#070707;padding:7px 12px}
```

### Проверка

Кабинет → Товары → «Править» → Старая цена `2190`, Бейдж `НОВИНКА` → Сохранить.
Через 30 секунд на сайте: в каталоге цена `1 890 ₽` с зачёркнутой `2 190 ₽` и плашка «НОВИНКА»,
на странице товара — плашка сверху.

---

## 2. Новый товар появлялся в каталоге, но без своей страницы

### Почему

Страница товара на сайте — это адрес вида `#/<id>.html`. Сайт ищет товар по полю `page`.
В кабинете поле `page` не заполнялось, в базе оставалась пустая строка, и ссылка
вела в никуда (роутер не находил товар и показывал главную).

### Как исправить

**Сервер** — страница создаётся автоматически при сохранении товара
(это уже есть в исправленном `productRowFromInput` выше):

```js
/* у нового товара страница создаётся сама: <id>.html */
const page = clean(String(g('page', '')), 80) || (id ? id + '.html' : '');
```

**Сайт, страховка** — `assets/js/store.js`, в функции `normalize`, после строки
`if (!out.fullName) out.fullName = out.name;`:

```js
/* у товара, созданного в кабинете, может не быть поля page —
   страница называется так же, как id */
if (!out.page && out.id) out.page = out.id + '.html';
```

и в `S.productByPage` — поиск ещё и по id:

```js
S.productByPage = function (page) {
  var slug = String(page || '').toLowerCase();
  var wanted = slug.replace(/\.html$/, '');
  for (var i = 0; i < S.products.length; i++) {
    var p = S.products[i];
    if (p.page === slug) return p;
    if (String(p.id).toLowerCase() === wanted) return p;   /* ← страховка */
  }
  return null;
};
```

**Картинка-заглушка** для товара без фото — `assets/js/render.js`, рядом с `R.esc = esc;`:

```js
var PLACEHOLDER = 'assets/img/placeholder.svg';
function photo(p, big) {
  var src = big ? (p.images.hero || p.images.card) : (p.images.card || p.images.hero);
  return esc(src || PLACEHOLDER);
}
R.photo = photo;
```

и вместо `esc(p.images.card)` / `esc(p.images.hero || p.images.card)` в шаблонах
карточек и страницы товара используйте `photo(p)` и `photo(p, true)`.
Сам файл `assets/img/placeholder.svg` — тёмный квадрат с надписью RULES.

### Проверка

Кабинет → Товары → «+ Товар», ID `candle-veter`, цена, остаток → Сохранить.
Откройте `…/index.html#/candle-veter` — страница есть, кнопка «В корзину» работает.

---

## 3. После заказа — приглашение в Telegram

### Почему

Сайт показывал одну строку текста и маленькую ссылку под ней — покупатель не понимал,
что нужно нажать «Запустить» в боте, иначе статусы не придут.

### Как исправить

`assets/js/cart.js`, в функции `send()` замените блок, который начинался с
`success.textContent = 'Заказ № ' + ...` на такой (сокращённо, полный — в файле):

```js
var num = data.id.slice(0, 8).toUpperCase();
var botOk = typeof data.bot === 'string' && /^[a-zA-Z0-9_]{5,32}$/.test(data.bot) && /bot$/i.test(data.bot);
var link = botOk ? 'https://t.me/' + data.bot + '?start=' + pending.token : '';
success.innerHTML =
  '<div class="order-done">' +
    '<div class="order-done-head">Заказ № ' + num + ' принят</div>' +
    '<p class="order-done-text">Мы получили заказ и свяжемся с вами для подтверждения.</p>' +
    '<p class="order-done-text">' + escapeHtml(dlvLine) + '</p>' +
    (botOk
      ? '<div class="order-done-bot">' +
          '<div class="order-done-bot-title">Включите отслеживание в Telegram</div>' +
          '<p class="order-done-text">Нажмите кнопку — откроется бот <b>@' + data.bot + '</b>. ' +
            'В нём нажмите «Запустить» (Start) — заказ привяжется автоматически, и все статусы будут приходить в чат.</p>' +
          '<a class="btn shop-submit order-done-btn" href="' + link + '" target="_blank" rel="noopener noreferrer">' +
            'Открыть бота и получать статусы ↗</a>' +
          '<p class="shop-hint">Бот не открылся? Найдите в Telegram @' + data.bot + ', нажмите «Запустить» и отправьте код: ' +
            '<code class="order-done-code">' + pending.token + '</code></p>' +
        '</div>'
      : '<p class="shop-hint">Отслеживание в Telegram пока не подключено.</p>') +
  '</div>';
```

Стили — `assets/css/shop.css`, в конец файла (классы `.order-done*`).

Сервер уже отдаёт всё нужное: `/order` возвращает `{ id, total, bot, delivery }`,
а ссылка `t.me/<bot>?start=<код>` привязывает именно этот заказ (код живёт 14 дней).

### Проверка

Оформите тестовый заказ — в корзине появится зелёный блок с кнопкой.
Нажмите её с телефона: откроется бот, «Запустить» → «Заказ № … привязан».

---

## 4–5. Бот покупателей: меню, заказы, выбор заказа, удобство

### Что теперь умеет бот

| Команда | Действие |
|---|---|
| `/start` | приветствие и меню |
| `/start <код>` | привязать заказ по коду из ссылки |
| `/menu` | главное меню (кнопки) |
| `/orders` | список заказов, каждый — кнопкой |
| `/status` | карточка активного заказа |
| `/catalog` | каталог с ценами и наличием |
| `/help` | как всё работает, доставка, оплата |

Кнопки (inline): «Мои заказы», «Активный заказ», «Каталог», «Помощь»,
в карточке заказа — «Выбрать для переписки», «Обновить», «Все заказы».
Системное меню Telegram (кнопка ☰ слева от поля ввода) заполняется автоматически
через `setMyCommands` при первом сообщении.

Логика переписки: у каждого чата есть **активный заказ** (таблица `bot_state`).
Всё, что покупатель пишет или прикладывает, падает в этот заказ; если активного нет,
а заказ один — бот сам его выбирает; если заказов несколько — просит выбрать кнопкой.

### Как это устроено в коде

Всё лежит в `worker/src/worker.js`, раздел «бот покупателей». Ключевые функции:

```js
const BOT_COMMANDS = [
  { command: 'start',   description: 'Запустить и привязать заказ' },
  { command: 'menu',    description: 'Главное меню' },
  { command: 'orders',  description: 'Мои заказы' },
  { command: 'status',  description: 'Статус активного заказа' },
  { command: 'catalog', description: 'Каталог и цены' },
  { command: 'help',    description: 'Помощь и доставка' }
];

async function setupBot(env) {                 /* один раз на инстанс */
  await telegram(env.CUSTOMER_BOT_TOKEN, 'setMyCommands', { commands: BOT_COMMANDS });
  await telegram(env.CUSTOMER_BOT_TOKEN, 'setChatMenuButton', { menu_button: { type: 'commands' } });
}

async function botSend(env, chatId, text, keyboard) {
  const payload = { chat_id: chatId, text, disable_web_page_preview: true };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  try { return await telegram(env.CUSTOMER_BOT_TOKEN, 'sendMessage', payload); }
  catch (e) { console.error('BOT_SEND_ERROR', e.message); return null; }  /* бот не должен падать из-за Telegram */
}
```

Дальше идут `botHome`, `botOrders`, `botOrderCard`, `botActive`, `botCatalog`, `botHelp`,
`setActive` / `getActive` (активный заказ), `bindOrder` (привязка по коду),
`customerMessage` (сообщение покупателя → в заказ).

Обработка нажатий в `webhook()`:

```js
if (data === 'menu:orders')  { await botOrders(env, chatId); return new Response('OK'); }
if (data === 'menu:active')  { await botActive(env, chatId); return new Response('OK'); }
if (data === 'menu:catalog') { await botCatalog(env, chatId); return new Response('OK'); }
if (data === 'menu:help')    { await botHelp(env, chatId); return new Response('OK'); }
if (data === 'menu:home')    { await botHome(env, chatId); return new Response('OK'); }
if (data.startsWith('o:'))   { await botOrderCard(env, chatId, data.slice(2)); return new Response('OK'); }
if (data.startsWith('chat:')){ /* выбрать заказ для переписки */
  await setActive(env, chatId, data.slice(5));
  ...
}
```

Таблица для активного заказа (создаётся автоматически, есть и в `schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS bot_state (
  chat_id         TEXT PRIMARY KEY,
  active_order_id TEXT NOT NULL DEFAULT '',
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Проверка

1. Оформите заказ, нажмите «Открыть бота» → «Запустить».
2. `/orders` — список с кнопками; нажмите заказ — придёт карточка с составом,
   доставкой, треком.
3. Напишите текст — он появится в кабинете в переписке этого заказа,
   а вам в бот заказов придёт уведомление.
4. Отправьте боту фото — в кабинете появится превью.

---

## 6. Вложения в переписке (фото чеков, документы)

### Как работает

Файл не хранится у нас: Worker отправляет его в Telegram (`sendPhoto` или `sendDocument`),
а в базу пишет `file_id` и тип. Кабинет показывает вложение через Worker —
адрес `/admin/api/file?f=<file_id>&t=<токен сессии>`, так что токен бота в браузер не попадает.

Если покупатель ещё не привязал бота, файл уходит в ваш чат с ботом заказов
(тогда в базе он помечен префиксом `o:` вместо `c:`) — и всё равно виден в карточке.

### Что добавить в код

**1. Колонки** (Worker добавляет сам, см. `ensureSchema`):

```js
const EXTRA_COLUMNS = [
  ['order_comments', 'kind', "TEXT NOT NULL DEFAULT 'text'"],   /* text | photo | document */
  ['order_comments', 'file_id', "TEXT NOT NULL DEFAULT ''"],
  ['order_comments', 'file_name', "TEXT NOT NULL DEFAULT ''"],
  ['order_extra', 'delivery_point_code', "TEXT NOT NULL DEFAULT ''"],
  ['order_extra', 'delivery_point_address', "TEXT NOT NULL DEFAULT ''"],
  ['order_extra', 'delivery_tariff', "TEXT NOT NULL DEFAULT ''"]
];

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  for (const [table, column, type] of EXTRA_COLUMNS) {
    try { await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run(); }
    catch (e) { /* колонка уже есть */ }
  }
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS bot_state (
      chat_id TEXT PRIMARY KEY, active_order_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  } catch (e) {}
  schemaReady = true;
}
```

`ensureSchema(env)` вызывается в начале `createOrder`, `adminApi` и `webhook`.

**2. Загрузка в Telegram** (`worker/src/worker.js`, перед `notifyCustomer`):

```js
async function telegramUpload(env, token, method, fields, file) {
  const form = new FormData();
  Object.keys(fields).forEach((k) => {
    if (fields[k] != null && fields[k] !== '') form.append(k, String(fields[k]));
  });
  const name = file.name || (file.type && file.type.startsWith('image/') ? 'photo.jpg' : 'file.bin');
  form.append(method === 'sendPhoto' ? 'photo' : 'document', file, name);
  const r = await fetch('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', body: form });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.ok) throw new Error('TELEGRAM_UPLOAD_' + r.status);
  const m = d.result;
  const doc = m.photo ? m.photo[m.photo.length - 1] : m.document || {};
  return { fileId: doc.file_id || '', fileName: (m.document && m.document.file_name) || name };
}
```

**3. Обработчик комментария** — `/admin/api/orders/:id/comments` теперь принимает и JSON,
и `multipart/form-data`:

```js
if (ctype.startsWith('multipart/form-data')) {
  const fd = await request.formData();
  body = clean(String(fd.get('body') || ''), 1500);
  notify = String(fd.get('notify') || 'true') !== 'false';
  const f = fd.get('file');
  if (f && typeof f === 'object' && Number(f.size) > 0) file = f;
}
```

дальше — если файл картинка, `sendPhoto`, иначе `sendDocument`; в базу пишется
`kind`, `file_id`, `file_name`, а сообщение помечается отправленным, если покупатель в боте.

**4. Показ файла в кабинете** — маршрут в главном `fetch`:

```js
if (path === '/admin/api/file') {
  return await serveTelegramFile(env, url.searchParams.get('f') || '', url.searchParams.get('t') || '');
}
```

**5. Кабинет** (`admin/app.js`):

```js
function apiUpload(path, form) {           /* запрос с файлом */
  return fetch(API + path, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: form })
    .then((r) => r.json().catch(() => ({})).then((data) => {
      if (r.status === 401) { token = ''; localStorage.removeItem('rules-admin-token'); renderLogin('Сессия истекла — войдите заново.'); throw new Error('unauthorized'); }
      if (!r.ok) throw new Error(data.error || 'Ошибка запроса');
      return data;
    }));
}
function fileUrl(fileId) { return API + '/file?f=' + encodeURIComponent(fileId) + '&t=' + encodeURIComponent(token); }
```

и в карточке заказа — кнопка «Прикрепить фото или документ» + скрытый `<input type="file">`,
а отправка идёт через `FormData` (`body`, `notify`, `file`).
В ленте переписки фото выводится как `<img class="attach">`, документ — ссылкой.

### Проверка

Кабинет → Заказы → заказ, где покупатель нажал «Запустить» → «Прикрепить фото или документ»
→ выбрать чек → «Добавить комментарий». Покупателю придёт фото в бот, в карточке
появится превью с плашкой «фото» и «отправлено в TG». Ответ покупателя фото тоже виден.

> Ограничение Telegram — 20 МБ на файл; больше Worker вернёт понятную ошибку.

---

## 7. Доставка СДЭК в корзине — отложено

> Этот раздел оставлен как справка. Сейчас СДЭК **не используется**: корзина не обращается
> к API СДЭК и не требует ключей. Покупатель вводит адрес руками — см. раздел 8.
> Код СДЭК в Worker (`cdekPoints`, `cdekCalc`, `/delivery/points`, `/delivery/calc`) остался
> и включится сам, если когда-нибудь появятся ключи.

### Схема работы

```
Корзина → GET  /delivery/config     (подключён ли СДЭК, какие способы)
        → GET  /delivery/points?city=Москва   (пункты выдачи)
        → POST /delivery/calc   {city, method} (стоимость и срок)
        → POST /order           { … , delivery:{method, city, pointCode, pointAddress} }
```

Ключи СДЭК лежат только в секретах Cloudflare, сайт их не видит.
Стоимость при приёме заказа **пересчитывается на сервере** — подменить цену из браузера нельзя.

### Секреты и переменные

| Имя | Значение |
|---|---|
| `CDEK_CLIENT_ID` | из личного кабинета СДЭК → Интеграция → API |
| `CDEK_CLIENT_SECRET` | там же |
| `CDEK_TEST` | `1` — тестовый контур `api.edu.cdek.ru`, `0` — боевой |
| `CDEK_FROM_CITY` | город склада, например `Москва` |
| `CDEK_TARIFF_PVZ` | тариф «склад-склад» (пункт выдачи), по умолчанию `136` |
| `CDEK_TARIFF_COURIER` | тариф «склад-дверь» (курьер), по умолчанию `137` |
| `CDEK_WEIGHT`, `CDEK_LENGTH`, `CDEK_WIDTH`, `CDEK_HEIGHT` | габариты посылки: `1500`, `30`, `20`, `15` |

Без ключей сайт просто показывает «Обсудить с продавцом» — оформление заказов работает как раньше.

### Серверная часть (уже в `worker/src/worker.js`)

```js
async function cdekToken(env) {              /* токен живёт час, кэшируем */
  if (cdekCache.token && cdekCache.exp > Date.now() + 60000) return cdekCache.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: String(env.CDEK_CLIENT_ID),
    client_secret: String(env.CDEK_CLIENT_SECRET)
  });
  const r = await fetch(cdekBase(env) + '/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString()
  });
  const d = await r.json();
  cdekCache.token = d.access_token;
  cdekCache.exp = Date.now() + (Number(d.expires_in) || 3600) * 1000;
  return cdekCache.token;
}
```

Дальше: `cdekCity` (название города → код через `/location/cities`),
`cdekPoints` (`/deliverypoints?city_code=…&type=PVZ`),
`cdekCalc` (`/calculator/tariff`), `resolveDelivery` (валидация выбора в заказе)
и `deliveryApi` — три публичные ручки с CORS.

Приём заказа: в `createOrder` перед проверкой покупателя добавлено

```js
const delivery = await resolveDelivery(env, b.delivery);
```

и запись в `order_extra`:

```js
"INSERT OR IGNORE INTO order_extra(order_id,payment_status,delivery_method,delivery_cost,
   delivery_point_code,delivery_point_address,delivery_tariff) VALUES(?,'none',?,?,?,?,?)"
```

Владелец в Telegram видит строку «Доставка: СДЭК, пункт выдачи · адрес — 390 ₽»,
в кабинете появилось поле «Пункт выдачи (адрес СДЭК)» и строка «Доставка» в сумме.

### Сайт: разметка (`index.html`)

После поля «Город доставки»:

```html
<div class="shop-field" id="shop-delivery-field">
  <label class="shop-label">Доставка</label>
  <div class="shop-delivery">
    <label class="shop-radio"><input type="radio" name="delivery" value="cdek_pvz" id="dl-pvz"><span>СДЭК — пункт выдачи</span></label>
    <label class="shop-radio"><input type="radio" name="delivery" value="cdek_courier" id="dl-courier"><span>СДЭК — курьером до двери</span></label>
    <label class="shop-radio"><input type="radio" name="delivery" value="discuss" id="dl-discuss" checked><span>Обсудить с продавцом</span></label>
  </div>
  <div id="shop-pvz" hidden>
    <button type="button" class="shop-action" id="shop-find-pvz">Найти пункты выдачи в моём городе</button>
    <p class="shop-hint" id="shop-pvz-hint"></p>
    <div id="shop-pvz-list" class="shop-pvz-list"></div>
  </div>
  <p class="shop-hint" id="shop-delivery-cost"></p>
</div>
```

и в блок итогов — строки доставки:

```html
<div class="shop-total-row" id="shop-delivery-row" hidden><span>Доставка</span><span id="shop-delivery-sum"></span></div>
<div class="shop-total-row final" id="shop-grand-row" hidden><span>К оплате с доставкой</span><span id="shop-grand"></span></div>
```

### Сайт: логика (`assets/js/cart.js`)

Сверху, после `var items = [], promo = '' …`:

```js
var delivery = { cfg: null, method: 'discuss', point: null, cost: 0, period: '', points: [], busy: false };
function apiBase() { return (S.apiBase || '').replace(/\/+$/, ''); }

function loadDeliveryConfig() {          /* включаем/выключаем СДЭК */
  return fetch(apiBase() + '/delivery/config', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      delivery.cfg = d;
      const on = !!(d && d.cdek && d.cdek.enabled);
      document.getElementById('dl-pvz').disabled = !on;
      document.getElementById('dl-courier').disabled = !on;
      if (!on) document.getElementById('shop-delivery-cost').textContent =
        'Онлайн-расчёт СДЭК пока недоступен — согласуем доставку с вами после заказа.';
      return d;
    })
    .catch(() => null);
}

function calcDelivery() {                /* стоимость по городу */
  var city = (document.getElementById('shop-city').value || '').trim();
  if (delivery.method === 'discuss' || city.length < 2) return;
  if (delivery.method === 'cdek_pvz' && !delivery.point) return;
  fetch(apiBase() + '/delivery/calc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: city, method: delivery.method })
  }).then((r) => r.json()).then((d) => {
    delivery.cost = Number(d.cost) || 0;
    delivery.period = d.periodMin ? ('срок ' + d.periodMin + '–' + d.periodMax + ' дн.') : '';
    renderDeliveryTotals();
  });
}

function findPoints() { /* GET /delivery/points → рисуем список радиокнопок */ }
```

В `submit()` в объект заказа добавьте:

```js
delivery: {
  method: delivery.method,
  city: fd.get('city'),
  pointCode: delivery.point ? delivery.point.code : '',
  pointAddress: delivery.point ? delivery.point.address : ''
}
```

Перед отправкой — проверка:

```js
if (delivery.method === 'cdek_pvz' && !delivery.point) {
  say('Выберите пункт выдачи СДЭК или переключитесь на «обсудить с продавцом».', true);
  return;
}
```

Стили — `assets/css/shop.css`, классы `.shop-delivery`, `.shop-radio`, `.shop-pvz-list`,
`.shop-pvz-item`.

### Проверка

1. Без ключей: в корзине только «Обсудить с продавцом», заказ оформляется.
2. С ключами: город «Москва» → «Найти пункты выдачи» → список адресов → выбор →
   «Доставка СДЭК: 390 ₽ · срок 2–4 дн.» и строка «К оплате с доставкой».
3. Заказ приходит в Telegram с адресом ПВЗ и стоимостью доставки;
   в кабинете адрес виден в карточке заказа.

---

## 8. Адрес доставки вводится в корзине

Задача: покупатель оформляет заказ без внешних сервисов — сам выбирает способ получения и
вводит адрес. Ничего не блокирует оформление, ключи не нужны.

### Что видит покупатель

1. Три карточки-переключателя: **Курьером по адресу / Самовывоз / Пункт выдачи СДЭК**
   (кнопки-радио в виде плиток, выбранная подсвечивается зелёным).
2. Поля адреса показываются только те, что нужны способу:
   * курьер — город, индекс, улица и дом, квартира/офис, подъезд·этаж·домофон;
   * пункт выдачи — только город (остальное подберём при подтверждении);
   * самовывоз — полей нет, вместо них плашка с адресом самовывоза.
3. Адрес запоминается в браузере (`localStorage`, ключ `rules-address-v1`): при следующем
   заказе поля уже заполнены. Очистить — очистить поля.
4. Если настроена стоимость доставки — в итогах появляются строки «Доставка» и
   «К оплате с доставкой», а под формой подсказка вида
   «Доставка курьером: 390 ₽ · бесплатно от 5 000 ₽».
5. Ошибки показываются под конкретным полем красным текстом, фокус переводится в него же.

### Разметка — `index.html`, внутри `<form id="shop-form">`

Блок `id="shop-delivery-field"` (вместо прежнего блока СДЭК):

* `.shop-methods` → три `<label class="shop-method">` c `input[type=radio][name=delivery]`
  (`value="courier" | "pickup" | "cdek"`);
* `.shop-address#shop-address` — сетка 2×N с полями:
  `#addr-city`, `#addr-postcode`, `#addr-street` (на всю ширину), `#addr-flat`, `#addr-note`;
* под каждым обязательным полем `<p class="shop-error" id="err-…" hidden>`;
* `#shop-pickup-box` и `#shop-cdek-box` — плашки-подсказки для самовывоза и ПВЗ;
* `<p class="shop-hint" id="shop-delivery-cost">` — текст про стоимость;
* у города есть `<datalist id="addr-cities">` с крупными городами (подсказка при вводе).

В `.shop-totals` добавлены строки `#shop-delivery-row` и `#shop-grand-row` (по умолчанию `hidden`).

### Логика — `assets/js/cart.js`

| Что | Где |
|---|---|
| состояние способа и настроек доставки | объект `delivery` + `deliveryCfg()` |
| чтение/запись адреса | `addressValue()`, `saveAddress()`, `restoreAddress()` |
| показ нужных полей | `applyMethod(method)` |
| проверка адреса | `validateAddress(show)`, `setError()`, `clearAddressErrors()` |
| стоимость и итоги | `deliveryCost()`, `renderDeliveryTotals()` |
| адрес самовывоза и цена с сервера | `initDeliveryInfo()` → `GET /delivery/config` |

Проверки (`validateAddress`): город ≥ 2 символов; улица и дом ≥ 5 символов; индекс — ровно
6 цифр, если заполнен. Сообщения: «Укажите город», «Улица и дом — обязательны»,
«Индекс — 6 цифр», общий статус «Заполните адрес доставки.».

В `submit()` адрес уходит так:

```js
delivery: {
  method: delivery.method,                     // courier | pickup | cdek
  city: address.city,
  address: address.address,                    // только для курьера
  flat: address.flat,
  postcode: address.postcode,
  note: address.note
}
```

Enter в любом поле адреса переводит к следующему полю, а не отправляет заказ.
После успешного заказа корзина и форма очищаются, адрес в браузере остаётся.

### Сервер — `worker/src/worker.js`

* `resolveDelivery()` проверяет адрес и считает стоимость; ошибки → 400 с текстом
  «Укажите город доставки.», «Укажите улицу и дом.», «Индекс должен состоять из 6 цифр.».
* Адрес пишется в `order_extra`: `delivery_address`, `delivery_flat`, `delivery_postcode`,
  `delivery_note` (колонки добавляются автоматически при первом запросе).
* `POST /order` возвращает `delivery: { method, label, cost, city, address, flat, postcode, note }`
  → этим пользуется экран «заказ принят».
* `deliveryLabel()` / `deliveryLine()` — тексты для Telegram, кабинета и CSV.
* `GET /delivery/config` отдаёт `{ cost, freeFrom, pickupAddress, pickupNote }` — корзина берёт
  оттуда цену и адрес самовывоза (если сервер не ответил — значения из `data/settings.json`).

### Настройка стоимости доставки — два места

1. `data/settings.json`, блок `delivery` (работает сразу, без деплоя Worker):

```json
"delivery": { "courierCost": 0, "freeFrom": 0, "pickupAddress": "", "pickupNote": "" }
```

2. Переменные Worker (необязательные, для расчёта на сервере в заказе):
   `DELIVERY_COST` (₽, 0 или не задано — «согласуем»), `DELIVERY_FREE_FROM` (бесплатно от суммы
   товаров), `PICKUP_ADDRESS`, `PICKUP_NOTE`.

Значения в двух местах должны совпадать, иначе сайт покажет одну цену, а в заказ запишется другая.
Проще держать `0` (стоимость согласуем) или задать одинаково.

### Кабинет — `admin/app.js`

В карточке заказа блок «Статус и доставка»: выпадающий список способа получения
(Курьером по адресу / Самовывоз / Пункт выдачи СДЭК), стоимость, индекс, улица-дом,
квартира, подъезд·этаж·домофон. Город — в блоке «Покупатель» (одно и то же поле).
Всё сохраняется кнопкой «Сохранить» и попадает в CSV-выгрузку заказов
(колонки «Способ доставки», «Индекс», «Улица, дом», «Квартира / офис»,
«Подъезд, этаж, домофон», «Стоимость доставки»).

### Проверка

1. Корзина → «Курьером по адресу» → пустой адрес → «Отправить заказ»:
   красные подписи под городом и улицей, статус «Заполните адрес доставки.».
2. Заполнить адрес → заказ оформлен → на экране «Доставка: курьером — 119019, Москва,
   ул. Арбат, 24, корп. 1, кв. 5 (подъезд 2, код 1234)».
3. Переключить «Самовывоз» — поля адреса скрыты, есть плашка с адресом самовывоза.
4. Переключить «Пункт выдачи СДЭК» — остаётся только город.
5. Задать `courierCost: 390, freeFrom: 5000` в `settings.json` → строки «Доставка 390 ₽» и
   «К оплате с доставкой»; от 5000 ₽ доставка бесплатна.
6. Кабинет → карточка заказа → адрес виден и редактируется.

---

## 9. Промокод RYASOVLOVESYOU: набор «Дорога» в подарок + бесплатная доставка

Условие: сумма товаров от 5 000 ₽. Что даёт промокод:

* товар `set-doroga` («Набор «Дорога»») добавляется в заказ отдельной строкой за **0 ₽**;
* доставка **любым способом** (курьер, самовывоз, ПВЗ СДЭК) — **бесплатно**;
* на скидку в деньгах не влияет (`percent: 0`) — только подарок и доставка.

### Где что менять

| Файл | Что внутри |
|---|---|
| `data/promos.json` | сам промокод: `gift`, `freeDelivery`, `minSum`, `label` |
| `worker/src/worker.js` → `PROMOS` | тот же промокод (проверка на сервере) |
| `assets/js/store.js` → `S.calculate` | возвращает `gift` (товар) и `freeDelivery` (да/нет) |
| `assets/js/cart.js` → `giftLine`, `deliveryCost`, `renderDeliveryTotals` | строка подарка и «Доставка — бесплатно» |
| `assets/css/shop.css` → `.shop-line.shop-gift` | оформление строки подарка |
| `worker/src/worker.js` → `createOrder`, `ownerText` | подарок в заказе, в Telegram и в кабинете |

Промокод целиком (`data/promos.json` и `PROMOS` в Worker — одинаково):

```json
"RYASOVLOVESYOU": {
  "label": "Набор «Дорога» в подарок и бесплатная доставка от 5 000 ₽",
  "percent": 0,
  "minSum": 5000,
  "gift": "set-doroga",
  "freeDelivery": true
}
```

### Как это работает

1. Покупатель вводит код → `S.calculate` проверяет `minSum: 5000`. Если сумма меньше —
   «Условие не выполнено: …», подарок не появляется.
2. Если условие выполнено — в корзине появляется строка
   «Подарок: Набор «Дорога» · По промокоду RYASOVLOVESYOU · 1 шт. бесплатно — 0 ₽»,
   а в итогах «Доставка — бесплатно» (вместо цены).
3. При отправке заказа Worker проверяет то же самое, **сам** добавляет подарок в заказ
   (`items_json`, строка с ценой 0) и обнуляет стоимость доставки. Подменить это из браузера нельзя.
4. Остаток подарка списывается, но не уходит в минус (если набор закончился — заказ всё равно
   принимается, подарок обещан).
5. В Telegram продавцу приходит строка «Подарок: Набор «Дорога» × 1 — бесплатно»,
   в кабинете подарок виден в составе заказа, в выгрузке `orders.csv` — тоже.

### Чтобы «бесплатная доставка» была видна

Если стоимость доставки не задана (`courierCost: 0`), доставка и так бесплатна — разницы не видно.
Задайте цену, и промокод начнёт её обнулять:

* `data/settings.json` → `"delivery": { "courierCost": 390 }` (цена курьера);
* переменная Worker `DELIVERY_COST=390` — чтобы та же сумма считалась в заказе.

После этого без промокода в итогах будет «Доставка 390 ₽» и «К оплате с доставкой»,
а с промокодом — «Доставка — бесплатно».

### Проверка

1. Корзина на 5 070 ₽ (3 × «Кодекс») → ввести `RYASOVLOVESYOU` → «Применить».
2. Появляется строка подарка, «Доставка — бесплатно», подсказка промокода.
3. Оформить заказ → на экране «Подарок: Набор «Дорога» — бесплатно».
4. Заказ в кабинете: в составе две строки, у подарка цена 0.
5. Корзина на 1 690 ₽ + тот же код → «Условие не выполнено: …».

---

## Чек-лист после обновления

- [ ] `node build.mjs` выполнен, в Cloudflare загружен новый `worker/worker.js`.
- [ ] Сайт: старая цена и бейдж видны в каталоге и на странице товара.
- [ ] Новый товар из кабинета открывается по своему адресу.
- [ ] После заказа в корзине есть кнопка «Открыть бота и получать статусы».
- [ ] В боте работают `/menu`, `/orders`, карточка заказа, «Выбрать для переписки».
- [ ] Из кабинета уходит фото покупателю и появляется в переписке.
- [ ] В корзине вводится адрес, заказ приходит с адресом и способом получения.
- [ ] Стоимость доставки настроена одинаково в `data/settings.json` и в Worker (или везде 0).
- [ ] СДЭК ключи не нужны; раздел 7 — справка на будущее.
- [ ] Промокод `RYASOVLOVESYOU` работает на сайте и на сервере (оба списка обновлены).

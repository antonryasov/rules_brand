/* ============================================================
   RULES · Cloudflare Worker — приём заказов, каталог, личный кабинет
   ------------------------------------------------------------
   Что здесь есть:
     GET  /catalog            — живой каталог для сайта (цены, остатки, фото)
     POST /order              — приём заказа с сайта
     POST /telegram           — вебхук бота для покупателей
     GET  /admin              — личный кабинет (CRM)
     /admin/api/*             — API личного кабинета
     cron                     — рассылка очереди Telegram

   Секреты (Settings → Variables and Secrets):
     ADMIN_PASSWORD, SESSION_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
     CUSTOMER_BOT_TOKEN, CUSTOMER_BOT_USERNAME, WEBHOOK_SECRET, ALLOWED_ORIGIN
   Привязка: D1 database → DB
   ============================================================ */

/* ==== личный кабинет (вставляется при сборке из папки admin/) ==== */
const ADMIN_HTML = "__ADMIN_HTML__";

/* ==== статусы заказа ==== */
const STATUSES = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  packing: 'Собирается',
  sent: 'Отправлен',
  delivered: 'Доставлен',
  cancelled: 'Отменён'
};
const PAYMENTS = { none: 'Не оплачен', paid: 'Оплачен', refund: 'Возврат' };

/* ==== промокоды ==== */
const PROMOS = {
  RULES5: { label: '5% на весь заказ', percent: 5 },
  GORY10: { label: '10% на ароматы «Горы»', percent: 10, family: 'gory' },
  SILA7: { label: '7% на ароматы «Сила»', percent: 7, family: 'sila' },
  SVECHA8: { label: '8% на свечи', percent: 8, type: 'candle' },
  DOM6: { label: '6% на диффузоры', percent: 6, type: 'diffuser' },
  PARA10: { label: '10% при покупке от 2 товаров', percent: 10, minQty: 2 },
  TRIO12: { label: '12% при покупке от 3 товаров', percent: 12, minQty: 3 },
  NABOR5: { label: '5% на подарочные наборы', percent: 5, type: 'set' },
  BOLSHOY15: { label: '15% при сумме товаров от 8 000 ₽', percent: 15, minSum: 8000 },
  RYASOV300: { label: '300 ₽ при сумме товаров от 3 500 ₽', fixed: 300, minSum: 3500 }
};

/* ============================ утилиты ============================ */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });

const clean = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max) : '';

const int = (v, def = 0, min = -1e9, max = 1e9) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽';
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const unique = () => crypto.randomUUID().replace(/-/g, '');
const b64random = () => {
  const a = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function digest(x) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)));
}
async function sign(key, s) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(s)));
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
}

function allowedOrigin(env, request) {
  const allowed = String(env.ALLOWED_ORIGIN || '').replace(/\/+$/, '');
  const origin = request.headers.get('Origin') || '';
  return { allowed, origin, ok: !!allowed && origin === allowed };
}
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

async function parseBody(req, max = 200000) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) throw new Error('Слишком большой запрос.');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > max) throw new Error('Слишком большой запрос.');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Неверный формат данных.');
  }
}

/* ============================ Telegram ============================ */
const botname = (env) => String(env.CUSTOMER_BOT_USERNAME || '').replace(/^@/, '');
const validBot = (env) => /^[a-zA-Z0-9_]{5,32}$/.test(botname(env)) && /bot$/i.test(botname(env));

async function telegram(token, method, payload) {
  if (!token) throw new Error('BOT_NOT_CONFIGURED');
  const r = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.ok) throw new Error('TELEGRAM_' + (r.status || 'ERROR'));
  return d.result;
}

async function enqueue(db, kind, chat, text, dedupe) {
  await db
    .prepare('INSERT OR IGNORE INTO outbox(kind,chat_id,text,dedupe) VALUES(?,?,?,?)')
    .bind(kind, String(chat), text, dedupe || unique())
    .run();
}

/* отправка очереди: 10 сообщений за один запуск */
async function flush(env) {
  if (!env.DB) return;
  try {
    await env.DB.prepare("UPDATE outbox SET state='pending' WHERE state='sending' AND next_at<=datetime('now')").run();
    for (let i = 0; i < 10; i++) {
      const row = await env.DB
        .prepare(
          "UPDATE outbox SET state='sending',attempts=attempts+1,next_at=datetime('now','+2 minutes') " +
          "WHERE id=(SELECT id FROM outbox WHERE state='pending' AND next_at<=datetime('now') ORDER BY id LIMIT 1) AND state='pending' RETURNING *"
        )
        .first();
      if (!row) break;
      try {
        if (row.kind === 'customer_news') {
          const sub = await env.DB.prepare('SELECT subscribed FROM subscribers WHERE chat_id=?').bind(row.chat_id).first();
          if (!sub || !sub.subscribed) {
            await env.DB.prepare("UPDATE outbox SET state='cancelled' WHERE id=?").bind(row.id).run();
            continue;
          }
        }
        await telegram(
          row.kind === 'owner' ? env.TELEGRAM_BOT_TOKEN : env.CUSTOMER_BOT_TOKEN,
          'sendMessage',
          { chat_id: row.chat_id, text: row.text, disable_web_page_preview: true }
        );
        await env.DB.prepare("UPDATE outbox SET state='sent',error='' WHERE id=?").bind(row.id).run();
      } catch (e) {
        await env.DB
          .prepare("UPDATE outbox SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,next_at=datetime('now','+5 minutes'),error=? WHERE id=?")
          .bind(clean(String(e.message || e), 80), row.id)
          .run();
      }
    }
  } catch (e) {
    /* очередь недоступна — повторим на следующем запуске */
  }
}

/* ============================ каталог ============================ */
function productFromRow(r) {
  const notes = safeJSON(r.notes_json, {});
  const gallery = safeJSON(r.gallery_json, []);
  return {
    id: r.id,
    page: r.page,
    sku: r.sku,
    name: r.name,
    fullName: r.full_name || r.name,
    type: r.type,
    typeLabel: r.type_label,
    family: r.family,
    collection: r.collection,
    price: r.price,
    oldPrice: r.old_price,
    stock: r.stock,
    active: !!r.active,
    badge: r.badge,
    sort: r.sort,
    tagline: r.tagline,
    quote: r.quote,
    lead: r.lead,
    notes: { top: notes.top || '', heart: notes.heart || '', base: notes.base || '' },
    specs: safeJSON(r.specs_json, []),
    safety: r.safety,
    deliveryNote: r.delivery_note,
    crossSell: r.cross_sell,
    images: { card: r.image_card, hero: r.image_hero || r.image_card, gallery: Array.isArray(gallery) ? gallery : [] },
    meta: { title: r.meta_title || r.name, description: r.meta_description || r.lead || '' },
    updatedAt: r.updated_at
  };
}
function safeJSON(s, def) {
  try {
    const v = JSON.parse(s);
    return v == null ? def : v;
  } catch (e) {
    return def;
  }
}

async function publicCatalog(env, request) {
  if (request.method === 'OPTIONS') {
    const { origin } = allowedOrigin(env, request);
    return new Response(null, { status: 204, headers: corsHeaders(origin || '*') });
  }
  if (!env.DB) return json({ error: 'Каталог не настроен.' }, 503);
  const { results } = await env.DB
    .prepare('SELECT * FROM products WHERE active=1 ORDER BY sort, name')
    .all();
  const products = (results || []).map(productFromRow);
  const { origin, ok } = allowedOrigin(env, request);
  return json(
    { products, promos: PROMOS, count: products.length, updatedAt: new Date().toISOString() },
    200,
    { 'cache-control': 'public, max-age=30', ...(ok ? corsHeaders(origin) : {}) }
  );
}

/* ============================ заказ с сайта ============================ */
function calculate(items, rawCode) {
  const subtotal = items.reduce((n, it) => n + it.price * it.qty, 0);
  const quantity = items.reduce((n, it) => n + it.qty, 0);
  const code = String(rawCode || '').trim().toUpperCase();
  const none = { subtotal, quantity, discount: 0, total: subtotal, code: '', promoMessage: '' };
  if (!code) return none;
  const p = PROMOS[code];
  if (!p) return { ...none, promoMessage: 'Промокод не найден.' };
  if ((p.minQty && quantity < p.minQty) || (p.minSum && subtotal < p.minSum)) {
    return { ...none, promoMessage: 'Условие не выполнено: ' + p.label + '.' };
  }
  const eligible = items.reduce((n, it) => {
    const okType = !p.type || p.type === it.type;
    const okFamily = !p.family || p.family === it.family;
    return n + (okType && okFamily ? it.price * it.qty : 0);
  }, 0);
  if (!eligible) return { ...none, promoMessage: 'В корзине нет товаров, подходящих под этот промокод.' };
  const discount = Math.min(eligible, p.fixed || Math.round((eligible * p.percent) / 100));
  return { subtotal, quantity, discount, total: subtotal - discount, code, promoMessage: p.label };
}

function ownerText(o) {
  return [
    '🕯 Новый заказ RULES · ' + o.id.slice(0, 8).toUpperCase(),
    '',
    ...o.items.map((x) => `${x.name} × ${x.qty} — ${money(x.price * x.qty)}`),
    '',
    `Товары: ${money(o.calc.subtotal)}`,
    `Промокод: ${o.calc.code || 'нет'}`,
    `Скидка: −${money(o.calc.discount)}`,
    `Итого за товары: ${money(o.calc.total)}`,
    'Доставка и оплата: согласовать отдельно',
    '',
    `Имя: ${o.name}`,
    `Телефон: ${o.phone}`,
    `Город: ${o.city}`,
    `Доп. контакт: ${o.contact || 'не указан'}`,
    `Комментарий: ${o.comment || 'нет'}`,
    'Согласие на обработку данных: получено'
  ].join('\n');
}

async function createOrder(request, env, ctx) {
  const { allowed, origin, ok } = allowedOrigin(env, request);
  if (!allowed) return json({ error: 'Доступ запрещён.' }, 403, { 'Access-Control-Allow-Origin': 'null' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return json({ error: 'Не найдено.' }, 404, corsHeaders(origin));
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ error: 'Приём заказов пока не настроен.' }, 503, corsHeaders(origin));
  }
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'Неверный формат.' }, 415, corsHeaders(origin));
  }

  try {
    const b = await parseBody(request, 12000);
    const id = b.request_id || unique();
    const token = b.tracking_token || b64random();
    if (!/^[a-f0-9]{32}$/.test(id) || !/^[A-Za-z0-9_-]{32}$/.test(token)) throw new Error('Неверный идентификатор заказа.');

    const hash = await digest(token);
    const old = await env.DB.prepare('SELECT id,token_hash,total FROM orders WHERE id=?').bind(id).first();
    if (old) {
      if (!equal(old.token_hash, hash)) return json({ error: 'Этот заказ уже существует.' }, 409, corsHeaders(origin));
      return json({ ok: true, id: old.id, total: old.total, bot: validBot(env) ? botname(env) : null }, 200, corsHeaders(origin));
    }

    /* товары проверяем по базе — цены и остатки актуальные */
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) throw new Error('Проверьте корзину.');
    const seen = new Set();
    let count = 0;
    const wanted = [];
    for (const raw of b.items) {
      if (!raw || typeof raw.id !== 'string' || seen.has(raw.id)) throw new Error('Проверьте корзину.');
      const qty = int(raw.qty, 0, 1, 20);
      if (!qty) throw new Error('Проверьте корзину.');
      seen.add(raw.id);
      count += qty;
      wanted.push({ id: raw.id, qty });
    }
    if (count > 100) throw new Error('Не более 100 товаров в заказе.');

    const rows = await env.DB
      .prepare(`SELECT id,name,price,stock,active,type,family,type_label FROM products WHERE id IN (${wanted.map(() => '?').join(',')})`)
      .bind(...wanted.map((w) => w.id))
      .all();
    const byId = {};
    (rows.results || []).forEach((r) => (byId[r.id] = r));
    const items = wanted.map((w) => {
      const p = byId[w.id];
      if (!p || !p.active) throw new Error('Товар недоступен: ' + w.id);
      if (p.stock < w.qty) throw new Error(`«${p.name}»: в наличии ${p.stock} шт.`);
      return { id: p.id, name: p.name, price: p.price, qty: w.qty, type: p.type, family: p.family, type_label: p.type_label };
    });

    const promo = typeof b.promo === 'string' ? b.promo.slice(0, 40) : '';
    const calc = calculate(items, promo);
    if (promo.trim() && !calc.code) throw new Error(calc.promoMessage);

    const name = clean(b.name, 100);
    const phone = clean(b.phone, 40);
    const city = clean(b.city, 100);
    const contact = clean(b.contact, 120);
    const comment = clean(b.comment, 500);
    if (name.length < 2 || (phone.match(/\d/g) || []).length < 10 || city.length < 2 || b.consent !== true) {
      throw new Error('Заполните имя, телефон, город и согласие.');
    }

    const order = { id, items, calc, name, phone, city, contact, comment };
    const stored = items.map((x) => ({ id: x.id, qty: x.qty, name: x.name, price: x.price }));

    await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO orders(id,token_hash,customer_name,phone,city,contact,comment,items_json,subtotal,discount,total,promo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(id, hash, name, phone, city, contact, comment, JSON.stringify(stored), calc.subtotal, calc.discount, calc.total, calc.code),
      env.DB.prepare('INSERT OR IGNORE INTO order_extra(order_id,payment_status,delivery_method,delivery_cost) VALUES(?,\'none\',\'\',0)').bind(id),
      env.DB.prepare("INSERT OR IGNORE INTO outbox(kind,chat_id,text,dedupe) SELECT 'owner',?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND token_hash=?)").bind(
        String(env.TELEGRAM_CHAT_ID), ownerText(order), 'order-' + id, id, hash
      ),
      ...items.map((x) =>
        env.DB.prepare('UPDATE products SET stock=stock-?, updated_at=datetime(\'now\') WHERE id=? AND stock>=?').bind(x.qty, x.id, x.qty)
      )
    ]);

    const check = await env.DB.prepare('SELECT id,token_hash,total FROM orders WHERE id=?').bind(id).first();
    if (!check || !equal(check.token_hash, hash)) return json({ error: 'Этот заказ уже существует.' }, 409, corsHeaders(origin));

    ctx.waitUntil(flush(env).catch(() => {}));
    return json({ ok: true, id: check.id, total: check.total, bot: validBot(env) ? botname(env) : null }, 200, corsHeaders(origin));
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/SQLITE|D1_|database|no such table/i.test(msg)) {
      return json({ error: 'Приём заказов временно недоступен.' }, 503, corsHeaders(origin));
    }
    return json({ error: msg || 'Ошибка заказа.' }, 400, corsHeaders(origin));
  }
}

/* ============================ сессии админа ============================ */
const SESSION_TTL = 12 * 60 * 60;

async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  return exp + '.' + (await sign(env.SESSION_SECRET, 'admin:' + exp));
}
async function tokenValid(env, token) {
  if (!env.SESSION_SECRET || typeof token !== 'string') return false;
  const m = token.match(/^(\d{9,})\.([a-f0-9]{64})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  const now = Math.floor(Date.now() / 1000);
  if (exp < now || exp > now + SESSION_TTL + 60) return false;
  return equal(await sign(env.SESSION_SECRET, 'admin:' + exp), m[2]);
}
function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

/* ============================ API личного кабинета ============================ */
const adminJson = (data, status = 200) => json(data, status);

async function orderItems(env, orderId, fallbackJSON) {
  const { results } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY position, id').bind(orderId).all();
  if (results && results.length) {
    return results.map((r) => ({
      id: r.id,
      productId: r.product_id,
      name: r.name,
      price: r.price,
      qty: r.qty,
      position: r.position
    }));
  }
  const arr = safeJSON(fallbackJSON, []);
  return (Array.isArray(arr) ? arr : []).map((x, i) => ({
    id: null,
    productId: x.id || '',
    name: x.name || '',
    price: Number(x.price) || 0,
    qty: Number(x.qty) || 0,
    position: i
  }));
}

function orderOut(row, items, extra, comments) {
  return {
    id: row.id,
    createdAt: row.created_at,
    customer: {
      name: row.customer_name,
      phone: row.phone,
      city: row.city,
      contact: row.contact,
      comment: row.comment
    },
    items,
    subtotal: row.subtotal,
    discount: row.discount,
    total: row.total,
    promo: row.promo,
    status: row.status,
    statusLabel: STATUSES[row.status] || row.status,
    tracking: row.tracking || '',
    adminNote: row.admin_note || '',
    customerChatId: row.customer_chat_id || null,
    claimedAt: row.claimed_at || null,
    paymentStatus: (extra && extra.payment_status) || 'none',
    deliveryMethod: (extra && extra.delivery_method) || '',
    deliveryCost: extra ? extra.delivery_cost || 0 : 0,
    archived: extra ? !!extra.archived : false,
    updatedAt: extra ? extra.updated_at : null,
    comments: comments || []
  };
}

async function loadComments(env, orderId) {
  const { results } = await env.DB
    .prepare('SELECT id,body,author,channel,sent_to_customer,created_at FROM order_comments WHERE order_id=? ORDER BY id')
    .bind(orderId)
    .all();
  return (results || []).map((r) => ({
    id: r.id,
    body: r.body,
    author: r.author,
    channel: r.channel,
    sent: !!r.sent_to_customer,
    createdAt: r.created_at
  }));
}

async function recalcOrder(env, orderId) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first();
  if (!order) return;
  const items = await orderItems(env, orderId, order.items_json);
  /* тип и коллекцию берём из каталога, чтобы промокоды со скидкой на категорию работали */
  const { results } = await env.DB
    .prepare(`SELECT id,type,family,price FROM products WHERE id IN (${items.filter((i) => i.productId).map(() => '?').join(',') || "''"})`)
    .bind(...items.filter((i) => i.productId).map((i) => i.productId))
    .all();
  const meta = {};
  (results || []).forEach((r) => (meta[r.id] = r));
  const priced = items.map((it) => {
    const m = meta[it.productId] || {};
    return { price: it.price, qty: it.qty, type: m.type || '', family: m.family || '' };
  });
  const subtotal = items.reduce((n, it) => n + it.price * it.qty, 0);
  const calc = calculate(priced, order.promo);
  const total = calc.code ? calc.total : subtotal;
  await env.DB
    .prepare('UPDATE orders SET subtotal=?, discount=?, total=?, items_json=? WHERE id=?')
    .bind(subtotal, calc.code ? calc.discount : 0, total, JSON.stringify(items.map((i) => ({ id: i.productId, qty: i.qty, name: i.name, price: i.price }))), orderId)
    .run();
}

/* ---------- CSV ---------- */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(rows, columns) {
  const head = columns.map((c) => csvCell(c.title)).join(';');
  const body = rows.map((r) => columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(';'));
  return '\uFEFF' + [head, ...body].join('\r\n');
}
function parseCSV(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const delim = (s.split(';').length >= s.split(',').length) ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean_rows = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!clean_rows.length) return [];
  const head = clean_rows[0].map((h) => String(h).trim().toLowerCase());
  return clean_rows.slice(1).map((r) => {
    const o = {};
    head.forEach((k, i) => (o[k] = String(r[i] == null ? '' : r[i]).trim()));
    return o;
  });
}

const PRODUCT_COLUMNS = [
  { key: 'id', title: 'id' },
  { key: 'name', title: 'name' },
  { key: 'price', title: 'price' },
  { key: 'old_price', title: 'old_price' },
  { key: 'stock', title: 'stock' },
  { key: 'type', title: 'type' },
  { key: 'type_label', title: 'type_label' },
  { key: 'family', title: 'family' },
  { key: 'collection', title: 'collection' },
  { key: 'active', title: 'active' },
  { key: 'sort', title: 'sort' },
  { key: 'tagline', title: 'tagline' },
  { key: 'lead', title: 'lead' },
  { key: 'sku', title: 'sku' },
  { key: 'image_card', title: 'image_card' },
  { key: 'image_hero', title: 'image_hero' },
  { key: 'page', title: 'page' },
  { key: 'badge', title: 'badge' }
];

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
    page: clean(String(g('page', '')), 80),
    sku: clean(String(g('sku', '')), 60),
    name,
    full_name: clean(String(g('full_name', name, 'fullName')), 160),
    type: clean(String(g('type', 'candle')), 20),
    type_label: clean(String(g('type_label', '', 'typeLabel')), 60),
    family: clean(String(g('family', '')), 20),
    collection: clean(String(g('collection', '')), 60),
    price: int(g('price', 0), 0, 0, 10000000),
    old_price: int(g('old_price', 0, 'oldPrice'), 0, 0, 10000000),
    stock: int(g('stock', 0), 0, 0, 100000),
    active: String(g('active', 1)) === '0' || String(g('active', 1)) === 'false' ? 0 : 1,
    badge: clean(String(g('badge', '')), 40),
    sort: int(g('sort', 100), 100, 0, 100000),
    tagline: clean(String(g('tagline', '')), 200),
    quote: clean(String(g('quote', '')), 200),
    lead: clean(String(g('lead', '', 'description')), 1000),
    notes_json: JSON.stringify(input.notes || (existing && safeJSON(existing.notes_json, {})) || { top: '', heart: '', base: '' }),
    specs_json: JSON.stringify(input.specs || (existing && safeJSON(existing.specs_json, [])) || []),
    gallery_json: JSON.stringify((input.images && input.images.gallery) || safeJSON(existing && existing.gallery_json, []) || []),
    image_card: String((input.images && input.images.card) || g('image_card', '')).slice(0, 900000),
    image_hero: String((input.images && input.images.hero) || g('image_hero', '')).slice(0, 900000),
    safety: clean(String(g('safety', '')), 800),
    delivery_note: clean(String(g('delivery_note', '', 'deliveryNote')), 300),
    cross_sell: clean(String(g('cross_sell', '', 'crossSell')), 80),
    meta_title: clean(String(g('meta_title', '')), 160),
    meta_description: clean(String(g('meta_description', '')), 300)
  };
}

async function upsertProduct(env, p) {
  await env.DB
    .prepare(
      `INSERT INTO products (id,page,sku,name,full_name,type,type_label,family,collection,price,old_price,stock,active,badge,sort,
        tagline,quote,lead,notes_json,specs_json,gallery_json,image_card,image_hero,safety,delivery_note,cross_sell,meta_title,meta_description,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
        page=excluded.page, sku=excluded.sku, name=excluded.name, full_name=excluded.full_name, type=excluded.type,
        type_label=excluded.type_label, family=excluded.family, collection=excluded.collection, price=excluded.price,
        old_price=excluded.old_price, stock=excluded.stock, active=excluded.active, badge=excluded.badge, sort=excluded.sort,
        tagline=excluded.tagline, quote=excluded.quote, lead=excluded.lead, notes_json=excluded.notes_json,
        specs_json=excluded.specs_json, gallery_json=excluded.gallery_json, image_card=excluded.image_card,
        image_hero=excluded.image_hero, safety=excluded.safety, delivery_note=excluded.delivery_note,
        cross_sell=excluded.cross_sell, meta_title=excluded.meta_title, meta_description=excluded.meta_description,
        updated_at=datetime('now')`
    )
    .bind(
      p.id, p.page, p.sku, p.name, p.full_name, p.type, p.type_label, p.family, p.collection, p.price, p.old_price,
      p.stock, p.active, p.badge, p.sort, p.tagline, p.quote, p.lead, p.notes_json, p.specs_json, p.gallery_json,
      p.image_card, p.image_hero, p.safety, p.delivery_note, p.cross_sell, p.meta_title, p.meta_description
    )
    .run();
}

/* уведомление покупателю по заказу */
async function notifyCustomer(env, order, text) {
  if (!order.customer_chat_id) return false;
  await enqueue(env.DB, 'customer', order.customer_chat_id, text);
  return true;
}

function statusMessage(order, extra) {
  const num = order.id.slice(0, 8).toUpperCase();
  const lines = [`📦 Заказ № ${num}`, `Статус: ${STATUSES[order.status] || order.status}`];
  if (order.tracking) lines.push(`Трек-номер: ${order.tracking}`);
  if (extra && extra.delivery_method) lines.push(`Доставка: ${extra.delivery_method}`);
  lines.push('', 'Откройте «Мои заказы» в боте, чтобы посмотреть подробности.');
  return lines.join('\n');
}

/* ============================ роутер админки ============================ */
async function adminApi(request, env, ctx, url) {
  const path = url.pathname.replace(/^\/admin\/api/, '') || '/';
  const method = request.method;

  /* --- вход --- */
  if (path === '/login' && method === 'POST') {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      return adminJson({ error: 'Задайте ADMIN_PASSWORD и SESSION_SECRET (не короче 32 символов).' }, 501);
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await digest(env.SESSION_SECRET + ip);
    const now = Math.floor(Date.now() / 1000);
    const attempt = await env.DB
      .prepare(
        'INSERT INTO login_attempts(ip_hash,count,window_start) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET ' +
        'count=CASE WHEN window_start<? THEN 1 ELSE count+1 END, window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING count'
      )
      .bind(ipHash, now, now - 900, now - 900)
      .first();
    if (attempt && attempt.count > 8) return adminJson({ error: 'Слишком много попыток. Попробуйте через 15 минут.' }, 429);

    const b = await parseBody(request, 2048).catch(() => ({}));
    if (typeof b.password !== 'string' || !equal(await digest(b.password), await digest(env.ADMIN_PASSWORD))) {
      return adminJson({ error: 'Неверный пароль.' }, 403);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash=?').bind(ipHash).run();
    return adminJson({ ok: true, token: await makeToken(env) });
  }

  /* --- дальше нужен токен --- */
  if (!(await tokenValid(env, bearer(request)))) return adminJson({ error: 'Войдите в панель.' }, 401);

  if (path === '/me') return adminJson({ ok: true, statuses: STATUSES, payments: PAYMENTS, siteUrl: String(env.ALLOWED_ORIGIN || '').replace(/\/+$/, '') });
  if (path === '/logout' && method === 'POST') return adminJson({ ok: true });

  /* --- сводка --- */
  if (path === '/summary') {
    const byStatus = await env.DB.prepare('SELECT status, COUNT(*) n, SUM(total) sum FROM orders GROUP BY status').all();
    const revenue = await env.DB.prepare("SELECT SUM(total) sum FROM orders WHERE status IN ('delivered','sent','packing','confirmed')").first();
    const today = await env.DB.prepare("SELECT COUNT(*) n, SUM(total) sum FROM orders WHERE date(created_at)=date('now')").first();
    const low = await env.DB.prepare('SELECT id,name,stock,price FROM products WHERE active=1 AND stock<=3 ORDER BY stock LIMIT 20').all();
    const queue = await env.DB
      .prepare("SELECT SUM(CASE WHEN state IN ('pending','sending') THEN 1 ELSE 0 END) pending, SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed FROM outbox")
      .first();
    const subs = await env.DB.prepare('SELECT COUNT(*) n FROM subscribers WHERE subscribed=1').first();
    const productsCount = await env.DB.prepare('SELECT COUNT(*) n FROM products WHERE active=1').first();
    const recent = await env.DB
      .prepare('SELECT id,created_at,customer_name,phone,city,total,status FROM orders ORDER BY created_at DESC, id DESC LIMIT 8')
      .all();
    return adminJson({
      ok: true,
      statuses: STATUSES,
      byStatus: byStatus.results || [],
      revenue: revenue ? revenue.sum || 0 : 0,
      today: today || { n: 0, sum: 0 },
      lowStock: low.results || [],
      queue: { pending: (queue && queue.pending) || 0, failed: (queue && queue.failed) || 0 },
      subscribers: subs ? subs.n : 0,
      products: productsCount ? productsCount.n : 0,
      recent: recent.results || [],
      bot: validBot(env) ? botname(env) : null,
      siteUrl: String(env.ALLOWED_ORIGIN || '').replace(/\/+$/, ''),
      adminHost: url.host
    });
  }

  /* --- список заказов --- */
  if (path === '/orders' && method === 'GET') {
    const q = clean(url.searchParams.get('q') || '', 80);
    const status = url.searchParams.get('status') || '';
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const page = Math.max(0, Math.min(5000, int(url.searchParams.get('page'), 0)));
    const limit = Math.max(1, Math.min(100, int(url.searchParams.get('limit'), 25)));
    if (status && !STATUSES[status]) return adminJson({ error: 'Неверный статус.' }, 400);

    const where = [];
    const args = [];
    if (status) { where.push('status=?'); args.push(status); }
    if (q) {
      where.push("(id LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')");
      const term = '%' + q.replace(/[\\%_]/g, (x) => '\\' + x) + '%';
      args.push(term, term, term, term);
    }
    if (from) { where.push('date(created_at)>=date(?)'); args.push(from); }
    if (to) { where.push('date(created_at)<=date(?)'); args.push(to); }
    const sql =
      'SELECT id,created_at,customer_name,phone,city,contact,comment,items_json,subtotal,discount,total,promo,status,tracking,admin_note,customer_chat_id ' +
      'FROM orders ' + (where.length ? 'WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY created_at DESC, id DESC LIMIT ' + (limit + 1) + ' OFFSET ' + page * limit;
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const list = (results || []).slice(0, limit).map((r) => {
      const items = safeJSON(r.items_json, []);
      return {
        id: r.id,
        createdAt: r.created_at,
        customer: { name: r.customer_name, phone: r.phone, city: r.city, contact: r.contact, comment: r.comment },
        itemsCount: Array.isArray(items) ? items.reduce((n, x) => n + (Number(x.qty) || 0), 0) : 0,
        itemsPreview: Array.isArray(items) ? items.map((x) => `${x.name} × ${x.qty}`).join(', ') : '',
        subtotal: r.subtotal,
        discount: r.discount,
        total: r.total,
        promo: r.promo,
        status: r.status,
        statusLabel: STATUSES[r.status] || r.status,
        tracking: r.tracking || '',
        adminNote: r.admin_note || '',
        hasChat: !!r.customer_chat_id
      };
    });
    return adminJson({ ok: true, orders: list, more: (results || []).length > limit, page, limit, statuses: STATUSES });
  }

  /* --- один заказ --- */
  let m = path.match(/^\/orders\/([a-f0-9]{32})$/);
  if (m && method === 'GET') {
    const id = m[1];
    const row = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    if (!row) return adminJson({ error: 'Заказ не найден.' }, 404);
    const extra = await env.DB.prepare('SELECT * FROM order_extra WHERE order_id=?').bind(id).first();
    const items = await orderItems(env, id, row.items_json);
    const comments = await loadComments(env, id);
    return adminJson({ ok: true, order: orderOut(row, items, extra, comments), statuses: STATUSES, payments: PAYMENTS });
  }

  /* --- сохранить заказ --- */
  if (m && (method === 'PUT' || method === 'PATCH')) {
    const id = m[1];
    const row = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    if (!row) return adminJson({ error: 'Заказ не найден.' }, 404);
    const b = await parseBody(request);
    const extra = (await env.DB.prepare('SELECT * FROM order_extra WHERE order_id=?').bind(id).first()) || {};

    const status = STATUSES[b.status] ? b.status : row.status;
    const tracking = b.tracking != null ? clean(b.tracking, 120) : row.tracking || '';
    const note = b.adminNote != null ? clean(b.adminNote, 2000) : row.admin_note || '';
    const payment = PAYMENTS[b.paymentStatus] ? b.paymentStatus : extra.payment_status || 'none';
    const deliveryMethod = b.deliveryMethod != null ? clean(b.deliveryMethod, 120) : extra.delivery_method || '';
    const deliveryCost = b.deliveryCost != null ? int(b.deliveryCost, 0, 0, 100000) : extra.delivery_cost || 0;

    const customer = b.customer || {};
    const name = customer.name != null ? clean(customer.name, 100) : row.customer_name;
    const phone = customer.phone != null ? clean(customer.phone, 40) : row.phone;
    const city = customer.city != null ? clean(customer.city, 100) : row.city;
    const contact = customer.contact != null ? clean(customer.contact, 120) : row.contact;
    const comment = customer.comment != null ? clean(customer.comment, 500) : row.comment;

    const statusChanged = status !== row.status;
    const trackingChanged = tracking !== (row.tracking || '');
    const wasCancelled = row.status === 'cancelled';

    const ops = [
      env.DB.prepare('UPDATE orders SET status=?, tracking=?, admin_note=?, customer_name=?, phone=?, city=?, contact=?, comment=? WHERE id=?')
        .bind(status, tracking, note, name, phone, city, contact, comment, id),
      env.DB
        .prepare(
          'INSERT INTO order_extra(order_id,payment_status,delivery_method,delivery_cost,updated_at) VALUES(?,?,?,?,datetime(\'now\')) ' +
          'ON CONFLICT(order_id) DO UPDATE SET payment_status=excluded.payment_status, delivery_method=excluded.delivery_method, delivery_cost=excluded.delivery_cost, updated_at=datetime(\'now\')'
        )
        .bind(id, payment, deliveryMethod, deliveryCost)
    ];

    /* возврат остатков при отмене и списание при возврате в работу */
    if (statusChanged && status === 'cancelled' && !wasCancelled && b.restock !== false) {
      const items = await orderItems(env, id, row.items_json);
      items.forEach((it) => {
        if (it.productId) ops.push(env.DB.prepare('UPDATE products SET stock=stock+? WHERE id=?').bind(it.qty, it.productId));
      });
    }
    if (statusChanged && wasCancelled && status !== 'cancelled') {
      const items = await orderItems(env, id, row.items_json);
      items.forEach((it) => {
        if (it.productId) ops.push(env.DB.prepare('UPDATE products SET stock=MAX(0,stock-?) WHERE id=?').bind(it.qty, it.productId));
      });
    }
    if (statusChanged) {
      ops.push(
        env.DB.prepare('INSERT INTO order_comments(order_id,body,author,channel,sent_to_customer) VALUES(?,?,?,?,0)')
          .bind(id, 'Статус изменён: ' + (STATUSES[status] || status), 'система', 'system')
      );
    }

    await env.DB.batch(ops);

    let notified = false;
    if ((statusChanged || trackingChanged) && row.customer_chat_id && b.notify !== false) {
      await enqueue(env.DB, 'customer', row.customer_chat_id, statusMessage({ ...row, status, tracking }, { delivery_method: deliveryMethod }));
      notified = true;
    }
    ctx.waitUntil(flush(env).catch(() => {}));

    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    const freshExtra = await env.DB.prepare('SELECT * FROM order_extra WHERE order_id=?').bind(id).first();
    return adminJson({
      ok: true,
      notified,
      order: orderOut(fresh, await orderItems(env, id, fresh.items_json), freshExtra, await loadComments(env, id))
    });
  }

  /* --- состав заказа --- */
  m = path.match(/^\/orders\/([a-f0-9]{32})\/items$/);
  if (m && method === 'PUT') {
    const id = m[1];
    const row = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    if (!row) return adminJson({ error: 'Заказ не найден.' }, 404);
    const b = await parseBody(request);
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return adminJson({ error: 'Добавьте хотя бы одну позицию.' }, 400);

    const rows = [];
    for (let i = 0; i < items.length && i < 100; i++) {
      const it = items[i] || {};
      const pid = clean(String(it.productId || it.id || ''), 60);
      let name = clean(String(it.name || ''), 160);
      let price = int(it.price, 0, 0, 10000000);
      const qty = int(it.qty, 0, 0, 10000);
      if (!qty) continue;
      if (pid) {
        const p = await env.DB.prepare('SELECT name,price FROM products WHERE id=?').bind(pid).first();
        if (p) {
          if (!name) name = p.name;
          if (!price) price = p.price;
        }
      }
      if (!name) return adminJson({ error: 'У позиции должно быть название.' }, 400);
      rows.push({ productId: pid, name, price, qty, position: i });
    }
    if (!rows.length) return adminJson({ error: 'Добавьте хотя бы одну позицию.' }, 400);

    await env.DB.prepare('DELETE FROM order_items WHERE order_id=?').bind(id).run();
    for (const r of rows) {
      await env.DB
        .prepare('INSERT INTO order_items(order_id,product_id,name,price,qty,position) VALUES(?,?,?,?,?,?)')
        .bind(id, r.productId, r.name, r.price, r.qty, r.position)
        .run();
    }
    await recalcOrder(env, id);
    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    const extra = await env.DB.prepare('SELECT * FROM order_extra WHERE order_id=?').bind(id).first();
    return adminJson({ ok: true, order: orderOut(fresh, await orderItems(env, id, fresh.items_json), extra, await loadComments(env, id)) });
  }

  /* --- комментарий --- */
  m = path.match(/^\/orders\/([a-f0-9]{32})\/comments$/);
  if (m && method === 'POST') {
    const id = m[1];
    const row = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    if (!row) return adminJson({ error: 'Заказ не найден.' }, 404);
    const b = await parseBody(request);
    const body = clean(String(b.body || ''), 1500);
    if (body.length < 1) return adminJson({ error: 'Введите текст комментария.' }, 400);
    const notify = b.notify !== false;
    let sent = false;
    await env.DB
      .prepare('INSERT INTO order_comments(order_id,body,author,channel,sent_to_customer) VALUES(?,?,?,?,?)')
      .bind(id, body, 'продавец', 'seller', notify && row.customer_chat_id ? 1 : 0)
      .run();
    if (notify && row.customer_chat_id) {
      const num = id.slice(0, 8).toUpperCase();
      await enqueue(env.DB, 'customer', row.customer_chat_id, `💬 Сообщение по заказу № ${num}\n\n${body}`);
      sent = true;
      ctx.waitUntil(flush(env).catch(() => {}));
    }
    return adminJson({ ok: true, sent, comments: await loadComments(env, id) });
  }

  /* --- повторная отправка статуса --- */
  m = path.match(/^\/orders\/([a-f0-9]{32})\/notify$/);
  if (m && method === 'POST') {
    const id = m[1];
    const row = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    if (!row) return adminJson({ error: 'Заказ не найден.' }, 404);
    if (!row.customer_chat_id) return adminJson({ error: 'Покупатель ещё не привязал заказ к боту.' }, 400);
    const extra = await env.DB.prepare('SELECT * FROM order_extra WHERE order_id=?').bind(id).first();
    const b = await parseBody(request).catch(() => ({}));
    const text = b.text ? clean(String(b.text), 1000) : statusMessage(row, extra);
    await enqueue(env.DB, 'customer', row.customer_chat_id, text);
    ctx.waitUntil(flush(env).catch(() => {}));
    return adminJson({ ok: true });
  }

  /* --- удалить заказ --- */
  if (m && method === 'DELETE') {
    const id = m[1];
    await env.DB.batch([
      env.DB.prepare('DELETE FROM order_items WHERE order_id=?').bind(id),
      env.DB.prepare('DELETE FROM order_comments WHERE order_id=?').bind(id),
      env.DB.prepare('DELETE FROM order_extra WHERE order_id=?').bind(id),
      env.DB.prepare('DELETE FROM orders WHERE id=?').bind(id)
    ]);
    return adminJson({ ok: true });
  }

  /* --- товары --- */
  if (path === '/products' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort, name').all();
    return adminJson({ ok: true, products: (results || []).map(productFromRow) });
  }
  if (path === '/products' && method === 'POST') {
    const b = await parseBody(request, 2000000);
    const input = Array.isArray(b.products) ? b.products : [b.product || b];
    const saved = [];
    for (const p of input.slice(0, 500)) {
      const existing = p.id ? await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(p.id).first() : null;
      const row = productRowFromInput(p, existing);
      if (!row.id || !row.name) continue;
      await upsertProduct(env, row);
      saved.push(row.id);
    }
    return adminJson({ ok: true, saved, count: saved.length });
  }
  m = path.match(/^\/products\/([a-z0-9-]{1,60})$/);
  if (m) {
    const id = m[1];
    if (method === 'PATCH' || method === 'PUT') {
      const existing = await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(id).first();
      const b = await parseBody(request, 2000000);
      if (!existing && method === 'PATCH') return adminJson({ error: 'Товар не найден.' }, 404);
      const row = productRowFromInput({ ...b, id }, existing);
      await upsertProduct(env, row);
      const fresh = await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(id).first();
      return adminJson({ ok: true, product: productFromRow(fresh) });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();
      return adminJson({ ok: true });
    }
    if (method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(id).first();
      if (!row) return adminJson({ error: 'Товар не найден.' }, 404);
      return adminJson({ ok: true, product: productFromRow(row) });
    }
  }

  /* --- импорт товаров --- */
  if (path === '/products/import' && method === 'POST') {
    const b = await parseBody(request, 4000000);
    const mode = b.mode === 'replace' ? 'replace' : 'merge';
    let list = [];
    if (b.format === 'csv' || (typeof b.data === 'string' && b.data.indexOf(';') >= 0) || (typeof b.data === 'string' && b.data.indexOf(',') >= 0)) {
      const rows = parseCSV(b.data);
      list = rows.map((r) => ({
        id: r.id,
        name: r.name || r['название'],
        price: r.price || r['цена'],
        old_price: r.old_price || r['старая цена'],
        stock: r.stock || r['остаток'],
        type: r.type || r['тип'] || 'candle',
        type_label: r.type_label || r['формат'],
        family: r.family || r['коллекция'],
        active: r.active != null ? r.active : (r['активен'] != null ? r['активен'] : 1),
        sort: r.sort || r['порядок'],
        tagline: r.tagline || r['короткое описание'],
        image_card: r.image_card || r['фото'],
        page: r.page,
        sku: r.sku
      }));
    } else {
      list = Array.isArray(b.products) ? b.products : Array.isArray(b.data) ? b.data : [];
    }
    if (!list.length) return adminJson({ error: 'Не удалось прочитать файл: нет строк с товарами.' }, 400);

    const saved = [];
    const errors = [];
    for (const item of list.slice(0, 1000)) {
      try {
        const existing = item.id ? await env.DB.prepare('SELECT * FROM products WHERE id=?').bind(item.id).first() : null;
        const row = productRowFromInput(item, existing);
        if (!row.id || !row.name) { errors.push('пропущено: ' + JSON.stringify(item).slice(0, 60)); continue; }
        await upsertProduct(env, row);
        saved.push({ id: row.id, price: row.price, stock: row.stock, name: row.name });
      } catch (e) {
        errors.push(String(e.message || e).slice(0, 120));
      }
    }
    if (mode === 'replace' && saved.length) {
      const ids = saved.map((s) => s.id);
      await env.DB
        .prepare(`DELETE FROM products WHERE id NOT IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .run();
    }
    return adminJson({ ok: true, updated: saved.length, saved, errors: errors.slice(0, 20) });
  }

  /* --- экспорт --- */
  if (path.startsWith('/export/') && method === 'GET') {
    const kind = path.replace('/export/', '');
    const stamp = new Date().toISOString().slice(0, 10);

    if (kind === 'orders.csv') {
      const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
      const rows = (results || []).map((r) => {
        const items = safeJSON(r.items_json, []);
        return {
          ...r,
          items: (items || []).map((x) => `${x.name} × ${x.qty}`).join(' | '),
          items_sum: (items || []).reduce((n, x) => n + (x.price || 0) * (x.qty || 0), 0)
        };
      });
      const csv = toCSV(rows, [
        { key: 'id', title: 'ID заказа' },
        { key: 'created_at', title: 'Дата' },
        { key: 'status', title: 'Статус', value: (r) => STATUSES[r.status] || r.status },
        { key: 'customer_name', title: 'Имя' },
        { key: 'phone', title: 'Телефон' },
        { key: 'city', title: 'Город' },
        { key: 'contact', title: 'Контакт' },
        { key: 'items', title: 'Состав' },
        { key: 'subtotal', title: 'Товары' },
        { key: 'discount', title: 'Скидка' },
        { key: 'total', title: 'Итого' },
        { key: 'promo', title: 'Промокод' },
        { key: 'tracking', title: 'Трек' },
        { key: 'comment', title: 'Комментарий покупателя' },
        { key: 'admin_note', title: 'Заметка продавца' }
      ]);
      return new Response(csv, downloadHeaders(`orders-${stamp}.csv`));
    }
    if (kind === 'orders.json' || kind === 'all.json') {
      const orders = (await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all()).results || [];
      const items = (await env.DB.prepare('SELECT * FROM order_items').all()).results || [];
      const comments = (await env.DB.prepare('SELECT * FROM order_comments').all()).results || [];
      const extra = (await env.DB.prepare('SELECT * FROM order_extra').all()).results || [];
      const payload = { exportedAt: new Date().toISOString(), orders, order_items: items, order_comments: comments, order_extra: extra };
      if (kind === 'all.json') {
        payload.products = (await env.DB.prepare('SELECT * FROM products').all()).results || [];
        payload.subscribers = (await env.DB.prepare('SELECT * FROM subscribers').all()).results || [];
        payload.news = (await env.DB.prepare('SELECT * FROM news').all()).results || [];
      }
      return new Response(JSON.stringify(payload, null, 2), downloadHeaders(`${kind.replace('.json', '')}-backup-${stamp}.json`, 'application/json'));
    }
    if (kind === 'products.csv') {
      const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort, name').all();
      return new Response(toCSV(results || [], PRODUCT_COLUMNS), downloadHeaders(`products-${stamp}.csv`));
    }
    if (kind === 'products.json') {
      const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort, name').all();
      return new Response(JSON.stringify((results || []).map(productFromRow), null, 2), downloadHeaders(`products-${stamp}.json`, 'application/json'));
    }
    if (kind === 'subscribers.csv') {
      const { results } = await env.DB.prepare('SELECT chat_id,subscribed,created_at FROM subscribers ORDER BY id').all();
      const csv = toCSV(results || [], [
        { key: 'chat_id', title: 'chat_id' },
        { key: 'subscribed', title: 'подписан' },
        { key: 'created_at', title: 'дата' }
      ]);
      return new Response(csv, downloadHeaders(`subscribers-${stamp}.csv`));
    }
    if (kind === 'comments.csv') {
      const { results } = await env.DB.prepare('SELECT * FROM order_comments ORDER BY id').all();
      const csv = toCSV(results || [], [
        { key: 'order_id', title: 'Заказ' },
        { key: 'created_at', title: 'Дата' },
        { key: 'author', title: 'Автор' },
        { key: 'channel', title: 'Канал' },
        { key: 'body', title: 'Текст' },
        { key: 'sent_to_customer', title: 'Отправлено' }
      ]);
      return new Response(csv, downloadHeaders(`comments-${stamp}.csv`));
    }
    return adminJson({ error: 'Неизвестный формат выгрузки.' }, 404);
  }

  /* --- новости / рассылка --- */
  if (path === '/news' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id,text,created_at FROM news ORDER BY id DESC LIMIT 50').all();
    return adminJson({ ok: true, news: results || [] });
  }
  if (path === '/news' && method === 'POST') {
    const b = await parseBody(request, 8000);
    const text = clean(b.text, 1200);
    if (text.length < 3) return adminJson({ error: 'Введите текст новости (от 3 до 1200 символов).' }, 400);
    const event = unique();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO news(text) VALUES(?)').bind(text),
      env.DB
        .prepare("INSERT OR IGNORE INTO outbox(kind,chat_id,text,dedupe) SELECT 'customer_news',chat_id,?,?||chat_id FROM subscribers WHERE subscribed=1")
        .bind('✨ Новости RULES\n\n' + text, 'news-' + event + '-')
    ]);
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM subscribers WHERE subscribed=1').first();
    ctx.waitUntil(flush(env).catch(() => {}));
    return adminJson({ ok: true, count: n ? n.n : 0 });
  }

  /* --- очередь сообщений --- */
  if (path === '/outbox' && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id,kind,chat_id,substr(text,1,120) t,state,attempts,error,created_at FROM outbox ORDER BY id DESC LIMIT 50')
      .all();
    const stat = await env.DB
      .prepare("SELECT SUM(CASE WHEN state IN ('pending','sending') THEN 1 ELSE 0 END) pending, SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed, SUM(CASE WHEN state='sent' THEN 1 ELSE 0 END) sent FROM outbox")
      .first();
    return adminJson({ ok: true, messages: results || [], stats: stat || {} });
  }
  if (path === '/outbox/retry' && method === 'POST') {
    await env.DB.prepare("UPDATE outbox SET state='pending',attempts=0,next_at=datetime('now'),error='' WHERE state='failed'").run();
    ctx.waitUntil(flush(env).catch(() => {}));
    return adminJson({ ok: true });
  }

  /* --- подключение вебхука бота покупателей --- */
  if (path === '/telegram/webhook' && method === 'POST') {
    if (!env.CUSTOMER_BOT_TOKEN || !env.WEBHOOK_SECRET || !validBot(env)) {
      return adminJson({ error: 'Заполните CUSTOMER_BOT_TOKEN, CUSTOMER_BOT_USERNAME и WEBHOOK_SECRET.' }, 400);
    }
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(env.WEBHOOK_SECRET)) {
      return adminJson({ error: 'WEBHOOK_SECRET: не менее 16 символов, латиница, цифры, _ и -.' }, 400);
    }
    if (equal(env.CUSTOMER_BOT_TOKEN, env.TELEGRAM_BOT_TOKEN)) {
      return adminJson({ error: 'Для покупателей нужен отдельный бот.' }, 400);
    }
    try {
      const me = await telegram(env.CUSTOMER_BOT_TOKEN, 'getMe', {});
      if (!me || String(me.username || '').toLowerCase() !== botname(env).toLowerCase()) {
        return adminJson({ error: 'Имя CUSTOMER_BOT_USERNAME не совпадает с токеном бота.' }, 400);
      }
      await telegram(env.CUSTOMER_BOT_TOKEN, 'setWebhook', {
        url: url.origin + '/telegram',
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query']
      });
      return adminJson({ ok: true, bot: me.username });
    } catch (e) {
      return adminJson({ error: 'Не удалось подключить webhook: ' + String(e.message || e) }, 502);
    }
  }

  /* --- тест бота владельца --- */
  if (path === '/telegram/test' && method === 'POST') {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return adminJson({ error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы.' }, 400);
    try {
      await telegram(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: String(env.TELEGRAM_CHAT_ID),
        text: '✅ RULES: уведомления о заказах подключены. Это тестовое сообщение.'
      });
      return adminJson({ ok: true });
    } catch (e) {
      return adminJson({ error: 'Telegram ответил ошибкой: ' + String(e.message || e) }, 502);
    }
  }

  return adminJson({ error: 'Не найдено.' }, 404);
}

function downloadHeaders(filename, type = 'text/csv; charset=utf-8') {
  return {
    'content-type': type,
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store'
  };
}

const secureHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

/* ============================ вебхук бота покупателей ============================ */
async function sendBot(env, chatId, text) {
  return telegram(env.CUSTOMER_BOT_TOKEN, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
}

async function customerMenu(env, chatId, view, ctx) {
  const rows = await env.DB.prepare('SELECT id,status,total,tracking,created_at FROM orders WHERE customer_chat_id=? ORDER BY created_at DESC LIMIT 10').bind(chatId).all();
  const orders = rows.results || [];
  if (view === 'orders' || view === 'home') {
    if (!orders.length) {
      return sendBot(env, chatId, 'У вас пока нет привязанных заказов.\n\nПосле оформления на сайте нажмите «Отслеживать заказ в Telegram».');
    }
    const lines = ['🧾 Ваши заказы:', ''];
    orders.forEach((o) => {
      lines.push(`№ ${o.id.slice(0, 8).toUpperCase()} · ${new Date(o.created_at + 'Z').toLocaleDateString('ru-RU')}`);
      lines.push(`Статус: ${STATUSES[o.status] || o.status} · ${money(o.total)}`);
      if (o.tracking) lines.push(`Трек: ${o.tracking}`);
      lines.push('');
    });
    lines.push('Вопросы — просто напишите сюда, продавец увидит сообщение.');
    return sendBot(env, chatId, lines.join('\n'));
  }
  if (view === 'catalog') {
    const { results } = await env.DB.prepare('SELECT name,price,stock FROM products WHERE active=1 ORDER BY sort').all();
    const lines = ['🕯 Каталог:', ''];
    (results || []).forEach((p) => {
      lines.push(`${p.name} — ${money(p.price)}${p.stock > 0 ? '' : ' (нет в наличии)'}`);
    });
    lines.push('', 'Заказ на сайте: нажмите ссылку в описании канала.');
    return sendBot(env, chatId, lines.join('\n'));
  }
  return sendBot(env, chatId, 'Привет! Здесь приходят статусы ваших заказов.');
}

async function webhook(request, env, ctx) {
  if (request.method !== 'POST') return new Response('OK');
  if (!env.CUSTOMER_BOT_TOKEN || !env.WEBHOOK_SECRET) return new Response('OK');
  if (!equal(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.WEBHOOK_SECRET)) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    const u = await request.json();
    const msg = u.message;
    const cb = u.callback_query;
    const chat = (cb && cb.message && cb.message.chat) || (msg && msg.chat);
    if (!chat || chat.type !== 'private') return new Response('OK');
    const chatId = String(chat.id);

    if (cb) {
      if (!cb.from || String(cb.from.id) !== chatId) return new Response('OK');
      ctx.waitUntil(telegram(env.CUSTOMER_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {}));
      await customerMenu(env, chatId, String(cb.data || 'home'), ctx);
      return new Response('OK');
    }

    const text = String((msg && msg.text) || '').trim();
    const start = text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{32}))?$/);
    if (start && start[1]) {
      const hash = await digest(start[1]);
      const o = await env.DB
        .prepare(
          "UPDATE orders SET customer_chat_id=?, claimed_at=COALESCE(claimed_at,datetime('now')) WHERE token_hash=? AND (customer_chat_id=? OR (customer_chat_id IS NULL AND created_at>=datetime('now','-14 days'))) RETURNING id,status,total"
        )
        .bind(chatId, hash, chatId)
        .first();
      if (o) {
        await env.DB.prepare('INSERT OR IGNORE INTO subscribers(chat_id,subscribed) VALUES(?,1)').bind(chatId).run();
        await sendBot(
          env,
          chatId,
          '✅ Заказ № ' + o.id.slice(0, 8).toUpperCase() + ' привязан.\nСтатус: ' + (STATUSES[o.status] || 'Уточняется') +
          '.\n\nЗдесь вы будете получать статусы и сообщения от продавца.'
        ).catch(() => {});
      } else {
        await sendBot(env, chatId, 'Ссылка недействительна или срок её действия истёк. Свяжитесь с продавцом.').catch(() => {});
      }
      return new Response('OK');
    }

    if (text === '/orders' || text === 'Мои заказы') { await customerMenu(env, chatId, 'orders', ctx); return new Response('OK'); }
    if (text === '/catalog' || text === 'Каталог') { await customerMenu(env, chatId, 'catalog', ctx); return new Response('OK'); }

    /* сообщение покупателя → в карточку заказа */
    if (text) {
      const last = await env.DB
        .prepare('SELECT id FROM orders WHERE customer_chat_id=? ORDER BY created_at DESC LIMIT 1')
        .bind(chatId)
        .first();
      if (last) {
        await env.DB
          .prepare("INSERT INTO order_comments(order_id,body,author,channel,sent_to_customer) VALUES(?,?,?,?,0)")
          .bind(last.id, clean(text, 1500), 'покупатель', 'customer')
          .run();
        await enqueue(env.DB, 'owner', String(env.TELEGRAM_CHAT_ID), `💬 Сообщение от покупателя по заказу № ${last.id.slice(0, 8).toUpperCase()}\n\n${clean(text, 1000)}`);
        ctx.waitUntil(flush(env).catch(() => {}));
      }
    }
    await customerMenu(env, chatId, 'home', ctx);
    return new Response('OK');
  } catch (e) {
    return new Response('OK');
  }
}

/* ============================ главный роутер ============================ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/catalog') return await publicCatalog(env, request);
      if (path === '/order') return await createOrder(request, env, ctx);
      if (path === '/telegram') return await webhook(request, env, ctx);
      if (path === '/admin' || path === '/admin/') {
        return new Response(ADMIN_HTML, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-frame-options': 'DENY',
            'referrer-policy': 'no-referrer'
          }
        });
      }
      if (path.startsWith('/admin/api/')) {
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              'Access-Control-Max-Age': '600'
            }
          });
        }
        return await adminApi(request, env, ctx, url);
      }
      if (path === '/health') return json({ ok: true, time: new Date().toISOString() });
      return new Response('RULES', { status: 404, headers: { 'cache-control': 'no-store' } });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/SQLITE|D1_|database|no such table/i.test(msg)) {
        return json({ error: 'База данных не инициализирована: выполните schema.sql.' }, 503);
      }
      return json({ error: 'Временная ошибка сервиса.' }, 503);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(flush(env));
  }
};

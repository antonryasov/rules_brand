-- ============================================================
-- RULES · схема базы D1 для личного кабинета (CRM)
-- ------------------------------------------------------------
-- Безопасно выполнять на существующей базе: все таблицы
-- создаются через CREATE TABLE IF NOT EXISTS, данные не удаляются.
-- Как применить:
--   Cloudflare → Workers & Pages → D1 → rules-orders-db → Console
--   вставьте весь текст файла и нажмите Execute.
--   (или: npx wrangler d1 execute rules-orders-db --remote --file=./schema.sql)
-- ============================================================

-- ---------- заказы (в существующей базе эта таблица уже есть) ----------
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  token_hash       TEXT NOT NULL DEFAULT '',
  customer_name    TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  contact          TEXT NOT NULL DEFAULT '',
  comment          TEXT NOT NULL DEFAULT '',
  items_json       TEXT NOT NULL DEFAULT '[]',
  subtotal         INTEGER NOT NULL DEFAULT 0,
  discount         INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL DEFAULT 0,
  promo            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'new',
  tracking         TEXT NOT NULL DEFAULT '',
  admin_note       TEXT NOT NULL DEFAULT '',
  customer_chat_id TEXT,
  claimed_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_token ON orders(token_hash);

-- ---------- товары и остатки ----------
CREATE TABLE IF NOT EXISTS products (
  id               TEXT PRIMARY KEY,
  page             TEXT NOT NULL DEFAULT '',
  sku              TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL,
  full_name        TEXT NOT NULL DEFAULT '',
  type             TEXT NOT NULL DEFAULT 'candle',
  type_label       TEXT NOT NULL DEFAULT '',
  family           TEXT NOT NULL DEFAULT '',
  collection       TEXT NOT NULL DEFAULT '',
  price            INTEGER NOT NULL DEFAULT 0,
  old_price        INTEGER NOT NULL DEFAULT 0,
  stock            INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  badge            TEXT NOT NULL DEFAULT '',
  sort             INTEGER NOT NULL DEFAULT 100,
  tagline          TEXT NOT NULL DEFAULT '',
  quote            TEXT NOT NULL DEFAULT '',
  lead             TEXT NOT NULL DEFAULT '',
  notes_json       TEXT NOT NULL DEFAULT '{}',
  specs_json       TEXT NOT NULL DEFAULT '[]',
  gallery_json     TEXT NOT NULL DEFAULT '[]',
  image_card       TEXT NOT NULL DEFAULT '',
  image_hero       TEXT NOT NULL DEFAULT '',
  safety           TEXT NOT NULL DEFAULT '',
  delivery_note    TEXT NOT NULL DEFAULT '',
  cross_sell       TEXT NOT NULL DEFAULT '',
  meta_title       TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active, sort);

-- ---------- состав заказа (редактируется в кабинете) ----------
CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  price      INTEGER NOT NULL DEFAULT 0,
  qty        INTEGER NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ---------- комментарии и история по заказу ----------
CREATE TABLE IF NOT EXISTS order_comments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         TEXT NOT NULL,
  body             TEXT NOT NULL,
  author           TEXT NOT NULL DEFAULT 'продавец',
  channel          TEXT NOT NULL DEFAULT 'seller',   -- seller | customer | system
  sent_to_customer INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_comments_order ON order_comments(order_id);

-- ---------- доп. поля заказа (оплата, доставка) ----------
CREATE TABLE IF NOT EXISTS order_extra (
  order_id        TEXT PRIMARY KEY,
  payment_status  TEXT NOT NULL DEFAULT 'none',      -- none | paid | refund
  delivery_method TEXT NOT NULL DEFAULT '',
  delivery_cost   INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- служебные таблицы (создаются, если их ещё нет) ----------
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash      TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscribers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT NOT NULL UNIQUE,
  subscribed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  dedupe     TEXT NOT NULL UNIQUE,
  state      TEXT NOT NULL DEFAULT 'pending',
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    TEXT NOT NULL DEFAULT (datetime('now')),
  error      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox(state, next_at);

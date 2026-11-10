#!/usr/bin/env node
/* ============================================================
   Заливка каталога из data/products.json в базу D1
   ------------------------------------------------------------
   Создаёт рядом файл seed.sql — его можно выполнить командой
   npm run seed   (wrangler d1 execute ... --file=seed.sql)
   или вставить в консоль D1 в Cloudflare.
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const productsPath = join(here, '../../data/products.json');
const products = JSON.parse(readFileSync(productsPath, 'utf8'));

const q = (v) => "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'";
const n = (v) => String(Number(v) || 0);

const rows = products.map((p) => {
  const notes = p.notes || {};
  return `(${[
    q(p.id),
    q(p.page || ''),
    q(p.sku || ''),
    q(p.name),
    q(p.fullName || p.name),
    q(p.type || 'candle'),
    q(p.typeLabel || ''),
    q(p.family || ''),
    q(p.collection || ''),
    n(p.price),
    n(p.oldPrice),
    n(p.stock),
    p.active === false ? 0 : 1,
    q(p.badge || ''),
    n(p.sort || 100),
    q(p.tagline || ''),
    q(p.quote || ''),
    q(p.lead || ''),
    q(JSON.stringify(notes)),
    q(JSON.stringify(p.specs || [])),
    q(JSON.stringify((p.images && p.images.gallery) || [])),
    q((p.images && p.images.card) || ''),
    q((p.images && p.images.hero) || ''),
    q(p.safety || ''),
    q(p.deliveryNote || ''),
    q(p.crossSell || ''),
    q((p.meta && p.meta.title) || ''),
    q((p.meta && p.meta.description) || '')
  ].join(',')})`;
});

const sql = `-- Сгенерировано из data/products.json: ${new Date().toISOString()}
INSERT INTO products (id,page,sku,name,full_name,type,type_label,family,collection,price,old_price,stock,active,badge,sort,
  tagline,quote,lead,notes_json,specs_json,gallery_json,image_card,image_hero,safety,delivery_note,cross_sell,meta_title,meta_description)
VALUES
${rows.join(',\n')}
ON CONFLICT(id) DO UPDATE SET
  page=excluded.page, sku=excluded.sku, name=excluded.name, full_name=excluded.full_name, type=excluded.type,
  type_label=excluded.type_label, family=excluded.family, collection=excluded.collection, price=excluded.price,
  old_price=excluded.old_price, stock=excluded.stock, active=excluded.active, badge=excluded.badge, sort=excluded.sort,
  tagline=excluded.tagline, quote=excluded.quote, lead=excluded.lead, notes_json=excluded.notes_json,
  specs_json=excluded.specs_json, gallery_json=excluded.gallery_json, image_card=excluded.image_card,
  image_hero=excluded.image_hero, safety=excluded.safety, delivery_note=excluded.delivery_note,
  cross_sell=excluded.cross_sell, meta_title=excluded.meta_title, meta_description=excluded.meta_description,
  updated_at=datetime('now');
`;

writeFileSync(join(here, '../seed.sql'), sql);
console.log('seed.sql создан, товаров:', products.length);

#!/usr/bin/env node
/* ============================================================
   Сборка Worker в один файл
   ------------------------------------------------------------
   Берёт worker/src/worker.js и вставляет в него личный кабинет
   из папки admin/ (index.html + app.css + app.js).
   Результат: worker/dist/worker.js — этот файл копируется
   в Cloudflare (или деплоится через wrangler).

   Запуск:  node build.mjs        (из папки worker/)
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const read = (p) => readFileSync(p, 'utf8');

const adminHtml = read(join(root, 'admin/index.html'));
const adminCss = read(join(root, 'admin/app.css'));
const adminJs = read(join(root, 'admin/app.js'));

const ui = adminHtml
  .split('/*__CSS__*/').join(adminCss)
  .split('/*__JS__*/').join(adminJs);

const worker = read(join(here, 'src/worker.js'));
if (!worker.includes('"__ADMIN_HTML__"')) {
  console.error('В src/worker.js не найден маркер "__ADMIN_HTML__"');
  process.exit(1);
}
const out = worker.split('"__ADMIN_HTML__"').join(JSON.stringify(ui));

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist/worker.js'), out);
console.log('готово: worker/dist/worker.js ·', (out.length / 1024).toFixed(0), 'КБ');

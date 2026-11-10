/* ============================================================
   RULES · личный кабинет (CRM) — логика
   ------------------------------------------------------------
   Работает как обычная страница: общается с этим же Worker
   по адресам /admin/api/*. Токен входа хранится в localStorage.
   ============================================================ */
(function () {
  'use strict';

  var API = '/admin/api';
  var root = document.getElementById('root');
  var toasts = document.getElementById('toasts');
  var token = '';
  var state = {
    view: 'dashboard',
    orders: { q: '', status: '', page: 0, list: [], more: false },
    products: [],
    productsDirty: {},
    summary: null,
    settings: {},
    drawOrder: null,
    catalog: []
  };

  /* ---------------- утилиты ---------------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function imgUrl(src) {
    if (!src) return '';
    if (/^(data:|https?:)/i.test(src)) return src;
    var base = (state.siteUrl || '').replace(/\/+$/, '');
    return base + '/' + String(src).replace(/^\//, '');
  }
  function money(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' ₽';
  }
  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(String(s).replace(' ', 'T') + (String(s).indexOf('Z') > 0 ? '' : 'Z'));
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function toast(text, type) {
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = text;
    toasts.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity .3s';
      setTimeout(function () { t.remove(); }, 320);
    }, type === 'err' ? 6000 : 3200);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) {
          token = '';
          localStorage.removeItem('rules-admin-token');
          renderLogin('Сессия истекла — войдите заново.');
          throw new Error('unauthorized');
        }
        if (!r.ok) throw new Error(data.error || 'Ошибка запроса');
        return data;
      });
    });
  }

  function download(path, filename) {
    var headers = token ? { Authorization: 'Bearer ' + token } : {};
    return fetch(API + path, { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('Не удалось выгрузить файл');
      return r.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------------- вход ---------------- */
  function renderLogin(message) {
    root.innerHTML =
      '<div class="login-wrap"><form class="login" id="login">' +
        '<h1>RULES · кабинет</h1>' +
        '<p>Панель управления заказами, товарами и клиентами.</p>' +
        '<label for="pw">Пароль</label>' +
        '<input id="pw" type="password" autocomplete="current-password" required autofocus>' +
        '<button type="submit">Войти</button>' +
        '<div class="err" id="login-err">' + esc(message || '') + '</div>' +
      '</form></div>';
    var form = document.getElementById('login');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button');
      btn.disabled = true;
      api('/login', { method: 'POST', body: { password: document.getElementById('pw').value } })
        .then(function (d) {
          token = d.token;
          localStorage.setItem('rules-admin-token', token);
          boot();
        })
        .catch(function (err) {
          document.getElementById('login-err').textContent = err.message;
        })
        .then(function () { btn.disabled = false; });
    });
  }

  /* ---------------- каркас ---------------- */
  var NAV = [
    { id: 'dashboard', label: 'Обзор' },
    { id: 'orders', label: 'Заказы' },
    { id: 'products', label: 'Товары и склад' },
    { id: 'clients', label: 'Клиенты' },
    { id: 'news', label: 'Рассылка' },
    { id: 'export', label: 'Выгрузка данных' },
    { id: 'settings', label: 'Настройки' }
  ];

  function renderShell() {
    root.innerHTML =
      '<div class="app">' +
        '<aside class="side">' +
          '<div class="brand">RULES<small>личный кабинет</small></div>' +
          '<nav id="nav">' + NAV.map(function (n) {
            return '<button data-view="' + n.id + '">' + n.label + (n.id === 'orders' ? '<span class="badge" id="badge-orders"></span>' : '') + '</button>';
          }).join('') + '</nav>' +
          '<div class="foot">' +
            '<button class="ghost small" id="logout">Выйти</button>' +
            '<span id="foot-info"></span>' +
          '</div>' +
        '</aside>' +
        '<div class="main">' +
          '<div class="topbar"><h2 id="page-title">Обзор</h2><div class="actions" id="top-actions"></div></div>' +
          '<div class="view" id="view"></div>' +
        '</div>' +
      '</div>';

    document.getElementById('nav').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]');
      if (!b) return;
      go(b.getAttribute('data-view'));
    });
    document.getElementById('logout').addEventListener('click', function () {
      api('/logout', { method: 'POST' }).catch(function () { });
      token = '';
      localStorage.removeItem('rules-admin-token');
      renderLogin('');
    });
  }

  function setActiveNav() {
    document.querySelectorAll('#nav button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === state.view);
    });
    var titles = {
      dashboard: 'Обзор', orders: 'Заказы', products: 'Товары и склад',
      clients: 'Клиенты', news: 'Рассылка', export: 'Выгрузка данных', settings: 'Настройки'
    };
    document.getElementById('page-title').textContent = titles[state.view] || '';
    document.getElementById('top-actions').innerHTML = '';
  }

  function actions(html) {
    document.getElementById('top-actions').innerHTML = html;
    return document.getElementById('top-actions');
  }

  function go(view) {
    state.view = view;
    setActiveNav();
    ({ dashboard: viewDashboard, orders: viewOrders, products: viewProducts, clients: viewClients, news: viewNews, export: viewExport, settings: viewSettings }[view] || viewDashboard)();
  }

  /* ---------------- обзор ---------------- */
  function viewDashboard() {
    var v = document.getElementById('view');
    v.innerHTML = '<div class="empty">Загружаем…</div>';
    api('/summary').then(function (d) {
      state.summary = d;
      state.siteUrl = d.siteUrl || '';
      var badge = document.getElementById('badge-orders');
      var newCount = (d.byStatus || []).filter(function (s) { return s.status === 'new'; })[0];
      if (badge) badge.textContent = newCount ? newCount.n : '';
      document.getElementById('foot-info').textContent = 'Бот: ' + (d.bot ? '@' + d.bot : 'не подключён');

      v.innerHTML =
        '<div class="cards">' +
          card('Заказов сегодня', d.today.n || 0, money(d.today.sum || 0)) +
          card('Новых заказов', newCount ? newCount.n : 0, 'ждут подтверждения') +
          card('Выручка в работе', money(d.revenue), 'подтверждённые и отправленные') +
          card('Товаров активных', d.products, 'в каталоге') +
          card('Подписчиков бота', d.subscribers, 'получают новости') +
          card('Очередь Telegram', d.queue.pending + (d.queue.failed ? ' / ' + d.queue.failed : ''), d.queue.failed ? 'есть ошибки отправки' : 'всё отправлено') +
        '</div>' +
        '<div class="grid2">' +
          '<div class="panel"><h3>Последние заказы</h3>' +
            (d.recent && d.recent.length
              ? '<table><tbody>' + d.recent.map(function (o) {
                  return '<tr class="click" data-order="' + esc(o.id) + '">' +
                    '<td><b>№ ' + esc(o.id.slice(0, 8).toUpperCase()) + '</b><div class="hint">' + esc(fmtDate(o.created_at)) + '</div></td>' +
                    '<td>' + esc(o.customer_name) + '<div class="hint">' + esc(o.city) + '</div></td>' +
                    '<td class="num">' + money(o.total) + '<div><span class="pill ' + esc(o.status) + '">' + esc(d.statuses[o.status] || o.status) + '</span></div></td>' +
                  '</tr>';
                }).join('') + '</tbody></table>'
              : '<div class="empty">Заказов пока нет</div>') +
          '</div>' +
          '<div class="panel"><h3>Мало на складе</h3>' +
            (d.lowStock && d.lowStock.length
              ? '<table><tbody>' + d.lowStock.map(function (p) {
                  return '<tr><td>' + esc(p.name) + '</td><td class="num">' + money(p.price) + '</td>' +
                    '<td class="num"><span class="pill ' + (p.stock > 0 ? 'warn' : 'bad') + '">' + p.stock + ' шт.</span></td></tr>';
                }).join('') + '</tbody></table>'
              : '<div class="empty">Все позиции в наличии</div>') +
          '</div>' +
        '</div>';

      v.querySelectorAll('[data-order]').forEach(function (tr) {
        tr.addEventListener('click', function () { openOrder(tr.getAttribute('data-order')); });
      });
    }).catch(function (e) {
      if (e.message !== 'unauthorized') v.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    });
  }

  function card(k, v, s) {
    return '<div class="card-metric"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>';
  }

  /* ---------------- заказы ---------------- */
  var STATUS_ORDER = ['new', 'confirmed', 'packing', 'sent', 'delivered', 'cancelled'];
  var STATUS_LABEL = {
    new: 'Новый', confirmed: 'Подтверждён', packing: 'Собирается',
    sent: 'Отправлен', delivered: 'Доставлен', cancelled: 'Отменён'
  };

  function viewOrders() {
    var v = document.getElementById('view');
    v.innerHTML =
      '<div class="panel">' +
        '<div class="row">' +
          '<div class="field" style="flex:2 1 260px"><label>Поиск</label>' +
            '<input id="q" placeholder="номер, имя, телефон, город" value="' + esc(state.orders.q) + '"></div>' +
          '<div class="field"><label>Статус</label><select id="f-status">' +
            '<option value="">Все</option>' +
            STATUS_ORDER.map(function (s) {
              return '<option value="' + s + '"' + (state.orders.status === s ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>';
            }).join('') + '</select></div>' +
          '<div class="field"><label>С даты</label><input id="f-from" type="date"></div>' +
          '<div class="field"><label>По дату</label><input id="f-to" type="date"></div>' +
          '<div class="row tight" style="flex:0 0 auto"><button id="apply">Найти</button></div>' +
        '</div>' +
      '</div>' +
      '<div class="panel"><div id="orders-list" class="tbl-wrap"><div class="empty">Загружаем…</div></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:16px">' +
          '<button class="ghost small" id="prev">← Назад</button>' +
          '<span class="hint" id="page-info"></span>' +
          '<button class="ghost small" id="next">Вперёд →</button>' +
        '</div>' +
      '</div>';

    actions('<button id="export-orders" class="ghost small">Выгрузить CSV</button>');
    document.getElementById('export-orders').addEventListener('click', function () {
      download('/export/orders.csv', 'orders-' + new Date().toISOString().slice(0, 10) + '.csv');
    });

    document.getElementById('apply').addEventListener('click', function () {
      state.orders.q = document.getElementById('q').value.trim();
      state.orders.status = document.getElementById('f-status').value;
      state.orders.from = document.getElementById('f-from').value;
      state.orders.to = document.getElementById('f-to').value;
      state.orders.page = 0;
      loadOrders();
    });
    document.getElementById('q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('apply').click();
    });
    document.getElementById('prev').addEventListener('click', function () {
      if (state.orders.page > 0) { state.orders.page--; loadOrders(); }
    });
    document.getElementById('next').addEventListener('click', function () {
      if (state.orders.more) { state.orders.page++; loadOrders(); }
    });
    loadOrders();
  }

  function loadOrders() {
    var box = document.getElementById('orders-list');
    if (!box) return;
    var qs = '?q=' + encodeURIComponent(state.orders.q || '') +
      '&status=' + encodeURIComponent(state.orders.status || '') +
      '&from=' + encodeURIComponent(state.orders.from || '') +
      '&to=' + encodeURIComponent(state.orders.to || '') +
      '&page=' + state.orders.page;
    api('/orders' + qs).then(function (d) {
      state.orders.list = d.orders;
      state.orders.more = d.more;
      document.getElementById('page-info').textContent = 'Страница ' + (d.page + 1);
      if (!d.orders.length) {
        box.innerHTML = '<div class="empty">Заказов не найдено</div>';
        return;
      }
      box.innerHTML =
        '<table><thead><tr>' +
          '<th>Заказ</th><th>Покупатель</th><th>Состав</th><th class="num">Сумма</th><th>Статус</th><th></th>' +
        '</tr></thead><tbody>' +
        d.orders.map(function (o) {
          return '<tr class="click" data-order="' + esc(o.id) + '">' +
            '<td><b>№ ' + esc(o.id.slice(0, 8).toUpperCase()) + '</b><div class="hint">' + esc(fmtDate(o.createdAt)) + '</div></td>' +
            '<td>' + esc(o.customer.name) + '<div class="hint">' + esc(o.customer.phone) + ' · ' + esc(o.customer.city) + '</div></td>' +
            '<td style="max-width:280px"><div class="hint" style="color:var(--muted)">' + esc(o.itemsPreview).slice(0, 90) + '</div></td>' +
            '<td class="num">' + money(o.total) + (o.discount ? '<div class="hint">−' + money(o.discount) + '</div>' : '') + '</td>' +
            '<td><span class="pill ' + esc(o.status) + '">' + esc(o.statusLabel) + '</span>' +
              (o.hasChat ? ' <span class="pill">TG</span>' : '') + '</td>' +
            '<td class="num"><button class="ghost small" data-order="' + esc(o.id) + '">Открыть</button></td>' +
          '</tr>';
        }).join('') + '</tbody></table>';

      box.querySelectorAll('[data-order]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          openOrder(el.getAttribute('data-order'));
        });
      });
    }).catch(function (e) {
      box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    });
  }

  /* ---------------- карточка заказа ---------------- */
  function openOrder(id) {
    api('/orders/' + id).then(function (d) {
      state.drawOrder = d.order;
      state.catalogLoaded = state.catalogLoaded || null;
      renderOrderDrawer(d.order);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function closeDrawer() {
    var w = document.querySelector('.drawer-wrap');
    if (w) w.remove();
  }

  function renderOrderDrawer(order) {
    closeDrawer();
    var wrap = document.createElement('div');
    wrap.className = 'drawer-wrap';
    wrap.innerHTML =
      '<div class="drawer">' +
        '<div class="drawer-head">' +
          '<div><div class="title">Заказ № ' + esc(order.id.slice(0, 8).toUpperCase()) + '</div>' +
            '<div class="sub">' + esc(fmtDate(order.createdAt)) + ' · ' + (order.customerChatId ? 'покупатель в боте' : 'покупатель не привязан к боту') + '</div></div>' +
          '<div class="row tight">' +
            '<button class="ghost small" id="d-notify">Отправить статус</button>' +
            '<button class="danger small" id="d-delete">Удалить</button>' +
            '<button class="close" id="d-close">×</button>' +
          '</div>' +
        '</div>' +
        '<div class="drawer-body" id="d-body"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeDrawer(); });
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { closeDrawer(); document.removeEventListener('keydown', escClose); }
    });
    wrap.querySelector('#d-close').addEventListener('click', closeDrawer);
    wrap.querySelector('#d-notify').addEventListener('click', function () {
      api('/orders/' + order.id + '/notify', { method: 'POST', body: {} })
        .then(function () { toast('Уведомление отправлено покупателю'); })
        .catch(function (e) { toast(e.message, 'err'); });
    });
    wrap.querySelector('#d-delete').addEventListener('click', function () {
      if (!confirm('Удалить заказ безвозвратно? Остатки при этом не восстанавливаются.')) return;
      api('/orders/' + order.id, { method: 'DELETE' })
        .then(function () { toast('Заказ удалён'); closeDrawer(); loadOrders(); })
        .catch(function (e) { toast(e.message, 'err'); });
    });

    renderOrderBody(order);
  }

  function renderOrderBody(order) {
    var body = document.getElementById('d-body');
    if (!body) return;
    var draft = state.drawDraft = {
      status: order.status,
      tracking: order.tracking || '',
      adminNote: order.adminNote || '',
      paymentStatus: order.paymentStatus || 'none',
      deliveryMethod: order.deliveryMethod || '',
      deliveryCost: order.deliveryCost || 0,
      customer: {
        name: order.customer.name || '',
        phone: order.customer.phone || '',
        city: order.customer.city || '',
        contact: order.customer.contact || '',
        comment: order.customer.comment || ''
      }
    };
    var items = state.drawItems = order.items.map(function (it) {
      return { productId: it.productId, name: it.name, price: it.price, qty: it.qty };
    });
    var total = items.reduce(function (n, it) { return n + it.price * it.qty; }, 0);

    body.innerHTML =
      '<div class="panel"><h3>Статус и доставка</h3>' +
        '<div class="grid3">' +
          '<div class="field"><label>Статус заказа</label><select id="d-status">' +
            STATUS_ORDER.map(function (s) {
              return '<option value="' + s + '"' + (order.status === s ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>';
            }).join('') + '</select></div>' +
          '<div class="field"><label>Оплата</label><select id="d-payment">' +
            [['none', 'Не оплачен'], ['paid', 'Оплачен'], ['refund', 'Возврат']].map(function (p) {
              return '<option value="' + p[0] + '"' + ((order.paymentStatus || 'none') === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
            }).join('') + '</select></div>' +
          '<div class="field"><label>Доставка</label><input id="d-delivery" value="' + esc(order.deliveryMethod || '') + '" placeholder="СДЭК, Почта, курьер"></div>' +
          '<div class="field"><label>Стоимость доставки, ₽</label><input id="d-delivery-cost" type="number" min="0" value="' + (order.deliveryCost || 0) + '"></div>' +
          '<div class="field"><label>Трек-номер</label><input id="d-tracking" value="' + esc(order.tracking || '') + '"></div>' +
          '<div class="field"><label>&nbsp;</label><label style="text-transform:none;letter-spacing:0;color:var(--muted);font-size:13px"><input type="checkbox" id="d-notify-check" checked style="width:auto;margin-right:8px">уведомить покупателя</label></div>' +
        '</div>' +
      '</div>' +

      '<div class="panel"><h3>Покупатель</h3>' +
        '<div class="grid2">' +
          '<div class="field"><label>Имя</label><input id="c-name" value="' + esc(order.customer.name) + '"></div>' +
          '<div class="field"><label>Телефон</label><input id="c-phone" value="' + esc(order.customer.phone) + '"></div>' +
          '<div class="field"><label>Город</label><input id="c-city" value="' + esc(order.customer.city) + '"></div>' +
          '<div class="field"><label>Контакт</label><input id="c-contact" value="' + esc(order.customer.contact || '') + '"></div>' +
        '</div>' +
        '<div class="field" style="margin-top:14px"><label>Комментарий покупателя</label>' +
          '<input id="c-comment" value="' + esc(order.customer.comment || '') + '"></div>' +
      '</div>' +

      '<div class="panel"><h3>Состав заказа</h3>' +
        '<div class="tbl-wrap"><table class="items-table"><thead><tr>' +
          '<th>Товар</th><th style="width:110px">Цена</th><th style="width:140px">Кол-во</th><th class="num" style="width:110px">Сумма</th><th></th>' +
        '</tr></thead><tbody id="items-body"></tbody></table></div>' +
        '<div class="row" style="margin-top:14px;align-items:flex-end">' +
          '<div class="field" style="flex:2 1 260px"><label>Добавить товар из каталога</label>' +
            '<select id="add-product"><option value="">— выбрать —</option></select></div>' +
          '<div class="row tight"><button class="ghost small" id="add-free">Добавить строку вручную</button></div>' +
        '</div>' +
        '<div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">' +
          '<div class="hint">Товары: <b id="items-total">' + money(total) + '</b>' +
            (order.promo ? ' · промокод <b>' + esc(order.promo) + '</b> (−' + money(order.discount) + ')' : '') + '</div>' +
          '<button class="ghost small" id="save-items">Пересчитать состав</button>' +
        '</div>' +
      '</div>' +

      '<div class="panel"><h3>Заметка продавца</h3>' +
        '<textarea id="d-note" placeholder="Внутренняя заметка, покупатель её не видит">' + esc(order.adminNote || '') + '</textarea>' +
        '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">' +
          '<button id="save-order">Сохранить заказ</button>' +
          '<button class="ghost" id="copy-id">Скопировать номер</button>' +
        '</div>' +
      '</div>' +

      '<div class="panel"><h3>Переписка с покупателем</h3>' +
        '<div class="comments" id="comments">' +
          (order.comments.length
            ? order.comments.map(commentHtml).join('')
            : '<div class="hint">Пока нет ни одного комментария.</div>') +
        '</div>' +
        '<div style="margin-top:16px">' +
          '<textarea id="new-comment" placeholder="Например: собрали заказ, отправим завтра СДЭКом"></textarea>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:12px;flex-wrap:wrap">' +
            '<label class="hint" style="display:flex;gap:8px;align-items:center">' +
              '<input type="checkbox" id="comment-notify" checked style="width:auto"' + (order.customerChatId ? '' : ' disabled') + '> ' +
              (order.customerChatId ? 'отправить покупателю в Telegram' : 'покупатель не привязал бота — сохранится только в карточке') +
            '</label>' +
            '<button id="send-comment">Добавить комментарий</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    renderItems();
    fillCatalogSelect();

    document.getElementById('save-order').addEventListener('click', function () {
      var body2 = {
        status: document.getElementById('d-status').value,
        tracking: document.getElementById('d-tracking').value,
        paymentStatus: document.getElementById('d-payment').value,
        deliveryMethod: document.getElementById('d-delivery').value,
        deliveryCost: Number(document.getElementById('d-delivery-cost').value) || 0,
        adminNote: document.getElementById('d-note').value,
        notify: document.getElementById('d-notify-check').checked,
        customer: {
          name: document.getElementById('c-name').value,
          phone: document.getElementById('c-phone').value,
          city: document.getElementById('c-city').value,
          contact: document.getElementById('c-contact').value,
          comment: document.getElementById('c-comment').value
        }
      };
      api('/orders/' + order.id, { method: 'PUT', body: body2 }).then(function (d) {
        toast(d.notified ? 'Заказ сохранён, покупатель уведомлён' : 'Заказ сохранён');
        state.drawOrder = d.order;
        renderOrderDrawer(d.order);
        if (state.view === 'orders') loadOrders();
      }).catch(function (e) { toast(e.message, 'err'); });
    });

    document.getElementById('copy-id').addEventListener('click', function () {
      navigator.clipboard.writeText(order.id).then(function () { toast('Номер скопирован'); });
    });

    document.getElementById('save-items').addEventListener('click', function () {
      api('/orders/' + order.id + '/items', { method: 'PUT', body: { items: state.drawItems } })
        .then(function (d) {
          toast('Состав обновлён, суммы пересчитаны');
          renderOrderDrawer(d.order);
          if (state.view === 'orders') loadOrders();
        }).catch(function (e) { toast(e.message, 'err'); });
    });

    document.getElementById('add-product').addEventListener('change', function (e) {
      var pid = e.target.value;
      if (!pid) return;
      var p = state.catalog.filter(function (x) { return x.id === pid; })[0];
      if (!p) return;
      state.drawItems.push({ productId: p.id, name: p.fullName || p.name, price: p.price, qty: 1 });
      e.target.value = '';
      renderItems();
      toast('Добавлено — не забудьте нажать «Пересчитать состав»');
    });

    document.getElementById('add-free').addEventListener('click', function () {
      state.drawItems.push({ productId: '', name: 'Позиция вручную', price: 0, qty: 1 });
      renderItems();
    });

    document.getElementById('send-comment').addEventListener('click', function () {
      var text = document.getElementById('new-comment').value.trim();
      if (!text) return;
      var notify = document.getElementById('comment-notify').checked;
      api('/orders/' + order.id + '/comments', { method: 'POST', body: { body: text, notify: notify } })
        .then(function (d) {
          toast(d.sent ? 'Комментарий добавлен и отправлен покупателю' : 'Комментарий сохранён в карточке');
          document.getElementById('new-comment').value = '';
          reloadComments(order.id);
        }).catch(function (e) { toast(e.message, 'err'); });
    });
  }

  function commentHtml(c) {
    var channel = c.channel === 'customer' ? 'покупатель' : c.channel === 'system' ? 'система' : 'продавец';
    return '<div class="comment ' + esc(c.channel) + '">' +
      '<div class="meta"><b>' + esc(c.author || channel) + '</b><span>' + esc(fmtDate(c.createdAt)) + '</span>' +
      (c.channel === 'seller' ? (c.sent ? '<span class="pill">отправлено в TG</span>' : '<span class="pill warn">только в карточке</span>') : '') +
      '</div>' + esc(c.body) + '</div>';
  }

  function reloadComments(id) {
    api('/orders/' + id).then(function (d) {
      var box = document.getElementById('comments');
      if (box) {
        box.innerHTML = d.order.comments.length
          ? d.order.comments.map(commentHtml).join('')
          : '<div class="hint">Пока нет ни одного комментария.</div>';
      }
      state.drawOrder = d.order;
    }).catch(function () { });
  }

  function renderItems() {
    var body = document.getElementById('items-body');
    if (!body) return;
    body.innerHTML = state.drawItems.map(function (it, i) {
      return '<tr>' +
        '<td><input data-k="name" data-i="' + i + '" value="' + esc(it.name) + '"></td>' +
        '<td><input data-k="price" data-i="' + i + '" type="number" min="0" value="' + it.price + '"></td>' +
        '<td><div class="qty-box">' +
          '<button class="ghost small" data-dec="' + i + '">−</button>' +
          '<input data-k="qty" data-i="' + i + '" type="number" min="0" value="' + it.qty + '">' +
          '<button class="ghost small" data-inc="' + i + '">+</button>' +
        '</div></td>' +
        '<td class="num">' + money(it.price * it.qty) + '</td>' +
        '<td class="num"><button class="danger small" data-del="' + i + '">×</button></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="5" class="empty">Нет позиций</td></tr>';

    var total = state.drawItems.reduce(function (n, it) { return n + it.price * it.qty; }, 0);
    var tEl = document.getElementById('items-total');
    if (tEl) tEl.textContent = money(total);

    body.querySelectorAll('input[data-k]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = Number(inp.getAttribute('data-i'));
        var k = inp.getAttribute('data-k');
        state.drawItems[i][k] = k === 'name' ? inp.value : Number(inp.value) || 0;
        var total2 = state.drawItems.reduce(function (n, it) { return n + it.price * it.qty; }, 0);
        if (tEl) tEl.textContent = money(total2);
      });
    });
    body.querySelectorAll('[data-dec]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-dec'));
        state.drawItems[i].qty = Math.max(0, state.drawItems[i].qty - 1);
        renderItems();
      });
    });
    body.querySelectorAll('[data-inc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-inc'));
        state.drawItems[i].qty += 1;
        renderItems();
      });
    });
    body.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.drawItems.splice(Number(b.getAttribute('data-del')), 1);
        renderItems();
      });
    });
  }

  function fillCatalogSelect() {
    var sel = document.getElementById('add-product');
    if (!sel) return;
    function fill(list) {
      sel.innerHTML = '<option value="">— выбрать —</option>' + list.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' · ' + money(p.price) + ' · ' + p.stock + ' шт.</option>';
      }).join('');
    }
    if (state.catalog && state.catalog.length) return fill(state.catalog);
    api('/products').then(function (d) {
      state.catalog = d.products;
      fill(d.products);
    }).catch(function () { });
  }

  /* ---------------- товары и склад ---------------- */
  function viewProducts() {
    var v = document.getElementById('view');
    v.innerHTML = '<div class="panel"><div class="empty">Загружаем…</div></div>';
    actions(
      '<button id="p-add" class="small">+ Товар</button>' +
      '<button id="p-import" class="ghost small">Импорт</button>' +
      '<button id="p-export" class="ghost small">Экспорт CSV</button>'
    );
    document.getElementById('p-add').addEventListener('click', function () { openProduct(null); });
    document.getElementById('p-import').addEventListener('click', openImport);
    document.getElementById('p-export').addEventListener('click', function () {
      download('/export/products.csv', 'products-' + new Date().toISOString().slice(0, 10) + '.csv');
    });

    api('/products').then(function (d) {
      state.products = d.products;
      state.productsDirty = {};
      renderProducts();
    }).catch(function (e) {
      v.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>';
    });
  }

  function renderProducts() {
    var v = document.getElementById('view');
    v.innerHTML =
      '<div class="panel">' +
        '<h3>Каталог: ' + state.products.length + ' позиций · изменения сразу уходят на сайт</h3>' +
        '<div class="tbl-wrap"><table><thead><tr>' +
          '<th></th><th>Товар</th><th>Тип</th><th class="num" style="width:120px">Цена</th>' +
          '<th class="num" style="width:110px">Остаток</th><th class="num" style="width:90px">Порядок</th>' +
          '<th style="width:90px">Активен</th><th></th>' +
        '</tr></thead><tbody id="products-body"></tbody></table></div>' +
        '<div style="margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
          '<button id="p-save">Сохранить изменения</button>' +
          '<span class="hint" id="p-dirty-info"></span>' +
        '</div>' +
      '</div>';

    var body = document.getElementById('products-body');
    body.innerHTML = state.products.map(function (p, i) {
      return '<tr>' +
        '<td><img class="thumb" src="' + esc(imgUrl(p.images.card)) + '" alt="" loading="lazy"></td>' +
        '<td><b>' + esc(p.name) + '</b><div class="hint mono">' + esc(p.id) + '</div></td>' +
        '<td class="hint">' + esc(p.typeLabel || p.type) + '<div>' + esc(p.collection === 'Наборы' ? 'набор' : p.family) + '</div></td>' +
        '<td class="num"><input type="number" min="0" data-i="' + i + '" data-k="price" value="' + p.price + '"></td>' +
        '<td class="num"><input type="number" min="0" data-i="' + i + '" data-k="stock" value="' + p.stock + '"></td>' +
        '<td class="num"><input type="number" min="0" data-i="' + i + '" data-k="sort" value="' + p.sort + '"></td>' +
        '<td><input type="checkbox" data-i="' + i + '" data-k="active" style="width:auto"' + (p.active ? ' checked' : '') + '></td>' +
        '<td class="num"><button class="ghost small" data-edit="' + i + '">Править</button></td>' +
      '</tr>';
    }).join('');

    body.querySelectorAll('input[data-k]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var i = Number(inp.getAttribute('data-i'));
        var k = inp.getAttribute('data-k');
        state.productsDirty[i] = state.productsDirty[i] || {};
        state.productsDirty[i][k] = k === 'active' ? (inp.checked ? 1 : 0) : Number(inp.value) || 0;
        var n = Object.keys(state.productsDirty).length;
        document.getElementById('p-dirty-info').textContent = n ? 'не сохранено позиций: ' + n : '';
      });
    });
    body.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        openProduct(state.products[Number(b.getAttribute('data-edit'))]);
      });
    });

    document.getElementById('p-save').addEventListener('click', function () {
      var ids = Object.keys(state.productsDirty);
      if (!ids.length) { toast('Нет изменений'); return; }
      var payload = ids.map(function (i) {
        var p = state.products[Number(i)];
        return Object.assign({ id: p.id, name: p.name, type: p.type }, state.productsDirty[i]);
      });
      api('/products', { method: 'POST', body: { products: payload } })
        .then(function () {
          toast('Сохранено: ' + payload.length + '. Сайт покажет новые цены и остатки.');
          state.productsDirty = {};
          go('products');
        }).catch(function (e) { toast(e.message, 'err'); });
    });
  }

  /* ---------------- редактор товара ---------------- */
  function openProduct(product) {
    var isNew = !product;
    var p = product || {
      id: '', name: '', fullName: '', type: 'candle', typeLabel: 'Свеча 200 г', family: 'sila',
      collection: 'Сила', price: 0, oldPrice: 0, stock: 0, active: true, badge: '', sort: 100,
      tagline: '', quote: '', lead: '', safety: '', deliveryNote: '', crossSell: '', sku: '', page: '',
      notes: { top: '', heart: '', base: '' }, specs: [], images: { card: '', hero: '', gallery: [] },
      meta: { title: '', description: '' }
    };

    var wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML =
      '<div class="modal">' +
        '<div class="modal-head"><b>' + (isNew ? 'Новый товар' : 'Товар: ' + esc(p.name)) + '</b>' +
          '<button class="ghost small" id="m-close">Закрыть</button></div>' +
        '<div class="modal-body">' +
          '<div class="grid3">' +
            field('id', 'ID (латиницей, без пробелов)', p.id, isNew ? '' : 'readonly') +
            field('name', 'Название', p.name) +
            field('fullName', 'Полное название (для корзины)', p.fullName) +
            field('type', 'Тип (candle / diffuser / set)', p.type) +
            field('typeLabel', 'Подпись типа', p.typeLabel) +
            field('collection', 'Коллекция', p.collection) +
            field('family', 'Коллекция-код (sila / gory)', p.family) +
            field('price', 'Цена, ₽', p.price, '', 'number') +
            field('oldPrice', 'Старая цена (для зачёркивания)', p.oldPrice, '', 'number') +
            field('stock', 'Остаток, шт.', p.stock, '', 'number') +
            field('sort', 'Порядок вывода', p.sort, '', 'number') +
            field('badge', 'Бейдж на фото', p.badge) +
          '</div>' +
          '<div class="field"><label>Короткое описание (под именем)</label><input id="f-tagline" value="' + esc(p.tagline) + '"></div>' +
          '<div class="field"><label>Слоган на странице товара</label><input id="f-quote" value="' + esc(p.quote) + '"></div>' +
          '<div class="field"><label>Описание</label><textarea id="f-lead">' + esc(p.lead) + '</textarea></div>' +
          '<div class="grid3">' +
            '<div class="field"><label>Верхние ноты</label><input id="f-top" value="' + esc(p.notes.top || '') + '"></div>' +
            '<div class="field"><label>Ноты сердца</label><input id="f-heart" value="' + esc(p.notes.heart || '') + '"></div>' +
            '<div class="field"><label>Базовые ноты</label><input id="f-base" value="' + esc(p.notes.base || '') + '"></div>' +
          '</div>' +
          '<div class="field"><label>Характеристики (по строке «Поле: значение»)</label>' +
            '<textarea id="f-specs">' + esc((p.specs || []).map(function (s) { return s.k + ': ' + s.v; }).join('\n')) + '</textarea></div>' +
          '<div class="grid2">' +
            '<div class="field"><label>Безопасность</label><textarea id="f-safety">' + esc(p.safety || '') + '</textarea></div>' +
            '<div class="field"><label>Примечание о доставке</label><textarea id="f-delivery">' + esc(p.deliveryNote || '') + '</textarea></div>' +
          '</div>' +
          '<div class="grid2">' +
            '<div class="field"><label>Фото для каталога (URL или загрузка)</label>' +
              '<div class="photo-row"><img id="prev-card" src="' + esc(imgUrl(p.images.card)) + '" alt="">' +
              '<input id="f-card" value="' + esc(p.images.card) + '">' +
              '<input type="file" accept="image/*" id="up-card" style="display:none">' +
              '<button class="ghost small" id="btn-card">Загрузить</button></div></div>' +
            '<div class="field"><label>Большое фото (страница товара)</label>' +
              '<div class="photo-row"><img id="prev-hero" src="' + esc(imgUrl(p.images.hero || p.images.card)) + '" alt="">' +
              '<input id="f-hero" value="' + esc(p.images.hero || '') + '">' +
              '<input type="file" accept="image/*" id="up-hero" style="display:none">' +
              '<button class="ghost small" id="btn-hero">Загрузить</button></div></div>' +
          '</div>' +
          '<label class="hint" style="display:flex;gap:8px;align-items:center">' +
            '<input type="checkbox" id="f-active" style="width:auto"' + (p.active ? ' checked' : '') + '> показывать на сайте</label>' +
        '</div>' +
        '<div class="modal-foot">' +
          (isNew ? '' : '<button class="danger" id="m-del">Удалить товар</button>') +
          '<button id="m-save">Сохранить</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector('#m-close').addEventListener('click', function () { wrap.remove(); });

    function val(id) { return wrap.querySelector('#' + id).value; }
    function bindUpload(btn, input, target, prev) {
      wrap.querySelector(btn).addEventListener('click', function () { wrap.querySelector(input).click(); });
      wrap.querySelector(input).addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        compressImage(file, function (dataUrl) {
          wrap.querySelector(target).value = dataUrl;
          wrap.querySelector(prev).src = dataUrl;
          toast('Фото загружено — не забудьте сохранить');
        });
      });
    }
    bindUpload('#btn-card', '#up-card', '#f-card', '#prev-card');
    bindUpload('#btn-hero', '#up-hero', '#f-hero', '#prev-hero');

    if (!isNew) {
      wrap.querySelector('#m-del').addEventListener('click', function () {
        if (!confirm('Удалить товар из каталога?')) return;
        api('/products/' + p.id, { method: 'DELETE' }).then(function () {
          toast('Товар удалён');
          wrap.remove();
          go('products');
        }).catch(function (e) { toast(e.message, 'err'); });
      });
    }

    wrap.querySelector('#m-save').addEventListener('click', function () {
      var specs = val('f-specs').split('\n').map(function (line) {
        var i = line.indexOf(':');
        if (i < 0) return null;
        return { k: line.slice(0, i).trim(), v: line.slice(i + 1).trim() };
      }).filter(Boolean);

      var body = {
        id: val('f-id').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name: val('f-name').trim(),
        fullName: val('f-fullName').trim(),
        type: val('f-type').trim(),
        typeLabel: val('f-typeLabel').trim(),
        collection: val('f-collection').trim(),
        family: val('f-family').trim(),
        price: Number(val('f-price')) || 0,
        oldPrice: Number(val('f-oldPrice')) || 0,
        stock: Number(val('f-stock')) || 0,
        sort: Number(val('f-sort')) || 100,
        badge: val('f-badge').trim(),
        tagline: val('f-tagline').trim(),
        quote: val('f-quote').trim(),
        lead: val('f-lead').trim(),
        safety: val('f-safety').trim(),
        deliveryNote: val('f-delivery').trim(),
        notes: { top: val('f-top'), heart: val('f-heart'), base: val('f-base') },
        specs: specs,
        active: wrap.querySelector('#f-active').checked,
        images: { card: val('f-card'), hero: val('f-hero'), gallery: (p.images && p.images.gallery) || [] },
        meta: p.meta || {}
      };
      if (!body.id || !body.name) { toast('Заполните ID и название', 'err'); return; }
      api('/products', { method: 'POST', body: { products: [body] } })
        .then(function () {
          toast('Товар сохранён — обновился на сайте');
          wrap.remove();
          state.catalog = [];
          go('products');
        }).catch(function (e) { toast(e.message, 'err'); });
    });
  }

  function field(id, label, value, extra, type) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input id="f-' + id + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '" ' + (extra || '') + '></div>';
  }

  function compressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1000;
        var w = img.width, h = img.height;
        if (w > max || h > max) {
          var k = Math.min(max / w, max / h);
          w = Math.round(w * k);
          h = Math.round(h * k);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------------- импорт товаров ---------------- */
  function openImport() {
    var wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML =
      '<div class="modal" style="max-width:720px">' +
        '<div class="modal-head"><b>Импорт товаров</b><button class="ghost small" id="i-close">Закрыть</button></div>' +
        '<div class="modal-body">' +
          '<p class="hint">Можно загрузить CSV (разделитель «;» или «,») или JSON-файл с товарами. ' +
            'Колонки CSV: <span class="mono">id;name;price;old_price;stock;type;type_label;family;collection;active;sort;tagline;image_card</span></p>' +
          '<div class="row tight"><input type="file" id="i-file" accept=".csv,.json,text/csv,application/json"><button class="ghost" id="i-load">Загрузить файл</button></div>' +
          '<div class="field"><label>…или вставьте текст</label><textarea id="i-text" style="min-height:160px" placeholder="id;name;price;stock&#10;candle-kodeks;Кодекс · свеча 200 г;1690;12"></textarea></div>' +
          '<label class="hint" style="display:flex;gap:8px;align-items:center">' +
            '<input type="checkbox" id="i-replace" style="width:auto"> удалить товары, которых нет в файле</label>' +
        '</div>' +
        '<div class="modal-foot"><button id="i-go">Импортировать</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.querySelector('#i-close').addEventListener('click', function () { wrap.remove(); });

    wrap.querySelector('#i-load').addEventListener('click', function () {
      var f = wrap.querySelector('#i-file').files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { wrap.querySelector('#i-text').value = r.result; toast('Файл загружен, проверьте текст'); };
      r.readAsText(f, 'utf-8');
    });

    wrap.querySelector('#i-go').addEventListener('click', function () {
      var text = wrap.querySelector('#i-text').value.trim();
      if (!text) { toast('Вставьте данные', 'err'); return; }
      var isJSON = text[0] === '[' || text[0] === '{';
      var body = isJSON
        ? { format: 'json', data: JSON.parse(text), mode: wrap.querySelector('#i-replace').checked ? 'replace' : 'merge' }
        : { format: 'csv', data: text, mode: wrap.querySelector('#i-replace').checked ? 'replace' : 'merge' };
      api('/products/import', { method: 'POST', body: body }).then(function (d) {
        toast('Обновлено товаров: ' + d.updated + (d.errors && d.errors.length ? ', предупреждений: ' + d.errors.length : ''));
        wrap.remove();
        state.catalog = [];
        go('products');
      }).catch(function (e) { toast(e.message, 'err'); });
    });
  }

  /* ---------------- клиенты ---------------- */
  function viewClients() {
    var v = document.getElementById('view');
    v.innerHTML = '<div class="panel"><div class="empty">Собираем список клиентов…</div></div>';
    api('/orders?limit=100').then(function (d) {
      var byPhone = {};
      d.orders.forEach(function (o) {
        var key = (o.customer.phone || '').replace(/\D/g, '') || o.customer.name;
        if (!byPhone[key]) byPhone[key] = { name: o.customer.name, phone: o.customer.phone, city: o.customer.city, orders: 0, sum: 0, last: o.createdAt };
        byPhone[key].orders++;
        byPhone[key].sum += Number(o.total) || 0;
        if (o.createdAt > byPhone[key].last) byPhone[key].last = o.createdAt;
      });
      var list = Object.keys(byPhone).map(function (k) { return byPhone[k]; })
        .sort(function (a, b) { return b.sum - a.sum; });
      v.innerHTML =
        '<div class="panel"><h3>Клиенты (по последним 100 заказам)</h3>' +
          (list.length ? '<div class="tbl-wrap"><table><thead><tr><th>Клиент</th><th>Телефон</th><th>Город</th><th class="num">Заказов</th><th class="num">Сумма</th><th>Последний</th></tr></thead><tbody>' +
            list.map(function (c) {
              return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.phone) + '</td><td>' + esc(c.city) + '</td>' +
                '<td class="num">' + c.orders + '</td><td class="num">' + money(c.sum) + '</td><td class="hint">' + esc(fmtDate(c.last)) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="empty">Пока нет заказов</div>') +
        '</div>' +
        '<div class="panel"><h3>Экспорт базы клиентов</h3>' +
          '<button class="ghost" id="c-export">Выгрузить заказы в CSV</button>' +
        '</div>';
      document.getElementById('c-export').addEventListener('click', function () {
        download('/export/orders.csv', 'clients-orders.csv');
      });
    }).catch(function (e) { v.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; });
  }

  /* ---------------- рассылка ---------------- */
  function viewNews() {
    var v = document.getElementById('view');
    v.innerHTML =
      '<div class="panel"><h3>Новость подписчикам бота</h3>' +
        '<textarea id="news-text" placeholder="Например: новая партия «Перевала» уже в наличии" style="min-height:120px"></textarea>' +
        '<div style="margin-top:14px;display:flex;gap:12px;align-items:center">' +
          '<button id="news-send">Отправить подписчикам</button>' +
          '<span class="hint" id="news-info"></span>' +
        '</div>' +
      '</div>' +
      '<div class="panel"><h3>История новостей</h3><div id="news-list" class="scroll-y"><div class="empty">Загружаем…</div></div></div>' +
      '<div class="panel"><h3>Очередь сообщений Telegram</h3><div id="outbox" class="scroll-y"><div class="empty">Загружаем…</div></div>' +
        '<div style="margin-top:14px"><button class="ghost small" id="outbox-retry">Повторить неудачные</button></div></div>';

    api('/news').then(function (d) {
      var box = document.getElementById('news-list');
      box.innerHTML = d.news.length
        ? d.news.map(function (n) {
            return '<div class="comment"><div class="meta">' + esc(fmtDate(n.created_at)) + '</div>' + esc(n.text) + '</div>';
          }).join('')
        : '<div class="empty">Новостей пока не было</div>';
    }).catch(function () { });

    api('/outbox').then(function (d) {
      var box = document.getElementById('outbox');
      box.innerHTML =
        '<div class="hint" style="margin-bottom:10px">В очереди: ' + (d.stats.pending || 0) +
        ' · отправлено: ' + (d.stats.sent || 0) + ' · ошибок: ' + (d.stats.failed || 0) + '</div>' +
        (d.messages.length
          ? '<table><tbody>' + d.messages.map(function (m) {
              var cls = m.state === 'sent' ? '' : m.state === 'failed' ? 'bad' : 'warn';
              return '<tr><td class="hint">' + esc(m.kind) + '</td><td class="hint">' + esc(m.t) + '</td>' +
                '<td class="num"><span class="pill ' + cls + '">' + esc(m.state) + '</span></td></tr>';
            }).join('') + '</tbody></table>'
          : '<div class="empty">Пусто</div>');
    }).catch(function () { });

    document.getElementById('news-send').addEventListener('click', function () {
      var text = document.getElementById('news-text').value.trim();
      if (text.length < 3) { toast('Слишком короткий текст', 'err'); return; }
      if (!confirm('Отправить новость всем подписчикам?')) return;
      api('/news', { method: 'POST', body: { text: text } }).then(function (d) {
        toast('Отправляем ' + d.count + ' подписчикам');
        document.getElementById('news-text').value = '';
        go('news');
      }).catch(function (e) { toast(e.message, 'err'); });
    });
    document.getElementById('outbox-retry').addEventListener('click', function () {
      api('/outbox/retry', { method: 'POST', body: {} }).then(function () { toast('Повторная отправка запущена'); go('news'); })
        .catch(function (e) { toast(e.message, 'err'); });
    });
  }

  /* ---------------- выгрузка ---------------- */
  function viewExport() {
    var v = document.getElementById('view');
    var stamp = new Date().toISOString().slice(0, 10);
    var items = [
      ['/export/orders.csv', 'orders-' + stamp + '.csv', 'Заказы (CSV)', 'Все заказы с составом, суммами и статусами — открывается в Excel и Google Таблицах.'],
      ['/export/orders.json', 'orders-' + stamp + '.json', 'Заказы (JSON)', 'Полные данные заказов, позиций и комментариев для переноса или бэкапа.'],
      ['/export/products.csv', 'products-' + stamp + '.csv', 'Товары (CSV)', 'Каталог с ценами и остатками. Этот же файл можно править и загружать обратно в импорт.'],
      ['/export/products.json', 'products-' + stamp + '.json', 'Товары (JSON)', 'Каталог со всеми описаниями, нотами и характеристиками.'],
      ['/export/comments.csv', 'comments-' + stamp + '.csv', 'Переписка по заказам (CSV)', 'Все комментарии продавца и покупателя.'],
      ['/export/subscribers.csv', 'subscribers-' + stamp + '.csv', 'Подписчики бота (CSV)', 'chat_id подписчиков — для рассылок.'],
      ['/export/all.json', 'rules-backup-' + stamp + '.json', 'Полный бэкап (JSON)', 'Заказы, товары, комментарии, подписчики и новости одним файлом.']
    ];
    v.innerHTML =
      '<div class="panel"><h3>Скачать данные на компьютер</h3>' +
        '<div class="grid2">' + items.map(function (x) {
          return '<div class="card-metric"><div class="k">' + esc(x[2]) + '</div>' +
            '<div class="s" style="margin:8px 0 14px;min-height:38px">' + esc(x[3]) + '</div>' +
            '<button class="ghost small" data-dl="' + x[0] + '" data-name="' + x[1] + '">Скачать</button></div>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="panel"><h3>Как это работает</h3>' +
        '<p class="hint">Файлы формируются прямо из базы D1 в момент скачивания — данные всегда актуальные. ' +
        'CSV открывается в Excel (разделитель «;», кодировка UTF-8 с BOM).</p></div>';

    v.querySelectorAll('[data-dl]').forEach(function (b) {
      b.addEventListener('click', function () {
        download(b.getAttribute('data-dl'), b.getAttribute('data-name'));
      });
    });
  }

  /* ---------------- настройки ---------------- */
  function viewSettings() {
    var v = document.getElementById('view');
    v.innerHTML =
      '<div class="panel"><h3>Проверка связи</h3>' +
        '<div class="row tight">' +
          '<button id="s-test-owner">Тест бота для заказов</button>' +
          '<button class="ghost" id="s-hook">Подключить бота покупателей (webhook)</button>' +
        '</div>' +
        '<p class="hint" style="margin-top:14px">Кнопки используют секреты Worker (TELEGRAM_*, CUSTOMER_BOT_*). ' +
        'Если бот не отвечает — проверьте токены в Cloudflare → Settings → Variables and Secrets.</p>' +
      '</div>' +
      '<div class="panel"><h3>Что где менять</h3>' +
        '<table><tbody>' +
          '<tr><td>Цены, остатки, фото, описания</td><td class="hint">раздел «Товары и склад»</td></tr>' +
          '<tr><td>Тексты страниц, логотип, фото на сайте</td><td class="hint">GitHub → папка content/ и assets/img/</td></tr>' +
          '<tr><td>Цвета и шрифты сайта</td><td class="hint">GitHub → data/settings.json</td></tr>' +
          '<tr><td>Пароль в кабинет</td><td class="hint">Cloudflare → секрет ADMIN_PASSWORD</td></tr>' +
        '</tbody></table>' +
      '</div>' +
      '<div class="panel"><h3>Сессия</h3>' +
        '<p class="hint">Вход действует 12 часов. Пароль хранится только как секрет Cloudflare.</p>' +
        '<button class="danger" id="s-logout">Выйти из кабинета</button>' +
      '</div>';

    document.getElementById('s-test-owner').addEventListener('click', function () {
      api('/telegram/test', { method: 'POST', body: {} })
        .then(function () { toast('Тестовое сообщение отправлено'); })
        .catch(function (e) { toast(e.message, 'err'); });
    });
    document.getElementById('s-hook').addEventListener('click', function () {
      api('/telegram/webhook', { method: 'POST', body: {} })
        .then(function (d) { toast('Вебхук подключён: @' + d.bot); })
        .catch(function (e) { toast(e.message, 'err'); });
    });
    document.getElementById('s-logout').addEventListener('click', function () {
      token = '';
      localStorage.removeItem('rules-admin-token');
      renderLogin('');
    });
  }

  /* ---------------- запуск ---------------- */
  function boot() {
    renderShell();
    setActiveNav();
    // заказы показываем сразу — это главное
    state.view = 'orders';
    go('orders');
    api('/summary').then(function (d) {
      state.summary = d;
      state.siteUrl = d.siteUrl || '';
      var badge = document.getElementById('badge-orders');
      var n = (d.byStatus || []).filter(function (s) { return s.status === 'new'; })[0];
      if (badge) badge.textContent = n ? n.n : '';
      document.getElementById('foot-info').textContent = 'Бот: ' + (d.bot ? '@' + d.bot : 'не подключён');
    }).catch(function () { });
  }

  token = localStorage.getItem('rules-admin-token') || '';
  if (!token) renderLogin('');
  else {
    api('/me')
      .then(function () { boot(); })
      .catch(function () { /* renderLogin уже вызван в api() */ });
  }
})();

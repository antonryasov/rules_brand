/* ============================================================
   RULES · личный кабинет покупателя (клуб)
   ------------------------------------------------------------
   Вход: ссылка из Telegram-бота (#t=ТОКЕН) или код из 6 цифр.
   Данные: worker API /club/*, оплата — ссылка СБП Ozon Банка.
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.RULES_CONFIG || {};
  var API = String(CFG.fallbackApiBase || '').replace(/\/+$/, '');
  var TOKEN_KEY = 'rules-club-token';
  var token = '';
  var state = { me: null, tab: 'overview', bot: '' };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' ₽';
  }
  function date(v) {
    if (!v) return '';
    var d = new Date(String(v).replace(' ', 'T') + (String(v).indexOf('Z') === -1 ? 'Z' : ''));
    return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  function dateShort(v) {
    if (!v) return '';
    var d = new Date(String(v).replace(' ', 'T') + (String(v).indexOf('Z') === -1 ? 'Z' : ''));
    return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  function toast(text, kind) {
    var box = $('#toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, kind === 'err' ? 6000 : 3200);
  }

  /* ---------- запросы ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401) {
          token = '';
          localStorage.removeItem(TOKEN_KEY);
          showGate('Сессия истекла — войдите заново через бота.');
          throw new Error('unauthorized');
        }
        if (!r.ok) throw new Error(d.error || 'Ошибка запроса');
        return d;
      });
    });
  }

  /* ---------- вход ---------- */
  function showGate(message) {
    $('#loading').hidden = true;
    $('#app').hidden = true;
    $('#gate').hidden = false;
    $('#t-exit').hidden = true;
    if (message) $('#g-err').textContent = message;
    $('#g-bot').onclick = function () {
      if (state.bot) window.open('https://t.me/' + state.bot, '_blank', 'noopener');
      else toast('Имя бота не настроено на сервере', 'err');
    };
  }

  function saveToken(t) {
    token = t;
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* приватный режим */ }
  }

  function boot() {
    if (token) load();
    else showGate('');
  }

  function load() {
    $('#loading').hidden = false;
    api('/club/me').then(function (d) {
      state.me = d;
      state.bot = d.bot || state.bot;
      $('#loading').hidden = true;
      $('#gate').hidden = true;
      $('#app').hidden = false;
      $('#t-exit').hidden = false;
      renderHead();
      renderAll();
    }).catch(function (e) {
      if (e.message !== 'unauthorized') showGate(e.message);
    });
  }

  /* ---------- шапка ---------- */
  function renderHead() {
    var d = state.me;
    var c = d.customer;
    var l = d.level;
    $('#h-points').innerHTML = Number(c.points).toLocaleString('ru-RU') + '<small>баллов · 1 балл = 1 ₽</small>';
    $('#h-name').textContent = (c.name || 'Гость').split(' ')[0];
    $('#h-orders').textContent = c.stats.orders;
    $('#h-spent').textContent = money(c.stats.spent);
    $('#h-cashback').textContent = l.cashback + ' %';
    $('#h-level').innerHTML = '<span class="lvl ' + l.key + '"><i class="dot ' + l.key + '"></i>' + esc(l.title) + '</span>';
    var pct = 100;
    if (l.next) {
      var prev = l.key === 'bronze' ? 0 : (l.key === 'silver' ? d.level.levels[1].from : d.level.levels[2].from);
      var span = Math.max(1, l.next.from - prev);
      pct = Math.max(4, Math.min(100, Math.round(((c.stats.spent - prev) / span) * 100)));
    }
    $('#h-progress').style.width = pct + '%';
    $('#h-next').textContent = l.next
      ? 'До уровня «' + l.next.title + '» — ' + money(l.next.left) + ' покупок. Там кэшбэк ' + l.next.cashback + ' %.'
      : 'Максимальный уровень: кэшбэк ' + l.cashback + ' % с каждого оплаченного заказа.';
  }

  /* ---------- вкладки ---------- */
  function renderAll() {
    renderOverview();
    renderPoints();
    renderOrders();
    renderDrops();
    renderProfile();
  }
  function switchTab(name) {
    state.tab = name;
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    $$('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + name); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- обзор ---------- */
  function renderOverview() {
    var d = state.me;
    var c = d.customer;
    var orders = d.orders.slice(0, 3);
    var drops = (d.drops || []).filter(function (x) { return x.access; }).slice(0, 2);
    var html = '';

    if (!c.name || !c.phone) {
      html += '<div class="card" style="margin-bottom:16px;border-color:rgba(217,183,116,.35)">' +
        '<b>Заполните профиль</b><div class="gate-hint" style="margin-top:6px">Имя и телефон нужны, чтобы заказы автоматически привязывались к вашему клубу и баллы не терялись.</div>' +
        '<button class="btn ghost small" style="margin-top:12px" data-goto="profile">Заполнить</button></div>';
    }

    html += '<div class="grid2">';

    html += '<div class="card"><div class="k">Как копить</div>' +
      '<div class="row"><div class="nm"><b>Кэшбэк ' + d.level.cashback + ' %</b><span>с каждого оплаченного заказа</span></div><div class="vl">→ баллы</div></div>' +
      '<div class="row"><div class="nm"><b>1 балл = 1 ₽</b><span>списывайте до ' + d.settings.maxRedeem + ' % суммы заказа</span></div><div class="vl">− скидка</div></div>' +
      '<div class="row"><div class="nm"><b>Закрытые распродажи</b><span>доступ по уровню клуба</span></div><div class="vl">' + (drops.length ? drops.length + ' открыто' : '—') + '</div></div>' +
      '</div>';

    html += '<div class="card"><div class="k">Последние заказы</div>' +
      (orders.length
        ? orders.map(function (o) {
            return '<div class="row"><div class="nm"><b>№ ' + esc(o.number) + '</b><span>' + dateShort(o.createdAt) + ' · ' + esc(o.statusLabel) + '</span></div>' +
              '<div class="vl">' + money(o.total) + '</div></div>';
          }).join('')
        : '<div class="empty">Заказов пока нет</div>') +
      '<button class="btn ghost small" style="margin-top:14px" data-goto="orders">Все заказы</button></div>';

    html += '</div>';

    if (drops.length) {
      html += '<div class="card" style="margin-top:16px"><div class="k">Доступно сейчас</div>' +
        drops.map(function (x) {
          return '<div class="row"><div class="nm"><b>' + esc(x.title) + '</b><span>' + esc(x.description || '').slice(0, 90) + '</span></div>' +
            '<div class="vl">' + x.itemsCount + ' поз. →</div></div>';
        }).join('') +
        '<button class="btn ghost small" style="margin-top:14px" data-goto="drops">Смотреть распродажи</button></div>';
    }

    html += '<div class="card" style="margin-top:16px"><div class="k">Как это работает</div>' +
      '<div class="gate-hint" style="line-height:1.75">' +
      '· Баллы начисляются после подтверждения оплаты заказа — от суммы, которую вы заплатили.<br>' +
      '· Списать баллы можно при оформлении заказа: 1 балл = 1 ₽, но не больше ' + d.settings.maxRedeem + ' % от суммы.<br>' +
      '· Если заказ отменён, баллы возвращаются на счёт автоматически.<br>' +
      '· Чем больше покупок, тем выше уровень: бронза → серебро → золото, кэшбэк растёт вместе с ним.' +
      '</div></div>';

    $('#pane-overview').innerHTML = html;
    bindGoto('#pane-overview');
  }

  /* ---------- баллы ---------- */
  function renderPoints() {
    var d = state.me;
    var c = d.customer;
    var hist = d.pointsHistory || [];
    var html = '<div class="card"><div class="k">Баланс</div>' +
      '<div class="big mono">' + Number(c.points).toLocaleString('ru-RU') + '<small>баллов</small></div>' +
      '<div class="gate-hint">1 балл = 1 ₽. Списание — при оформлении заказа в корзине, до ' + d.settings.maxRedeem + ' % суммы.</div>' +
      '<div class="progress" style="margin-top:18px"><i style="width:' + Math.min(100, Math.round((c.points / 1000) * 100)) + '%"></i></div>' +
      '<div class="gate-hint">' + (c.points >= 1000 ? 'Хороший запас — можно закрыть часть следующего заказа.' : 'До 1 000 баллов осталось ' + (1000 - c.points) + '.') + '</div>' +
      '</div>';

    html += '<div class="card" style="margin-top:16px"><div class="k">Уровни клуба</div>' +
      d.level.levels.map(function (l) {
        var on = l.key === d.level.key;
        return '<div class="row"><div class="nm"><b><i class="dot ' + l.key + '"></i>' + esc(l.title) + (on ? ' · ваш уровень' : '') +
          '</b><span>от ' + money(l.from) + ' покупок</span></div><div class="vl">кэшбэк ' + l.cashback + ' %</div></div>';
      }).join('') +
      '</div>';

    html += '<div class="card" style="margin-top:16px"><div class="k">История операций</div>' +
      (hist.length
        ? hist.map(function (h) {
            var plus = Number(h.delta) > 0;
            return '<div class="row"><div class="nm"><b>' + esc(h.reason) + '</b><span>' + date(h.created_at) + '</span></div>' +
              '<div class="vl ' + (plus ? 'plus' : 'minus') + '">' + (plus ? '+' : '') + h.delta + '<div class="gate-hint">' + h.balance_after + ' на счёте</div></div></div>';
          }).join('')
        : '<div class="empty">Пока нет операций — сделайте первый оплаченный заказ.</div>') +
      '</div>';

    $('#pane-points').innerHTML = html;
  }

  /* ---------- заказы ---------- */
  function renderOrders() {
    var d = state.me;
    var list = d.orders || [];
    if (!list.length) {
      $('#pane-orders').innerHTML = '<div class="card"><div class="empty">Заказов пока нет. <a href="index.html" style="border-bottom:1px solid var(--line2)">Перейти в каталог</a></div></div>';
      return;
    }
    $('#pane-orders').innerHTML = list.map(function (o) {
      var paid = o.paymentStatus === 'paid';
      var claim = o.paymentStatus === 'declared';
      var canPay = !paid && o.status !== 'cancelled';
      return '<div class="order">' +
        '<div class="order-h"><div><div class="num">№ ' + esc(o.number) + '</div>' +
          '<div class="meta">' + date(o.createdAt) + '</div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
            '<span class="pill ' + esc(o.status) + '">' + esc(o.statusLabel) + '</span>' +
            '<span class="pill ' + (paid ? 'paid' : 'unpaid') + '">' + (paid ? 'оплачен' : claim ? 'ждёт подтверждения' : 'не оплачен') + '</span>' +
          '</div></div>' +
        '<div class="order-items">' + (o.items || []).map(function (i) {
          return esc(i.name) + ' × ' + i.qty + ' — ' + money(i.price * i.qty);
        }).join('<br>') + '</div>' +
        (o.pointsUsed ? '<div class="gate-hint" style="margin-top:8px">Списано баллами: −' + o.pointsUsed + ' ₽</div>' : '') +
        (o.pointsEarned ? '<div class="gate-hint">Начислено баллов: +' + o.pointsEarned + '</div>' : '') +
        (o.tracking ? '<div class="gate-hint">Трек: ' + esc(o.tracking) + '</div>' : '') +
        '<div class="order-foot"><div class="total">' + money(o.total) + '</div>' +
          '<div class="actions">' +
            (canPay ? '<button class="btn small ' + (claim ? 'ghost' : 'green') + '" data-pay="' + esc(o.id) + '">' +
              (claim ? 'Оплата на проверке' : 'Оплатить по СБП') + '</button>' : '') +
          '</div></div>' +
        '</div>';
    }).join('');
    $$('[data-pay]', $('#pane-orders')).forEach(function (b) {
      b.addEventListener('click', function () { openPay(b.getAttribute('data-pay')); });
    });
  }

  /* ---------- распродажи ---------- */
  function renderDrops() {
    var d = state.me;
    var drops = d.drops || [];
    if (!drops.length) {
      $('#pane-drops').innerHTML = '<div class="card"><div class="empty">Сейчас закрытых распродаж нет. Как только появится — пришлём в бот.</div>' +
        '<div class="gate-hint" style="text-align:center;margin-top:10px">Уровень: ' + esc(d.level.title) + ' · кэшбэк ' + d.level.cashback + ' %</div></div>';
      return;
    }
    $('#pane-drops').innerHTML = drops.map(function (x) {
      var head = '<div class="drop-h"><div><h3>' + esc(x.title) + '</h3>' +
        '<p>' + esc(x.description || '') + '</p>' +
        '<div class="gate-hint" style="margin-top:8px">' +
          (x.startsAt ? 'с ' + dateShort(x.startsAt) + ' ' : '') +
          (x.endsAt ? 'до ' + dateShort(x.endsAt) : 'без даты окончания') +
          ' · доступ с уровня «' + esc(x.needLevel) + '»</div></div>' +
        '<div>' + (x.access ? '<span class="pill confirmed">доступ открыт</span>' : '<span class="pill cancelled">закрыто</span>') + '</div></div>';
      if (!x.access) {
        return '<div class="drop">' + head + '<div class="locked">Эта распродажа открывается с уровня <b>«' + esc(x.needLevel) + '»</b>.<br>' +
          'Ваш уровень — ' + esc(d.level.title) + '. До следующего осталось ' + money((d.level.next && d.level.next.left) || 0) + ' покупок.</div></div>';
      }
      var items = (x.items || []).map(function (i) {
        var save = i.basePrice && i.price && i.basePrice > i.price ? '<s>' + money(i.basePrice) + '</s>' : '';
        return '<div class="drop-item"><div class="nm">' + esc(i.name) + '</div>' +
          '<div class="pr">' + money(i.price) + save + '</div>' +
          '<div class="st">' + (i.stock > 0 ? 'в наличии ' + i.stock + ' шт' : 'под заказ') + (i.note ? ' · ' + esc(i.note) : '') + '</div></div>';
      }).join('');
      return '<div class="drop">' + head + '<div class="drop-items">' + (items || '<div class="locked">Состав скоро появится</div>') + '</div>' +
        '<div style="padding:14px 22px"><a class="btn small ghost" href="index.html">Забрать в каталоге</a></div></div>';
    }).join('');
  }

  /* ---------- профиль ---------- */
  function renderProfile() {
    var c = state.me.customer;
    $('#pane-profile').innerHTML =
      '<div class="card"><div class="k">Данные покупателя</div>' +
        '<form id="p-form" style="margin-top:14px" autocomplete="on">' +
          '<div class="grid2">' +
            '<div class="field"><label>Имя и фамилия</label><input name="name" value="' + esc(c.name) + '" placeholder="Как к вам обращаться"></div>' +
            '<div class="field"><label>Телефон</label><input name="phone" value="' + esc(c.phone) + '" inputmode="tel" placeholder="+7 …"></div>' +
            '<div class="field"><label>Почта</label><input name="email" type="email" value="' + esc(c.email) + '" placeholder="mail@example.ru"></div>' +
            '<div class="field"><label>Город</label><input name="city" value="' + esc(c.city) + '" placeholder="Москва"></div>' +
            '<div class="field"><label>День рождения</label><input name="birthday" type="date" value="' + esc(c.birthday) + '"></div>' +
            '<div class="field"><label>Telegram</label><input value="' + (c.tgUsername ? '@' + esc(c.tgUsername) : 'привязан к боту') + '" disabled></div>' +
          '</div>' +
          '<button class="btn" type="submit">Сохранить</button>' +
          '<span class="gate-hint" id="p-info" style="margin-left:12px"></span>' +
        '</form>' +
      '</div>' +
      '<div class="card" style="margin-top:16px"><div class="k">Вход и безопасность</div>' +
        '<div class="gate-hint" style="margin-top:8px">Кабинет открывается по ссылке из Telegram-бота или по коду из 6 цифр. Ссылка действует 120 дней.</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">' +
          '<button class="btn ghost small" id="p-bot">Открыть бота</button>' +
          '<button class="btn ghost small" id="p-logout">Выйти</button>' +
        '</div></div>' +
      '<div class="card" style="margin-top:16px"><div class="k">Ваши права</div>' +
        '<div class="gate-hint" style="margin-top:8px">Данные хранятся в вашей базе у продавца: имя, телефон, почта, заказы и история баллов. ' +
        'Напишите в бот, если хотите изменить или удалить данные — продавец сделает это вручную.</div></div>';

    $('#p-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var body = {
        name: f.name.value.trim(),
        phone: f.phone.value.trim(),
        email: f.email.value.trim(),
        city: f.city.value.trim(),
        birthday: f.birthday.value
      };
      api('/club/profile', { method: 'POST', body: body }).then(function (d) {
        state.me.customer = Object.assign(state.me.customer, d.customer);
        renderHead();
        $('#p-info').textContent = 'Сохранено';
        toast('Профиль обновлён');
        setTimeout(function () { var el = $('#p-info'); if (el) el.textContent = ''; }, 2500);
      }).catch(function (err) { toast(err.message, 'err'); });
    });
    $('#p-bot').addEventListener('click', function () {
      if (state.bot) window.open('https://t.me/' + state.bot, '_blank', 'noopener');
      else toast('Бот не настроен', 'err');
    });
    $('#p-logout').addEventListener('click', function () {
      api('/club/logout', { method: 'POST', body: {} }).catch(function () {});
      token = '';
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      showGate('Вы вышли из кабинета');
    });
  }

  /* ---------- оплата ---------- */
  var payOrder = null;
  function openPay(orderId) {
    var o = (state.me.orders || []).filter(function (x) { return x.id === orderId; })[0];
    if (!o) return;
    payOrder = o;
    $('#pay-amount').textContent = money(o.total);
    $('#pay-sum').textContent = money(o.total);
    $('#pay-order').textContent = 'Заказ № ' + o.number + ' · ' + (o.items || []).length + ' поз.';
    $('#pay-link').href = state.me.sbpLink;
    $('#pay-err').textContent = '';
    $('#pay-claim').disabled = o.paymentStatus === 'declared';
    $('#pay-claim').textContent = o.paymentStatus === 'declared' ? 'Оплата на проверке' : 'Я оплатил(а)';
    $('#pay').classList.add('on');
  }
  function closePay() { $('#pay').classList.remove('on'); }

  function bindPay() {
    $$('[data-close]').forEach(function (b) { b.addEventListener('click', closePay); });
    $('#pay').addEventListener('click', function (e) { if (e.target === $('#pay')) closePay(); });
    $('#pay-copy').addEventListener('click', function () {
      var sum = $('#pay-sum').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(sum).then(function () { toast('Сумма скопирована'); });
      else toast('Сумма: ' + sum);
    });
    $('#pay-claim').addEventListener('click', function () {
      if (!payOrder) return;
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Отправляем…';
      api('/club/pay/claim', { method: 'POST', body: { id: payOrder.id } })
        .then(function () {
          toast('Спасибо! Продавец подтвердит оплату в ближайшее время.');
          closePay();
          load();
        })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = 'Я оплатил(а)';
          $('#pay-err').textContent = e.message;
        });
    });
  }

  function bindGoto(root) {
    $$('[data-goto]', $(root)).forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-goto')); });
    });
  }

  /* ---------- запуск ---------- */
  function start() {
    var hash = String(location.hash || '').replace(/^#/, '');
    var m = hash.match(/(?:^|&)t=([A-Za-z0-9_-]{20,})/);
    if (m) {
      saveToken(m[1]);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    } else {
      try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }
    }

    $$('#tabs button').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });
    bindPay();
    $('#t-exit').addEventListener('click', function () {
      token = '';
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      showGate('Вы вышли из кабинета');
    });
    $('#t-bot').addEventListener('click', function () {
      if (state.bot) window.open('https://t.me/' + state.bot, '_blank', 'noopener');
      else toast('Сначала войдите через бота', 'err');
    });

    $('#g-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = ($('#g-code').value || '').replace(/\D/g, '').slice(0, 6);
      if (code.length !== 6) { $('#g-err').textContent = 'Код состоит из 6 цифр'; return; }
      api('/club/login', { method: 'POST', body: { code: code } }).then(function (d) {
        saveToken(d.token);
        $('#g-err').textContent = '';
        load();
      }).catch(function (err) { $('#g-err').textContent = err.message; });
    });

    /* адрес воркера и имя бота — из настроек сайта */
    fetch('data/settings.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
      if (s && s.api && s.api.base) API = String(s.api.base).replace(/\/+$/, '');
      if (s && s.contacts && (s.contacts.bot || s.contacts.telegram)) state.bot = s.contacts.bot || s.contacts.telegram;
    }).catch(function () {}).then(boot);
  }

  document.addEventListener('DOMContentLoaded', start);
})();

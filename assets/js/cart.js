/* ============================================================
   RULES · корзина и оформление заказа
   ------------------------------------------------------------
   Цены и остатки берутся из тех же данных, что и каталог
   (data/products.json или живой каталог из личного кабинета).
   Заказ уходит в Worker → D1 → Telegram.
   ============================================================ */
(function () {
  var S = window.RULES = window.RULES || {};
  var C = S.cart = {};

  var $ = function (id) { return document.getElementById(id); };
  var overlay, drawer, itemsEl, content, codeInput, hint, form, status, success, badge;
  var storageKey = 'rules-cart-v3';
  var items = [], promo = '', busy = false, preparing = false, lastFocus = null;

  /* ---------- доставка: адрес и способ получения ---------- */
  var delivery = {
    method: 'courier',   /* courier | pickup | cdek */
    cost: 0,
    cfg: {               /* значения по умолчанию, переопределяются data/settings.json */
      courierCost: 0,
      freeFrom: 0,
      pickupAddress: '',
      pickupNote: ''
    }
  };
  var ADDRESS_KEY = 'rules-address-v1';

  function deliveryCfg() {
    var st = (S.settings && S.settings.delivery) || {};
    var cfg = delivery.cfg;
    return {
      courierCost: Number(st.courierCost) || cfg.courierCost,
      freeFrom: Number(st.freeFrom) || cfg.freeFrom,
      pickupAddress: st.pickupAddress || cfg.pickupAddress,
      pickupNote: st.pickupNote || cfg.pickupNote
    };
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addressEl(id) { return document.getElementById(id); }

  function addressValue() {
    return {
      city: (addressEl('addr-city') || {}).value ? addressEl('addr-city').value.trim() : '',
      postcode: (addressEl('addr-postcode') || {}).value ? addressEl('addr-postcode').value.replace(/\D/g, '') : '',
      address: (addressEl('addr-street') || {}).value ? addressEl('addr-street').value.trim() : '',
      flat: (addressEl('addr-flat') || {}).value ? addressEl('addr-flat').value.trim() : '',
      note: (addressEl('addr-note') || {}).value ? addressEl('addr-note').value.trim() : ''
    };
  }

  /* адрес запоминаем в браузере — при следующем заказе поля уже заполнены */
  function saveAddress() {
    try { localStorage.setItem(ADDRESS_KEY, JSON.stringify(addressValue())); } catch (e) { }
  }
  function restoreAddress() {
    try {
      var a = JSON.parse(localStorage.getItem(ADDRESS_KEY) || 'null');
      if (!a) return;
      ['addr-city|city', 'addr-postcode|postcode', 'addr-street|address', 'addr-flat|flat', 'addr-note|note'].forEach(function (pair) {
        var el = addressEl(pair.split('|')[0]);
        if (el && !el.value && a[pair.split('|')[1]]) el.value = a[pair.split('|')[1]];
      });
    } catch (e) { }
  }

  function deliveryCost() {
    var cfg = deliveryCfg();
    /* промокод может давать бесплатную доставку любым способом */
    if (S.calculate(items, promo).freeDelivery) return 0;
    if (delivery.method !== 'courier') return 0;
    if (!cfg.courierCost) return 0;
    var calc = S.calculate(items, promo);
    if (cfg.freeFrom > 0 && calc.total >= cfg.freeFrom) return 0;
    return cfg.courierCost;
  }

  function renderDeliveryTotals() {
    var cfg = deliveryCfg();
    var calc = S.calculate(items, promo);
    delivery.cost = deliveryCost();

    var free = !!calc.freeDelivery;
    var row = document.getElementById('shop-delivery-row');
    var grand = document.getElementById('shop-grand-row');
    if (row && grand && free) {
      row.hidden = false;
      grand.hidden = true;
      document.getElementById('shop-delivery-sum').textContent = 'бесплатно';
    } else if (row && grand) {
      if (delivery.cost > 0) {
        row.hidden = false; grand.hidden = false;
        document.getElementById('shop-delivery-sum').textContent = S.money(delivery.cost);
        document.getElementById('shop-grand').textContent = S.money(calc.total + delivery.cost);
      } else {
        row.hidden = true; grand.hidden = true;
      }
    }

    var line = document.getElementById('shop-delivery-cost');
    if (line) {
      if (free) {
        line.textContent = 'Доставка бесплатно по промокоду ' + calc.code + '.';
      } else if (delivery.method === 'courier') {
        if (delivery.cost > 0) {
          line.textContent = 'Доставка курьером: ' + S.money(delivery.cost) +
            (cfg.freeFrom > 0 ? ' · бесплатно от ' + S.money(cfg.freeFrom) : '');
        } else if (cfg.courierCost > 0 && cfg.freeFrom > 0) {
          line.textContent = 'Доставка бесплатно — заказ от ' + S.money(cfg.freeFrom) + '.';
        } else {
          line.textContent = 'Стоимость доставки согласуем при подтверждении заказа.';
        }
      } else if (delivery.method === 'pickup') {
        line.textContent = cfg.pickupAddress
          ? 'Самовывоз: ' + cfg.pickupAddress
          : 'Адрес самовывоза пришлём при подтверждении заказа.';
      } else {
        line.textContent = 'Стоимость доставки в пункт выдачи согласуем при подтверждении.';
      }
    }
  }

  /* адрес самовывоза и стоимость доставки: берём из data/settings.json, при наличии — с сервера */
  function applyDeliveryInfo(src) {
    if (!src) return;
    delivery.cfg = {
      courierCost: Number(src.courierCost || src.cost || 0) || 0,
      freeFrom: Number(src.freeFrom || 0) || 0,
      pickupAddress: src.pickupAddress || '',
      pickupNote: src.pickupNote || ''
    };
    var note = document.getElementById('shop-pickup-note');
    if (note) note.textContent = delivery.cfg.pickupAddress ? delivery.cfg.pickupAddress : 'Заберёте сами';
    var addr = document.getElementById('shop-pickup-address');
    if (addr && delivery.cfg.pickupAddress) {
      addr.textContent = 'Забрать можно по адресу: ' + delivery.cfg.pickupAddress +
        (delivery.cfg.pickupNote ? ' · ' + delivery.cfg.pickupNote : '');
    }
    renderDeliveryTotals();
  }

  function initDeliveryInfo() {
    applyDeliveryInfo((S.settings && S.settings.delivery) || null);
    var api = (S.apiBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(api) || !window.fetch) return;
    /* необязательный запрос: если сервер не ответил, работаем на значениях из настроек */
    fetch(api + '/delivery/config', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        applyDeliveryInfo({
          courierCost: d.cost,
          freeFrom: d.freeFrom,
          pickupAddress: d.pickupAddress,
          pickupNote: d.pickupNote
        });
      })
      .catch(function () { });
  }

  /* показываем только поля, нужные для выбранного способа */
  function applyMethod(method) {
    delivery.method = method;
    var cityOnly = method === 'cdek';
    var courier = method === 'courier';
    var address = document.getElementById('shop-address');
    if (address) {
      address.hidden = method === 'pickup';
      /* когда нужен только город — растягиваем поле на всю ширину */
      address.classList.toggle('single', method !== 'courier');
    }

    ['shop-postcode-field', 'shop-street-field', 'shop-flat-field', 'shop-note-field'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = !courier;
    });
    var cityField = addressEl('addr-city');
    if (cityField) {
      cityField.setAttribute('autocomplete', 'address-level2');
      /* для самовывоза город не нужен */
      cityField.disabled = method === 'pickup';
    }
    var street = addressEl('addr-street');
    if (street) street.disabled = !courier;
    var flat = addressEl('addr-flat');
    if (flat) flat.disabled = !courier;
    var note = addressEl('addr-note');
    if (note) note.disabled = !courier;
    var post = addressEl('addr-postcode');
    if (post) post.disabled = !courier;

    var pickupBox = document.getElementById('shop-pickup-box');
    if (pickupBox) pickupBox.hidden = method !== 'pickup';
    var cdekBox = document.getElementById('shop-cdek-box');
    if (cdekBox) cdekBox.hidden = method !== 'cdek';

    clearAddressErrors();
    renderDeliveryTotals();
  }

  function setError(fieldId, message) {
    var box = document.getElementById('err-' + fieldId);
    var input = document.getElementById(fieldId);
    if (box) {
      box.textContent = message;
      box.hidden = !message;
    }
    if (input) {
      input.classList.toggle('invalid', !!message);
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
  function clearAddressErrors() {
    ['addr-city', 'addr-postcode', 'addr-street'].forEach(function (id) { setError(id, ''); });
  }

  /* проверка адреса: возвращает текст ошибки или пустую строку */
  function validateAddress(show) {
    clearAddressErrors();
    var a = addressValue();
    var firstBad = null;
    if (delivery.method === 'pickup') return '';

    if (a.city.length < 2) {
      if (show) setError('addr-city', 'Укажите город');
      firstBad = firstBad || 'addr-city';
    }
    if (delivery.method === 'cdek') {
      if (firstBad) addressEl(firstBad).focus();
      return firstBad ? 'Укажите город — подберём пункт выдачи СДЭК.' : '';
    }
    if (a.address.length < 5) {
      if (show) setError('addr-street', 'Улица и дом — обязательны');
      firstBad = firstBad || 'addr-street';
    }
    if (a.postcode && a.postcode.length !== 6) {
      if (show) setError('addr-postcode', 'Индекс — 6 цифр');
      firstBad = firstBad || 'addr-postcode';
    }
    if (firstBad) {
      var el = addressEl(firstBad);
      if (el) el.focus();
      return 'Заполните адрес доставки.';
    }
    return '';
  }

  /* ---------- хранение корзины между визитами ---------- */
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ items: items, promo: promo }));
    } catch (e) { }
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!raw) return;
      items = (raw.items || []).filter(function (x) {
        return x && S.byId[x.id];
      }).map(function (x) {
        var p = S.byId[x.id];
        var qty = Math.max(1, Math.min(Number(x.qty) || 1, Math.min(p.stock || 99, S.maxQty())));
        return { id: x.id, qty: qty };
      }).filter(function (x) { return S.byId[x.id].stock > 0; });
      promo = typeof raw.promo === 'string' ? raw.promo : '';
    } catch (e) { }
  }

  function lineName(p) {
    return p.fullName || p.name || p.id;
  }

  /* подарок по промокоду: отдельная строка в корзине */
  function giftLine(calc) {
    if (!calc.gift) return '';
    return '<div class="shop-line shop-gift"><div>' +
      '<div class="shop-line-name">Подарок: ' + escapeHtml(calc.gift.fullName || calc.gift.name) + '</div>' +
      '<div class="shop-line-price">По промокоду ' + escapeHtml(calc.code) + ' · 1 шт. бесплатно</div>' +
      '</div><div><div class="shop-line-price" style="text-align:right">0 ₽</div></div></div>';
  }

  /* ---------- закрытая распродажа: цены по уровню клуба ---------- */
  var dropState = { id: '', title: '', prices: {}, active: false };

  function readDropId() {
    var m = String(location.search || '').match(/[?&]drop=([^&#]+)/);
    if (m) return decodeURIComponent(m[1]);
    try {
      var raw = JSON.parse(localStorage.getItem('rules-drop') || 'null');
      if (raw && raw.id) return String(raw.id);
    } catch (e) { /* приватный режим */ }
    return '';
  }

  function dropApiBase() {
    return (S.apiBase || window.RULES_CONFIG.fallbackApiBase || '').replace(/\/+$/, '');
  }

  function applyDropPrices() {
    if (!dropState.active) return;
    S.products.forEach(function (p) {
      var dp = dropState.prices[p.id];
      if (dp && dp > 0 && dp < p.price) {
        /* запоминаем обычную цену: карточки товаров покажут её зачёркнутой */
        if (!p.fullPrice) p.fullPrice = (p.oldPrice && p.oldPrice > p.price) ? p.oldPrice : p.price;
        p.price = dp;
        p.oldPrice = p.fullPrice;
        p.dropPrice = true;
      }
    });
    S.reindex();
  }

  function showDropNote() {
    var box = document.getElementById('shop-drop-note');
    if (!box) return;
    box.hidden = !dropState.active;
    if (dropState.active) {
      box.innerHTML = '<b>' + (dropState.title || 'Закрытая распродажа') + '</b>' +
        '<span>Показаны цены закрытой распродажи — они действуют для её товаров, пока она открыта.</span>';
    }
  }

  function initDrop() {
    var id = readDropId();
    if (!id) return Promise.resolve();
    if (!club.token) { dropState.id = id; return Promise.resolve(); }
    return fetch(dropApiBase() + '/club/drop/' + encodeURIComponent(id), {
      headers: { Authorization: 'Bearer ' + club.token }
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Распродажа недоступна');
        return d;
      });
    }).then(function (d) {
      dropState.id = d.drop.id;
      dropState.title = d.drop.title || '';
      dropState.active = true;
      (d.items || []).forEach(function (i) { if (Number(i.price) > 0) dropState.prices[i.id] = Number(i.price); });
      try { localStorage.setItem('rules-drop', JSON.stringify({ id: dropState.id, title: dropState.title })); } catch (e) {}
      applyDropPrices();
      showDropNote();
      if (S.router && S.router.refresh) S.router.refresh();
      if (overlay && !overlay.hidden) render();
      return d;
    }).catch(function (e) {
      /* распродажа закрылась или уровень упал — тихо убираем */
      dropState.active = false;
      dropState.id = '';
      try { localStorage.removeItem('rules-drop'); } catch (err) {}
      if (e && e.message && /уровн/i.test(e.message) && typeof toastNote === 'function') toastNote(e.message);
    });
  }

  function clearDrop() {
    dropState.active = false;
    dropState.id = '';
    dropState.prices = {};
    try { localStorage.removeItem('rules-drop'); } catch (e) {}
    showDropNote();
  }

  /* ---------- клуб: баланс баллов ---------- */
  var club = { token: '', points: 0, maxRedeem: 30, cashback: 5, loaded: false, busy: false };
  try { club.token = localStorage.getItem('rules-club-token') || ''; } catch (e) { club.token = ''; }
  var usedPoints = 0;

  function clubApiBase() {
    return String((S.apiBase || '')).replace(/\/+$/, '');
  }

  function loadClub() {
    if (!club.token || club.busy || club.loaded) return Promise.resolve();
    club.busy = true;
    return fetch(clubApiBase() + '/club/me', { headers: { Authorization: 'Bearer ' + club.token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.customer) {
          club.points = Number(d.customer.points) || 0;
          club.maxRedeem = Number((d.settings && d.settings.maxRedeem) || 30);
          club.cashback = Number((d.level && d.level.cashback) || 5);
          club.loaded = true;
          var f = $('shop-name');
          if (f && !f.value && d.customer.name) f.value = d.customer.name;
          var ph = $('shop-phone');
          if (ph && !ph.value && d.customer.phone) ph.value = d.customer.phone;
        } else if (d === null) {
          club.token = '';
        }
      })
      .catch(function () {})
      .then(function () { club.busy = false; updateClubEntry(); });
  }

  /* сколько баллов реально можно списать */
  function pointsLimit(total) {
    if (!club.token || !club.points) return 0;
    var byPercent = Math.floor((total * club.maxRedeem) / 100);
    return Math.max(0, Math.min(club.points, byPercent));
  }

  function syncPoints(calc) {
    var box = $('shop-club');
    if (!box) return;
    if (!club.token || !club.points) { box.hidden = true; usedPoints = 0; return; }
    box.hidden = false;
    var limit = pointsLimit(calc.subtotal - calc.discount);
    var input = $('shop-points');
    if (input && document.activeElement !== input) input.value = usedPoints || '';
    usedPoints = Math.min(Math.max(0, usedPoints), limit);
    if (input) {
      input.max = limit;
      input.placeholder = 'до ' + limit;
    }
    var row = $('shop-points-row');
    var sum = $('shop-points-sum');
    if (row && sum) {
      row.hidden = !usedPoints;
      sum.textContent = '− ' + S.money(usedPoints);
    }
    var hint = $('shop-points-hint');
    if (hint) {
      hint.textContent = 'У вас ' + club.points + ' баллов. 1 балл = 1 ₽, списать можно до ' + club.maxRedeem +
        ' % суммы — это ' + limit + ' баллов.';
    }
  }


  /* Если кода нет в файле (data/promos.json устарел) или сайт работает
     без живого каталога — спрашиваем воркер. Он знает все коды.
     Успешный ответ добавляет правило в S.promos, и дальше всё считает
     обычный S.calculate: со скидкой, подарком и бесплатной доставкой. */
  function checkPromoOnServer(code) {
    var base = (S.apiBase || '').replace(/\/+$/, '');
    if (!base || !code) return Promise.resolve(false);
    return fetch(base + '/promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        items: items.map(function (x) { return { id: x.id, qty: x.qty }; })
      })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return false;
      if (d.rule) {
        S.promos[code] = d.rule;
        if (d.gift && !S.byId[d.gift.id]) {
          /* подарка нет в локальном каталоге — покажем хотя бы строкой */
          S.byId[d.gift.id] = { id: d.gift.id, name: d.gift.name, price: 0, images: {} };
        }
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }


  /* ---------- кнопка личного кабинета рядом с корзиной ----------
     Вставляется скриптом, поэтому появляется на всех страницах,
     где подключена корзина, и ничего не нужно править в вёрстке. */
  function mountClubEntry() {
    var cartBtn = document.querySelector('.shop-cart-toggle');
    if (!cartBtn || document.getElementById('club-entry')) return;
    var a = document.createElement('a');
    a.id = 'club-entry';
    a.className = 'shop-club-entry';
    a.href = 'club.html';
    a.innerHTML = '<span class="shop-club-ico" aria-hidden="true">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
      '<circle cx="12" cy="8" r="3.6"/><path d="M4.6 20c.6-3.9 3.6-6.1 7.4-6.1s6.8 2.2 7.4 6.1"/></svg>' +
      '</span><span class="shop-club-text">Кабинет</span><span class="shop-club-badge" hidden></span>';
    cartBtn.parentNode.insertBefore(a, cartBtn);
    updateClubEntry();
  }

  function updateClubEntry() {
    var a = document.getElementById('club-entry');
    if (!a) return;
    var badge = a.querySelector('.shop-club-badge');
    var text = a.querySelector('.shop-club-text');
    if (club.token && club.loaded) {
      a.setAttribute('aria-label', 'Личный кабинет: ' + club.points + ' баллов');
      a.title = 'Личный кабинет · ' + club.points + ' баллов';
      if (text) text.textContent = 'Кабинет';
      if (badge) {
        badge.hidden = false;
        badge.textContent = club.points > 999 ? Math.round(club.points / 100) / 10 + 'к' : club.points;
      }
      a.classList.add('is-in');
    } else {
      a.setAttribute('aria-label', 'Войти в личный кабинет');
      a.title = 'Войти в личный кабинет';
      if (text) text.textContent = 'Войти';
      if (badge) badge.hidden = true;
      a.classList.remove('is-in');
    }
  }

  function render() {
    if (!overlay) return;
    var calc = S.calculate(items, promo);
    badge.textContent = calc.quantity;
    var toggle = document.querySelector('.shop-cart-toggle');
    if (toggle) toggle.setAttribute('aria-label', 'Корзина, товаров: ' + calc.quantity);

    content.hidden = !items.length;
    if (!items.length) {
      itemsEl.innerHTML = '<p class="shop-empty">В корзине пока пусто. Выберите аромат в каталоге.</p>';
      return;
    }
    itemsEl.innerHTML = items.map(function (x) {
      var p = S.byId[x.id];
      return '<div class="shop-line"><div>' +
        '<div class="shop-line-name">' + lineName(p) + '</div>' +
        '<div class="shop-line-price">' + S.money(p.price) + ' за шт.</div>' +
        '<button type="button" class="shop-remove" data-remove="' + x.id + '">Удалить</button></div>' +
        '<div><div class="shop-line-actions">' +
          '<button type="button" class="shop-qty" data-delta="-1" data-id="' + x.id + '" aria-label="Уменьшить количество">−</button>' +
          '<output>' + x.qty + '</output>' +
          '<button type="button" class="shop-qty" data-delta="1" data-id="' + x.id + '" aria-label="Увеличить количество">+</button>' +
        '</div><div class="shop-line-price" style="text-align:right">' + S.money(p.price * x.qty) + '</div></div></div>';
    }).join('');

    if (calc.gift) itemsEl.insertAdjacentHTML('beforeend', giftLine(calc));
    showDropNote();

    syncPoints(calc);
    var afterPoints = Math.max(0, calc.total - usedPoints);
    $('shop-subtotal').textContent = S.money(calc.subtotal);
    $('shop-discount').textContent = '− ' + S.money(calc.discount);
    $('shop-total').textContent = S.money(afterPoints);
    $('shop-total').setAttribute('data-after-points', afterPoints);
    codeInput.value = promo;
    hint.textContent = promo ? calc.promoMessage : 'Один промокод на заказ; скидки не суммируются.';
    hint.classList.toggle('error', !!promo && !calc.code);
    $('shop-clear-promo').hidden = !promo;
    renderDeliveryTotals();
  }

  function open() {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add('shop-open');
    render();
    loadClub().then(function () { if (items.length) render(); });
    var btn = overlay.querySelector('.shop-close');
    if (btn) btn.focus();
  }

  function close() {
    if (busy) return;
    overlay.hidden = true;
    document.documentElement.classList.remove('shop-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function toastNote(text) {
    var el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;' +
      'background:#efeae0;color:#0a0a0a;padding:11px 18px;border-radius:99px;font:600 13.5px/1.4 system-ui,sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.45)';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function say(text, isError) {
    status.textContent = text || '';
    status.classList.toggle('error', !!isError);
  }

  function addToCart(id) {
    var p = S.byId[id];
    if (!p || p.stock <= 0) return;
    success.textContent = '';
    $('shop-telegram').hidden = true;
    var line = items.filter(function (x) { return x.id === id; })[0];
    var limit = Math.min(p.stock, S.maxQty());
    var total = items.reduce(function (n, x) { return n + x.qty; }, 0);
    if (line && line.qty >= limit) {
      open(); say('В наличии ' + p.stock + ' шт., больше добавить нельзя.', true); return;
    }
    if (total >= S.maxTotal()) { open(); say('Не более ' + S.maxTotal() + ' товаров в заказе.', true); return; }
    if (line) line.qty++; else items.push({ id: id, qty: 1 });
    save(); render(); say(''); open();
  }

  function bind() {
    overlay = $('shop-overlay');
    if (!overlay) return;
    drawer = overlay.querySelector('.shop-drawer');
    itemsEl = $('shop-items'); content = $('shop-content');
    codeInput = $('shop-code'); hint = $('shop-promo-hint');
    form = $('shop-form'); status = $('shop-status'); success = $('shop-success');
    badge = $('shop-badge');

    var ptsInput = $('shop-points');
    if (ptsInput) {
      ptsInput.addEventListener('input', function () {
        var calc = S.calculate(items, promo);
        var limit = pointsLimit(calc.subtotal - calc.discount);
        var v = parseInt(String(ptsInput.value).replace(/\D/g, ''), 10) || 0;
        usedPoints = Math.max(0, Math.min(v, limit));
        render();
      });
    }
    var ptsMax = $('shop-points-max');
    if (ptsMax) {
      ptsMax.addEventListener('click', function () {
        var calc = S.calculate(items, promo);
        usedPoints = pointsLimit(calc.subtotal - calc.discount);
        render();
      });
    }
    document.querySelector('.shop-cart-toggle').addEventListener('click', open);
    overlay.querySelector('.shop-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelectorAll('.shop-continue,.shop-policy').forEach(function (a) {
      a.addEventListener('click', close);
    });
    document.addEventListener('keydown', function (e) {
      if (overlay.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        var f = [].slice.call(drawer.querySelectorAll('button:not([disabled]):not([hidden]),input:not([disabled]),textarea:not([disabled]),a[href]'))
          .filter(function (x) { return x.getClientRects().length; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    // «В корзину» на любых страницах
    document.addEventListener('click', function (e) {
      var add = e.target.closest ? e.target.closest('[data-shop-add]') : null;
      if (!add || add.disabled) return;
      addToCart(add.getAttribute('data-shop-add'));
    });

    itemsEl.addEventListener('click', function (e) {
      if (busy) return;
      var remove = e.target.closest('[data-remove]');
      var delta = e.target.closest('[data-delta]');
      if (remove) {
        var id = remove.getAttribute('data-remove');
        items = items.filter(function (x) { return x.id !== id; });
      } else if (delta) {
        var pid = delta.getAttribute('data-id');
        var line = items.filter(function (x) { return x.id === pid; })[0];
        if (!line) return;
        var p = S.byId[pid];
        var next = line.qty + Number(delta.getAttribute('data-delta'));
        var total = items.reduce(function (n, x) { return n + x.qty; }, 0);
        var limit = Math.min(p.stock || 99, S.maxQty());
        if (next > limit) { say('В наличии ' + p.stock + ' шт.', true); return; }
        if (next > line.qty && total >= S.maxTotal()) { say('Не более ' + S.maxTotal() + ' товаров в заказе.', true); return; }
        if (next <= 0) items = items.filter(function (x) { return x !== line; });
        else line.qty = next;
      } else return;
      say(''); save(); render();
    });

    $('shop-apply').addEventListener('click', function () {
      var code = codeInput.value.trim().toUpperCase();
      promo = code;
      success.textContent = '';
      save(); render();
      if (!code) return;
      if (S.calculate(items, code).code) return;
      /* локально не сошлось — уточняем у воркера */
      checkPromoOnServer(code).then(function (known) {
        if (!known) return;
        promo = code;
        save(); render();
        var calc = S.calculate(items, code);
        if (!calc.code) say(calc.promoMessage, true);
      });
    });
    $('shop-clear-promo').addEventListener('click', function () {
      promo = ''; save(); render(); codeInput.focus();
    });
    codeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('shop-apply').click(); }
    });
    codeInput.addEventListener('input', function () {
      if (promo && codeInput.value.trim().toUpperCase() !== promo) {
        promo = ''; save();
        hint.textContent = 'Нажмите «Применить», чтобы проверить промокод.';
        hint.classList.remove('error');
        $('shop-clear-promo').hidden = true;
        var calc = S.calculate(items, '');
        $('shop-subtotal').textContent = S.money(calc.subtotal);
        $('shop-discount').textContent = '− ' + S.money(0);
        $('shop-total').textContent = S.money(calc.total);
      }
    });

    $('shop-forget').onclick = function () {
      if (confirm('Предыдущий заказ мог быть принят. Начать новый заказ? Для проверки свяжитесь с продавцом.')) {
        try { sessionStorage.removeItem('rules-pending-v3'); } catch (e) { }
        $('shop-forget').hidden = true;
        say('Теперь можно оформить новый заказ.');
      }
    };

    /* --- доставка: способ получения и поля адреса --- */
    Array.prototype.forEach.call(document.querySelectorAll('input[name="delivery"]'), function (r) {
      r.addEventListener('change', function () { applyMethod(r.value); });
    });
    ['addr-city', 'addr-postcode', 'addr-street', 'addr-flat', 'addr-note'].forEach(function (id) {
      var el = addressEl(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (id === 'addr-postcode') el.value = el.value.replace(/\D/g, '').slice(0, 6);
        if (el.classList.contains('invalid')) setError(id, '');
        saveAddress();
      });
      el.addEventListener('blur', function () { saveAddress(); renderDeliveryTotals(); });
      el.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        /* Enter в адресе переводит к следующему полю, а не отправляет заказ */
        var order = ['addr-city', 'addr-postcode', 'addr-street', 'addr-flat', 'addr-note'];
        for (var k = order.indexOf(id) + 1; k < order.length; k++) {
          var next = addressEl(order[k]);
          if (next && !next.disabled && next.offsetParent) { ev.preventDefault(); next.focus(); return; }
        }
      });
    });
    var cityEl = addressEl('addr-city');
    if (cityEl) cityEl.addEventListener('input', renderDeliveryTotals);

    applyMethod(delivery.method);
    restoreAddress();
    initDeliveryInfo();
    form.addEventListener('submit', submit);
    load(); render();
  }

  function hex(bytes) {
    return [].map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function submit(e) {
    e.preventDefault();
    if (busy || preparing || !items.length) return;
    say('');
    if (codeInput.value.trim().toUpperCase() !== promo) { say('Примените промокод или очистите поле.', true); return; }
    var calc = S.calculate(items, promo);
    if (promo && !calc.code) {
      /* последний шанс: спросить воркер (файл промокодов мог устареть) */
      say('Проверяем промокод…');
      checkPromoOnServer(promo).then(function (known) {
        var again = S.calculate(items, promo);
        if (known && again.code) { save(); render(); submit(e); return; }
        say(again.promoMessage, true);
      });
      return;
    }
    var address = addressValue();
    var addrError = validateAddress(true);
    if (addrError) { say(addrError, true); return; }
    saveAddress();
    var phone = $('shop-phone').value;
    if ((phone.match(/\d/g) || []).length < 10) { say('Введите телефон не менее чем из 10 цифр.', true); $('shop-phone').focus(); return; }

    var api = (S.apiBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(api)) { say('Приём заказов ещё не подключён. Свяжитесь с продавцом.', true); return; }

    var fd = new FormData(form);
    var payload = {
      items: items.map(function (x) { return { id: x.id, qty: x.qty }; }),
      promo: promo,
      drop: dropState.active ? dropState.id : '',
      name: fd.get('name'), phone: phone, city: address.city,
      contact: fd.get('contact'), comment: fd.get('comment'),
      consent: fd.get('consent') === 'on',
      points: usedPoints,
      club_token: club.token || '',
      delivery: {
        method: delivery.method,
        city: address.city,
        address: delivery.method === 'courier' ? address.address : '',
        flat: delivery.method === 'courier' ? address.flat : '',
        postcode: delivery.method === 'courier' ? address.postcode : '',
        note: delivery.method === 'courier' ? address.note : ''
      }
    };
    if (!window.crypto || !crypto.subtle) { say('Откройте сайт по адресу HTTPS для оформления заказа.', true); return; }
    $('shop-forget').hidden = true;

    preparing = true;
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
      .then(function (buf) {
        preparing = false;
        var fingerprint = hex(new Uint8Array(buf));
        var pending = null;
        try { pending = JSON.parse(sessionStorage.getItem('rules-pending-v3') || 'null'); } catch (err) { }
        if (pending && pending.fingerprint !== fingerprint) {
          say('Проверяемый заказ отличается от текущей корзины. Верните прежние данные и повторите отправку.', true);
          $('shop-forget').hidden = false;
          return;
        }
        if (!pending) {
          var idBytes = crypto.getRandomValues(new Uint8Array(16));
          var track = crypto.getRandomValues(new Uint8Array(24));
          pending = {
            id: hex(idBytes),
            token: btoa(String.fromCharCode.apply(null, track)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
            fingerprint: fingerprint
          };
          try { sessionStorage.setItem('rules-pending-v3', JSON.stringify(pending)); } catch (err) {
            say('Для надёжного оформления разрешите хранение данных сессии в браузере.', true);
            return;
          }
        }
        payload.request_id = pending.id;
        payload.tracking_token = pending.token;
        send(pending, payload);
      }).catch(function () {
        preparing = false;
        say('Не удалось подготовить заказ. Обновите страницу.', true);
      });
  }

  function send(pending, payload) {
    busy = true;
    var all = [].slice.call(drawer.querySelectorAll('button,input,textarea'));
    all.forEach(function (x) { x.disabled = true; });
    say('Отправляем заказ…');

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 25000);

    fetch(S.apiBase.replace(/\/+$/, '') + '/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.ok) {
          if (res.status === 400) { try { sessionStorage.removeItem('rules-pending-v3'); } catch (e) { } }
          throw new Error(data.error || 'Не удалось отправить заказ. Проверьте связь.');
        }
        return data;
      });
    }).then(function (data) {
      if (data.id !== pending.id) throw new Error('Обновление магазина ещё не завершено. Свяжитесь с продавцом.');
      items = []; promo = ''; save(); clearDrop(); form.reset();
      applyMethod(delivery.method);
      try { sessionStorage.removeItem('rules-pending-v3'); } catch (e) { }
      var num = data.id.slice(0, 8).toUpperCase();
      var botOk = typeof data.bot === 'string' && /^[a-zA-Z0-9_]{5,32}$/.test(data.bot) && /bot$/i.test(data.bot);
      var dlv = data.delivery || {};
      var dlvLine = '';
      if (dlv.method === 'courier') {
        var where = [dlv.postcode, dlv.city, dlv.address, dlv.flat].filter(Boolean).join(', ');
        dlvLine = 'Доставка: курьером' + (where ? ' — ' + where : '') +
          (dlv.cost ? ', ' + S.money(dlv.cost) : '') + (dlv.note ? ' (' + dlv.note + ')' : '');
      } else if (dlv.method === 'pickup') {
        var puAddr = deliveryCfg().pickupAddress;
        dlvLine = 'Получение: самовывоз' + (puAddr ? ' — ' + puAddr : '') + '.';
      } else if (dlv.method === 'cdek') {
        dlvLine = 'Получение: пункт выдачи СДЭК' + (dlv.city ? ', ' + dlv.city : '') +
          '. Адрес пункта пришлём при подтверждении.';
      } else {
        dlvLine = 'Доставку и оплату согласуем с вами.';
      }
      if (data.gift) {
        dlvLine += ' Подарок: ' + data.gift.name + ' — бесплатно.';
      }
      if (dlv && dlv.free) {
        dlvLine += ' Доставка бесплатно по промокоду.';
      }
      var link = botOk ? 'https://t.me/' + data.bot + '?start=' + pending.token : '';
      var pay = data.payment || {};
      var payBlock = '';
      if (pay.link) {
        payBlock =
          '<div class="order-pay" id="order-pay">' +
            '<div class="order-pay-head">Оплата по СБП</div>' +
            '<p class="order-done-text">Сумма к переводу: <b>' + S.money(pay.amount) + '</b>. ' +
              'Оплатите по ссылке ниже — подойдёт любой банк, СБП или QR.</p>' +
            '<a class="btn shop-submit order-done-btn" href="' + pay.link + '" target="_blank" rel="noopener noreferrer">Перейти к оплате ↗</a>' +
            '<button type="button" class="btn shop-submit order-done-btn" id="order-paid" style="margin-top:8px;background:transparent;border:1px solid currentColor;color:inherit">Я оплатил(а)</button>' +
            '<p class="shop-hint" id="order-paid-hint">' + escapeHtml(pay.note || '') + '</p>' +
          '</div>';
      }
      var clubLine = '';
      if (data.club) {
        clubLine = '<p class="order-done-text">Клуб RULES: списано ' + (data.club.pointsUsed || 0) + ' баллов, осталось ' +
          data.club.pointsLeft + '. Кэшбэк ' + data.club.cashback + ' % начислим после оплаты — это ещё ' +
          Math.round((pay.amount || data.total || 0) * data.club.cashback / 100) + ' баллов.</p>';
      }
      success.innerHTML =
        '<div class="order-done">' +
          '<div class="order-done-head">Заказ № ' + num + ' принят</div>' +
          '<p class="order-done-text">Мы получили заказ и свяжемся с вами для подтверждения.</p>' +
          '<p class="order-done-text">' + escapeHtml(dlvLine) + '</p>' +
          (botOk
            ? (data.linked
                ? '<div class="order-done-bot">' +
                    '<div class="order-done-bot-title">Отслеживание уже включено</div>' +
                    '<p class="order-done-text">Ваш Telegram привязан к номеру телефона, поэтому заказ и все статусы придут в бот <b>@' + data.bot + '</b> сами. ' +
                      'Активировать бота заново не нужно.</p>' +
                    '<a class="btn shop-submit order-done-btn" href="' + 'https://t.me/' + data.bot + '" target="_blank" rel="noopener noreferrer">' +
                      'Открыть бота ↗</a>' +
                  '</div>'
                : '<div class="order-done-bot">' +
                    '<div class="order-done-bot-title">Включите отслеживание в Telegram</div>' +
                    '<p class="order-done-text">Нажмите кнопку — откроется бот <b>@' + data.bot + '</b>. Нажмите «Запустить» (Start) и поделитесь ' +
                      'номером телефона кнопкой «📱 Отправить мой номер»: по номеру к кабинету привяжутся этот и все остальные заказы. ' +
                      'В следующий раз активировать бота не придётся.</p>' +
                    '<a class="btn shop-submit order-done-btn" href="' + link + '" target="_blank" rel="noopener noreferrer">' +
                      'Открыть бота и получать статусы ↗</a>' +
                    '<p class="shop-hint">Бот не открылся? Найдите в Telegram @' + data.bot + ', нажмите «Запустить» и отправьте код: ' +
                      '<code class="order-done-code">' + pending.token + '</code></p>' +
                  '</div>')
            : '<p class="shop-hint">Отслеживание в Telegram пока не подключено — статусы пришлём по указанному контакту.</p>') +
          clubLine +
          payBlock +
          '<p class="shop-hint">Оплата подтверждается вручную: как только продавец увидит поступление, статус заказа изменится и придёт в бот.</p>' +
        '</div>';
      var bot = $('shop-telegram');
      if (bot) bot.hidden = true;
      var paidBtn = $('order-paid');
      if (paidBtn) {
        paidBtn.addEventListener('click', function () {
          paidBtn.disabled = true;
          paidBtn.textContent = 'Отправляем…';
          fetch(S.apiBase.replace(/\/+$/, '') + '/pay/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: data.id, token: pending.token })
          }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) {
            if (!r.ok) throw new Error(d.error || 'Не получилось отправить');
            return d;
          }); }).then(function () {
            paidBtn.textContent = 'Оплата на проверке';
            var hint = $('order-paid-hint');
            if (hint) hint.textContent = 'Спасибо! Продавец подтвердит оплату, и заказ перейдёт в работу. Статус придёт в бот.';
            toastNote('Спасибо! Продавец подтвердит оплату.');
          }).catch(function (err) {
            paidBtn.disabled = false;
            paidBtn.textContent = 'Я оплатил(а)';
            var hint = $('order-paid-hint');
            if (hint) hint.textContent = err.message;
          });
        });
      }
      say('');
      render();
      success.focus();
    }).catch(function (err) {
      say(err.name === 'AbortError' || err instanceof TypeError
        ? 'Ответ пока не получен. Повторите отправку с теми же данными — повторный заказ не создастся.'
        : err.message, true);
    }).then(function () {
      clearTimeout(timer);
      busy = false;
      all.forEach(function (x) { x.disabled = false; });
    });
  }

  C.init = function () {
    bind();
    mountClubEntry();
    if (club.token) {
      loadClub().then(initDrop, function () {});
    } else {
      initDrop();
    }
    document.addEventListener('rules:catalog-updated', render);
  };
  C.add = addToCart;
  C.open = open;
})();

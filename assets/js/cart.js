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

    $('shop-subtotal').textContent = S.money(calc.subtotal);
    $('shop-discount').textContent = '− ' + S.money(calc.discount);
    $('shop-total').textContent = S.money(calc.total);
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
    var btn = overlay.querySelector('.shop-close');
    if (btn) btn.focus();
  }

  function close() {
    if (busy) return;
    overlay.hidden = true;
    document.documentElement.classList.remove('shop-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
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
      promo = codeInput.value.trim().toUpperCase();
      success.textContent = '';
      save(); render();
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
    if (promo && !calc.code) { say(calc.promoMessage, true); return; }
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
      name: fd.get('name'), phone: phone, city: address.city,
      contact: fd.get('contact'), comment: fd.get('comment'),
      consent: fd.get('consent') === 'on',
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
      items = []; promo = ''; save(); form.reset();
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
            : '<p class="shop-hint">Отслеживание в Telegram пока не подключено — статусы пришлём по указанному контакту.</p>') +
        '</div>';
      var bot = $('shop-telegram');
      if (bot) bot.hidden = true;
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
    document.addEventListener('rules:catalog-updated', render);
  };
  C.add = addToCart;
  C.open = open;
})();

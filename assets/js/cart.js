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

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ items: items, promo: promo })); } catch (e) { }
  }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (Array.isArray(saved.items)) {
        var seen = {};
        items = saved.items.filter(function (x) {
          if (!x || !S.byId[x.id] || !Number.isInteger(x.qty) || x.qty < 1 || seen[x.id]) return false;
          seen[x.id] = 1;
          x.qty = Math.min(x.qty, S.maxQty());
          return true;
        });
      }
      if (typeof saved.promo === 'string') promo = saved.promo.slice(0, 40);
    } catch (e) { items = []; }
  }

  function lineName(p) { return p.fullName; }

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

    $('shop-subtotal').textContent = S.money(calc.subtotal);
    $('shop-discount').textContent = '− ' + S.money(calc.discount);
    $('shop-total').textContent = S.money(calc.total);
    codeInput.value = promo;
    hint.textContent = promo ? calc.promoMessage : 'Один промокод на заказ; скидки не суммируются.';
    hint.classList.toggle('error', !!promo && !calc.code);
    $('shop-clear-promo').hidden = !promo;
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
    var phone = $('shop-phone').value;
    if ((phone.match(/\d/g) || []).length < 10) { say('Введите телефон не менее чем из 10 цифр.', true); $('shop-phone').focus(); return; }

    var api = (S.apiBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(api)) { say('Приём заказов ещё не подключён. Свяжитесь с продавцом.', true); return; }

    var fd = new FormData(form);
    var payload = {
      items: items.map(function (x) { return { id: x.id, qty: x.qty }; }),
      promo: promo,
      name: fd.get('name'), phone: phone, city: fd.get('city'),
      contact: fd.get('contact'), comment: fd.get('comment'),
      consent: fd.get('consent') === 'on'
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
      try { sessionStorage.removeItem('rules-pending-v3'); } catch (e) { }
      success.textContent = 'Заказ № ' + data.id.slice(0, 8).toUpperCase() +
        ' принят. Свяжемся с вами для подтверждения доставки и оплаты.';
      var bot = $('shop-telegram');
      if (typeof data.bot === 'string' && /^[a-zA-Z0-9_]{5,32}$/.test(data.bot) && /bot$/i.test(data.bot)) {
        bot.href = 'https://t.me/' + data.bot + '?start=' + pending.token;
        bot.hidden = false;
      } else {
        bot.hidden = true;
        success.textContent += ' Бот для отслеживания пока не подключён.';
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
    document.addEventListener('rules:catalog-updated', render);
  };
  C.add = addToCart;
  C.open = open;
})();

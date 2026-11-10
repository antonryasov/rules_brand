/* ============================================================
   RULES · загрузка данных
   ------------------------------------------------------------
   1. читает data/settings.json, products.json, promos.json, quiz.json
   2. если в настройках указан адрес Worker — берёт живой каталог
      (цены, остатки, фото, наличие) прямо из базы D1
   3. если Worker недоступен — работает на файлах из папки data/
   ============================================================ */
(function () {
  var S = window.RULES = window.RULES || {};

  S.settings = {};
  S.products = [];
  S.promos = {};
  S.quiz = { questions: [], results: {} };
  S.byId = {};
  S.live = false;

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return r.json();
    });
  }

  function normalize(p, fallback) {
    var f = fallback || {};
    var out = {
      id: String(p.id),
      page: p.page || f.page || '',
      sku: p.sku || f.sku || '',
      name: p.name || f.name || '',
      fullName: p.fullName || p.full_name || f.fullName || p.name || '',
      type: p.type || f.type || 'candle',
      typeLabel: p.typeLabel || p.type_label || f.typeLabel || '',
      family: p.family || f.family || '',
      collection: p.collection || f.collection || '',
      price: Number(p.price != null ? p.price : f.price || 0),
      oldPrice: Number(p.oldPrice != null ? p.oldPrice : (p.old_price != null ? p.old_price : f.oldPrice || 0)),
      stock: Number(p.stock != null ? p.stock : f.stock || 0),
      active: p.active != null ? !!Number(p.active) : (f.active !== false),
      badge: p.badge || f.badge || '',
      sort: Number(p.sort != null ? p.sort : f.sort || 100),
      tagline: p.tagline || f.tagline || '',
      quote: p.quote || f.quote || '',
      lead: p.lead || p.description || f.lead || '',
      deliveryNote: p.deliveryNote || p.delivery_note || f.deliveryNote || '',
      crossSell: p.crossSell || p.cross_sell || f.crossSell || '',
      safety: p.safety || f.safety || '',
      notes: p.notes || f.notes || { top: '', heart: '', base: '' },
      specs: p.specs || f.specs || [],
      images: {
        card: (p.images && p.images.card) || p.image || f.images && f.images.card || '',
        hero: (p.images && p.images.hero) || f.images && f.images.hero || '',
        gallery: (p.images && p.images.gallery) || f.images && f.images.gallery || []
      },
      meta: p.meta || f.meta || {}
    };
    if (!out.fullName) out.fullName = out.name;
    /* у товара, созданного в кабинете, может не быть поля page —
       страница называется так же, как id */
    if (!out.page && out.id) out.page = out.id + '.html';
    if (!out.images.hero) out.images.hero = out.images.card;
    if (!out.images.card) out.images.card = out.images.hero;
    return out;
  }

  S.load = function () {
    return Promise.all([
      getJSON('data/settings.json').catch(function () { return {}; }),
      getJSON('data/products.json').catch(function () { return []; }),
      getJSON('data/promos.json').catch(function () { return {}; }),
      getJSON('data/quiz.json').catch(function () { return { questions: [], results: {} }; })
    ]).then(function (res) {
      var settings = res[0] || {}, local = res[1] || [], promos = res[2] || {}, quiz = res[3] || {};
      S.settings = settings;
      S.localProducts = local.map(function (p) { return normalize(p); });
      S.promos = promos;
      S.quiz = quiz;
      S.products = S.localProducts.slice();
      S.reindex();

      var api = ((settings.api && settings.api.base) || window.RULES_CONFIG.fallbackApiBase || '').replace(/\/+$/, '');
      S.apiBase = api;
      if (!api || (settings.api && settings.api.liveCatalog === false)) return;

      return getJSON(api + '/catalog').then(function (data) {
        var list = Array.isArray(data) ? data : (data && data.products) || [];
        if (!list.length) return;
        var localById = {};
        S.localProducts.forEach(function (p) { localById[p.id] = p; });
        S.products = list.map(function (p) { return normalize(p, localById[p.id]); })
          .filter(function (p) { return p.active; });
        if (data && data.promos) S.promos = data.promos;
        S.live = true;
        S.reindex();
      }).catch(function () {
        S.live = false; // Worker недоступен — работаем на файлах data/
      });
    });
  };

  S.reindex = function () {
    S.byId = {};
    S.products.forEach(function (p) { S.byId[p.id] = p; });
    S.products.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  };

  S.productByPage = function (page) {
    var slug = String(page || '').toLowerCase();
    var wanted = slug.replace(/\.html$/, '');
    for (var i = 0; i < S.products.length; i++) {
      var p = S.products[i];
      if (p.page === slug) return p;
      /* запасной вариант: страница = id.html */
      if (String(p.id).toLowerCase() === wanted) return p;
    }
    return null;
  };

  S.ofType = function (type) {
    return S.products.filter(function (p) { return p.type === type && p.active !== false; });
  };

  S.maxQty = function () {
    return (S.settings.cart && S.settings.cart.maxQtyPerItem) || window.RULES_CONFIG.maxQtyPerItem;
  };
  S.maxTotal = function () {
    return (S.settings.cart && S.settings.cart.maxItemsTotal) || window.RULES_CONFIG.maxItemsTotal;
  };

  S.money = function (n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽';
  };

  /* Промокоды: та же логика, что и на сервере.
     Кроме скидки промокод может давать подарок (gift: '<id товара>')
     и бесплатную доставку (freeDelivery: true). */
  S.calculate = function (items, rawCode) {
    var subtotal = 0, quantity = 0;
    items.forEach(function (it) {
      var p = S.byId[it.id];
      if (!p) return;
      subtotal += p.price * it.qty;
      quantity += it.qty;
    });
    var code = String(rawCode || '').trim().toUpperCase();
    var base = {
      subtotal: subtotal, quantity: quantity, discount: 0, total: subtotal,
      code: '', promoMessage: '', gift: null, freeDelivery: false
    };
    function fail(message) {
      return {
        subtotal: subtotal, quantity: quantity, discount: 0, total: subtotal,
        code: '', promoMessage: message, gift: null, freeDelivery: false
      };
    }
    if (!code) return base;
    var p = S.promos[code];
    if (!p) return fail('Промокод не найден.');
    if ((p.minQty && quantity < p.minQty) || (p.minSum && subtotal < p.minSum)) {
      return fail('Условие не выполнено: ' + p.label + '.');
    }
    var eligible = 0;
    items.forEach(function (it) {
      var prod = S.byId[it.id];
      if (!prod) return;
      if ((!p.type || p.type === prod.type) && (!p.family || p.family === prod.family)) {
        eligible += prod.price * it.qty;
      }
    });
    if (!eligible) return fail('В корзине нет товаров, подходящих под этот промокод.');
    var discount = Math.min(eligible, p.fixed || Math.round(eligible * (p.percent || 0) / 100));
    return {
      subtotal: subtotal,
      quantity: quantity,
      discount: discount,
      total: subtotal - discount,
      code: code,
      promoMessage: p.label,
      gift: p.gift ? (S.byId[p.gift] || null) : null,
      freeDelivery: !!p.freeDelivery
    };
  };
})();

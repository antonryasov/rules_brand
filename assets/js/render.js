/* ============================================================
   RULES · шаблоны (как выглядят карточки и страница товара)
   ------------------------------------------------------------
   Здесь НЕ тексты и НЕ цены — они берутся из data/products.json
   и из личного кабинета. Менять этот файл нужно, только если
   хотите изменить саму вёрстку.
   ============================================================ */
(function () {
  var S = window.RULES = window.RULES || {};
  var R = S.render = {};

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  R.esc = esc;

  function priceBlock(p) {
    var html = '<div class="price">' + S.money(p.price);
    if (p.oldPrice && p.oldPrice > p.price) html += '<span class="old">' + S.money(p.oldPrice) + '</span>';
    return html + '</div>';
  }

  function stockBadge(p) {
    if (p.stock <= 0) return '<span class="stock out">Нет в наличии</span>';
    if (p.stock <= 3) return '<span class="stock low">Осталось ' + p.stock + ' шт.</span>';
    return '<span class="stock in">В наличии</span>';
  }

  function addButton(p, cls) {
    if (p.stock <= 0) {
      return '<button type="button" class="btn ' + (cls || 'shop-add') + '" disabled>Нет в наличии</button>';
    }
    return '<button type="button" class="btn ' + (cls || 'shop-add') + '" data-shop-add="' + esc(p.id) + '">' +
      'В корзину <span class="arr">→</span></button>';
  }

  function catList(p) {
    return [p.type, p.family].filter(Boolean).join(' ');
  }

  /* ---------- карточка каталога ---------- */
  R.catalogCard = function (p) {
    var href = p.page ? esc(p.page) : 'catalog.html';
    var inner =
      '<a class="card" href="' + href + '">' +
        '<div class="ph"><img decoding="async" loading="lazy" data-k="' + esc(p.id) + '" src="' + esc(p.images.card) + '" alt="' + esc(p.name) + '">' +
        (p.badge ? '<span class="tag">' + esc(p.badge) + '</span>' : '') + '</div>' +
        '<div class="tx"><h3>' + esc(p.name) + '</h3>' +
          '<div class="meta">' + esc(p.typeLabel) + (p.tagline ? ' · ' + esc(p.tagline) : '') + '</div>' +
          priceBlock(p) + '</div>' +
      '</a>';
    return '<div class="shop-card cat-item" data-cat="' + esc(catList(p)) + '">' + inner + addButton(p) + '</div>';
  };

  R.catalog = function (products) {
    return products.filter(function (p) { return p.type !== 'set'; }).map(R.catalogCard).join('');
  };

  /* короткая строка нот для списка на главной */
  function notesLine(p) {
    var n = p.notes || {};
    var parts = [n.top, n.heart].filter(Boolean).join(' — ');
    return parts || p.lead || '';
  }

  /* ---------- строка на главной ---------- */
  R.indexRow = function (p, i) {
    return '<div class="index-row" data-k="' + esc(p.id) + '">' +
      '<span class="n">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="name">' + esc(p.name) + '</span>' +
      '<span class="desc"><b>' + esc(p.tagline) + '</b>' + esc(notesLine(p)) + '</span>' +
      '<span class="pr">' + S.money(p.price) + '</span>' +
      '<a class="full" href="' + esc(p.page || 'catalog.html') + '" aria-label="' + esc(p.name) + '"></a>' +
    '</div>';
  };

  R.indexList = function (products) {
    return products.map(R.indexRow).join('');
  };

  /* ---------- горизонтальная лента коллекции ---------- */
  R.collectionCard = function (p) {
    return '<a class="hcard" href="' + esc(p.page || 'catalog.html') + '">' +
      '<div class="ph"><span class="tag">' + esc(p.typeLabel) + '</span>' +
        '<img decoding="async" loading="lazy" data-k="' + esc(p.id) + '" src="' + esc(p.images.card) + '" alt="' + esc(p.name) + '"></div>' +
      '<div class="cap"><h3>' + esc(p.name) + '</h3><span>' + S.money(p.price) + '</span></div>' +
      '<div class="sub">' + esc(p.tagline) + '</div>' +
    '</a>';
  };

  R.collectionScroll = function (products) {
    var cta = '<div class="hcard cta"><div class="kicker" style="margin-bottom:0">Первая партия</div>' +
      '<h3>100 штук. <em>Ручная</em> работа.</h3>' +
      '<a class="btn solid magnet" href="promo-first-batch.html">Подробнее <span class="arr">→</span></a></div>';
    return products.map(R.collectionCard).join('') + cta;
  };

  /* ---------- наборы ---------- */
  R.setCard = function (p) {
    var items = '';
    (p.specs || []).forEach(function (s) { if (s.k === 'Состав набора') items = s.v; });
    return '<div class="shop-card"><div class="set">' +
      '<div class="ph"><img decoding="async" loading="lazy" data-k="' + esc(p.id) + '" src="' + esc(p.images.card) + '" alt="' + esc(p.name) + '"></div>' +
      '<div class="body"><h3>' + (p.page ? '<a href="' + esc(p.page) + '" style="color:inherit;text-decoration:none">' + esc(p.name) + '</a>' : esc(p.name)) + '</h3>' +
        (items ? '<div class="items">' + esc(items) + '</div>' : '') +
        '<p class="small">' + esc(p.tagline) + '</p>' +
        '<div class="foot">' + priceBlock(p) + '</div>' +
      '</div></div>' + addButton(p) + '</div>';
  };

  R.sets = function (products) {
    return products.map(R.setCard).join('');
  };

  /* ---------- страница товара ---------- */
  R.productPage = function (p) {
    var notes = p.notes || {};
    var pyramid = [
      ['Верх', notes.top], ['Сердце', notes.heart], ['База', notes.base]
    ].filter(function (x) { return x[1]; }).map(function (x) {
      return '<div class="lvl"><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>';
    }).join('');

    var specs = (p.specs || []).map(function (s) {
      return '<div><dt>' + esc(s.k) + '</dt><dd>' + esc(s.v) + '</dd></div>';
    }).join('');

    var gallery = (p.images.gallery || []).map(function (src) {
      return '<figure class="pdp-shot"><img loading="lazy" decoding="async" src="' + esc(src) + '" alt="' + esc(p.name) + '"></figure>';
    }).join('');

    var cross = p.crossSell ? S.byId[String(p.crossSell).replace(/\.html$/, '')] : null;
    var crossHtml = cross ? '<a class="card" href="' + esc(cross.page) + '" style="max-width:360px;margin-top:44px">' +
      '<div class="ph"><img decoding="async" loading="lazy" src="' + esc(cross.images.card) + '" alt="' + esc(cross.name) + '"></div>' +
      '<div class="tx"><h3>' + esc(cross.fullName) + '</h3><div class="meta">' + S.money(cross.price) + '</div></div></a>' : '';

    return '' +
      '<section style="padding:0;border:0"><div class="pdp-hero">' +
        '<img decoding="async" src="' + esc(p.images.hero || p.images.card) + '" alt="' + esc(p.name) + '" loading="eager">' +
        '<div class="pdp-title"><div>' +
          (p.tagline ? '<div class="tagline">' + esc(p.tagline) + '</div>' : '') +
          '<h1 class="h-xl">' + esc(p.name) + '</h1></div>' +
          '<div class="kicker" style="margin:0;color:var(--bone)"><span>' +
            esc([p.collection, p.typeLabel].filter(Boolean).join(' · ')) + '</span></div>' +
        '</div></div></section>' +

      '<section style="padding:0"><div class="shell pdp-body">' +
        '<div class="pdp-sticky">' +
          '<div class="kicker">' + esc(p.typeLabel) + '</div>' +
          (p.quote ? '<p class="serif" style="font-size:clamp(34px,3.6vw,56px);line-height:1.05">' + esc(p.quote) + '</p>' : '') +
          (p.lead ? '<p class="lead">' + esc(p.lead) + '</p>' : '') +
          priceBlock(p) + '<div class="stock-line">' + stockBadge(p) + '</div>' +
          '<div class="row-btn">' + addButton(p, 'solid') +
            '<a class="link" href="quiz.html">Какой запах мой</a></div>' +
          (p.deliveryNote ? '<p class="small" style="margin-top:22px">' + esc(p.deliveryNote) + '</p>' : '') +
          crossHtml +
        '</div>' +
        '<div>' +
          (gallery ? '<div class="pdp-gallery">' + gallery + '</div>' : '') +
          (pyramid ? '<div class="kicker">Пирамида ароматов</div><dl class="pyramid">' + pyramid + '</dl>' : '') +
          (specs ? '<dl class="specs">' + specs + '</dl>' : '') +
        '</div>' +
      '</div></section>' +

      (p.safety ? '<section style="padding-top:0"><div class="shell"><div class="safety rv">' +
        '<b>Безопасность</b>' + esc(p.safety) + '</div></div></section>' : '');
  };

  /* прячем картинки для hover-превью и квиза */
  R.imageIndex = function () {
    return '<div hidden aria-hidden="true">' + S.products.map(function (p) {
      return '<img loading="lazy" decoding="async" data-k="' + esc(p.id) + '" src="' + esc(p.images.card) + '" alt="">';
    }).join('') + '</div>';
  };

  /* подстановка {{brand.name}} в текстах страниц */
  R.applyPlaceholders = function (root) {
    var st = S.settings || {};
    var map = {
      '{{brand.name}}': (st.brand && st.brand.name) || 'RULES',
      '{{brand.legal}}': (st.brand && st.brand.legal) || '',
      '{{contacts.email}}': (st.contacts && st.contacts.email) || '',
      '{{contacts.telegram}}': (st.contacts && st.contacts.telegram) || '',
      '{{contacts.vk}}': (st.contacts && st.contacts.vk) || '',
      '{{contacts.phone}}': (st.contacts && st.contacts.phone) || ''
    };
    var html = root.innerHTML;
    Object.keys(map).forEach(function (k) {
      html = html.split(k).join(esc(map[k]));
    });
    if (html !== root.innerHTML) root.innerHTML = html;
  };
})();

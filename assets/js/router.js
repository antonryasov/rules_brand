/* ============================================================
   RULES · роутер
   ------------------------------------------------------------
   Сайт работает по адресам вида  index.html#/catalog.html
   Каждая страница-текстовик лежит в папке content/,
   страницы товаров собираются из data/products.json.
   ============================================================ */
(function () {
  var S = window.RULES = window.RULES || {};
  var RT = S.router = {};
  var cache = {};
  var current = null;
  var app = null;

  function slugOf(hash) {
    var m = String(hash || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
    if (!m) return 'index.html';
    if (!/\.html$/.test(m)) m += '.html';
    return m;
  }

  function setMeta(slug) {
    var info = (S.pagesMeta && S.pagesMeta[slug]) || {};
    var product = S.productByPage(slug);
    var title = (product && product.meta && product.meta.title) || info.title;
    var desc = (product && product.meta && product.meta.description) || info.description;
    if (title) document.title = title;
    var d = document.querySelector('meta[name="description"]');
    if (d && desc) d.setAttribute('content', desc);
  }

  function markNav(slug) {
    document.querySelectorAll('header.site nav a, .menu a').forEach(function (a) {
      a.classList.toggle('on', (a.getAttribute('href') || '').toLowerCase() === slug);
    });
  }

  function loadFragment(slug) {
    if (cache[slug]) return Promise.resolve(cache[slug]);
    return fetch('content/' + slug, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('нет файла content/' + slug);
      return r.text();
    }).then(function (html) {
      cache[slug] = html;
      return html;
    });
  }

  /* блоки, которые собираются из data/products.json:
     data-render="catalog" | "index-list" | "collection-scroll" | "sets" */
  function fillRenderBlocks() {
    app.querySelectorAll('[data-render]').forEach(function (el) {
      var kind = el.getAttribute('data-render');
      if (kind === 'catalog') el.innerHTML = S.render.catalog(S.products);
      else if (kind === 'index-list') el.innerHTML = S.render.indexList(S.ofType('candle'));
      else if (kind === 'collection-scroll') el.innerHTML = S.render.collectionScroll(S.products.filter(function (p) { return p.type !== 'set'; }));
      else if (kind === 'sets') el.innerHTML = S.render.sets(S.ofType('set'));
    });
  }

  function afterRender(slug) {
    fillRenderBlocks();
    S.render.applyPlaceholders(app);
    markNav(slug);
    setMeta(slug);
    if (S.motion && S.motion.scan) S.motion.scan();
    if (window.scrollY) window.scrollTo(0, 0);
    document.documentElement.classList.remove('menu-open');
  }

  function show(slug) {
    if (!app) app = document.getElementById('page');
    if (slug === current) return Promise.resolve();
    current = slug;

    var product = S.productByPage(slug);
    if (product) {
      app.innerHTML = S.render.productPage(product) + S.render.imageIndex();
      app.classList.add('active');
      afterRender(slug);
      return Promise.resolve();
    }

    return loadFragment(slug).catch(function () {
      return loadFragment('index.html');
    }).then(function (html) {
      app.innerHTML = html + ((slug === 'index.html' || slug === 'quiz.html') ? S.render.imageIndex() : '');
      app.classList.add('active');
      afterRender(slug);
    });
  }

  function route() {
    var slug = slugOf(location.hash);
    show(slug);
  }

  /* страницы, которые открываются как обычные файлы, а не внутри index.html:
     личный кабинет и 404 живут отдельными html-файлами */
  var NATIVE_PAGES = { 'club.html': 1, '404.html': 1 };

  RT.start = function () {
    app = document.getElementById('page');
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (a.target || a.hasAttribute('download')) return;
      /* ссылка помечена как «обычный переход» — отдаём браузеру */
      if (a.hasAttribute('data-native') || a.getAttribute('data-native') === '') return;
      var m = href.match(/^(?:\.\/)?([a-z0-9][a-z0-9-]*)\.html(?:#.*)?$/i);
      if (!m) return;
      /* личный кабинет, 404 и любые другие отдельные файлы не подменяем хешем */
      if (NATIVE_PAGES[m[1].toLowerCase() + '.html']) return;
      e.preventDefault();
      var slug = m[1].toLowerCase() + '.html';
      if (slug === slugOf(location.hash)) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      location.hash = '#/' + m[1].toLowerCase();
    }, true);
    window.addEventListener('hashchange', route);
    route();
  };

  RT.go = function (slug) { location.hash = '#/' + String(slug).replace(/\.html$/, ''); };
  /* перерисовать текущую страницу (например, когда подъехали цены распродажи) */
  RT.refresh = function () { current = null; route(); };
})();

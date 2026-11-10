/* ============================================================
   RULES · запуск сайта
   ------------------------------------------------------------
   Порядок: читаем данные → применяем тему и тексты из
   data/settings.json → включаем корзину → показываем страницу.
   ============================================================ */
(function () {
  var S = window.RULES;

  function applyTheme() {
    var st = S.settings || {};
    var theme = st.theme || {};
    var root = document.documentElement;
    var map = { ink: '--ink', ink2: '--ink2', bone: '--bone', ash: '--ash', line: '--line', emerald: '--emerald', emerald2: '--emerald2', ice: '--ice' };
    Object.keys(map).forEach(function (k) {
      if (theme[k]) root.style.setProperty(map[k], theme[k]);
    });
    var fonts = st.fonts || {};
    if (fonts.display) root.style.setProperty('--display', fonts.display);
    if (fonts.serif) root.style.setProperty('--serif', fonts.serif);
    if (fonts.text) root.style.setProperty('--text', fonts.text);
    if (st.home && st.home.heroImage) root.style.setProperty('--hero', 'url(' + new URL(st.home.heroImage, location.href).href + ')');
    if (st.brand && st.brand.logo) {
      var logo = document.querySelector('header.site .logo img');
      if (logo) logo.src = new URL(st.brand.logo, location.href).href;
    }
  }

  function applyBrandText() {
    var st = S.settings || {};
    var brand = st.brand || {};
    var legal = document.querySelectorAll('.legal span, .menu .menu-foot');
    if (brand.copyright && legal[0]) legal[0].textContent = brand.copyright;
    document.querySelectorAll('.menu .menu-foot').forEach(function (el) {
      if (brand.legal) el.textContent = 'Ручная работа · Малые партии · ' + brand.legal;
    });
    S.render.applyPlaceholders(document.body);
    if (brand.name) document.querySelectorAll('.menu-foot').forEach(function () { });
  }

  function loadPagesMeta() {
    return fetch('data/pages.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (json) { S.pagesMeta = json || {}; })
      .catch(function () { S.pagesMeta = {}; });
  }

  function boot() {
    loadPagesMeta().then(function () {
      return S.load();
    }).then(function () {
      applyTheme();
      applyBrandText();
      S.motion.init();
      S.cart.init();
      S.router.start();
      document.documentElement.classList.add('ready');
      if (!S.live && S.products.length) {
        console.info('RULES: каталог загружен из data/products.json (живой каталог недоступен).');
      }
    }).catch(function (err) {
      console.error('RULES: ошибка запуска', err);
      var app = document.getElementById('page');
      if (app) {
        app.innerHTML = '<section style="padding:200px 0 120px"><div class="shell">' +
          '<div class="kicker">RULES</div><h1 class="h-l">Не удалось загрузить данные</h1>' +
          '<p class="lead">Проверьте, что файлы из папки data/ на месте, и обновите страницу.</p></div></section>';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

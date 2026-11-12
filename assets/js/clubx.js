/* ============================================================
   RULES · PRIVATE CLUB
   ------------------------------------------------------------
   Поведение страницы программы лояльности:
   · переключение уровней с анимацией и «дорогой» прогресса;
   · живой калькулятор «где ты сейчас»;
   · аккордеон вопросов;
   · появление блоков при прокрутке;
   · подтягивает названия уровней, пороги и проценты кэшбэка
     из Worker (/club/program), чтобы страница совпадала с
     настройками в админке. Если Worker недоступен — работает
     на значениях по умолчанию (они ниже).
   ============================================================ */
(function () {
  var S = window.RULES = window.RULES || {};

  /* значения по умолчанию — совпадают с настройками клуба в админке */
  var LEVELS = [
    {
      key: 'bronze', title: 'Странник', from: 0, cashback: 5,
      desc: 'С этого начинается всё. Ты пробуешь RULES на себе: одна свеча, один аромат, одно правило — и решаешь, остаться здесь или идти выше.',
      perks: [
        'Кэшбэк 5 % баллами с каждой покупки',
        'Приветственные баллы за вход в кабинет',
        'Личный кабинет: заказы, статусы, доставка',
        'Переписка с продавцом в боте — прямо по заказу',
        'Баллы не сгорают: копи и трать когда удобно'
      ]
    },
    {
      key: 'silver', title: 'Искатель', from: 15000, cashback: 10,
      desc: 'Ты уже знаешь, что тебе нравится, и возвращаешься осознанно. Здесь появляется то, чего нет в обычном каталоге.',
      perks: [
        'Кэшбэк 10 % — вдвое больше баллов за ту же покупку',
        'Закрытые распродажи этого уровня и выше',
        'Ранний вход в лимитированные серии',
        'Баллами можно закрыть до 30 % суммы заказа',
        'Всё, что было на предыдущем уровне'
      ]
    },
    {
      key: 'gold', title: 'Покоритель', from: 40000, cashback: 25,
      desc: 'Собрал свою коллекцию и чувствуешь запахи глубже, чем большинство. Мы начинаем говорить с тобой как с постоянным.',
      perks: [
        'Кэшбэк 25 % — четверть суммы возвращается баллами',
        'Все закрытые распродажи: тестовые партии и остатки',
        'Новые ароматы — до старта публичных продаж',
        'Подбор набора под задачу: просто напиши, что ищешь',
        'Всё, что было на предыдущих уровнях'
      ]
    },
    {
      key: 'vip', title: 'Легенда', from: 80000, cashback: 50,
      desc: 'Максимальный уровень. Дальше — не про баллы, а про доступ. Тебя видят в списке первым.',
      perks: [
        'Кэшбэк 50 % — половина суммы возвращается баллами',
        'Все уровни клуба без ограничений',
        'Новые коллекции — раньше всех, до публичного старта',
        'Закрытые тесты ароматов и ранние анонсы',
        'Личная связь с автором ароматов'
      ]
    }
  ];

  var state = {
    active: 0,
    ready: false,
    mounted: null,
    calcValue: 0
  };

  /* ---------- утилиты ---------- */
  function fmt(n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString('ru-RU').replace(/\u2009|\u00A0/g, ' ') + ' ₽';
  }
  function num(n) { return (Math.round(Number(n) || 0)).toLocaleString('ru-RU'); }

  /* подписи под ползунком ставим по их настоящим значениям, а не «поровну» */
  function paintScale() {
    var root = document.querySelector('.cx');
    if (!root) return;
    var range = root.querySelector('[data-cx-range]');
    var scale = root.querySelectorAll('.cx-scale span');
    if (!range || !scale.length) return;
    var max = Number(range.getAttribute('max')) || 120000;
    var marks = [0, LEVELS[1].from, LEVELS[2].from, LEVELS[3].from, max];
    scale.forEach(function (el, i) {
      if (marks[i] == null) return;
      el.textContent = fmt(marks[i]);
      el.style.left = Math.min(100, Math.max(0, marks[i] / max * 100)) + '%';
    });
  }
  function fromLabel(lv, i) { return lv.from > 0 ? 'от ' + fmt(lv.from) : (i === 0 ? 'с первого заказа' : 'без порога'); }
  function levelBySum(sum) {
    var idx = 0;
    LEVELS.forEach(function (l, i) { if (sum >= l.from) idx = i; });
    return idx;
  }
  function reduce() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /* ---------- отрисовка уровня ---------- */
  function paintLevel(i, animate) {
    var root = document.querySelector('.cx');
    if (!root) return;
    var lv = LEVELS[i];
    if (!lv) return;
    var panel = root.querySelector('[data-cx-panel]');
    var nodes = root.querySelectorAll('[data-cx-level]');
    var fill = root.querySelector('[data-cx-fill]');

    nodes.forEach(function (n, k) {
      n.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
    if (fill) fill.style.width = ((i + 0.5) / LEVELS.length * 100) + '%';

    function swap() {
      panel.setAttribute('data-lv', String(i));
      var badge = panel.querySelector('[data-cx-badge]');
      if (badge) badge.textContent = 'Уровень 0' + (i + 1) + ' · ' + fromLabel(lv, i);
      var title = panel.querySelector('[data-cx-title]');
      if (title) title.textContent = lv.title;
      var desc = panel.querySelector('[data-cx-desc]');
      if (desc) desc.textContent = lv.desc;
      var cb = panel.querySelector('[data-cx-cb]');
      if (cb) cb.textContent = lv.cashback + ' %';
      var from = panel.querySelector('[data-cx-from]');
      if (from) from.textContent = fromLabel(lv, i);
      var pts = panel.querySelector('[data-cx-points]');
      if (pts) pts.textContent = num(Math.round(5000 * lv.cashback / 100));

      var ul = panel.querySelector('[data-cx-perks]');
      if (ul) {
        ul.innerHTML = lv.perks.map(function (p, k) {
          return '<li style="--i:' + k + '">' + p + '</li>';
        }).join('');
      }
      /* перезапуск анимации «выезда» пунктов */
      var swapped = panel.querySelectorAll('.cx-swap');
      swapped.forEach(function (el) { el.style.animation = 'none'; });
      panel.classList.remove('is-out');
    }

    if (!animate || reduce()) { swap(); return; }
    panel.classList.add('is-out');
    setTimeout(swap, 210);
  }

  /* ---------- подписи на «дороге» уровней ---------- */
  function paintNodes() {
    var root = document.querySelector('.cx');
    if (!root) return;
    LEVELS.forEach(function (lv, i) {
      var n = root.querySelector('[data-cx-level="' + i + '"]');
      if (!n) return;
      var t = n.querySelector('.cx-node-t');
      var s = n.querySelector('.cx-node-s');
      var d = n.querySelector('.cx-dot');
      if (t) t.textContent = lv.title;
      if (s) s.textContent = fromLabel(lv, i);
      if (d) d.textContent = '0' + (i + 1);
    });
  }

  /* ---------- калькулятор ---------- */
  function paintCalc(value) {
    var root = document.querySelector('.cx');
    if (!root) return;
    var sum = Math.max(0, Number(value) || 0);
    state.calcValue = sum;
    var idx = levelBySum(sum);
    var lv = LEVELS[idx];
    var next = LEVELS[idx + 1] || null;

    var sumEl = root.querySelector('[data-cx-sum]');
    if (sumEl) sumEl.textContent = fmt(sum);

    var card = root.querySelector('[data-cx-calc-card]');
    if (card) card.setAttribute('data-lv', String(idx));

    var nameEl = root.querySelector('[data-cx-calc-level]');
    if (nameEl) nameEl.textContent = lv.title;
    var cbEl = root.querySelector('[data-cx-calc-cb]');
    if (cbEl) cbEl.textContent = lv.cashback;
    var ptsEl = root.querySelector('[data-cx-calc-points]');
    if (ptsEl) ptsEl.textContent = num(Math.round(sum * lv.cashback / 100));

    var nextEl = root.querySelector('[data-cx-calc-next]');
    if (nextEl) {
      nextEl.textContent = next
        ? 'До уровня «' + next.title + '» — ' + fmt(next.from - sum) + ' покупок. Кэшбэк вырастет до ' + next.cashback + ' %.'
        : 'Максимальный уровень. Дальше только доступ: всё новое — тебе первому.';
    }

    var bar = root.querySelector('[data-cx-calc-fill]');
    if (bar) {
      var pct = next ? Math.max(4, Math.min(100, (sum - lv.from) / (next.from - lv.from) * 100)) : 100;
      bar.style.width = pct + '%';
    }
  }

  /* ---------- аккордеон ---------- */
  function initFaq(root) {
    root.querySelectorAll('.cx-q > button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var q = btn.parentNode;
        var body = q.querySelector('.cx-a');
        var open = q.classList.contains('open');
        /* закрываем остальные — так страница не «разъезжается» */
        root.querySelectorAll('.cx-q.open').forEach(function (other) {
          if (other === q) return;
          other.classList.remove('open');
          var b = other.querySelector('.cx-a');
          if (b) b.style.maxHeight = '0px';
          var ob = other.querySelector('button');
          if (ob) ob.setAttribute('aria-expanded', 'false');
        });
        q.classList.toggle('open', !open);
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (body) body.style.maxHeight = open ? '0px' : (body.scrollHeight + 40) + 'px';
      });
    });
  }

  /* ---------- появление при прокрутке ---------- */
  function initReveal(root) {
    var items = root.querySelectorAll('.cx-rv');
    if (!('IntersectionObserver' in window) || reduce()) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (el, i) {
      el.style.transitionDelay = (i % 3) * 90 + 'ms';
      io.observe(el);
    });
  }

  /* ---------- прокрутка к блоку уровней ---------- */
  function initScroll(root) {
    root.querySelectorAll('[data-cx-scroll]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = document.getElementById(btn.getAttribute('data-cx-scroll'));
        if (!target) return;
        var top = target.getBoundingClientRect().top + window.scrollY - 70;
        window.scrollTo({ top: top, behavior: reduce() ? 'auto' : 'smooth' });
      });
    });
  }

  /* ---------- инициализация страницы ---------- */
  function init() {
    var root = document.querySelector('.cx');
    if (!root || !root.querySelector('[data-cx-panel]')) return;
    if (state.mounted === root) return;
    state.mounted = root;

    paintNodes();
    paintScale();
    paintLevel(state.active, false);
    var range = root.querySelector('[data-cx-range]');
    if (range) {
      range.addEventListener('input', function () { paintCalc(range.value); });
      paintCalc(range.value);
    }

    root.querySelectorAll('[data-cx-level]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = Number(btn.getAttribute('data-cx-level'));
        if (i === state.active) return;
        state.active = i;
        paintLevel(i, true);
      });
    });

    initFaq(root);
    initReveal(root);
    initScroll(root);

    /* дорога уровней заполняется, когда блок доехал до экрана */
    var fill = root.querySelector('[data-cx-fill]');
    if (fill) {
      fill.style.width = '0%';
      paintLevel(state.active, false);
    }
  }

  /* ---------- живые данные из Worker ---------- */
  function hydrate() {
    var api = (S.apiBase || '').replace(/\/+$/, '');
    if (!api || !window.fetch) return;
    fetch(api + '/club/program', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.levels) || !d.levels.length) return;
        d.levels.forEach(function (l, i) {
          var local = LEVELS[i];
          if (!local) return;
          if (l.title) local.title = l.title;
          if (l.from != null) local.from = Number(l.from) || 0;
          if (l.cashback != null) local.cashback = Number(l.cashback) || 0;
          if (l.key) local.key = l.key;
        });
        var maxi = Math.max(LEVELS[3].from * 1.5, LEVELS[3].from + 40000);
        var range = document.querySelector('[data-cx-range]');
        if (range) range.setAttribute('max', String(Math.round(maxi / 1000) * 1000));
        paintScale();
        paintNodes();
        paintLevel(state.active, false);
        var range2 = document.querySelector('[data-cx-range]');
        if (range2) paintCalc(range2.value);
      })
      .catch(function () { });
  }

  /* ---------- запуск: страница вставляется роутером, ловим это ---------- */
  function boot() {
    init();
    if (!state.ready) {
      state.ready = true;
      hydrate();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
  } else {
    setTimeout(boot, 0);
  }

  window.addEventListener('hashchange', function () { setTimeout(boot, 60); });

  var app = document.getElementById('page');
  if (app && 'MutationObserver' in window) {
    var mo = new MutationObserver(function () { setTimeout(boot, 0); });
    mo.observe(app, { childList: true, subtree: false });
  }

  /* на случай, если данные о клубе подъехали позже */
  document.addEventListener('rules:catalog-updated', function () { setTimeout(boot, 0); });
})();

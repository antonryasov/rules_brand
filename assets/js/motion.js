/* ============================================================
   RULES · анимации, меню, квиз, фильтры каталога
   ------------------------------------------------------------
   Здесь только «поведение» сайта. Тексты и товары — в data/.
   ============================================================ */
(function () {
  var S = window.RULES = window.RULES || {};
  var M = S.motion = {};

  var doc = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var io = null;

  /* ---------- заставка (один раз за сессию) ---------- */
  function intro() {
    var el = document.getElementById('intro');
    if (!el) return;
    function end() {
      el.classList.add('out');
      setTimeout(function () { el.classList.add('done'); }, 700);
    }
    var seen = false;
    try { seen = !!sessionStorage.getItem('rules-intro'); } catch (e) { }
    if (reduce || seen) { el.classList.add('done'); return; }
    try { sessionStorage.setItem('rules-intro', '1'); } catch (e) { }
    var count = el.querySelector('.count');
    var t0 = performance.now();
    (function tick(now) {
      var p = Math.min(1, (now - t0) / 650);
      if (count) count.textContent = String(Math.round(p * 100)).padStart(3, '0');
      if (p < 1) requestAnimationFrame(tick); else setTimeout(end, 150);
    })(t0);
    setTimeout(end, 1500);
  }

  /* ---------- шапка и меню ---------- */
  function chrome() {
    var header = document.querySelector('header.site');
    var burger = document.querySelector('.burger');
    if (burger) burger.addEventListener('click', function () { doc.classList.toggle('menu-open'); });
    document.querySelectorAll('.menu a').forEach(function (a) {
      a.addEventListener('click', function () { doc.classList.remove('menu-open'); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') doc.classList.remove('menu-open'); });
    window.addEventListener('scroll', function () {
      if (header) header.classList.toggle('small', (window.scrollY || 0) > 40);
    }, { passive: true });
  }

  /* ---------- магнитные кнопки ---------- */
  function magnets(root) {
    if (!fine || reduce) return;
    (root || document).querySelectorAll('.magnet:not([data-magnet])').forEach(function (el) {
      el.setAttribute('data-magnet', '1');
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
        el.style.transform = 'translate(' + x * 0.22 + 'px,' + y * 0.32 + 'px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }

  /* ---------- появление блоков при прокрутке ---------- */
  var SELECTOR = [
    '.kicker', '.h-xl', '.h-l', '.lead', '.index-head > *', '.index-row', '.card', '.set', '.step',
    '.num-row', '.feature > *', '.craft > *', '.panel', '.big-quote', '.hs .head', '.result > *',
    '.quiz-stage .kicker', '.pdp-body > *', '.specs > *', '.safety', '.cta-band > *', 'footer .cols > *',
    '.rv', '.pdp-shot', '.shop-card'
  ].join(',');

  function reveal(root) {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });

    (root || document).querySelectorAll(SELECTOR).forEach(function (el) {
      if (el.closest('#shop-overlay') || el.closest('header.site') || el.closest('.menu')) return;
      el.classList.add('rv');
      var group = Array.prototype.indexOf.call(el.parentNode.children, el) % 4;
      el.style.setProperty('--d', (group * 0.09) + 's');
    });
    document.querySelectorAll('.img-clip, .craft .stick .frame').forEach(function (el) { el.classList.add('rv-clip'); });
    document.querySelectorAll('.card .ph img, .feature .img img, .set .ph img, .hcard .ph img').forEach(function (img) {
      if (img.parentNode) img.parentNode.classList.add('rv-scale-wrap');
    });
    document.querySelectorAll('.rv, .rv-clip').forEach(function (el) {
      if (el.classList.contains('in')) return;
      io.observe(el);
    });
  }

  /* ---------- манифест: подсветка слов при прокрутке ---------- */
  function splitManifesto() {
    var el = document.querySelector('.manifesto p');
    if (!el || el.dataset.split) return;
    el.dataset.split = '1';
    var html = el.innerHTML.replace(/<em>/g, '<em data-it="1">');
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var out = [];
    (function walk(node, italic) {
      Array.prototype.forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) {
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { out.push(document.createTextNode(part)); return; }
            var s = document.createElement('span');
            s.className = 'w' + (italic ? ' it' : '');
            s.textContent = part;
            out.push(s);
          });
        } else if (n.nodeType === 1) {
          walk(n, italic || n.tagName === 'EM');
        }
      });
    })(tmp, false);
    el.innerHTML = '';
    out.forEach(function (n) { el.appendChild(n); });
  }

  /* ---------- горизонтальная лента ---------- */
  var hsState = {};
  function scrollScene() {
    var hs = document.querySelector('.hs');
    if (!hs) { hsState = {}; return; }
    hsState.hs = hs;
    hsState.track = hs.querySelector('.track');
    hsState.progress = hs.querySelector('.progress i');
  }

  function onScroll() {
    var y = window.scrollY || 0;
    var heroWord = document.querySelector('.hero-word');
    if (heroWord) {
      var shift = Math.min(y * 0.25, 260);
      heroWord.style.backgroundPosition = 'calc(50% + ' + (shift * 0.2) + 'px) ' + (42 + y * 0.02) + '%';
    }
    var manifesto = document.querySelector('.manifesto p');
    if (manifesto && manifesto.querySelector('.w')) {
      var words = manifesto.querySelectorAll('.w');
      var r = manifesto.getBoundingClientRect();
      var vh = window.innerHeight;
      var p = (vh * 0.85 - r.top) / (r.height + vh * 0.5);
      p = Math.max(0, Math.min(1, p));
      for (var i = 0; i < words.length; i++) {
        words[i].classList.toggle('lit', p >= i / words.length);
      }
    }
    if (hsState.hs && hsState.track && !window.matchMedia('(max-width: 900px)').matches) {
      var rect = hsState.hs.getBoundingClientRect();
      var total = hsState.hs.offsetHeight - window.innerHeight;
      var pr = Math.max(0, Math.min(1, -rect.top / (total || 1)));
      var maxX = hsState.track.scrollWidth - window.innerWidth;
      hsState.track.style.transform = 'translate3d(' + (-pr * Math.max(0, maxX)) + 'px,0,0)';
      if (hsState.progress) hsState.progress.style.transform = 'scaleX(' + pr + ')';
    }
  }

  /* ---------- превью аромата за курсором ---------- */
  function preview() {
    var el = document.querySelector('.preview');
    if (!el || !fine || reduce) return;
    if (el.dataset.ready) return;
    el.dataset.ready = '1';
    var img = el.querySelector('img');
    var px = 0, py = 0, tx = 0, ty = 0, rot = 0;
    document.addEventListener('pointermove', function (e) { tx = e.clientX; ty = e.clientY; });
    (function loop() {
      var dx = tx - px, dy = ty - py;
      px += dx * 0.18; py += dy * 0.18;
      rot += ((dx * 0.12) - rot) * 0.1;
      el.style.left = px + 'px';
      el.style.top = py + 'px';
      el.style.setProperty('--r', Math.max(-8, Math.min(8, rot)) + 'deg');
      requestAnimationFrame(loop);
    })();
    el.show = function (id) {
      var src = document.querySelector('img[data-k="' + id + '"]');
      if (src) img.src = src.src;
      el.classList.add('on');
    };
    el.hide = function () { el.classList.remove('on'); };
  }

  function hoverRows(root) {
    var el = document.querySelector('.preview');
    (root || document).querySelectorAll('.index-row[data-k]').forEach(function (row) {
      if (row.dataset.hover) return;
      row.dataset.hover = '1';
      row.addEventListener('pointerenter', function () { if (el && el.show) el.show(row.getAttribute('data-k')); });
      row.addEventListener('pointerleave', function () { if (el && el.hide) el.hide(); });
    });
  }

  /* ---------- фильтры каталога ---------- */
  function filters() {
    document.querySelectorAll('.chip').forEach(function (chip) {
      if (chip.dataset.bound) return;
      chip.dataset.bound = '1';
      chip.addEventListener('click', function () {
        document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
        var f = chip.getAttribute('data-f');
        document.querySelectorAll('.cat-item').forEach(function (item) {
          var cats = item.getAttribute('data-cat') || '';
          item.classList.toggle('hide', !(f === 'all' || cats.indexOf(f) !== -1));
        });
      });
    });
  }

  /* ---------- квиз ---------- */
  function quiz() {
    var box = document.getElementById('quiz');
    if (!box || !S.quiz || !S.quiz.questions || !S.quiz.questions.length) return;
    var Q = S.quiz.questions, RES = S.quiz.results || {};
    var step = 0, score = {};
    Object.keys(RES).forEach(function (k) { score[k] = 0; });

    function render() {
      if (step >= Q.length) return finish();
      var q = Q[step];
      box.innerHTML =
        '<div class="quiz-box"><div class="kicker">Вопрос <b>' + String(step + 1).padStart(2, '0') +
        '</b> из ' + String(Q.length).padStart(2, '0') + '</div>' +
        '<h2 class="quiz-q">' + q.q + '</h2><div class="quiz-opts">' +
        q.o.map(function (o, i) {
          return '<button class="quiz-opt magnet" data-i="' + i + '"><span>' + String(i + 1).padStart(2, '0') + '</span>' + o.t + '</button>';
        }).join('') +
        '</div><div class="quiz-bar"><i style="width:' + (step / Q.length * 100) + '%"></i></div>' +
        '<div class="quiz-meta"><span>Какой ты запах</span><span>' + Math.round(step / Q.length * 100) + '%</span></div></div>';
      box.querySelectorAll('.quiz-opt').forEach(function (b) {
        b.addEventListener('click', function () {
          var o = Q[step].o[+b.getAttribute('data-i')];
          Object.keys(o.s).forEach(function (k) { score[k] = (score[k] || 0) + o.s[k]; });
          step++;
          render();
        });
      });
      magnets(box);
    }

    function finish() {
      var top = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; })
        .slice(0, 2).filter(function (k) { return score[k] > 0; });
      if (!top.length) top = Object.keys(RES).slice(0, 1);
      box.innerHTML =
        '<div class="quiz-box"><div class="kicker">Твой результат</div>' +
        '<h2 class="quiz-q">Тебе <i>подойдёт</i></h2><div class="result">' +
        top.map(function (k) {
          var r = RES[k] || {};
          var prod = S.products.filter(function (p) { return p.page === r.link; })[0];
          var src = prod ? prod.images.card : '';
          return '<a class="card" href="' + (r.link || 'catalog.html') + '"><div class="ph">' +
            '<img loading="lazy" decoding="async" src="' + src + '" alt=""></div>' +
            '<div class="tx"><h3>' + (r.n || '') + '</h3><div class="meta">' + (r.d || '') + '</div></div></a>';
        }).join('') +
        '</div><p class="note">Квиз — подсказка, а не приговор. Попробуй оба и выбери сам.</p>' +
        '<div style="margin-top:40px;display:flex;gap:16px;flex-wrap:wrap">' +
        '<button class="btn" id="again">Пройти заново <span class="arr">↺</span></button>' +
        '<a class="btn solid" href="catalog.html">Весь каталог</a></div></div>';
      var again = document.getElementById('again');
      if (again) again.addEventListener('click', function () {
        step = 0;
        Object.keys(score).forEach(function (k) { score[k] = 0; });
        render();
      });
    }
    render();
  }

  /* ---------- пересборка после смены страницы ---------- */
  M.scan = function () {
    splitManifesto();
    reveal(document.getElementById('app') || document);
    scrollScene();
    onScroll();
    filters();
    hoverRows(document);
    quiz();
    magnets(document);
  };

  M.init = function () {
    doc.classList.add('js');
    intro();
    chrome();
    preview();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  };
})();

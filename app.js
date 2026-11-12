/* ICY UI. Plain JS, no dependencies. */
(function () {
  'use strict';

  var Deck = window.ICYDeck;
  var QUESTIONS = Array.isArray(window.ICY_QUESTIONS) ? window.ICY_QUESTIONS : [];
  var $ = function (id) { return document.getElementById(id); };

  // ---------- storage (always guarded) ----------
  var K = { names: 'icy.names', seen: 'icy.seen', skips: 'icy.skips', sessions: 'icy.sessions',
            finished: 'icy.finished', ratings: 'icy.ratings', shown: 'icy.shown', length: 'icy.length' };
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }
  var mem = { // in-memory copy so the app works without storage
    seen: load(K.seen, []), skips: load(K.skips, {}), sessions: load(K.sessions, 0), finished: load(K.finished, 0),
    ratings: load(K.ratings, { meh: 0, good: 0, loved: 0 }), shown: load(K.shown, 0)
  };
  if (!Array.isArray(mem.seen)) mem.seen = [];
  var seenSet = {};
  mem.seen.forEach(function (id) { seenSet[id] = true; });

  // ---------- state ----------
  var names = load(K.names, ['', '']);
  if (!Array.isArray(names)) names = ['', ''];
  var length = parseInt(load(K.length, 24), 10);
  if ([12, 24, 36].indexOf(length) < 0) length = 24;
  var S = null;          // current session
  var wakeLock = null;
  var interCallback = null;

  var SCREENS = ['home', 'play', 'inter', 'end', 'stats'];
  function show(name) {
    SCREENS.forEach(function (s) { $(s).hidden = s !== name; });
    if (name !== 'play') { document.body.classList.remove('is-fun'); $('play').classList.remove('is-fun'); }
    if (name === 'home' || name === 'stats' || name === 'end') setWarmth(0);
  }

  // ---------- warmth ----------
  var COLD = { a: [223, 243, 255], b: [143, 211, 255], t: '#dff3ff' };
  var WARM = { a: [255, 230, 214], b: [255, 158, 134], t: '#ffe6d6' };
  function mix(c1, c2, t) {
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(c1[i] + (c2[i] - c1[i]) * t); }).join(',') + ')';
  }
  function setWarmth(w) {
    w = Math.max(0, Math.min(1, w));
    var r = document.documentElement.style;
    r.setProperty('--warmth', w.toFixed(3));
    r.setProperty('--bg1', mix(COLD.a, WARM.a, w));
    r.setProperty('--bg2', mix(COLD.b, WARM.b, w));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mix(COLD.a, WARM.a, w));
  }

  // ---------- utils ----------
  function playerName(i) {
    var n = (names[i] || '').trim();
    return n || (i === 0 ? 'Player 1' : 'Player 2');
  }
  function persistSeen(id) {
    if (seenSet[id]) return;
    seenSet[id] = true;
    mem.seen.push(id);
    save(K.seen, mem.seen);
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  var FORMAT_TAG = { wyr: 'Would you rather', pick: 'This or that', silly: 'Just for fun', dare: 'Mini dare' };
  var STAGE_NAME = ['', 'Breaking the ice', 'The ice is cracking', 'Melting'];
  var STAGE_SUB = ['', '', 'Getting a little more personal.', 'The deeper ones. Take your time.'];

  // ---------- wake lock ----------
  function acquireWake() {
    try {
      if (!S || !('wakeLock' in navigator) || wakeLock) return;
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { wakeLock = null; });
    } catch (e) { /* unsupported */ }
  }
  function releaseWake() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S && !S.over) acquireWake();
  });

  // ---------- home ----------
  function renderChips() {
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
      c.setAttribute('aria-checked', String(parseInt(c.dataset.len, 10) === length));
    });
  }
  function goHome() {
    S = null; releaseWake();
    $('name1').value = names[0] || '';
    $('name2').value = names[1] || '';
    renderChips();
    $('homeMsg').textContent = QUESTIONS.length ? '' : 'Question cards could not be loaded.';
    show('home');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.addEventListener('click', function () {
      length = parseInt(c.dataset.len, 10);
      save(K.length, length);
      renderChips();
    });
  });
  $('name1').addEventListener('input', function () { names[0] = this.value; save(K.names, names); });
  $('name2').addEventListener('input', function () { names[1] = this.value; save(K.names, names); });

  // Hidden stats: 5 taps on the wordmark
  var taps = 0, tapTimer = null;
  $('wordmark').addEventListener('click', function () {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function () { taps = 0; }, 2500);
    if (taps >= 5) { taps = 0; openStats(); }
  });

  $('start').addEventListener('click', function () {
    names[0] = $('name1').value; names[1] = $('name2').value; save(K.names, names);
    startSession();
  });

  // ---------- session ----------
  function startSession() {
    if (!QUESTIONS.length || !Deck) { $('homeMsg').textContent = 'Question cards could not be loaded.'; return; }
    var deck = Deck.buildDeck(QUESTIONS, { length: length, seenIds: mem.seen });
    if (!deck.length) { $('homeMsg').textContent = 'Not enough questions to start.'; return; }
    S = { deck: deck, idx: 0, stage: 0, startPlayer: Math.random() < 0.5 ? 0 : 1, over: false, rated: null, done: 0 };
    mem.sessions += 1; save(K.sessions, mem.sessions);
    acquireWake();
    showCard(0);
  }

  function knowIndex(idx) { // how many know cards come before idx
    var n = 0;
    for (var i = 0; i < idx; i++) if (S.deck[i].type === 'know') n++;
    return n;
  }
  function stageOf(idx) { // stage for any card: the level of the latest know card up to idx
    for (var i = idx; i >= 0; i--) if (S.deck[i].type === 'know') return S.deck[i].level;
    for (var j = idx; j < S.deck.length; j++) if (S.deck[j].type === 'know') return S.deck[j].level;
    return 1;
  }

  function showCard(idx) {
    S.idx = idx;
    var q = S.deck[idx];
    var stage = stageOf(idx);
    if (q.type === 'know' && q.level > S.stage && q.level >= 2) {
      S.stage = q.level;
      showInter(q.level, function () { renderCard(); });
      return;
    }
    if (S.stage < stage) S.stage = stage;
    renderCard();
  }

  function showInter(level, cb) {
    setWarmth(S.idx / Math.max(1, S.deck.length - 1));
    $('interTitle').textContent = 'Stage ' + level + ': ' + STAGE_NAME[level];
    $('interSub').textContent = STAGE_SUB[level];
    interCallback = cb;
    show('inter');
    var c = $('interCard'); c.classList.remove('enter'); void c.offsetWidth; c.classList.add('enter');
    c.focus({ preventScroll: true });
  }
  $('interCard').addEventListener('click', function () {
    var cb = interCallback; interCallback = null;
    if (cb) cb();
  });

  function renderCard() {
    var q = S.deck[S.idx];
    var fun = q.type === 'fun';
    persistSeen(q.id);
    mem.shown += 1; save(K.shown, mem.shown);

    show('play');
    $('play').classList.toggle('is-fun', fun);
    document.body.classList.toggle('is-fun', fun);
    setWarmth(S.idx / Math.max(1, S.deck.length - 1));

    var total = S.deck.length;
    $('count').textContent = (S.idx + 1) + ' / ' + total;
    $('bar').style.width = (((S.idx + 1) / total) * 100) + '%';
    var stage = stageOf(S.idx);
    $('stage').textContent = fun ? 'Just for fun' : 'Stage ' + stage + ' · ' + STAGE_NAME[stage];
    if (fun) {
      $('who').textContent = 'Both answer!';
    } else {
      $('who').textContent = playerName((S.startPlayer + knowIndex(S.idx)) % 2) + ' answers first';
    }

    var tag = $('tag');
    if (fun) { tag.textContent = FORMAT_TAG[q.format] || 'Just for fun'; tag.hidden = false; } else { tag.hidden = true; }
    var qe = $('question');
    qe.textContent = q.text;
    var n = q.text.length;
    qe.setAttribute('data-len', n > 140 ? 'xlong' : n > 90 ? 'long' : 'normal');
    $('hint').hidden = fun;
    $('next').textContent = S.idx + 1 >= total ? 'Finish' : 'Next';

    var card = $('card');
    card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
  }

  $('next').addEventListener('click', function () {
    if (!S) return;
    S.done = Math.max(S.done, S.idx + 1);
    if (S.idx + 1 >= S.deck.length) return endSession(true);
    showCard(S.idx + 1);
  });

  $('skip').addEventListener('click', function () {
    if (!S) return;
    var q = S.deck[S.idx];
    mem.skips[q.id] = (mem.skips[q.id] || 0) + 1;
    save(K.skips, mem.skips);
    var avoid = [];
    if (q.type === 'fun') {
      [S.idx - 3, S.idx + 3].forEach(function (i) {
        var o = S.deck[i]; if (o && o.type === 'fun') avoid.push(o.format);
      });
      avoid.push(q.format);
    }
    var r = Deck.pickReplacement(QUESTIONS, q, {
      deckIds: S.deck.map(function (c) { return c.id; }), seenIds: mem.seen, avoidFormats: avoid
    });
    if (!r) { toast('No other card to swap in. Tap Next.'); return; }
    S.deck[S.idx] = r;
    renderCard();
  });

  $('quit').addEventListener('click', function () {
    if (!S) return;
    if (window.confirm('End this session?')) endSession(false);
  });

  function endSession(finished) {
    S.over = true;
    releaseWake();
    var count = finished ? S.deck.length : S.done;
    if (finished) { mem.finished += 1; save(K.finished, mem.finished); }
    if (count === 0 && !finished) { goHome(); return; }
    S.count = count;
    $('endCount').textContent = 'You went through ' + count + ' question' + (count === 1 ? '' : 's') + '.';
    $('thanks').textContent = '';
    Array.prototype.forEach.call(document.querySelectorAll('.rate-btn'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    show('end');
  }

  Array.prototype.forEach.call(document.querySelectorAll('.rate-btn'), function (b) {
    b.addEventListener('click', function () {
      if (!S) return;
      var r = b.dataset.rate;
      if (S.rated && mem.ratings[S.rated] > 0) mem.ratings[S.rated] -= 1;
      mem.ratings[r] = (mem.ratings[r] || 0) + 1;
      S.rated = r;
      save(K.ratings, mem.ratings);
      Array.prototype.forEach.call(document.querySelectorAll('.rate-btn'), function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      $('thanks').textContent = 'Thanks!';
    });
  });
  $('again').addEventListener('click', startSession);
  $('toHome').addEventListener('click', goHome);

  // ---------- stats ----------
  function byId(id) {
    for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].id === id) return QUESTIONS[i];
    return null;
  }
  function openStats() {
    var body = $('statsBody');
    body.textContent = '';
    var dl = document.createElement('dl');
    function row(k, v) {
      var dt = document.createElement('dt'); dt.textContent = k;
      var dd = document.createElement('dd'); dd.textContent = String(v);
      dl.appendChild(dt); dl.appendChild(dd);
    }
    var r = mem.ratings;
    row('Sessions played', mem.sessions);
    row('Sessions finished', mem.finished);
    row('Rating: meh', r.meh || 0);
    row('Rating: good', r.good || 0);
    row('Rating: loved it', r.loved || 0);
    row('Cards shown (total)', mem.shown);
    row('Unique cards seen', mem.seen.length + ' / ' + QUESTIONS.length);
    body.appendChild(dl);

    var h = document.createElement('h3'); h.textContent = 'Most skipped (top 10)'; body.appendChild(h);
    var list = Object.keys(mem.skips).map(function (id) { return { id: id, n: mem.skips[id] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
    if (!list.length) {
      var p = document.createElement('p'); p.textContent = 'No skips yet.'; body.appendChild(p);
    } else {
      var ol = document.createElement('ol');
      list.forEach(function (it) {
        var li = document.createElement('li');
        var q = byId(it.id);
        var b = document.createElement('b'); b.textContent = it.n + 'x ';
        li.appendChild(b);
        li.appendChild(document.createTextNode(q ? q.text : it.id));
        ol.appendChild(li);
      });
      body.appendChild(ol);
    }
    show('stats');
  }
  $('statsBack').addEventListener('click', goHome);
  $('reset').addEventListener('click', function () {
    if (!window.confirm('Reset all ICY data on this phone (names, seen cards, skips, ratings)?')) return;
    try { Object.keys(K).forEach(function (k) { localStorage.removeItem(K[k]); }); } catch (e) { /* ignore */ }
    mem = { seen: [], skips: {}, sessions: 0, finished: 0, ratings: { meh: 0, good: 0, loved: 0 }, shown: 0 };
    seenSet = {}; names = ['', '']; length = 24;
    goHome();
  });

  // ---------- service worker ----------
  try {
    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secure) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline support optional */ });
      });
    }
  } catch (e) { /* ignore */ }

  goHome();
})();

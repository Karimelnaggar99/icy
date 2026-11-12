/* ICY deck logic. Pure, no DOM. Browser: window.ICYDeck. Node: require. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ICYDeck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SPLITS = { 12: [4, 3, 1], 24: [6, 6, 4], 36: [8, 9, 7] };

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function toSet(ids) {
    var s = {};
    (ids || []).forEach(function (id) { s[id] = true; });
    return s;
  }
  // Unseen (shuffled) first, then seen (shuffled).
  function ordered(pool, seen, rng) {
    var unseen = pool.filter(function (q) { return !seen[q.id]; });
    var old = pool.filter(function (q) { return seen[q.id]; });
    return shuffle(unseen, rng).concat(shuffle(old, rng));
  }
  function splitFor(length) {
    if (SPLITS[length]) return SPLITS[length].slice();
    var know = length - Math.floor(length / 3);
    var l1 = Math.round(know * 0.33), l3 = Math.round(know * 0.25);
    return [l1, know - l1 - l3, l3];
  }

  function buildDeck(questions, opts) {
    opts = opts || {};
    var length = opts.length || 24;
    var rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    var seen = toSet(opts.seenIds);
    questions = (questions || []).filter(function (q) { return q && q.id; });

    var used = {};
    var split = splitFor(length);
    var funCount = Math.floor(length / 3);

    // ---- know cards ----
    var byLevel = { 1: [], 2: [], 3: [] };
    questions.forEach(function (q) { if (q.type === 'know' && byLevel[q.level]) byLevel[q.level].push(q); });
    var cands = {
      1: ordered(byLevel[1], seen, rng),
      2: ordered(byLevel[2], seen, rng),
      3: ordered(byLevel[3], seen, rng)
    };
    var knowCards = [];
    function takeFrom(level) {
      var c = cands[level];
      while (c.length) {
        var q = c.shift();
        if (!used[q.id]) { used[q.id] = true; return q; }
      }
      return null;
    }
    [1, 2, 3].forEach(function (lvl) {
      for (var n = 0; n < split[lvl - 1]; n++) {
        var q = takeFrom(lvl);
        if (!q) {
          var order = [1, 2, 3].filter(function (x) { return x !== lvl; })
            .sort(function (a, b) { return Math.abs(a - lvl) - Math.abs(b - lvl); });
          for (var k = 0; k < order.length && !q; k++) q = takeFrom(order[k]);
        }
        if (q) knowCards.push(q);
      }
    });
    knowCards.sort(function (a, b) { return a.level - b.level; });

    // ---- fun cards ----
    var formats = {};
    questions.forEach(function (q) { if (q.type === 'fun') (formats[q.format] = formats[q.format] || []).push(q); });
    Object.keys(formats).forEach(function (f) { formats[f] = ordered(formats[f], seen, rng); });
    function avail(f) {
      var c = formats[f];
      while (c.length && used[c[0].id]) c.shift();
      return c.length;
    }
    var funCards = [], prevFormat = null;
    for (var i = 0; i < funCount; i++) {
      var all = Object.keys(formats).filter(avail);
      if (!all.length) break;
      var first = i === 0;
      var ok = all.filter(function (f) { return f !== prevFormat && !(first && f === 'dare'); });
      if (!ok.length) ok = all.filter(function (f) { return !(first && f === 'dare'); });
      if (!ok.length) ok = all;
      var fresh = ok.filter(function (f) { return !seen[formats[f][0].id]; });
      if (fresh.length) ok = fresh;
      var weights = ok.map(function (f) { return formats[f].length; });
      var total = weights.reduce(function (a, b) { return a + b; }, 0);
      var r = rng() * total, pick = ok[ok.length - 1];
      for (var w = 0; w < ok.length; w++) { r -= weights[w]; if (r < 0) { pick = ok[w]; break; } }
      var card = formats[pick].shift();
      used[card.id] = true;
      funCards.push(card);
      prevFormat = pick;
    }

    // ---- interleave: positions 3, 6, 9 ... are fun ----
    var deck = [], ki = 0, fi = 0;
    for (var p = 1; p <= length; p++) {
      if (p % 3 === 0) {
        if (fi < funCards.length) deck.push(funCards[fi++]);
        else if (ki < knowCards.length) deck.push(knowCards[ki++]);
      } else {
        if (ki < knowCards.length) deck.push(knowCards[ki++]);
        else if (fi < funCards.length) deck.push(funCards[fi++]);
      }
    }
    return deck;
  }

  // Replacement for a skipped card: same type and level, not already in the deck.
  // opts: { deckIds, seenIds, avoidFormats, rng }. Returns a question or null.
  function pickReplacement(questions, card, opts) {
    opts = opts || {};
    var rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    var inDeck = toSet(opts.deckIds);
    var seen = toSet(opts.seenIds);
    var avoid = toSet(opts.avoidFormats);
    var pool = (questions || []).filter(function (q) {
      return q.type === card.type && q.level === card.level && !inDeck[q.id] && q.id !== card.id;
    });
    if (!pool.length) return null;
    var unseen = pool.filter(function (q) { return !seen[q.id]; });
    var list = unseen.length ? unseen : pool;
    var good = list.filter(function (q) { return !avoid[q.format]; });
    var use = good.length ? good : list;
    return use[Math.floor(rng() * use.length)];
  }

  return { buildDeck: buildDeck, pickReplacement: pickReplacement, splitFor: splitFor, SPLITS: SPLITS };
});

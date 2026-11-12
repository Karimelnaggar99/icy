const test = require('node:test');
const assert = require('node:assert');
const { buildDeck, pickReplacement } = require('../app/deck.js');

function fixture(k1 = 20, k2 = 20, k3 = 20, perFormat = 10) {
  const q = [];
  [[1, k1], [2, k2], [3, k3]].forEach(([lvl, n]) => {
    for (let i = 0; i < n; i++) q.push({ id: `k${lvl}-${i}`, type: 'know', level: lvl, format: 'open', text: 't' });
  });
  ['wyr', 'pick', 'silly', 'dare'].forEach((f) => {
    for (let i = 0; i < perFormat; i++) q.push({ id: `${f}-${i}`, type: 'fun', level: 0, format: f, text: 't' });
  });
  return q;
}
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const SPLIT = { 12: [4, 3, 1], 24: [6, 6, 4], 36: [8, 9, 7] };

for (const len of [12, 24, 36]) {
  test(`length ${len}: size, fun every third, level split`, () => {
    const deck = buildDeck(fixture(), { length: len, rng: seeded(len) });
    assert.strictEqual(deck.length, len);
    deck.forEach((c, i) => assert.strictEqual(c.type, (i + 1) % 3 === 0 ? 'fun' : 'know'));
    const know = deck.filter((c) => c.type === 'know');
    assert.strictEqual(know.length, len * 2 / 3);
    assert.strictEqual(deck.filter((c) => c.type === 'fun').length, len / 3);
    const counts = [1, 2, 3].map((l) => know.filter((c) => c.level === l).length);
    assert.deepStrictEqual(counts, SPLIT[len]);
    for (let i = 1; i < know.length; i++) assert.ok(know[i].level >= know[i - 1].level);
  });
}

test('no duplicates, fun formats never repeat in a row, no dare first', () => {
  for (let s = 1; s <= 50; s++) {
    const deck = buildDeck(fixture(), { length: 36, rng: seeded(s) });
    assert.strictEqual(new Set(deck.map((c) => c.id)).size, deck.length);
    const fun = deck.filter((c) => c.type === 'fun');
    assert.notStrictEqual(fun[0].format, 'dare');
    for (let i = 1; i < fun.length; i++) assert.notStrictEqual(fun[i].format, fun[i - 1].format);
  }
});

test('unseen ids are preferred', () => {
  const qs = fixture();
  const first = buildDeck(qs, { length: 24, rng: seeded(3) });
  const seenIds = first.map((c) => c.id);
  const second = buildDeck(qs, { length: 24, seenIds, rng: seeded(4) });
  second.forEach((c) => assert.ok(!seenIds.includes(c.id), c.id + ' was seen'));
});

test('exhaustion falls back to seen cards without duplicates or crash', () => {
  const qs = fixture(8, 8, 8, 5);
  const seenIds = qs.map((q) => q.id);
  const deck = buildDeck(qs, { length: 24, seenIds, rng: seeded(9) });
  assert.strictEqual(deck.length, 24);
  assert.strictEqual(new Set(deck.map((c) => c.id)).size, 24);
});

test('partially exhausted pool uses unseen first then seen', () => {
  const qs = fixture(20, 20, 20, 10);
  const seenIds = qs.filter((q) => q.level === 1).slice(0, 18).map((q) => q.id);
  const deck = buildDeck(qs, { length: 24, seenIds, rng: seeded(5) });
  const l1 = deck.filter((c) => c.level === 1);
  assert.strictEqual(l1.length, 6);
  assert.strictEqual(l1.filter((c) => !seenIds.includes(c.id)).length, 2);
});

test('replacement keeps type and level and is not in deck', () => {
  const qs = fixture();
  const deck = buildDeck(qs, { length: 24, rng: seeded(11) });
  const deckIds = deck.map((c) => c.id);
  for (const card of deck) {
    const r = pickReplacement(qs, card, { deckIds, seenIds: deckIds, rng: seeded(2) });
    assert.ok(r);
    assert.strictEqual(r.type, card.type);
    assert.strictEqual(r.level, card.level);
    assert.ok(!deckIds.includes(r.id));
  }
});

test('replacement prefers unseen, avoids formats; null when none left', () => {
  const qs = fixture(3, 3, 3, 3);
  const card = qs.find((q) => q.id === 'wyr-0');
  const r = pickReplacement(qs, card, { deckIds: ['wyr-0'], seenIds: ['wyr-1'], avoidFormats: ['wyr'], rng: seeded(1) });
  assert.ok(r && r.type === 'fun');
  const only = [{ id: 'a', type: 'know', level: 1, format: 'open', text: 'x' }];
  assert.strictEqual(pickReplacement(only, only[0], { deckIds: ['a'] }), null);
});

test('tiny question bank does not crash', () => {
  assert.deepStrictEqual(buildDeck([], { length: 24 }), []);
  const tiny = [
    { id: 'a', type: 'know', level: 1, format: 'open', text: 'x' },
    { id: 'b', type: 'know', level: 3, format: 'open', text: 'x' },
    { id: 'c', type: 'fun', level: 0, format: 'dare', text: 'x' }
  ];
  const deck = buildDeck(tiny, { length: 12 });
  assert.ok(deck.length <= 3);
  assert.strictEqual(new Set(deck.map((c) => c.id)).size, deck.length);
  assert.doesNotThrow(() => buildDeck(tiny));
  assert.doesNotThrow(() => buildDeck(undefined, {}));
});

test('real question bank (if present) builds all three lengths', () => {
  const fs = require('fs');
  const p = require('path').join(__dirname, '../app/questions.js');
  if (!fs.existsSync(p)) return;
  const win = {};
  new Function('window', fs.readFileSync(p, 'utf8'))(win);
  const qs = win.ICY_QUESTIONS;
  for (const len of [12, 24, 36]) {
    const deck = buildDeck(qs, { length: len });
    assert.strictEqual(deck.length, len);
    assert.strictEqual(new Set(deck.map((c) => c.id)).size, len);
  }
});

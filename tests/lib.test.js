const test = require('node:test');
const assert = require('node:assert/strict');
const DATA = require('../src/rooms.js');
const LIB = require('../src/lib.js');

test('対象は8施設・11部屋で、IDとコードが一意', () => {
  assert.equal(DATA.ROOM_LIST.length, 11);
  assert.equal(new Set(DATA.ROOM_LIST.map((r) => r.id)).size, 11);
  assert.equal(new Set(DATA.ROOM_LIST.map((r) => `${r.facilityCode}/${r.objectCode}`)).size, 11);
  const facs = new Set(DATA.ROOM_LIST.map((r) => r.facilityCode));
  assert.equal(facs.size, 8);
  for (const c of facs) assert.ok(DATA.FACILITIES[c], `facility ${c}`);
});

test('茗台A/B・江戸川橋A/B/Cは別々の部屋として定義されている', () => {
  const names = (fac) => DATA.ROOM_LIST.filter((r) => r.facilityCode === fac).map((r) => LIB.normalizeName(r.officialName));
  assert.deepEqual(names('38'), ['レクリエーションホールA', 'レクリエーションホールB']);
  assert.deepEqual(names('25'), ['地域活動室A', '地域活動室B', '地域活動室C']);
});

test('normalizeName: 全角英数・空白・説明文を吸収する', () => {
  assert.equal(LIB.normalizeName('  研修室Ａ ≪《机利用時の定員96人》≫'), '研修室A');
  assert.equal(LIB.normalizeName('４階ホール'), LIB.normalizeName('4階ホール'));
  assert.notEqual(LIB.normalizeName('多目的室'), LIB.normalizeName('スポーツ多目的室'));
});

test('todayJST: 端末TZに関係なく日本時間の日付', () => {
  // 2026-11-05 15:30 UTC = 2026-11-06 00:30 JST
  assert.equal(LIB.todayJST(new Date('2026-11-05T15:30:00Z')), '2026-11-06');
  assert.equal(LIB.todayJST(new Date('2026-11-05T14:59:59Z')), '2026-11-05');
});

test('isValidDateString', () => {
  assert.ok(LIB.isValidDateString('2026-11-06'));
  assert.ok(!LIB.isValidDateString('2026-02-30'));
  assert.ok(!LIB.isValidDateString('2026/11/06'));
  assert.ok(!LIB.isValidDateString(''));
});

test('validateRequest: 未選択・上限超過・不明IDを拒否し、並びをチェックリスト順にそろえる', () => {
  assert.ok(!LIB.validateRequest({ date: '2026-11-06', roomIds: [] }, DATA).ok);
  const all = DATA.ROOM_LIST.map((r) => r.id);
  const over = LIB.validateRequest({ date: '2026-11-06', roomIds: all }, DATA);
  assert.ok(!over.ok);
  assert.match(over.errors.join(), /10部屋まで/);
  assert.ok(!LIB.validateRequest({ date: '2026-11-06', roomIds: ['nope'] }, DATA).ok);
  const ok = LIB.validateRequest({ date: '2026-11-06', roomIds: ['otowa-mp', 'civic-4f-hall', 'otowa-mp'] }, DATA);
  assert.ok(ok.ok);
  assert.deepEqual(ok.roomIds, ['civic-4f-hall', 'otowa-mp']);
});

test('facilityCodesFor: 選択部屋の施設だけを重複なく返す', () => {
  assert.deepEqual(LIB.facilityCodesFor(['edogawabashi-a', 'edogawabashi-c', 'danjo-kenshu-a'], DATA), ['25', '5']);
});

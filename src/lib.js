/* 画面に依存しない純粋関数。popup / background / content script / テストで共有する。 */
(function (root) {
  'use strict';

  /** 表示名の比較用正規化: 説明文（≪…≫）除去 → NFKC（全角英数→半角）→ 空白除去 */
  function normalizeName(s) {
    return String(s == null ? '' : s)
      .replace(/≪[\s\S]*?≫/g, '')
      .normalize('NFKC')
      .replace(/\s+/g, '');
  }

  /** 日本時間の当日（YYYY-MM-DD）。端末のタイムゾーン設定に左右されない。 */
  function todayJST(now) {
    const d = now instanceof Date ? now : new Date();
    // en-CA は YYYY-MM-DD 形式で出力される
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  }

  function isValidDateString(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /** 選択部屋が属する施設コード（重複なし・チェックリスト順） */
  function facilityCodesFor(roomIds, data) {
    const set = new Set(roomIds);
    const out = [];
    for (const r of data.ROOM_LIST) {
      if (set.has(r.id) && !out.includes(r.facilityCode)) out.push(r.facilityCode);
    }
    return out;
  }

  /** 実行前検証。エラー文言は利用者にそのまま表示する。 */
  function validateRequest(req, data) {
    const errors = [];
    const ids = Array.isArray(req && req.roomIds) ? req.roomIds : [];
    const unknown = ids.filter((id) => !data.ROOMS[id]);
    const uniq = [...new Set(ids)];
    if (!isValidDateString(req && req.date)) errors.push('日付が正しくありません。');
    if (uniq.length === 0) errors.push('部屋を1つ以上選んでください。');
    if (unknown.length) errors.push('不明な部屋が含まれています: ' + unknown.join(', '));
    if (uniq.length > data.MAX_SELECTABLE) {
      errors.push(`公式サイトの上限により、一度に表示できるのは${data.MAX_SELECTABLE}部屋までです（現在${uniq.length}部屋）。`);
    }
    return { ok: errors.length === 0, errors, roomIds: data.ROOM_LIST.filter((r) => uniq.includes(r.id)).map((r) => r.id) };
  }

  const api = { normalizeName, todayJST, isValidDateString, facilityCodesFor, validateRequest };
  root.BunkyoLib = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

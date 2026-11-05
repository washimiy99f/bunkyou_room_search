/*
 * 対象施設・部屋の定義（唯一の正）。
 * 公式サイト（「文の京」施設予約ねっと）の識別子を 2026-11-05 に実画面で確認した値。
 *   facilityCode : 施設選択画面のチェックボックス value（SelectFacilities.Facilities[n].SelectedFacility.Value）
 *   objectCode   : 施設別空き状況画面のセル hidden（AvailabilitySelectDays[..].Cells[..].ObjectCode[0]）
 *   officialName : 公式画面の表示名（全角のまま。比較時は NFKC 正規化する）
 * 名称の部分一致には依存せず、コード一致 + 正式名称の完全一致（正規化後）の両方を検証する。
 */
(function (root) {
  'use strict';

  const FACILITIES = {
    '3':  { code: '3',  officialName: 'シルバーセンター',     displayName: '文京シビックセンター' },
    '5':  { code: '5',  officialName: '男女平等センター',     displayName: '男女平等センター' },
    '9':  { code: '9',  officialName: '音羽地域活動センター', displayName: '音羽地域活動センター' },
    '25': { code: '25', officialName: '福祉センター江戸川橋', displayName: '文京福祉センター江戸川橋' },
    '33': { code: '33', officialName: 'アカデミー文京',       displayName: 'アカデミー文京' },
    '38': { code: '38', officialName: 'アカデミー茗台',       displayName: 'アカデミー茗台' },
    '45': { code: '45', officialName: '総合体育館',           displayName: '文京総合体育館' },
    '46': { code: '46', officialName: 'スポーツセンター',     displayName: '文京スポーツセンター' },
  };

  // 表示順 = チェックリストの並び順
  const ROOM_LIST = [
    // 文京シビックセンター4階ホール。公式上は「シルバーセンター シルバーホール」を採用（区民会議室「４階ホール」(1/11) とは別登録）
    { id: 'civic-4f-hall',     facilityCode: '3',  objectCode: '1',  officialName: 'シルバーホール',           displayName: '4階ホール（シルバーホール）' },
    { id: 'meidai-rec-a',      facilityCode: '38', objectCode: '9',  officialName: 'レクリエーションホールＡ', displayName: 'レクリエーションホールA' },
    { id: 'meidai-rec-b',      facilityCode: '38', objectCode: '11', officialName: 'レクリエーションホールＢ', displayName: 'レクリエーションホールB' },
    { id: 'academy-rec',       facilityCode: '33', objectCode: '13', officialName: 'レクリエーションホール',   displayName: 'レクリエーションホール' },
    { id: 'sports-center-mp',  facilityCode: '46', objectCode: '49', officialName: '多目的室',                 displayName: '多目的室' },
    { id: 'gym-mp',            facilityCode: '45', objectCode: '29', officialName: '多目的室',                 displayName: '多目的室' },
    { id: 'edogawabashi-a',    facilityCode: '25', objectCode: '3',  officialName: '地域活動室Ａ',             displayName: '地域活動室A' },
    { id: 'edogawabashi-b',    facilityCode: '25', objectCode: '5',  officialName: '地域活動室Ｂ',             displayName: '地域活動室B' },
    { id: 'edogawabashi-c',    facilityCode: '25', objectCode: '7',  officialName: '地域活動室Ｃ',             displayName: '地域活動室C' },
    { id: 'danjo-kenshu-a',    facilityCode: '5',  objectCode: '1',  officialName: '研修室Ａ',                 displayName: '研修室A' },
    { id: 'otowa-mp',          facilityCode: '9',  objectCode: '7',  officialName: '多目的室',                 displayName: '多目的室' },
  ];

  const ROOMS = Object.fromEntries(ROOM_LIST.map((r) => [r.id, r]));

  // 公式サイトの施設別空き状況画面は、一度に選べるコマ数を最大10件に制限している
  // （エラー文言「選択可能数は、最大10件までです。」を実画面で確認）。1日表示では 1部屋 = 1コマ。
  const MAX_SELECTABLE = 10;

  const SITE_ORIGIN = 'https://www.shisetsu.city.bunkyo.lg.jp';
  const HOME_URL = SITE_ORIGIN + '/user/Home';

  root.BunkyoData = Object.freeze({ FACILITIES, ROOM_LIST, ROOMS, MAX_SELECTABLE, SITE_ORIGIN, HOME_URL });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BunkyoData;
})(typeof globalThis !== 'undefined' ? globalThis : this);

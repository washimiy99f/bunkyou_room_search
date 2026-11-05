/*
 * 公式サイト上の操作補助（content script）。
 * 公式の通常手順（Home →「一覧から探す」→「全施設」→ 施設選択 → 施設別空き状況 → 時間帯別空き状況）を
 * 画面ごとに1段階ずつ進める。ページ遷移で本スクリプトは破棄されるため、段階（stage）は background が保持する。
 *
 * 方針
 *  - URL 直行・内部 API 呼び出しはしない。公式画面のボタン/チェックを順にクリックするだけ。
 *  - 固定秒数ではなく、対象要素や状態（チェック済み・日付・セル）の出現を待つ。
 *  - 各操作の自動再試行は最大1回。確認できなければ停止し、段階と対象を表示する。
 *  - 時間帯の選択・ログイン・申込には一切触れない。
 */
(function () {
  'use strict';
  if (window.__bunkyoRoomHelperLoaded) return;
  window.__bunkyoRoomHelperLoaded = true;

  const DATA = globalThis.BunkyoData;
  const LIB = globalThis.BunkyoLib;
  const norm = LIB.normalizeName;

  const STAGES = {
    home:     { path: '/user/home',                               label: '検索方法の選択（Home）' },
    facility: { path: '/user/availabilitycheckapplyselectfacility', label: '施設の選択' },
    days:     { path: '/user/availabilitycheckapplyselectdays',     label: '日付・部屋の選択（施設別空き状況）' },
    time:     { path: '/user/availabilitycheckapplyselecttime',     label: '時間帯別空き状況の確認' },
  };
  // Vue の再描画が落ち着くまでの間隔。連続クリックだと選択が公式側に反映されない事例を確認済み。
  const SETTLE_MS = 300;

  // ---------------------------------------------------------------- 基本ユーティリティ
  class StepError extends Error {
    constructor(message, { fatal = false } = {}) {
      super(message);
      this.fatal = fatal; // true: 再試行しても結果が変わらない（名称不一致・上限超過など）
    }
  }
  class Cancelled extends Error {}

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const visible = (el) => !!el && el.offsetParent !== null;
  const byText = (sel, text) => qsa(sel).find((e) => norm(e.innerText || e.textContent) === norm(text));
  const nextButton = () => qsa('button').find((b) => norm(b.innerText) === norm('次へ進む'));

  async function waitFor(fn, { timeout = 15000, interval = 200, what = '画面の準備' } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() > end) throw new StepError(`${what}を確認できませんでした（${Math.round(timeout / 1000)}秒待機）`);
      await sleep(interval);
    }
  }

  /** 1回失敗したら1回だけ再試行する。fatal なエラーと中止は再試行しない。 */
  async function withRetry(fn) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Cancelled || (e instanceof StepError && e.fatal)) throw e;
      await sleep(800);
      return await fn();
    }
  }

  /** 公式のエラーダイアログ（例:「選択可能数は、最大10件までです。」） */
  function visibleErrorDialog() {
    const m = qsa('.modal-content').find((e) => visible(e) && /エラー/.test(e.innerText));
    return m ? m.innerText.replace(/\s+/g, ' ').replace(/閉じる\s*$/, '').trim() : null;
  }

  // ---------------------------------------------------------------- background との通信
  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError; // 拡張の再読込直後などは応答なし
          resolve(res || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  let job = null;

  async function update(patch) {
    const res = await send({ type: 'updateJob', runId: job.runId, patch });
    if (!res || !res.ok) throw new Cancelled();
    job = res.job;
    return job;
  }

  async function ensureNotCancelled() {
    const latest = await send({ type: 'getJob' });
    if (!latest || latest.runId !== job.runId || latest.status !== 'running') throw new Cancelled();
  }

  // ---------------------------------------------------------------- 状態表示（ページ右上）
  const banner = (() => {
    let host = null;
    let box = null;
    function ensure() {
      if (host) return;
      host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;';
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `
        <style>
          .b{font:14px/1.5 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;max-width:360px;
             padding:12px 14px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.25);color:#111;background:#fff;
             border-left:6px solid #888}
          .b[data-s=running]{border-color:#1a73e8}
          .b[data-s=done]{border-color:#188038}
          .b[data-s=error]{border-color:#d93025}
          .b[data-s=cancelled]{border-color:#888}
          .t{font-weight:700;margin-bottom:4px}
          .m{white-space:pre-wrap;word-break:break-word}
          .a{margin-top:8px;text-align:right}
          button{font:inherit;padding:2px 10px;border-radius:6px;border:1px solid #bbb;background:#f6f6f6;cursor:pointer}
        </style>
        <div class="b" role="status" aria-live="polite"><div class="t"></div><div class="m"></div>
          <div class="a"><button type="button" data-act="cancel">中止</button>
          <button type="button" data-act="close">閉じる</button></div></div>`;
      box = shadow.querySelector('.b');
      shadow.querySelector('[data-act=close]').addEventListener('click', () => host.remove());
      shadow.querySelector('[data-act=cancel]').addEventListener('click', () => send({ type: 'cancelJob' }));
      document.documentElement.appendChild(host);
    }
    return {
      hide() {
        if (host) host.remove();
        host = null;
      },
      show(state, title, message) {
        ensure();
        box.dataset.s = state;
        box.querySelector('.t').textContent = title;
        box.querySelector('.m').textContent = message || '';
        box.querySelector('[data-act=cancel]').style.display = state === 'running' ? '' : 'none';
        box.querySelector('[data-act=close]').style.display = state === 'running' ? 'none' : '';
      },
    };
  })();

  function showRunning(stageKey, detail) {
    banner.show('running', `実行中: ${STAGES[stageKey].label}`, detail || '画面を操作せずにお待ちください。');
  }

  // ---------------------------------------------------------------- 画面遷移
  /**
   * 段階を進めてから「次へ」系ボタンを押し、画面遷移を待つ。
   * 遷移すると本スクリプトは破棄されるので、ここで return することはない（=遷移しなかった場合のみ戻る）。
   */
  async function advance(nextStage, getButton, what) {
    await ensureNotCancelled();
    await update({ stage: nextStage });
    for (let attempt = 0; attempt < 2; attempt++) {
      const btn = getButton();
      if (!btn) throw new StepError(`${what}のボタンが見つかりません`);
      btn.click();
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        const err = visibleErrorDialog();
        if (err) throw new StepError(`公式サイトがエラーを表示しました: ${err}`, { fatal: true });
        await sleep(250);
      }
    }
    throw new StepError(`${what}後に次の画面へ進みませんでした`);
  }

  // ---------------------------------------------------------------- 段階1: Home
  async function stageHome() {
    showRunning('home');
    const tab = await waitFor(() => byText('a.nav-link', '一覧から探す'), { what: '「一覧から探す」タブ' });
    await withRetry(async () => {
      tab.click();
      await waitFor(() => visible(byText('button', '全施設')), { timeout: 5000, what: '「全施設」ボタン' });
    });
    await advance('facility', () => byText('button', '全施設'), '「全施設」');
  }

  // ---------------------------------------------------------------- 段階2: 施設選択
  const facilityBoxes = () => qsa('input[type=checkbox][name$=".SelectedFacility.Value"]');
  const facilityBox = (code) => facilityBoxes().find((cb) => cb.value === code) || null;
  const labelFor = (input) => (input && input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null);
  const visibleFacilityRows = () => facilityBoxes().filter((cb) => visible(cb.closest('tr') || cb)).length;

  async function revealAllFacilities() {
    // 「さらに読み込む」で行が追加表示される（全81施設でおよそ8回）。表示されていない行は操作しない。
    for (let i = 0; i < 30; i++) {
      const more = qsa('button').find((b) => norm(b.innerText) === norm('さらに読み込む') && visible(b));
      if (!more) return;
      const before = visibleFacilityRows();
      await withRetry(async () => {
        more.click();
        await waitFor(() => visibleFacilityRows() > before || !visible(more), { timeout: 5000, what: '施設一覧の追加読み込み' });
      });
      await sleep(100);
    }
    throw new StepError('施設一覧の「さらに読み込む」が終わりませんでした');
  }

  async function setFacility(code, checked) {
    const fac = DATA.FACILITIES[code];
    const name = fac ? fac.officialName : `施設コード${code}`;
    await withRetry(async () => {
      const cb = facilityBox(code);
      if (!cb) {
        throw new StepError(`施設「${name}」が公式の施設一覧に見つかりません（改称・非公開の可能性）`, { fatal: true });
      }
      const label = labelFor(cb);
      if (fac && (!label || norm(label.innerText) !== norm(fac.officialName))) {
        throw new StepError(
          `施設コード${code}の名称が「${label ? label.innerText.trim() : '不明'}」で、想定「${fac.officialName}」と一致しません（改称の可能性）`,
          { fatal: true },
        );
      }
      if (cb.checked === checked) return;
      if (!visible(label)) throw new StepError(`施設「${name}」の行が表示されていません`);
      label.click();
      await waitFor(() => facilityBox(code) && facilityBox(code).checked === checked, {
        timeout: 3000, what: `施設「${name}」の${checked ? '選択' : '解除'}`,
      });
      await sleep(SETTLE_MS);
    });
  }

  async function stageFacility() {
    showRunning('facility');
    await waitFor(() => facilityBoxes().length > 0, { what: '施設一覧' });
    await revealAllFacilities();

    const targets = LIB.facilityCodesFor(job.roomIds, DATA);
    // 既存のチェックが残っていれば外す（Home 経由なら通常は空）
    for (const cb of facilityBoxes().filter((c) => c.checked && !targets.includes(c.value))) {
      await ensureNotCancelled();
      await setFacility(cb.value, false);
    }
    for (const code of targets) {
      await ensureNotCancelled();
      showRunning('facility', `施設を選択中: ${DATA.FACILITIES[code].officialName}`);
      await setFacility(code, true);
    }

    // 再描画で選択が戻っていないか、少し待ってから全体を再確認する
    await sleep(600);
    const checked = facilityBoxes().filter((c) => c.checked).map((c) => c.value);
    const missing = targets.filter((c) => !checked.includes(c));
    const extra = checked.filter((c) => !targets.includes(c));
    if (missing.length || extra.length) {
      const nm = (c) => (DATA.FACILITIES[c] ? DATA.FACILITIES[c].officialName : c);
      throw new StepError(
        `施設の選択状態が一致しません（未選択: ${missing.map(nm).join('、') || 'なし'} / 余分: ${extra.map(nm).join('、') || 'なし'}）`,
      );
    }
    await advance('days', nextButton, '施設選択の「次へ進む」');
  }

  // ---------------------------------------------------------------- 段階3: 施設別空き状況
  const cells = () => qsa('td[data-toggle="buttons"]');
  const cellVal = (td, suffix) => {
    const el = td.querySelector(`input[type=hidden][name$="${suffix}"]`);
    return el ? el.value : null;
  };
  const cellFacility = (td) => cellVal(td, '.FacilityCode');
  const cellObject = (td) => cellVal(td, '.ObjectCode[0]');
  const cellObjects = (td) => qsa('input[type=hidden][name*=".ObjectCode["]', td).map((e) => e.value);
  const cellDate = (td) => String(cellVal(td, '.UseDate') || '').slice(0, 10);
  const cellRoomName = (td) => {
    const tr = td.closest('tr');
    const head = tr && tr.querySelector('td.startdate, th.startdate');
    return head ? head.innerText.split('≪')[0].trim() : '';
  };
  const cellStatusText = (td) => {
    const sr = td.querySelector('.sr-only');
    return sr ? sr.innerText.trim() : '';
  };
  // 休館など、公式画面でそもそも選択できないセル
  const cellDisabled = (td) => {
    const label = td.querySelector('label');
    return cellVal(td, '.Disabled') === 'True' || (!!label && label.classList.contains('disabled'));
  };
  const cellReason = (td) => cellVal(td, '.ClosedDateName') || cellStatusText(td) || cellVal(td, '.Status') || '選択不可';
  const cellActive = (td) => {
    const label = td.querySelector('label');
    return !!label && label.classList.contains('active');
  };
  const findCell = (room) =>
    cells().find((td) => cellFacility(td) === room.facilityCode && cellObject(td) === room.objectCode && cellDate(td) === job.date) || null;
  const shownDates = () => [...new Set(cells().map(cellDate))];

  async function ensureDateAndOneDay() {
    const ok = () => {
      const d = shownDates();
      return d.length === 1 && d[0] === job.date;
    };
    if (ok()) return;
    if ((job.showAttempts || 0) >= 2) {
      throw new StepError(`表示期間を「${job.date}・1日」に切り替えられませんでした`);
    }
    await update({ showAttempts: (job.showAttempts || 0) + 1 });

    const input = await waitFor(() => document.getElementById('SearchCondition_StartDate'), { what: '日付の入力欄' });
    if (input.value !== job.date) {
      // Vue の v-model に値を伝えるため、ネイティブ setter + input/change イベントで設定する
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, job.date);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(SETTLE_MS);
      if (input.value !== job.date) throw new StepError('日付を入力できませんでした');
    }
    const oneDay = qsa('input[type=radio]').find((r) => {
      const l = labelFor(r);
      return l && norm(l.innerText) === norm('1日');
    });
    if (!oneDay) throw new StepError('表示期間「1日」が見つかりません', { fatal: true });
    if (!oneDay.checked) {
      labelFor(oneDay).click();
      await waitFor(() => oneDay.checked, { timeout: 3000, what: '表示期間「1日」の選択' });
      await sleep(SETTLE_MS);
    }
    const show = byText('button', '表示');
    if (!show) throw new StepError('「表示」ボタンが見つかりません', { fatal: true });
    show.click();
    // 「表示」は画面を再描画する（再読込になった場合は本スクリプトが再実行され、ここから再開する）
    await waitFor(ok, { timeout: 20000, what: `${job.date}・1日の空き状況表` });
    await sleep(SETTLE_MS);
  }

  async function setCell(room, active) {
    const fac = DATA.FACILITIES[room.facilityCode].officialName;
    await withRetry(async () => {
      const td = findCell(room);
      if (!td) throw new StepError(`「${fac} ${room.officialName}」の${job.date}の欄が見つかりません`);
      if (cellActive(td) === active) return;
      td.querySelector('label').click();
      await waitFor(() => findCell(room) && cellActive(findCell(room)) === active, {
        timeout: 3000, what: `「${fac} ${room.officialName}」の${active ? '選択' : '解除'}（状態: ${cellStatusText(td) || '不明'}）`,
      });
      await sleep(SETTLE_MS);
    });
  }

  async function stageDays() {
    showRunning('days');
    await waitFor(() => document.getElementById('SearchCondition_StartDate'), { timeout: 20000, what: '施設別空き状況画面' });
    await waitFor(() => cells().length > 0, { timeout: 20000, what: '空き状況の表' });
    await sleep(SETTLE_MS);

    // 選んだ施設がすべて公式画面に出ているか（一部だけ表示を成功扱いしない）
    const rooms = job.roomIds.map((id) => DATA.ROOMS[id]);
    const targetFacilities = LIB.facilityCodesFor(job.roomIds, DATA);
    const shownFacilities = new Set(cells().map(cellFacility));
    const lostFacilities = targetFacilities.filter((c) => !shownFacilities.has(c));
    if (lostFacilities.length) {
      throw new StepError(
        `次の施設が施設別空き状況に表示されていません: ${lostFacilities.map((c) => DATA.FACILITIES[c].officialName).join('、')}`,
      );
    }

    showRunning('days', `${job.date} の1日表示に切り替え中`);
    await ensureDateAndOneDay();

    // 対象部屋のセルを特定（コード一致 + 正式名称一致の両方を確認）
    for (const room of rooms) {
      const fac = DATA.FACILITIES[room.facilityCode].officialName;
      const td = findCell(room);
      if (!td) {
        const sameName = cells().filter((c) => cellFacility(c) === room.facilityCode && norm(cellRoomName(c)) === norm(room.officialName));
        throw new StepError(
          `「${fac} ${room.officialName}」が見つかりません（公式の部屋コード${room.objectCode}）。` +
            (sameName.length ? '同名の部屋はあるためコードが変わった可能性があります。' : '改称・非公開の可能性があります。'),
          { fatal: true },
        );
      }
      if (norm(cellRoomName(td)) !== norm(room.officialName)) {
        throw new StepError(
          `部屋コード${room.objectCode}（${fac}）の名称が「${cellRoomName(td)}」で、想定「${room.officialName}」と一致しません（改称の可能性）`,
          { fatal: true },
        );
      }
    }

    // 休館など公式画面で選べない部屋は除外して続行する（空きなしとは扱わず、理由を明示する）
    const skipped = [];
    const selectable = [];
    for (const room of rooms) {
      const td = findCell(room);
      if (cellDisabled(td)) {
        skipped.push({
          id: room.id,
          label: `${DATA.FACILITIES[room.facilityCode].officialName} ${room.officialName}`,
          reason: cellReason(td),
        });
      } else {
        selectable.push(room);
      }
    }
    if (!selectable.length) {
      throw new StepError(
        `選んだ部屋はすべて${job.date}に選択できない状態です: ${skipped.map((s) => `${s.label}（${s.reason}）`).join('、')}`,
        { fatal: true },
      );
    }
    await update({ skipped });

    // 対象外で選択済みのコマを外す（前回操作の残り対策）
    const targetKeys = new Set(selectable.map((r) => `${r.facilityCode}/${r.objectCode}`));
    for (const td of cells().filter((c) => cellActive(c) && !targetKeys.has(`${cellFacility(c)}/${cellObject(c)}`))) {
      await ensureNotCancelled();
      const pseudo = { facilityCode: cellFacility(td), objectCode: cellObject(td), officialName: cellRoomName(td) };
      if (!DATA.FACILITIES[pseudo.facilityCode]) {
        td.querySelector('label').click();
        await sleep(SETTLE_MS);
      } else {
        await setCell(pseudo, false);
      }
    }
    for (const room of selectable) {
      await ensureNotCancelled();
      showRunning('days', `部屋を選択中: ${DATA.FACILITIES[room.facilityCode].officialName} ${room.officialName}`);
      await setCell(room, true);
    }

    await sleep(600);
    const activeKeys = cells().filter(cellActive).map((c) => `${cellFacility(c)}/${cellObject(c)}`);
    const missing = selectable.filter((r) => !activeKeys.includes(`${r.facilityCode}/${r.objectCode}`));
    const extra = activeKeys.filter((k) => !targetKeys.has(k));
    if (missing.length || extra.length) {
      throw new StepError(
        `部屋の選択状態が一致しません（未選択: ${missing.map((r) => `${DATA.FACILITIES[r.facilityCode].officialName} ${r.officialName}`).join('、') || 'なし'} / 余分: ${extra.length}件）`,
      );
    }

    // 時間帯別画面で照合するため、公式画面上の部屋コード（区画を含む）を記録する
    const expected = selectable.map((r) => ({
      id: r.id,
      facilityCode: r.facilityCode,
      objectCodes: cellObjects(findCell(r)),
    }));
    await update({ expected });
    await advance('time', nextButton, '施設別空き状況の「次へ進む」');
  }

  // ---------------------------------------------------------------- 段階4: 時間帯別空き状況（検証のみ）
  function readTimePlaces() {
    const re = /^AvailabilityTime\.FacilityList\[(\d+)\]\.Tables\[(\d+)\]\.Places\[(\d+)\]\.Cells\[\d+\]\.(FacilityCode|ObjectCode|UseDate)$/;
    const places = new Map();
    for (const el of qsa('input[type=hidden][name^="AvailabilityTime.FacilityList"]')) {
      const m = el.name.match(re);
      if (!m) continue;
      const key = `${m[1]}.${m[2]}.${m[3]}`;
      if (!places.has(key)) places.set(key, { fac: new Set(), obj: new Set(), date: new Set() });
      const p = places.get(key);
      if (m[4] === 'FacilityCode') p.fac.add(el.value);
      else if (m[4] === 'ObjectCode') p.obj.add(el.value);
      else p.date.add(String(el.value).slice(0, 10));
    }
    return [...places.values()];
  }

  async function stageTime() {
    showRunning('time');
    const places = await waitFor(() => {
      const p = readTimePlaces();
      return p.length ? p : null;
    }, { timeout: 20000, what: '時間帯別空き状況の表' });

    const expected = job.expected || [];
    const pairs = [];
    for (const p of places) for (const f of p.fac) for (const o of p.obj) pairs.push(`${f}/${o}`);
    const dates = new Set(places.flatMap((p) => [...p.date]));

    const problems = [];
    if (!expected.length) problems.push('照合用の情報がありません');
    if (dates.size !== 1 || !dates.has(job.date)) problems.push(`表示日が指定日と異なります（表示: ${[...dates].join('、') || '不明'}）`);
    for (const e of expected) {
      if (!e.objectCodes.some((o) => pairs.includes(`${e.facilityCode}/${o}`))) {
        const r = DATA.ROOMS[e.id];
        problems.push(`未表示: ${DATA.FACILITIES[r.facilityCode].officialName} ${r.officialName}`);
      }
    }
    const allowed = new Set(expected.flatMap((e) => e.objectCodes.map((o) => `${e.facilityCode}/${o}`)));
    const extra = pairs.filter((k) => !allowed.has(k));
    if (extra.length) problems.push(`選択していない部屋が表示されています（${extra.length}件）`);
    if (problems.length) throw new StepError(`時間帯別空き状況の内容が指定と一致しません: ${problems.join(' / ')}`, { fatal: true });

    const skipped = job.skipped || [];
    const msg = `${job.date}・${expected.length}部屋の時間帯別空き状況を表示しました。` +
      (skipped.length ? `\n表示対象外 ${skipped.length}部屋: ${skipped.map((s) => `${s.label}（${s.reason}）`).join('、')}` : '') +
      '\n時間帯の選択・ログイン・申込は、この画面からご自身で進めてください。';
    await update({ status: 'done', stage: 'done', message: msg });
    banner.hide();
    globalThis.BunkyoTimeView.mount({ message: skipped.length ? '完了（一部の部屋は表示対象外）' : '完了', skipped });
  }

  // ---------------------------------------------------------------- 入口
  const HANDLERS = { home: stageHome, facility: stageFacility, days: stageDays, time: stageTime };

  async function main() {
    job = await send({ type: 'getJob' });
    if (!job || job.status !== 'running') {
      // 時間帯別画面では、手動で開いた場合も含めて比較ビューを出す
      if (location.pathname.toLowerCase() === STAGES.time.path) {
        const done = job && job.status === 'done';
        globalThis.BunkyoTimeView.mount({ skipped: done ? job.skipped || [] : [] });
      }
      return;
    }

    const stage = job.stage;
    const spec = STAGES[stage];
    try {
      if (!spec || !HANDLERS[stage]) throw new StepError(`不明な段階です: ${stage}`, { fatal: true });
      if (location.pathname.toLowerCase() !== spec.path) {
        throw new StepError(
          `想定外の画面が表示されました（表示中:「${document.title}」）。ログイン切れ・メンテナンス・別画面への移動の可能性があります。`,
          { fatal: true },
        );
      }
      await HANDLERS[stage]();
    } catch (e) {
      if (e instanceof Cancelled) {
        banner.show('cancelled', '中止しました', '自動操作を停止しました。公式画面はそのまま操作できます。');
        return;
      }
      const label = spec ? spec.label : String(stage);
      const message = e && e.message ? e.message : String(e);
      try {
        await update({ status: 'error', failedStage: label, message });
      } catch (ignored) { /* 既に中止・上書きされている */ }
      banner.show('error', `失敗: ${label}`, `${message}\n自動操作を停止しました。公式画面の表示は変更していません。`);
    }
  }

  main();
})();

/* 日付・部屋のチェックリスト。前回の部屋選択は chrome.storage.local に保存（日付は保存しない）。 */
(function () {
  'use strict';
  const DATA = globalThis.BunkyoData;
  const LIB = globalThis.BunkyoLib;
  const STORAGE_KEY = 'selectedRoomIds';
  const STAGE_LABEL = {
    home: '検索方法の選択（Home）',
    facility: '施設の選択',
    days: '日付・部屋の選択',
    time: '時間帯別空き状況の確認',
  };

  const $ = (id) => document.getElementById(id);
  const dateEl = $('date');
  const form = $('rooms');
  const runBtn = $('run');
  let currentJob = null;
  let starting = false;

  // ---- チェックリスト（施設単位でまとめる）
  function render() {
    const groups = new Map();
    for (const r of DATA.ROOM_LIST) {
      if (!groups.has(r.facilityCode)) groups.set(r.facilityCode, []);
      groups.get(r.facilityCode).push(r);
    }
    for (const [code, rooms] of groups) {
      const fac = DATA.FACILITIES[code];
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = fac.displayName;
      fs.appendChild(lg);
      if (fac.officialName !== fac.displayName) {
        // 公式サイト上の施設名が異なる場合だけ併記（公式画面で探すときの手がかり）
        const off = document.createElement('div');
        off.className = 'official';
        off.textContent = `公式サイト上の施設名: ${fac.officialName}`;
        fs.appendChild(off);
      }
      for (const r of rooms) {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'room';
        cb.value = r.id;
        const span = document.createElement('span');
        span.textContent = r.displayName;
        label.append(cb, span);
        fs.appendChild(label);
      }
      form.appendChild(fs);
    }
  }

  const boxes = () => Array.from(form.querySelectorAll('input[name=room]'));
  const selectedIds = () => boxes().filter((b) => b.checked).map((b) => b.value);

  function isRunning(job) {
    return !!job && job.status === 'running' && Date.now() - job.updatedAt < 90 * 1000;
  }

  function refresh() {
    const ids = selectedIds();
    const count = $('count');
    count.textContent = `${ids.length}部屋選択（上限${DATA.MAX_SELECTABLE}）`;
    count.classList.toggle('over', ids.length > DATA.MAX_SELECTABLE);
    const v = LIB.validateRequest({ date: dateEl.value, roomIds: ids }, DATA);
    // 未選択は「まだ操作していない」状態なので赤字にはしない
    $('validation').textContent = ids.length === 0 ? '' : v.errors.join('\n');
    runBtn.disabled = !v.ok || isRunning(currentJob) || starting;
  }

  async function saveSelection() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: selectedIds() });
    } catch (e) { /* 保存失敗は実行に影響させない */ }
  }

  // ---- 状態表示
  function showStatus(job) {
    currentJob = job;
    const box = $('status');
    if (!job) { box.hidden = true; refresh(); return; }
    box.hidden = false;
    const running = isRunning(job);
    const stale = job.status === 'running' && !running;
    box.dataset.s = stale ? 'error' : job.status;
    let title;
    let msg = job.message || '';
    if (running) { title = `実行中: ${STAGE_LABEL[job.stage] || job.stage}`; msg = '公式サイトのタブで操作を進めています。'; }
    else if (stale) { title = '応答がありません'; msg = '前回の実行が途中で止まりました。再実行できます。'; }
    else if (job.status === 'done') title = '完了';
    else if (job.status === 'error') title = `失敗: ${job.failedStage || ''}`;
    else if (job.status === 'cancelled') title = '中止しました';
    else title = job.status;
    box.querySelector('.status-title').textContent = title;
    box.querySelector('.status-msg').textContent = `${job.date}・${job.roomIds.length}部屋\n${msg}`;
    $('cancel').hidden = !running;
    refresh();
  }

  async function loadJob() {
    try {
      const { job } = await chrome.storage.session.get('job');
      showStatus(job || null);
    } catch (e) { showStatus(null); }
  }

  // ---- 実行
  async function run() {
    const ids = selectedIds();
    const v = LIB.validateRequest({ date: dateEl.value, roomIds: ids }, DATA);
    if (!v.ok || isRunning(currentJob) || starting) { refresh(); return; }
    starting = true; // 連打防止
    refresh();
    try {
      await saveSelection();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      // 公式サイトの /user/ 配下を開いているタブなら再利用。それ以外は URL が読めないため新しいタブを開く。
      // （host_permissions を持たず、content_scripts の対象 /user/* だけが URL を読める範囲）
      const onSite = tab && typeof tab.url === 'string' && tab.url.startsWith(DATA.SITE_ORIGIN + '/');
      const res = await chrome.runtime.sendMessage({
        type: 'startJob', date: dateEl.value, roomIds: v.roomIds, tabId: onSite ? tab.id : null,
      });
      if (!res || !res.ok) {
        $('validation').textContent = (res && res.errors ? res.errors : ['開始できませんでした。']).join('\n');
      } else {
        showStatus(res.job);
      }
    } finally {
      starting = false;
      refresh();
    }
  }

  // ---- 初期化
  async function init() {
    render();
    dateEl.value = LIB.todayJST(); // 日付は保存せず、毎回日本時間の当日
    try {
      const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      if (Array.isArray(saved)) {
        const known = new Set(saved.filter((id) => DATA.ROOMS[id]));
        for (const b of boxes()) b.checked = known.has(b.value);
      }
    } catch (e) { /* 読込失敗時は未選択で開始 */ }

    form.addEventListener('change', () => { saveSelection(); refresh(); });
    dateEl.addEventListener('input', refresh);
    $('selectAll').addEventListener('click', () => { boxes().forEach((b) => { b.checked = true; }); saveSelection(); refresh(); });
    $('clearAll').addEventListener('click', () => { boxes().forEach((b) => { b.checked = false; }); saveSelection(); refresh(); });
    runBtn.addEventListener('click', run);
    $('cancel').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancelJob' }));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.job) showStatus(changes.job.newValue || null);
    });
    await loadJob();
    refresh();
  }

  init();
})();

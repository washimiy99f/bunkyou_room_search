/*
 * 実行ジョブの保持と排他制御（service worker）。
 * ジョブは chrome.storage.session（ブラウザ終了で消える・ディスクに残さない）に1件だけ置く。
 * content script は自分のタブのジョブだけを読み書きできる（sender.tab.id で判定）。
 */
importScripts('rooms.js', 'lib.js');

const DATA = self.BunkyoData;
const LIB = self.BunkyoLib;
// content script は段階ごとに updatedAt を更新する。これより長く無更新なら放棄されたとみなす。
const STALE_MS = 90 * 1000;
const UPDATABLE_KEYS = ['stage', 'status', 'message', 'failedStage', 'expected', 'showAttempts', 'skipped'];

async function getJob() {
  const { job } = await chrome.storage.session.get('job');
  return job || null;
}
async function setJob(job) {
  await chrome.storage.session.set({ job });
}
function isActive(job) {
  return !!job && job.status === 'running' && Date.now() - job.updatedAt < STALE_MS;
}

async function startJob(msg) {
  const current = await getJob();
  if (isActive(current)) {
    return { ok: false, errors: ['別の実行が進行中です。完了するか中止してから再実行してください。'] };
  }
  const v = LIB.validateRequest({ date: msg.date, roomIds: msg.roomIds }, DATA);
  if (!v.ok) return { ok: false, errors: v.errors };

  const now = Date.now();
  const job = {
    runId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    tabId: Number.isInteger(msg.tabId) ? msg.tabId : null,
    date: msg.date,
    roomIds: v.roomIds,
    stage: 'home',
    status: 'running',
    message: '',
    failedStage: null,
    expected: null,
    skipped: [],
    showAttempts: 0,
    startedAt: now,
    updatedAt: now,
  };
  // ジョブを保存してから遷移させる（Home 読込時に content script がジョブを取りこぼさないため）
  if (job.tabId !== null) {
    await setJob(job);
    try {
      await chrome.tabs.update(job.tabId, { url: DATA.HOME_URL, active: true });
      return { ok: true, job };
    } catch (e) {
      // タブが既に閉じられていた等 → 新しいタブで実行する
    }
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  job.tabId = tab.id;
  await setJob(job);
  await chrome.tabs.update(tab.id, { url: DATA.HOME_URL });
  return { ok: true, job };
}

async function updateJob(msg, sender) {
  const job = await getJob();
  if (!job || !sender.tab || job.tabId !== sender.tab.id || job.runId !== msg.runId || job.status !== 'running') {
    return { ok: false };
  }
  for (const k of UPDATABLE_KEYS) if (k in msg.patch) job[k] = msg.patch[k];
  job.updatedAt = Date.now();
  await setJob(job);
  return { ok: true, job };
}

async function cancelJob() {
  const job = await getJob();
  if (job && job.status === 'running') {
    job.status = 'cancelled';
    job.message = '利用者が中止しました。';
    job.updatedAt = Date.now();
    await setJob(job);
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'startJob':
        return startJob(msg);
      case 'getJob': {
        const job = await getJob();
        return job && sender.tab && job.tabId === sender.tab.id ? job : null;
      }
      case 'updateJob':
        return updateJob(msg, sender);
      case 'cancelJob':
        return cancelJob();
      default:
        return { ok: false, errors: ['unknown message'] };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, errors: [String(e && e.message || e)] }));
  return true; // 非同期応答
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const job = await getJob();
  if (job && job.tabId === tabId && job.status === 'running') {
    job.status = 'error';
    job.message = '対象のタブが閉じられたため停止しました。';
    job.updatedAt = Date.now();
    await setJob(job);
  }
});

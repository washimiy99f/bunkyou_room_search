/*
 * 時間帯別空き状況の比較ビュー（content script）。
 * 公式の時間帯別空き状況画面は施設ごとに時間軸が分かれて縦に並ぶため、部屋同士を見比べにくい。
 * ここでは「公式画面が既に表示しているデータ」だけを読み取り、全部屋を共通の時間軸に並べたパネルを重ねて表示する。
 *   - 独自の通信はしない（取得は公式画面の描画結果のみ）
 *   - 枠のクリックは公式画面の同じ枠をクリックするだけ（選択状態の正は常に公式画面）
 *   - 申込は公式の「次へ進む」から（このパネルには申込ボタンを置かない）
 */
(function (root) {
  'use strict';

  const ICON = { circle: '○', triangle: '△', cross: '×', minus: '－', asterisk: '＊' };
  const STATUS_LABEL = {
    vacant: '空き', some: '一部空き', full: '空きなし', 'time-over': '申込期間外',
    closed: '休館', lottery: '抽選', inquiry: '施設に問合せ', 'out-of-time': '利用時間外',
  };
  const KNOWN = Object.keys(STATUS_LABEL);

  const qsa = (sel, r = document) => Array.from(r.querySelectorAll(sel));
  const text = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : '');
  const toMin = (hhmm) => {
    const n = parseInt(hhmm, 10);
    return Number.isFinite(n) ? Math.floor(n / 100) * 60 + (n % 100) : null;
  };
  const fmt = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

  /** 公式 hidden 項目（FacilityList[f].Tables[t].Places[p].Cells[c].*）を文書順＝表示順に並べる */
  function readHiddenCells() {
    const map = new Map();
    const re = /^AvailabilityTime\.FacilityList\[(\d+)\]\.Tables\[(\d+)\]\.Places\[(\d+)\]\.Cells\[(\d+)\]\.(\w+)$/;
    for (const el of qsa('input[type=hidden][name^="AvailabilityTime.FacilityList"]')) {
      const m = el.name.match(re);
      if (!m) continue;
      const key = [m[1], m[2], m[3], m[4]].map(Number);
      const k = key.join('.');
      if (!map.has(k)) map.set(k, { key, v: {} });
      map.get(k).v[m[5]] = el.value;
    }
    return [...map.values()]
      .sort((a, b) => a.key.reduce((acc, x, i) => acc || x - b.key[i], 0))
      .map((e) => ({ place: e.key.slice(0, 3).join('.'), ...e.v }));
  }

  /** 画面から部屋ごとの枠一覧を読む。読めなければ null。 */
  function read() {
    const nodes = qsa('h3, li.events-group');
    const groups = [];
    let facility = '';
    for (const n of nodes) {
      if (n.tagName === 'H3') { facility = text(n).split('≪')[0].trim(); continue; }
      const slots = qsa('li[data-toggle="buttons"]', n).map((li) => {
        const label = li.querySelector('label');
        const status = KNOWN.find((s) => li.classList.contains(s)) ||
          [...li.classList].find((c) => !['btn-group-toggle', 'text-center', 'set-height'].includes(c)) || '';
        const icon = qsa('svg use', li).find((u) => u.closest('svg').style.display !== 'none');
        const iconName = icon ? (icon.getAttribute('xlink:href') || icon.getAttribute('href') || '').split('#')[1] : '';
        return {
          li,
          label,
          name: text(li.querySelector('label > span')) || text(label).split(' ')[0],
          status,
          symbol: ICON[iconName] || '',
          disabled: !label || label.classList.contains('disabled') || label.hasAttribute('disabled'),
          active: !!label && label.classList.contains('active'),
        };
      });
      const dateEl = n.parentElement && n.parentElement.querySelector('li.events-date');
      groups.push({
        facility,
        room: text(n.querySelector('.room-name > div')) || text(n.querySelector('.room-name')),
        capacity: text(n.querySelector('.capacity span')),
        date: text(dateEl),
        slots,
      });
    }
    if (!groups.length) return null;

    // hidden の時刻を表示枠に対応づける（件数が一致した場合のみ）
    const hidden = readHiddenCells();
    const all = groups.flatMap((g) => g.slots);
    const timed = hidden.length === all.length;
    if (timed) {
      all.forEach((s, i) => {
        s.from = toMin(hidden[i].TimeFrom);
        s.to = toMin(hidden[i].TimeTo);
        s.facilityCode = hidden[i].FacilityCode;
        s.objectCode = hidden[i].ObjectCode;
        if (!s.status && hidden[i].Status) s.status = hidden[i].Status;
      });
    }
    return { groups, timed };
  }

  // ------------------------------------------------------------------ 表示
  // 公式画面を隠さないよう、右上に小さく固定表示する（ドラッグで大きさを変えられる）
  const CSS = `
  :host{all:initial}
  .p{position:fixed;top:12px;right:12px;z-index:2147483646;width:min(540px,calc(100vw - 24px));min-width:340px;
     max-height:calc(100vh - 120px);display:flex;flex-direction:column;background:rgba(255,255,255,.97);color:#111;
     border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.25);font:12px/1.35 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif;
     resize:both;overflow:hidden}
  .p.min{width:auto;min-width:0;max-height:none;resize:none}
  .h{display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid #e3e3e3;cursor:default}
  .h b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sp{flex:1}
  button.t{font:inherit;font-size:11px;padding:1px 8px;border-radius:5px;border:1px solid #bbb;background:#f6f6f6;cursor:pointer;white-space:nowrap}
  .p.min .b,.p.min .msg,.p.min .note,.p.min .tip{display:none}
  .p.min .h{border-bottom:0}
  .b{overflow:auto;padding:2px 8px 6px;flex:1}
  .note{padding:3px 8px 0;color:#666;font-size:10.5px}
  .msg{padding:3px 8px 0;white-space:pre-wrap;color:#185c2c;font-weight:600;font-size:11px}
  .grid{min-width:420px}
  .row{display:grid;grid-template-columns:112px 1fr;align-items:center;min-height:26px;padding:1px 0;border-bottom:1px solid #f2f2f2}
  .row.axis{position:sticky;top:0;background:#fff;z-index:1;min-height:16px}
  .nm{padding-right:6px;overflow:hidden}
  .nm .f{color:#777;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nm .r{font-weight:700;font-size:11px;line-height:1.2;word-break:break-all} /* A/B の区別が消えないよう省略せず折り返す */
  .tr{position:relative;height:20px}
  .axis .tr{height:14px}
  .tick{position:absolute;top:0;bottom:0;border-left:1px dashed #e2e2e2;font-size:9px;color:#999;padding-left:1px}
  .s{position:absolute;top:1px;bottom:1px;border-radius:4px;border:1px solid rgba(0,0,0,.12);display:flex;align-items:center;
     justify-content:center;font:inherit;font-size:10.5px;overflow:hidden;white-space:nowrap;padding:0 2px;color:#111}
  .s{cursor:pointer}
  .s.off{cursor:not-allowed}
  .s:not(.off):hover{filter:brightness(.95);outline:2px solid #1a73e8}
  /* 公式では「○」でも今は選べない枠（申込期間外など）。普通の空きと見分けられるよう斜線＋点線にする */
  .s.ro{background:repeating-linear-gradient(135deg,#eef8f0,#eef8f0 4px,#d9efdf 4px,#d9efdf 8px);border-style:dashed;color:#4a6b52}
  .s.on{outline:2px solid #1a73e8;outline-offset:-1px;font-weight:700}
  .vacant{background:#d6f5dd}.some{background:#fff1c2}.full{background:#e9e9e9;color:#777}
  .time-over,.out-of-time{background:#f4f4f4;color:#999}.closed{background:repeating-linear-gradient(45deg,#ececec,#ececec 4px,#dcdcdc 4px,#dcdcdc 8px);color:#666}
  .lottery,.inquiry{background:#e3ecff}
  .skip{color:#a33;font-size:10.5px;padding:4px 0 0}
  .tip{margin:4px 8px 0;padding:4px 6px;border-radius:5px;background:#fff4e5;color:#7a4b00;font-size:11px}
  .tip:empty{display:none}
  .flat{display:flex;gap:3px;height:20px}
  .flat .s{position:static;flex:1}
  `;

  let host = null;
  let shadow = null;
  let opts = {};
  let minimized = false;
  let observer = null;
  let timer = null;

    function render() {
    const data = read();
    if (!host) return;
    const panel = shadow.querySelector('.p');
    panel.classList.toggle('min', minimized);
    const head = shadow.querySelector('.ttl');
    const body = shadow.querySelector('.b');
    if (!data) { head.textContent = '部屋まとめ（表が読み取れません）'; body.textContent = ''; return; }

    const date = data.groups[0] ? data.groups[0].date : '';
    const nSel = data.groups.reduce((a, g) => a + g.slots.filter((s) => s.active).length, 0);
    head.textContent = `部屋まとめ ${date.replace(/^\d+年\s*/, '')}${nSel ? ` ・選択中${nSel}` : ''}`;

    const frag = document.createDocumentFragment();
    let lo = Infinity; let hi = -Infinity;
    if (data.timed) {
      for (const g of data.groups) for (const s of g.slots) {
        if (s.from != null) lo = Math.min(lo, s.from);
        if (s.to != null) hi = Math.max(hi, s.to);
      }
      lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
      const axis = document.createElement('div');
      axis.className = 'row axis';
      axis.innerHTML = '<div class="nm"></div><div class="tr"></div>';
      for (let m = lo; m < hi; m += 60) {
        const t = document.createElement('span');
        t.className = 'tick';
        t.style.left = `${((m - lo) / (hi - lo)) * 100}%`;
        t.textContent = (m / 60) % 2 === 0 ? String(m / 60) : '';
        axis.lastChild.appendChild(t);
      }
      frag.appendChild(axis);
    }

    data.groups.forEach((g) => {
      const row = document.createElement('div');
      row.className = 'row';
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.innerHTML = '<div class="f"></div><div class="r"></div>';
      nm.firstChild.textContent = g.facility;
      nm.lastChild.textContent = g.room;
      nm.title = `${g.facility} ${g.room}${g.capacity ? `（定員${g.capacity}名）` : ''}`;
      const tr = document.createElement('div');
      tr.className = data.timed ? 'tr' : 'flat';
      g.slots.forEach((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        // 公式画面で「○/△」なのに選択できない枠 = 空き状況の確認だけができる期間（申込期間外・未ログイン等）
        const viewOnly = s.disabled && (s.status === 'vacant' || s.status === 'some');
        b.className = `s ${s.status}${s.active ? ' on' : ''}${s.disabled ? ' off' : ''}${viewOnly ? ' ro' : ''}`;
        const range = s.from != null && s.to != null ? `${fmt(s.from)}–${fmt(s.to)}` : '';
        const st = STATUS_LABEL[s.status] || s.status || '不明';
        const why = viewOnly ? '（公式画面で選択できない期間）' : s.disabled ? '（選択不可）' : '';
        b.textContent = `${s.symbol} ${s.name}`;
        b.title = `${g.facility} ${g.room}\n${s.name} ${range}\n${st}${why}${s.active ? '（公式で選択中）' : ''}`;
        b.setAttribute('aria-label', `${g.facility} ${g.room} ${s.name} ${range} ${st}${why}${s.active ? ' 選択中' : ''}`);
        b.setAttribute('aria-pressed', String(s.active));
        b.setAttribute('aria-disabled', String(s.disabled));
        if (data.timed && s.from != null && s.to != null) {
          b.style.left = `${((s.from - lo) / (hi - lo)) * 100}%`;
          b.style.width = `calc(${((s.to - s.from) / (hi - lo)) * 100}% - 2px)`;
        }
        // disabled 属性は付けない（押しても無反応だと理由が分からないため、押したら理由を出す）
        b.addEventListener('click', () => {
          const where = `${g.facility} ${g.room} ${s.name}`;
          if (s.disabled) {
            tip(viewOnly
              ? `${where} は空いていますが、公式画面で選択できない状態です。公式の注意書きどおり、ログイン後も選べない場合は申込期間外（空き状況の確認のみ）です。`
              : `${where} は「${st}」のため選択できません。`);
            return;
          }
          const before = s.label.classList.contains('active');
          s.label.click();
          s.li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          schedule();
          // 公式側が切り替わらなかった場合は黙らずに知らせる
          setTimeout(() => {
            if (s.label.isConnected && s.label.classList.contains('active') === before) {
              tip(`${where} の選択が公式画面に反映されませんでした。公式画面の同じ枠を直接クリックしてください。`);
            }
          }, 800);
        });
        tr.appendChild(b);
      });
      row.append(nm, tr);
      frag.appendChild(row);
    });

    for (const sk of opts.skipped || []) {
      const d = document.createElement('div');
      d.className = 'skip';
      d.textContent = `表示対象外: ${sk.label} — ${sk.reason}（公式の施設別空き状況で選択できない状態）`;
      frag.appendChild(d);
    }
    // 時間軸が潰れないよう表に最小幅を持たせ、狭い画面では横スクロールにする
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.appendChild(frag);
    body.replaceChildren(grid);
  }

  let tipTimer = null;
  function tip(message) {
    if (!shadow) return;
    const el = shadow.querySelector('.tip');
    el.textContent = message;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { el.textContent = ''; }, 8000);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 150);
  }

  function mount(options) {
    opts = options || {};
    if (!host) {
      host = document.createElement('div');
      shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `<style>${CSS}</style>
        <div class="p" role="region" aria-label="部屋まとめ（時間帯の比較）">
          <div class="h"><b class="ttl"></b>
            <span class="sp"></span>
            <button type="button" class="t" data-a="min">畳む</button>
          </div>
          <div class="msg"></div>
          <div class="note">○空き △一部 ×空きなし －期間外／斜線＝空きだが今は選択不可。枠クリックで公式の同じ枠を選択／解除、申込は公式の「次へ進む」から。</div>
          <div class="tip" role="status" aria-live="polite"></div>
          <div class="b"></div>
        </div>`;
      shadow.querySelector('[data-a=min]').addEventListener('click', (e) => {
        minimized = !minimized;
        e.currentTarget.textContent = minimized ? '開く' : '畳む';
        render();
      });
      document.documentElement.appendChild(host);
      // 公式画面側でのクリック・再描画も反映する
      observer = new MutationObserver((muts) => {
        if (muts.some((m) => !host.contains(m.target))) schedule();
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    }
    const msg = shadow.querySelector('.msg');
    msg.textContent = opts.message || '';
    msg.style.display = opts.message ? '' : 'none';
    render();
    return read();
  }

  root.BunkyoTimeView = Object.freeze({ read, mount });
})(globalThis);

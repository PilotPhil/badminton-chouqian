/* ============================================================
 * 羽毛球抽签 · 电子分组
 * 纯前端单页应用：名单 → 随机分组 → 二维码 / 海报
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------
   * 常量
   * ------------------------------------------------------- */
  const LS_KEY = 'bdmt.draw.v2';
  const DEFAULT_GROUPS = 4;
  const MAX_GROUPS = 32;
  const HUES = [158, 202, 26, 264, 338, 96, 44, 300];

  const EVENTS = [
    { key: '男单', pairs: false, tip: '每行一位选手，按个人报名分组。' },
    { key: '女单', pairs: false, tip: '每行一位选手，按个人报名分组。' },
    { key: '男双', pairs: true, tip: '每行一组搭档，例如「张三/李四」。' },
    { key: '女双', pairs: true, tip: '每行一组搭档，例如「张三/李四」。' },
    { key: '混双', pairs: true, tip: '每行一组混双搭档（男/女），例如「张三/李四」。' },
  ];

  const SAMPLE_NAMES = [
    '张伟', '王芳', '李强', '刘洋', '陈静', '杨帆',
    '赵磊', '黄丽', '周涛', '吴敏', '徐亮', '孙悦',
    '马超', '朱琳', '胡军', '郭佳',
  ];

  /* ---------------------------------------------------------
   * DOM
   * ------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  const dom = {
    steps: $('steps'),
    viewSetup: $('viewSetup'),
    viewResult: $('viewResult'),
    eventChips: $('eventChips'),
    eventHint: $('eventHint'),
    titleInput: $('titleInput'),
    playerInput: $('playerInput'),
    btnAdd: $('btnAdd'),
    roster: $('roster'),
    rosterEmpty: $('rosterEmpty'),
    playerCounter: $('playerCounter'),
    btnBulk: $('btnBulk'),
    btnSample: $('btnSample'),
    btnClear: $('btnClear'),
    gMinus: $('gMinus'),
    gPlus: $('gPlus'),
    groupCount: $('groupCount'),
    groupHint: $('groupHint'),
    swSeed: $('swSeed'),
    resTitle: $('resTitle'),
    resMeta: $('resMeta'),
    resEvent: $('resEvent'),
    resStats: $('resStats'),
    groups: $('groups'),
    seedLegend: $('seedLegend'),
    btnReset: $('btnReset'),
    btnDraw: $('btnDraw'),
    btnBack: $('btnBack'),
    btnRedraw: $('btnRedraw'),
    btnShare: $('btnShare'),
    abSetup: $('abSetup'),
    abResult: $('abResult'),
    shareWrap: $('shareWrap'),
    bulkWrap: $('bulkWrap'),
    bulkText: $('bulkText'),
    btnBulkImport: $('btnBulkImport'),
    qrCanvas: $('qrCanvas'),
    qrTip: $('qrTip'),
    qrInfo: $('qrInfo'),
    qrWarn: $('qrWarn'),
    codeText: $('codeText'),
    btnCopyCode: $('btnCopyCode'),
    btnSaveQr: $('btnSaveQr'),
    btnSavePoster: $('btnSavePoster'),
    btnCopyText: $('btnCopyText'),
    btnImport: $('btnImport'),
    toast: $('toast'),
  };

  /* ---------------------------------------------------------
   * 状态
   * ------------------------------------------------------- */
  let state = defaultState();
  const ui = {
    view: 'setup',
    sel: null,        // 已选中的选手 {g, p}
    flash: null,      // 刚交换的两位
    shareOpen: false,
  };

  function defaultState() {
    return {
      event: '男单',
      title: '',
      players: [],        // [{ n, seed }]
      groupCount: DEFAULT_GROUPS,
      spreadSeeds: true,
      groups: null,       // [{ players:[{n,seed}] }]
      drawnAt: 0,
      dirty: false,       // 名单修改后，已有分组是否过期
    };
  }

  function getEvent(key) {
    return EVENTS.find((e) => e.key === (key || state.event)) || EVENTS[0];
  }
  const unitOf = (ev) => (ev.pairs ? '对' : '人');

  /* ---------------------------------------------------------
   * 工具函数
   * ------------------------------------------------------- */
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function rand(max) {
    if (max <= 0) return 0;
    if (window.crypto && crypto.getRandomValues) {
      const limit = Math.floor(0x100000000 / max) * max;
      const buf = new Uint32Array(1);
      let x;
      do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
      return x % max;
    }
    return Math.floor(Math.random() * max);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function groupLabel(i) {
    if (i < 26) return String.fromCharCode(65 + i);
    return 'G' + (i + 1);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function dateStr(ts) {
    const d = new Date(ts || Date.now());
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function fileStamp(extra) {
    const d = new Date();
    const s = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
    return `羽毛球抽签_${state.event}${extra ? '_' + extra : ''}_${s}.png`;
  }

  let toastTimer = 0;
  function toast(msg, opts) {
    const sheetOpen = !dom.shareWrap.hidden || !dom.bulkWrap.hidden;
    dom.toast.textContent = msg;
    dom.toast.classList.toggle('is-top', !!(opts && opts.top) || sheetOpen);
    dom.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('is-show'), 2000);
  }

  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (_) { /* ignore */ }
  }

  function copyText(text) {
    const done = () => toast('已复制到剪贴板');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
      toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择');
    }
  }

  /* ---------------------------------------------------------
   * 持久化
   * ------------------------------------------------------- */
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        event: state.event,
        title: state.title,
        players: state.players,
        groupCount: state.groupCount,
        spreadSeeds: state.spreadSeeds,
        groups: state.groups,
        drawnAt: state.drawnAt,
        dirty: state.dirty,
      }));
    } catch (_) { /* ignore quota / private mode */ }
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (_) { return false; }
    if (!raw) return false;
    try {
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.players)) return false;
      state = Object.assign(defaultState(), {
        event: EVENTS.some((e) => e.key === d.event) ? d.event : '男单',
        title: typeof d.title === 'string' ? d.title : '',
        players: d.players.filter((p) => p && typeof p.n === 'string').map((p) => ({ n: p.n, seed: !!p.seed })),
        groupCount: clamp(Number(d.groupCount) || DEFAULT_GROUPS, 1, MAX_GROUPS),
        spreadSeeds: d.spreadSeeds !== false,
        groups: Array.isArray(d.groups) ? normalizeGroups(d.groups) : null,
        drawnAt: Number(d.drawnAt) || 0,
        dirty: !!d.dirty,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function normalizeGroups(raw) {
    const out = [];
    for (const g of raw) {
      if (!g || !Array.isArray(g.players)) return null;
      const players = g.players
        .filter((p) => p && typeof p.n === 'string' && p.n)
        .map((p) => ({ n: p.n, seed: !!p.seed }));
      if (!players.length) return null;
      out.push({ players });
    }
    return out.length ? out : null;
  }

  /* ---------------------------------------------------------
   * 名单解析
   * ------------------------------------------------------- */
  function cleanName(raw) {
    let s = String(raw == null ? '' : raw).replace(/\u3000/g, ' ').trim();
    // 去掉 Excel / Word 粘贴带来的行号、项目符号
    s = s.replace(/^[\s\-–—•·*#>]*/, '');
    s = s.replace(/^[（(]?\d{1,3}[）)]?\s*[.、．,，:：)）\-]\s*/, '');
    s = s.replace(/^[\s\-–—•·*#>]+/, '');
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  function splitNames(text) {
    const sep = getEvent().pairs
      ? /[\n\r,，、;；\t|]+/            // 双打：空格可能是「张三 李四」这种搭档写法，不拆
      : /[\n\r,，、;；\t|\s]+/;        // 单打：空格也当作分隔
    return String(text || '')
      .split(sep)
      .map(cleanName)
      .filter(Boolean);
  }

  function addPlayers(names, opts) {
    const silent = opts && opts.silent;
    let added = 0;
    let dup = 0;
    let tooLong = 0;
    const existing = new Set(state.players.map((p) => p.n));
    for (const raw of names) {
      const n = cleanName(raw);
      if (!n) continue;
      if (n.length > 32) { tooLong++; continue; }
      if (existing.has(n)) { dup++; continue; }
      existing.add(n);
      state.players.push({ n, seed: false });
      added++;
    }
    if (added) markDirty();
    renderRoster();
    updateGroupUI();
    save();
    if (!silent) {
      const parts = [];
      if (added) parts.push(`已添加 ${added} 个`);
      if (dup) parts.push(`忽略 ${dup} 个重复`);
      if (tooLong) parts.push(`${tooLong} 个名字过长`);
      if (parts.length) toast(parts.join('，'));
      else if (names.length) toast('没有可添加的名字');
    }
    return added;
  }

  function markDirty() {
    if (state.groups) state.dirty = true;
  }

  /* ---------------------------------------------------------
   * 渲染：项目类型
   * ------------------------------------------------------- */
  function renderEventChips() {
    dom.eventChips.innerHTML = EVENTS.map((e) => (
      `<button class="chip${e.key === state.event ? ' is-on' : ''}" type="button" data-event="${e.key}">${e.key}</button>`
    )).join('');
    const ev = getEvent();
    dom.eventHint.textContent = ev.tip;
    dom.playerInput.placeholder = ev.pairs
      ? '输入搭档，如 张三/李四，回车添加'
      : '输入姓名后回车，可一次粘贴多个';
  }

  /* ---------------------------------------------------------
   * 渲染：名单
   * ------------------------------------------------------- */
  function renderRoster() {
    const ev = getEvent();
    const total = state.players.length;
    const seeds = state.players.filter((p) => p.seed).length;

    dom.playerCounter.textContent = seeds
      ? `${total} ${unitOf(ev)} · ${seeds} 种子`
      : `${total} ${unitOf(ev)}`;

    if (!total) {
      dom.roster.innerHTML = '';
      dom.rosterEmpty.classList.remove('hidden');
    } else {
      dom.rosterEmpty.classList.add('hidden');
      dom.roster.innerHTML = state.players.map((p, i) => `
        <span class="pchip${p.seed ? ' is-seed' : ''}" data-i="${i}">
          <button class="pchip-name" type="button" aria-label="标记种子">${esc(p.n)}</button>
          ${p.seed ? '<span class="pchip-star">★</span>' : ''}
          <button class="pchip-x" type="button" aria-label="删除">×</button>
        </span>`).join('');
    }
    updateGroupUI();
  }

  /* ---------------------------------------------------------
   * 渲染：分组设置
   * ------------------------------------------------------- */
  function maxGroups() {
    return Math.max(1, Math.min(MAX_GROUPS, state.players.length || 12));
  }

  function groupSizes(n, k) {
    const base = Math.floor(n / k);
    const extra = n % k;
    return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
  }

  function sizesText() {
    const ev = getEvent();
    const n = state.players.length;
    const k = state.groupCount;
    if (!n) return '添加名单后自动计算';
    if (n < 2) return '至少需要 2 位';
    if (k > n) return `人数不足 ${k} 组`;
    const sizes = groupSizes(n, k);
    const min = Math.min.apply(null, sizes);
    const max = Math.max.apply(null, sizes);
    const same = min === max;
    return `每组 ${same ? min : min + '~' + max} ${unitOf(ev)}`;
  }

  function updateGroupUI() {
    const n = state.players.length;
    const max = maxGroups();
    state.groupCount = clamp(state.groupCount, 1, max);
    dom.groupCount.textContent = state.groupCount;
    dom.groupHint.textContent = sizesText();
    dom.gMinus.disabled = state.groupCount <= 1;
    dom.gPlus.disabled = state.groupCount >= max;
    dom.btnDraw.disabled = n < 2;
    dom.btnDraw.textContent = n < 2 ? '至少添加 2 位选手' : `开始抽签分组（${n} ${unitOf(getEvent())}）`;
    dom.swSeed.classList.toggle('is-on', state.spreadSeeds);
    dom.swSeed.setAttribute('aria-checked', state.spreadSeeds ? 'true' : 'false');
  }

  /* ---------------------------------------------------------
   * 抽签算法
   * ------------------------------------------------------- */
  function drawGroups() {
    const n = state.players.length;
    if (n < 2) { toast('至少需要 2 位选手'); return; }

    const k = clamp(state.groupCount, 1, Math.min(n, MAX_GROUPS));
    if (k !== state.groupCount) {
      state.groupCount = k;
      toast(`人数不足，已调整为 ${k} 组`);
    }

    const sizes = groupSizes(n, k);
    const maxSize = Math.max.apply(null, sizes);

    // 蛇形槽位：保证每组人数均衡，种子优先占各组的第一位
    const slotOrder = [];
    for (let r = 0; r < maxSize; r++) {
      for (let c = 0; c < k; c++) {
        const g = r % 2 === 0 ? c : k - 1 - c;
        if (sizes[g] > r) slotOrder.push(g);
      }
    }

    const pool = state.players.map((p) => ({ n: p.n, seed: !!p.seed }));
    let queue;
    if (state.spreadSeeds && pool.some((p) => p.seed)) {
      const seeds = pool.filter((p) => p.seed);
      const rest = shuffle(pool.filter((p) => !p.seed));
      queue = seeds.concat(rest);
    } else {
      queue = shuffle(pool);
    }

    const groups = Array.from({ length: k }, () => ({ players: [] }));
    queue.forEach((p, i) => {
      const g = slotOrder[i];
      if (g == null) return;
      groups[g].players.push({ n: p.n, seed: !!p.seed });
    });

    state.groups = groups;
    state.groupCount = k;
    state.drawnAt = Date.now();
    state.dirty = false;
    ui.sel = null;
    save();
    renderResult();
    renderRoster();
    showView('result');
    buzz(14);
  }

  /* ---------------------------------------------------------
   * 渲染：结果
   * ------------------------------------------------------- */
  function renderResult(opts) {
    const animate = !(opts && opts.noAnim);
    const ev = getEvent();
    const unit = unitOf(ev);
    const groups = state.groups || [];
    const n = state.players.length;
    const k = groups.length;

    dom.resTitle.textContent = state.title.trim() || `${state.event} 分组结果`;
    dom.resEvent.textContent = state.event;
    dom.resMeta.textContent = `${state.event} · 共 ${n} ${unit} · 生成于 ${dateStr(state.drawnAt)}`;

    const sizes = groups.map((g) => g.players.length);
    const minS = Math.min.apply(null, sizes);
    const maxS = Math.max.apply(null, sizes);
    const many = unit === '人' ? '人数' : '对数';
    dom.resStats.innerHTML = `
      <div class="stat"><b>${n}</b><span>参赛${many}</span></div>
      <div class="stat"><b>${k}</b><span>小组数</span></div>
      <div class="stat"><b>${minS === maxS ? minS : minS + '~' + maxS}</b><span>每组${many}</span></div>`;

    dom.groups.classList.toggle('is-static', !animate);
    dom.groups.innerHTML = groups.map((g, gi) => `
      <article class="gcard" style="--h:${HUES[gi % HUES.length]};--i:${Math.min(gi, 8)}">
        <div class="ghead">
          <span class="gname">${groupLabel(gi)} 组</span>
          <span class="gcount">${g.players.length} ${unit}</span>
        </div>
        <ul class="glist">
          ${g.players.map((p, pi) => {
            const selected = ui.sel && ui.sel.g === gi && ui.sel.p === pi;
            return `<li class="gplayer${selected ? ' is-sel' : ''}" data-g="${gi}" data-p="${pi}" tabindex="0">
              <span class="gidx">${pi + 1}</span>
              <span class="gname-txt">${esc(p.n)}</span>
              ${p.seed ? '<span class="gseed">★</span>' : ''}
            </li>`;
          }).join('')}
        </ul>
      </article>`).join('');

    dom.seedLegend.classList.toggle('hidden', !groups.some((g) => g.players.some((p) => p.seed)));
    renderStaleNotice();

    if (ui.flash) {
      const keys = ui.flash;
      ui.flash = null;
      requestAnimationFrame(() => {
        keys.forEach(([g, p]) => {
          const node = dom.groups.querySelector(`.gplayer[data-g="${g}"][data-p="${p}"]`);
          if (node) node.classList.add('is-flash');
        });
      });
    }
  }

  function renderStaleNotice() {
    const old = document.getElementById('staleNotice');
    if (old) old.remove();
    if (!state.dirty) return;
    const box = document.createElement('div');
    box.id = 'staleNotice';
    box.className = 'notice';
    box.innerHTML = '<span>名单已修改，当前分组可能已过期</span><button type="button" id="btnStaleRedraw">重新抽签</button>';
    dom.viewResult.insertBefore(box, dom.groups);
    const btn = box.querySelector('#btnStaleRedraw');
    if (btn) btn.addEventListener('click', drawGroups);
  }

  /* ---------------------------------------------------------
   * 视图切换
   * ------------------------------------------------------- */
  function showView(name) {
    ui.view = name;
    dom.viewSetup.classList.toggle('hidden', name !== 'setup');
    dom.viewResult.classList.toggle('hidden', name !== 'result');
    dom.abSetup.classList.toggle('hidden', name !== 'setup');
    dom.abResult.classList.toggle('hidden', name !== 'result');
    ui.sel = null;
    if (name === 'result') {
      // 名单可能在上一步被改过，回到结果页时同步提示
      dom.groups.querySelectorAll('.gplayer.is-sel').forEach((n) => n.classList.remove('is-sel'));
      renderStaleNotice();
    }
    updateSteps();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateSteps() {
    const active = ui.shareOpen ? 3 : (ui.view === 'result' ? 2 : 1);
    Array.prototype.forEach.call(dom.steps.querySelectorAll('.step'), (b) => {
      const s = Number(b.dataset.step);
      b.classList.toggle('is-active', s === active);
      b.classList.toggle('is-done', s < active);
    });
  }

  /* ---------------------------------------------------------
   * 交换位置
   * ------------------------------------------------------- */
  function onPlayerTap(gi, pi) {
    const groups = state.groups;
    if (!groups || !groups[gi] || !groups[gi].players[pi]) return;

    if (!ui.sel) {
      ui.sel = { g: gi, p: pi };
      renderResult({ noAnim: true });
      buzz(6);
      return;
    }
    if (ui.sel.g === gi && ui.sel.p === pi) {
      ui.sel = null;
      renderResult({ noAnim: true });
      return;
    }

    const from = ui.sel;
    const a = groups[from.g].players[from.p];
    const b = groups[gi].players[pi];
    groups[from.g].players[from.p] = b;
    groups[gi].players[pi] = a;

    ui.sel = null;
    ui.flash = [[from.g, from.p], [gi, pi]];
    renderResult({ noAnim: true });
    save();
    buzz(10);
    toast(from.g === gi ? '已调整组内顺序' : `已把 ${a.n} 与 ${b.n} 交换`);
  }

  /* ---------------------------------------------------------
   * 二维码数据
   * ------------------------------------------------------- */
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(code) {
    let s = String(code).trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
    s += '='.repeat(pad);
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function buildPayload() {
    const groups = state.groups || [];
    return b64urlEncode(JSON.stringify({
      v: 1,
      e: state.event,
      t: state.title.trim(),
      g: groups.map((g) => g.players.map((p) => (p.seed ? '*' : '') + p.n)),
    }));
  }

  function shareCode() {
    const code = buildPayload();
    const { protocol, origin, pathname, search } = location;
    if (protocol === 'http:' || protocol === 'https:') {
      return `${origin}${pathname}${search}#d=${code}`;
    }
    return code;
  }

  function isLinkMode() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function decodeCode(raw) {
    if (!raw) throw new Error('empty');
    let text = String(raw).trim();
    const hashAt = text.indexOf('#d=');
    if (hashAt >= 0) text = text.slice(hashAt + 3);
    else if (/^https?:\/\//i.test(text)) throw new Error('no-data');
    text = text.split('&')[0].split(/\s/)[0];
    const json = JSON.parse(b64urlDecode(text));
    if (!json || !Array.isArray(json.g) || !json.g.length) throw new Error('bad');
    const groups = json.g.map((list) => ({
      players: (Array.isArray(list) ? list : []).map((v) => {
        const s = String(v);
        return s.charAt(0) === '*' ? { n: s.slice(1), seed: true } : { n: s, seed: false };
      }).filter((p) => p.n),
    })).filter((g) => g.players.length);
    if (!groups.length) throw new Error('bad');
    return {
      event: EVENTS.some((e) => e.key === json.e) ? json.e : state.event,
      title: typeof json.t === 'string' ? json.t : '',
      groups,
    };
  }

  function applyImported(data) {
    const players = [];
    const seen = new Set();
    data.groups.forEach((g) => g.players.forEach((p) => {
      if (seen.has(p.n)) return;
      seen.add(p.n);
      players.push({ n: p.n, seed: !!p.seed });
    }));
    state.event = data.event;
    state.title = data.title || '';
    state.groups = data.groups;
    state.players = players;
    state.groupCount = data.groups.length;
    state.drawnAt = Date.now();
    state.dirty = false;
    ui.sel = null;
    renderEventChips();
    dom.titleInput.value = state.title;
    renderRoster();
    updateGroupUI();
    renderResult();
    save();
    showView('result');
  }

  /* ---------------------------------------------------------
   * 绘制二维码
   * ------------------------------------------------------- */
  function makeQr(text) {
    if (typeof qrcode !== 'function') return null;
    const levels = ['M', 'L'];
    for (const lv of levels) {
      try {
        const q = qrcode(0, lv);
        q.addData(text, 'Byte');
        q.make();
        return { q, level: lv };
      } catch (_) { /* try next */ }
    }
    return null;
  }

  function paintQrModules(ctx, qr, x, y, boxSize) {
    const n = qr.getModuleCount();
    const quiet = 4;
    const total = n + quiet * 2;
    // 整数缩放，保证每个模块边缘都清晰，缩放后再居中
    const scale = Math.max(1, Math.floor(boxSize / total));
    const size = total * scale;
    const ox = x + Math.floor((boxSize - size) / 2);
    const oy = y + Math.floor((boxSize - size) / 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, size, size);
    ctx.fillStyle = '#08120e';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        ctx.fillRect(ox + (c + quiet) * scale, oy + (r + quiet) * scale, scale, scale);
      }
    }
    ctx.fillStyle = '#ffffff';
  }

  let qrCache = null;   // { qr, level, text }

  function renderShare() {
    const ev = getEvent();
    const groups = state.groups || [];
    if (!groups.length) return;

    const code = shareCode();
    const payload = qrCache && qrCache.text === code ? qrCache : null;
    const made = payload || makeQr(code);

    if (!made) {
      dom.qrCanvas.style.display = 'none';
      dom.qrTip.textContent = '数据太长，无法生成二维码';
      dom.qrInfo.textContent = '请减少人数或改用「保存海报」';
      dom.qrWarn.textContent = '';
      qrCache = null;
      dom.codeText.value = code;
      return;
    }
    qrCache = { q: made.q, level: made.level, text: code };

    // 绘制到页面 canvas
    const qr = made.q;
    const n = qr.getModuleCount();
    const quiet = 4;
    const total = n + quiet * 2;
    const scale = Math.max(2, Math.floor(900 / total));
    const size = total * scale;
    const cv = dom.qrCanvas;
    cv.width = size;
    cv.height = size;
    cv.style.display = 'block';
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#08120e';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }

    const totalPlayers = groups.reduce((s, g) => s + g.players.length, 0);
    dom.qrTip.textContent = isLinkMode() ? '扫码即可打开并还原本次分组' : '扫码保存这段分组数据（可复制导入）';
    dom.qrInfo.textContent = `${state.event} · ${totalPlayers} ${unitOf(ev)} · ${groups.length} 组 · 纠错 ${made.level}`;
    dom.codeText.value = code;
    dom.qrWarn.textContent = isLinkMode()
      ? '把二维码或海报发到群里，球友扫码就能看到分组。'
      : '当前是本地文件打开的，二维码里是分组数据文本。部署到网页后会自动变成可点击的分享链接。';
  }

  /* ---------------------------------------------------------
   * 海报绘制
   * ------------------------------------------------------- */
  const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';

  function rrect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, rr);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
      s = s.slice(0, -1);
    }
    return s + '…';
  }

  function buildPoster() {
    const ev = getEvent();
    const unit = unitOf(ev);
    const groups = state.groups || [];
    const k = groups.length;
    const n = groups.reduce((s, g) => s + g.players.length, 0);
    const cols = k <= 4 ? 2 : 3;
    const W = 1080;
    const P = 56;
    const GAP = 20;
    const cardW = (W - P * 2 - GAP * (cols - 1)) / cols;
    const headerH = 252;
    const rowH = 56;
    const cardTop = 76;

    const heights = groups.map((g) => cardTop + g.players.length * rowH + 12);
    const rows = [];
    for (let i = 0; i < k; i += cols) {
      const idxs = [];
      for (let j = 0; j < cols && i + j < k; j++) idxs.push(i + j);
      rows.push({
        idxs,
        h: Math.max.apply(null, idxs.map((ix) => heights[ix])),
      });
    }
    const contentH = rows.reduce((s, r) => s + r.h, 0) + GAP * Math.max(0, rows.length - 1);
    const contentTop = headerH + 30;

    // 二维码越大越密，尺寸按模块数自适应，保证打印出来也能扫
    const qrModules = qrCache ? qrCache.q.getModuleCount() + 8 : 0;
    const qrSize = qrCache ? clamp(Math.round(qrModules * 4.2), 160, 300) : 0;
    const footerH = qrCache ? Math.max(214, qrSize + 76) : 120;
    const H = contentTop + contentH + 30 + footerH;

    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');

    // 背景
    ctx.fillStyle = '#f2f7f4';
    ctx.fillRect(0, 0, W, H);

    // 顶部色块
    const grad = ctx.createLinearGradient(0, 0, W, headerH);
    grad.addColorStop(0, '#0f9d76');
    grad.addColorStop(0.55, '#12b886');
    grad.addColorStop(1, '#4cc9a4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, headerH + 18);
    // 装饰圆
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(W - 60, 30, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W - 190, headerH + 40, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.font = `600 24px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`羽毛球 · ${state.event}`, P, 84);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 52px ${FONT}`;
    const title = fitText(ctx, state.title.trim() || `${state.event} 分组结果`, W - P * 2 - 40);
    ctx.fillText(title, P, 152);

    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(`${n} ${unit}参赛 · ${k} 个小组 · ${dateStr(state.drawnAt)}`, P, 198);

    // 小组卡片
    let y = contentTop;
    rows.forEach((row) => {
      row.idxs.forEach((gi, j) => {
        const g = groups[gi];
        const x = P + j * (cardW + GAP);
        const h = heights[gi];
        const hue = HUES[gi % HUES.length];

        ctx.save();
        ctx.shadowColor = 'rgba(16, 52, 40, .10)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 6;
        ctx.fillStyle = '#ffffff';
        rrect(ctx, x, y, cardW, h, 20);
        ctx.fill();
        ctx.restore();

        // 组头
        ctx.save();
        rrect(ctx, x, y, cardW, h, 20);
        ctx.clip();
        ctx.fillStyle = `hsl(${hue} 58% 95%)`;
        ctx.fillRect(x, y, cardW, cardTop);
        ctx.restore();

        ctx.fillStyle = `hsl(${hue} 55% 30%)`;
        ctx.font = `800 30px ${FONT}`;
        ctx.fillText(`${groupLabel(gi)} 组`, x + 22, y + 48);

        ctx.fillStyle = `hsl(${hue} 35% 45%)`;
        ctx.font = `600 22px ${FONT}`;
        const cnt = `${g.players.length} ${unit}`;
        ctx.textAlign = 'right';
        ctx.fillText(cnt, x + cardW - 22, y + 47);
        ctx.textAlign = 'left';

        ctx.strokeStyle = `hsl(${hue} 40% 88%)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 18, y + cardTop);
        ctx.lineTo(x + cardW - 18, y + cardTop);
        ctx.stroke();

        // 选手
        g.players.forEach((p, pi) => {
          const py = y + cardTop + pi * rowH + 18;
          ctx.fillStyle = `hsl(${hue} 50% 92%)`;
          rrect(ctx, x + 20, py, 30, 30, 9);
          ctx.fill();

          ctx.fillStyle = `hsl(${hue} 45% 40%)`;
          ctx.font = `700 16px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(String(pi + 1), x + 35, py + 21);
          ctx.textAlign = 'left';

          ctx.fillStyle = '#13251f';
          ctx.font = `600 26px ${FONT}`;
          const nameMax = cardW - 20 - 30 - 16 - (p.seed ? 30 : 0) - 10;
          const name = fitText(ctx, p.n, nameMax);
          ctx.fillText(name, x + 62, py + 22);

          if (p.seed) {
            ctx.fillStyle = '#f0a020';
            ctx.font = `700 20px ${FONT}`;
            ctx.textAlign = 'right';
            ctx.fillText('★', x + cardW - 20, py + 22);
            ctx.textAlign = 'left';
          }
        });
      });
      y += row.h + GAP;
    });

    // 底部
    const fy = H - footerH + 6;
    ctx.strokeStyle = '#dbe8e1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(P, fy);
    ctx.lineTo(W - P, fy);
    ctx.stroke();

    const qy = fy + 26;
    if (qrCache) {
      ctx.fillStyle = '#ffffff';
      rrect(ctx, P, qy, qrSize + 16, qrSize + 16, 12);
      ctx.fill();
      paintQrModules(ctx, qrCache.q, P + 8, qy + 8, qrSize);
    }

    const tx = P + qrSize + 40;
    ctx.fillStyle = '#12261f';
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText('扫码查看完整分组', tx, qy + 54);

    ctx.fillStyle = '#6b8379';
    ctx.font = `500 23px ${FONT}`;
    ctx.fillText(isLinkMode() ? '打开链接即可查看 / 重新抽签' : '数据码：用抽签页「导入」还原', tx, qy + 98);

    ctx.fillStyle = '#a4b7ae';
    ctx.font = `500 21px ${FONT}`;
    ctx.fillText(`羽毛球电子抽签 · ${dateStr(state.drawnAt)}`, tx, qy + 142);
    ctx.textAlign = 'left';

    return cv;
  }

  /* ---------------------------------------------------------
   * 导出
   * ------------------------------------------------------- */
  function downloadCanvas(canvas, filename) {
    const finish = (url, revoke) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (!blob) { toast('导出失败，请长按图片保存'); return; }
        finish(URL.createObjectURL(blob), true);
        toast('已保存图片，请在下载目录查看');
      }, 'image/png');
    } else {
      finish(canvas.toDataURL('image/png'));
      toast('已保存图片');
    }
  }

  function buildQrExportCanvas() {
    if (!qrCache) return null;
    const ev = getEvent();
    const groups = state.groups || [];
    const totalPlayers = groups.reduce((s, g) => s + g.players.length, 0);

    const S = 900;
    const pad = 70;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S + 150;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);

    ctx.fillStyle = '#0f9d76';
    ctx.fillRect(0, 0, cv.width, 8);

    ctx.fillStyle = '#12261f';
    ctx.font = `800 40px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(fitText(ctx, state.title.trim() || `${state.event} 分组结果`, S - pad * 2), S / 2, 96);

    ctx.fillStyle = '#6b8379';
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(`${state.event} · ${totalPlayers} ${unitOf(ev)} · ${groups.length} 个小组`, S / 2, 140);

    paintQrModules(ctx, qrCache.q, pad, 178, S - pad * 2);

    ctx.fillStyle = '#12261f';
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText(isLinkMode() ? '扫码查看分组' : '扫码保存分组数据', S / 2, S + 300);

    ctx.fillStyle = '#9bb0a7';
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText('羽毛球电子抽签 · ' + dateStr(state.drawnAt), S / 2, S + 348);
    ctx.textAlign = 'left';

    return cv;
  }

  /* ---------------------------------------------------------
   * 面板开关
   * ------------------------------------------------------- */
  function openSheet(wrap) {
    // 面板打开时收起旧提示，避免盖住面板按钮
    dom.toast.classList.remove('is-show');
    wrap.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheet(wrap) {
    wrap.hidden = true;
    if (dom.shareWrap.hidden && dom.bulkWrap.hidden) document.body.style.overflow = '';
  }

  function openShare() {
    if (!state.groups || !state.groups.length) { toast('还没有分组结果'); return; }
    renderShare();
    ui.shareOpen = true;
    updateSteps();
    openSheet(dom.shareWrap);
  }

  function closeShare() {
    ui.shareOpen = false;
    updateSteps();
    closeSheet(dom.shareWrap);
  }

  function openBulk() {
    dom.bulkText.value = '';
    openSheet(dom.bulkWrap);
    setTimeout(() => dom.bulkText.focus(), 250);
  }

  /* ---------------------------------------------------------
   * 示例名单
   * ------------------------------------------------------- */
  function fillSample() {
    const ev = getEvent();
    const names = SAMPLE_NAMES.slice();
    let list;
    if (ev.pairs) {
      list = [];
      for (let i = 0; i < 8; i++) {
        list.push(`${names[i * 2]}/${names[i * 2 + 1]}`);
      }
    } else {
      list = names.slice(0, 12);
    }
    state.players = [];
    state.groups = null;
    state.dirty = false;
    state.groupCount = ev.pairs ? 2 : 4;
    addPlayers(list, { silent: true });
    if (!state.title.trim()) {
      state.title = '周末羽毛球友谊赛';
      dom.titleInput.value = state.title;
    }
    // 前两位标记为种子
    state.players.forEach((p, i) => { p.seed = i < 2; });
    renderRoster();
    updateGroupUI();
    save();
    toast('已填入示例名单');
  }

  /* ---------------------------------------------------------
   * 文字结果
   * ------------------------------------------------------- */
  function textResult() {
    const ev = getEvent();
    const groups = state.groups || [];
    const lines = [];
    lines.push(`【${state.title.trim() || state.event + ' 分组结果'}】`);
    lines.push(`${state.event} · ${groups.reduce((s, g) => s + g.players.length, 0)} ${unitOf(ev)} · ${groups.length} 组`);
    lines.push('');
    groups.forEach((g, i) => {
      lines.push(`${groupLabel(i)} 组（${g.players.length} ${unitOf(ev)}）`);
      g.players.forEach((p, pi) => {
        lines.push(`  ${pi + 1}. ${p.n}${p.seed ? ' ★' : ''}`);
      });
      lines.push('');
    });
    lines.push(`生成时间：${dateStr(state.drawnAt)}`);
    return lines.join('\n').trim();
  }

  /* ---------------------------------------------------------
   * 事件绑定
   * ------------------------------------------------------- */
  function bind() {
    /* 项目类型 */
    dom.eventChips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-event]');
      if (!btn) return;
      const next = btn.dataset.event;
      if (next === state.event) return;
      state.event = next;
      markDirty();
      renderEventChips();
      renderRoster();
      updateGroupUI();
      save();
      buzz(6);
    });

    /* 比赛名称 */
    dom.titleInput.addEventListener('input', () => {
      state.title = dom.titleInput.value;
      save();
    });

    /* 添加选手 */
    const doAdd = (keepFocus) => {
      const raw = dom.playerInput.value;
      const names = splitNames(raw);
      if (!names.length) {
        if (keepFocus) dom.playerInput.focus();
        return;
      }
      addPlayers(names);
      dom.playerInput.value = '';
      if (keepFocus) dom.playerInput.focus();
    };
    dom.btnAdd.addEventListener('click', () => doAdd(true));
    dom.playerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doAdd(true);
      }
    });
    // 失焦时自动收录，避免输入完忘记点按钮
    dom.playerInput.addEventListener('blur', () => {
      if (dom.playerInput.value.trim()) doAdd(false);
    });

    // 单行输入框会自动吞掉换行，多行粘贴走单独处理，避免「张三李四王五」粘成一个人
    dom.playerInput.addEventListener('paste', (e) => {
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData('text') : '';
      if (!text || !/[\r\n]/.test(text)) return;
      e.preventDefault();
      addPlayers(splitNames(text));
      dom.playerInput.value = '';
    });

    /* 名单 chip */
    dom.roster.addEventListener('click', (e) => {
      const chip = e.target.closest('.pchip');
      if (!chip) return;
      const i = Number(chip.dataset.i);
      const p = state.players[i];
      if (!p) return;
      if (e.target.closest('.pchip-x')) {
        state.players.splice(i, 1);
        markDirty();
        renderRoster();
        updateGroupUI();
        save();
        return;
      }
      p.seed = !p.seed;
      markDirty();
      renderRoster();
      save();
      buzz(6);
    });

    /* 批量粘贴 */
    dom.btnBulk.addEventListener('click', openBulk);
    $('btnBulkImport').addEventListener('click', () => {
      const names = splitNames(dom.bulkText.value);
      if (!names.length) { toast('没有识别到姓名'); return; }
      addPlayers(names);
      closeSheet(dom.bulkWrap);
    });
    dom.btnSample.addEventListener('click', fillSample);
    dom.btnClear.addEventListener('click', () => {
      if (!state.players.length) { toast('名单已经是空的'); return; }
      if (!window.confirm('确定清空全部名单和分组结果吗？')) return;
      state = defaultState();
      dom.titleInput.value = '';
      renderEventChips();
      renderRoster();
      updateGroupUI();
      save();
      showView('setup');
      toast('已清空');
    });

    /* 组数 */
    dom.gMinus.addEventListener('click', () => {
      if (state.groupCount <= 1) return;
      state.groupCount--;
      if (state.groups) state.dirty = true;
      updateGroupUI();
      save();
      buzz(5);
    });
    dom.gPlus.addEventListener('click', () => {
      if (state.groupCount >= maxGroups()) return;
      state.groupCount++;
      if (state.groups) state.dirty = true;
      updateGroupUI();
      save();
      buzz(5);
    });

    /* 种子分散 */
    dom.swSeed.addEventListener('click', () => {
      state.spreadSeeds = !state.spreadSeeds;
      updateGroupUI();
      save();
      toast(state.spreadSeeds ? '种子将分散到不同小组' : '改为完全随机分组');
    });

    /* 抽签 */
    dom.btnDraw.addEventListener('click', drawGroups);
    dom.btnRedraw.addEventListener('click', () => {
      drawGroups();
      toast('已重新抽签');
    });
    dom.btnBack.addEventListener('click', () => showView('setup'));

    /* 分组内点击交换 */
    dom.groups.addEventListener('click', (e) => {
      const li = e.target.closest('.gplayer');
      if (!li) return;
      onPlayerTap(Number(li.dataset.g), Number(li.dataset.p));
    });
    dom.groups.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const li = e.target.closest('.gplayer');
      if (!li) return;
      e.preventDefault();
      onPlayerTap(Number(li.dataset.g), Number(li.dataset.p));
    });

    /* 步骤条 */
    dom.steps.addEventListener('click', (e) => {
      const step = e.target.closest('.step');
      if (!step) return;
      const s = Number(step.dataset.step);
      if (s === 1) {
        if (!dom.shareWrap.hidden) closeShare();
        showView('setup');
      } else if (s === 2) {
        if (!dom.shareWrap.hidden) closeShare();
        if (!state.groups) { toast('先生成一次分组'); return; }
        showView('result');
      } else if (s === 3) {
        openShare();
      }
    });

    /* 面板关闭 */
    document.querySelectorAll('[data-close]').forEach((node) => {
      node.addEventListener('click', () => {
        const which = node.dataset.close;
        if (which === 'share') closeShare();
        else closeSheet(dom.bulkWrap);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!dom.shareWrap.hidden) closeShare();
      else if (!dom.bulkWrap.hidden) closeSheet(dom.bulkWrap);
    });

    /* 分享相关 */
    dom.btnShare.addEventListener('click', openShare);

    dom.btnCopyCode.addEventListener('click', () => {
      if (!dom.codeText.value) return;
      copyText(dom.codeText.value);
    });

    dom.btnCopyText.addEventListener('click', () => copyText(textResult()));

    dom.btnSaveQr.addEventListener('click', () => {
      const cv = buildQrExportCanvas();
      if (!cv) { toast('二维码还没生成'); return; }
      downloadCanvas(cv, fileStamp('二维码'));
    });

    dom.btnSavePoster.addEventListener('click', () => {
      if (!state.groups) return;
      try {
        const cv = buildPoster();
        downloadCanvas(cv, fileStamp('分组海报'));
      } catch (err) {
        toast('海报生成失败');
      }
    });

    dom.btnImport.addEventListener('click', () => {
      const raw = window.prompt('粘贴二维码里的链接或数据码：', '');
      if (!raw) return;
      try {
        applyImported(decodeCode(raw));
        closeShare();
        toast('已还原分组结果');
      } catch (err) {
        toast('内容无法识别，请检查后重试');
      }
    });

    /* 重置 */
    dom.btnReset.addEventListener('click', () => {
      if (!window.confirm('重置会清空当前名单与分组，继续吗？')) return;
      state = defaultState();
      dom.titleInput.value = '';
      renderEventChips();
      renderRoster();
      updateGroupUI();
      save();
      showView('setup');
      toast('已重置');
    });

    /* 从链接还原 */
    window.addEventListener('hashchange', handleUrlData);
  }

  function handleUrlData() {
    const hash = location.hash || '';
    const at = hash.indexOf('#d=');
    if (at < 0) return;
    try {
      const data = decodeCode(hash.slice(at + 3));
      applyImported(data);
      toast('已载入分享的分组结果', { top: true });
    } catch (_) {
      toast('链接里的分组数据无法识别', { top: true });
    }
  }

  /* ---------------------------------------------------------
   * 启动
   * ------------------------------------------------------- */
  function boot() {
    bind();

    const restored = load();
    dom.titleInput.value = state.title;
    renderEventChips();
    renderRoster();
    updateGroupUI();

    if (state.groups && state.groups.length) {
      renderResult({ noAnim: true });
      showView('result');
    } else {
      showView('setup');
    }

    handleUrlData();

    if (location.hash === '#demo' || /[?&]demo=1/.test(location.search)) {
      fillSample();
      drawGroups();
      // 演示参数用完就清掉，避免以后刷新时把用户数据覆盖掉
      try {
        history.replaceState(null, '', location.pathname + location.search.replace(/[?&]demo=1/, ''));
      } catch (_) { /* file:// 下可能不支持，忽略 */ }
    }

    if (!restored && !state.players.length) {
      setTimeout(() => toast('先添加名单，再点「开始抽签分组」', { top: true }), 500);
    }
  }

  /* ---------------------------------------------------------
   * 调试 / 自动化测试入口（正常使用无需关心）
   * ------------------------------------------------------- */
  window.__bdDebug = {
    getState: () => state,
    draw: drawGroups,
    sample: fillSample,
    poster: () => buildPoster(),
    qrExport: () => buildQrExportCanvas(),
    openShare,
    closeShare,
    renderShare,
    shareCode,
    textResult,
    importCode: (code) => applyImported(decodeCode(code)),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/**
 * 端到端检查脚本（仅开发使用，不参与网页运行）
 * 用 Chrome DevTools Protocol 打开页面 → 截图 → 解码二维码 → 校验分组逻辑
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const WEB_PORT = 8791;
const ROOT = 'E:/code_2026_xia/badminton_chouqian_web';
const OUT = path.resolve('tools/out');
const PAGE = 'file:///' + ROOT + '/index.html';
const NL = String.fromCharCode(10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------- CDP ------------------------------- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
      (this.handlers.get(msg.method) || []).forEach((fn) => fn(msg.params));
    });
  }
  on(method, fn) {
    const list = this.handlers.get(method) || [];
    list.push(fn);
    this.handlers.set(method, list);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('timeout: ' + method));
      }, 20000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function launch() {
  const dir = path.join(os.tmpdir(), 'bdmt-cdp-' + Date.now());
  const child = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${dir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      version = await res.json();
      break;
    } catch {
      await sleep(150);
    }
  }
  if (!version) throw new Error('Chrome 启动失败');
  return { child, dir };
}

async function openPage(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', (p) => {
    console.log('  [页面异常]', p.exceptionDetails.exception?.description || p.exceptionDetails.text);
  });
  return { cdp, target, ws };
}

async function setViewport(cdp, width, height, mobile = true, scale = 2) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile,
    screenWidth: width, screenHeight: height,
  });
}

async function goto(cdp, url) {
  const nav = await cdp.send('Page.navigate', { url });
  if (nav.errorText) throw new Error('navigate: ' + nav.errorText);
  for (let i = 0; i < 120; i++) {
    const ready = await cdp.evaluate('document.readyState').catch(() => 'loading');
    if (ready === 'complete') break;
    await sleep(100);
  }
  await sleep(400);
}

async function shot(cdp, file, fullPage = false) {
  let clip;
  if (fullPage) {
    const m = await cdp.send('Page.getLayoutMetrics');
    const cs = m.cssContentSize || m.contentSize;
    clip = { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.ceil(cs.height), scale: 1 };
  }
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: !!fullPage,
    ...(clip ? { clip } : {}),
  });
  await fsp.writeFile(file, Buffer.from(data, 'base64'));
  return file;
}

/* --------------------------- QR 解码 --------------------------- */
async function decodeQrFromPng(file) {
  const png = PNG.sync.read(await fsp.readFile(file));
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return res ? res.data : null;
}

/* ------------------------- 简易静态服务器 ------------------------- */
function startServer() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
  };
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    try {
      const data = await fsp.readFile(path.join(ROOT, p));
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => srv.listen(WEB_PORT, '127.0.0.1', () => resolve(srv)));
}

/* --------------------------- 主流程 --------------------------- */
async function main() {
  await fsp.rm(OUT, { recursive: true, force: true });
  await fsp.mkdir(OUT, { recursive: true });
  const report = { checks: [] };
  const ok = (name, pass, detail) => report.checks.push({ name, pass: !!pass, detail });

  const { child, dir } = await launch();
  try {
    const { cdp, target, ws } = await openPage('about:blank');
    await setViewport(cdp, 390, 844);
    await goto(cdp, PAGE);

    /* --- 1. 初始页面 --- */
    await shot(cdp, path.join(OUT, '01-setup-empty.png'), true);
    const empty = await cdp.evaluate(`({
      drawDisabled: document.getElementById('btnDraw').disabled,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })`);
    ok('空名单时抽签按钮不可点', empty.drawDisabled, JSON.stringify(empty));
    ok('首屏没有横向滚动', empty.overflowX <= 0, String(empty.overflowX));

    /* --- 2. 示例名单 + 抽签 --- */
    await cdp.evaluate('__bdDebug.sample()');
    await sleep(300);
    await shot(cdp, path.join(OUT, '02-setup-filled.png'), true);

    const before = await cdp.evaluate('__bdDebug.getState().players.length');
    await cdp.evaluate('document.getElementById("btnDraw").click()');
    await sleep(700);
    await shot(cdp, path.join(OUT, '03-result.png'), true);

    const st = await cdp.evaluate(`(() => {
      const s = __bdDebug.getState();
      const names = s.groups.flatMap(g => g.players.map(p => p.n));
      return {
        event: s.event,
        k: s.groups.length,
        sizes: s.groups.map(g => g.players.length),
        total: names.length,
        unique: new Set(names).size,
        missing: s.players.map(p => p.n).filter(n => !names.includes(n)),
        groupsWithSeeds: s.groups.map(g => g.players.filter(p => p.seed).length),
        seeds: s.players.filter(p => p.seed).length,
      };
    })()`);
    ok('分组人数与名单一致', st.total === before && st.missing.length === 0, JSON.stringify(st.sizes));
    ok('没有重复选手', st.unique === st.total, `unique=${st.unique}/${st.total}`);
    ok('组间人数最多差 1', Math.max(...st.sizes) - Math.min(...st.sizes) <= 1, st.sizes.join('/'));
    ok('种子分散在不同小组',
      st.groupsWithSeeds.filter((c) => c > 0).length === Math.min(st.seeds, st.k),
      st.groupsWithSeeds.join('/'));

    /* --- 3. 交换两名选手 --- */
    const swap = await cdp.evaluate(`(() => {
      const s0 = __bdDebug.getState();
      const a = s0.groups[0].players[0].n;
      const b = s0.groups[1].players[0].n;
      const el = (g, p) => document.querySelector('.gplayer[data-g="' + g + '"][data-p="' + p + '"]');
      el(0, 0).click();
      el(1, 0).click();
      const s1 = __bdDebug.getState();
      return { a, b, g0: s1.groups[0].players[0].n, g1: s1.groups[1].players[0].n };
    })()`);
    ok('点击可交换两名选手', swap.g0 === swap.b && swap.g1 === swap.a, JSON.stringify(swap));
    await sleep(300);
    await shot(cdp, path.join(OUT, '04-result-swapped.png'), true);

    /* --- 4. 二维码面板 --- */
    await cdp.evaluate('document.getElementById("btnShare").click()');
    await sleep(600);
    await shot(cdp, path.join(OUT, '05-share-sheet.png'), false);

    const decoded = await decodeQrFromPng(path.join(OUT, '05-share-sheet.png'));
    ok('截图里的二维码可以被解码', !!decoded, decoded ? decoded.slice(0, 40) + '…' : 'decode failed');

    const codeInPage = await cdp.evaluate('__bdDebug.shareCode()');
    ok('二维码内容与页面数据一致', !!decoded && decoded === codeInPage,
      `decoded=${decoded ? decoded.length : 0} page=${codeInPage.length}`);

    /* --- 5. 导入还原 --- */
    const roundtrip = await cdp.evaluate(`(() => {
      const code = __bdDebug.shareCode();
      const before = __bdDebug.getState().groups.map(g => g.players.map(p => p.n + (p.seed ? '*' : '')).join(','));
      __bdDebug.importCode(code);
      const after = __bdDebug.getState().groups.map(g => g.players.map(p => p.n + (p.seed ? '*' : '')).join(','));
      return { same: JSON.stringify(before) === JSON.stringify(after) };
    })()`);
    ok('扫码数据可以完整还原分组', roundtrip.same, JSON.stringify(roundtrip));

    /* --- 6. 海报 / 二维码图片导出 --- */
    await cdp.evaluate('document.getElementById("btnShare").click()');
    await sleep(500);
    const posterData = await cdp.evaluate('__bdDebug.poster().toDataURL("image/png")');
    const posterFile = path.join(OUT, '06-poster.png');
    await fsp.writeFile(posterFile, Buffer.from(posterData.split(',')[1], 'base64'));
    report.posterBytes = (await fsp.stat(posterFile)).size;

    const qrCard = await cdp.evaluate('__bdDebug.qrExport().toDataURL("image/png")');
    const qrCardFile = path.join(OUT, '07-qr-card.png');
    await fsp.writeFile(qrCardFile, Buffer.from(qrCard.split(',')[1], 'base64'));
    ok('导出的二维码图片可被解码', !!(await decodeQrFromPng(qrCardFile)), '');

    const posterQr = await decodeQrFromPng(posterFile);
    ok('海报里的二维码可解码', !!posterQr && posterQr === codeInPage,
      posterQr ? 'ok' : 'decode failed');

    /* --- 7. 多尺寸适配 --- */
    const sizes = [
      { name: '08-narrow-360', w: 360, h: 740, mobile: true },
      { name: '09-tablet-768', w: 768, h: 1024, mobile: true },
      { name: '10-desktop-1280', w: 1280, h: 900, mobile: false },
    ];
    for (const s of sizes) {
      await cdp.evaluate('__bdDebug.closeShare()');
      await setViewport(cdp, s.w, s.h, s.mobile, s.mobile ? 2 : 1);
      await sleep(250);
      await cdp.evaluate('window.scrollTo(0,0)');
      await sleep(150);
      await shot(cdp, path.join(OUT, s.name + '-result.png'), true);
      const ox = await cdp.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      ok(`${s.w}px 宽度没有横向溢出`, ox <= 0, String(ox));
    }

    /* --- 8. 双打模式 --- */
    await setViewport(cdp, 390, 844);
    await goto(cdp, PAGE + '#demo');
    await sleep(500);
    await cdp.evaluate(`(() => {
      document.querySelector('[data-event="男双"]').click();
      __bdDebug.sample();
      __bdDebug.draw();
      document.querySelector('[data-step="1"]').click();
    })()`);
    await sleep(400);
    await shot(cdp, path.join(OUT, '11-doubles-setup.png'), true);
    await cdp.evaluate('document.getElementById("btnDraw").click()');
    await sleep(600);
    await shot(cdp, path.join(OUT, '12-doubles-result.png'), true);
    const db = await cdp.evaluate(`(() => {
      const s = __bdDebug.getState();
      return { event: s.event, k: s.groups.length, sample: s.groups[0].players.map(p => p.n) };
    })()`);
    ok('双打项目可以正常分组', db.event === '男双' && db.k >= 1, JSON.stringify(db));

    /* --- 9. 30 人大名单（批量导入 / 二维码容量 / 海报高度） --- */
    await goto(cdp, PAGE);
    await sleep(400);
    const big = await cdp.evaluate(`(() => {
      const sur = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜';
      const giv = ['伟','芳','强','洋','静','帆','磊','丽','涛','敏','亮','悦','超','琳','军','佳','峰','晨','宁','欣','宇','杰','萍','鹏','慧','辉','娜','勇','雪','刚'];
      const names = [];
      for (let i = 0; i < 30; i++) names.push(sur[i] + giv[i]);
      localStorage.clear();
      __bdDebug.getState().players = [];
      document.querySelector('[data-event="男单"]').click();
      const title = document.getElementById('titleInput');
      title.value = '2026 城市羽毛球联赛（小组赛）';
      title.dispatchEvent(new Event('input'));
      document.getElementById('btnBulk').click();
      document.getElementById('bulkText').value = names.join(String.fromCharCode(10));
      document.getElementById('btnBulkImport').click();
      for (let i = 0; i < 60; i++) {
        const gc = __bdDebug.getState().groupCount;
        if (gc === 8) break;
        document.getElementById(gc < 8 ? 'gPlus' : 'gMinus').click();
      }
      __bdDebug.draw();
      const s = __bdDebug.getState();
      return { n: s.players.length, k: s.groups.length, sizes: s.groups.map(g => g.players.length) };
    })()`);
    await sleep(600);
    await shot(cdp, path.join(OUT, '13-big-result.png'), true);
    ok('30 人批量导入 + 8 组正常', big.n === 30 && big.k === 8, JSON.stringify(big));

    await cdp.evaluate('document.getElementById("btnShare").click()');
    await sleep(600);
    await shot(cdp, path.join(OUT, '14-big-share.png'), false);
    const bigQr = await decodeQrFromPng(path.join(OUT, '14-big-share.png'));
    ok('30 人时二维码依然可解码', !!bigQr && bigQr === await cdp.evaluate('__bdDebug.shareCode()'),
      bigQr ? String(bigQr.length) : 'fail');
    const bigPoster = await cdp.evaluate('__bdDebug.poster().toDataURL("image/png")');
    await fsp.writeFile(path.join(OUT, '15-big-poster.png'), Buffer.from(bigPoster.split(',')[1], 'base64'));

    /* --- 10. 深色模式 --- */
    await cdp.evaluate('__bdDebug.closeShare()');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(300);
    await shot(cdp, path.join(OUT, '16-dark-result.png'), true);
    await cdp.evaluate('document.getElementById("btnShare").click()');
    await sleep(500);
    await shot(cdp, path.join(OUT, '17-dark-share.png'), false);
    await cdp.evaluate('__bdDebug.closeShare()');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    /* --- 11. 链接模式（http） --- */
    const server = await startServer();
    try {
      await goto(cdp, `http://127.0.0.1:${WEB_PORT}/index.html#demo`);
      await sleep(500);
      const link = await cdp.evaluate('__bdDebug.shareCode()');
      ok('http 模式下二维码内容是分享链接',
        /^http:\/\/127\.0\.0\.1:\d+\/index\.html#d=/.test(link), link.slice(0, 70));
      const expect = await cdp.evaluate('__bdDebug.getState().groups.map(g => g.players.map(p => p.n).join("|"))');
      await cdp.evaluate('localStorage.clear()');
      await goto(cdp, link);
      await sleep(500);
      const got = await cdp.evaluate('__bdDebug.getState().groups.map(g => g.players.map(p => p.n).join("|"))');
      ok('通过分享链接打开能还原分组', JSON.stringify(got) === JSON.stringify(expect), JSON.stringify(got).slice(0, 100));
      await shot(cdp, path.join(OUT, '18-link-open.png'), true);

      await cdp.evaluate('__bdDebug.openShare()');
      await sleep(500);
      await shot(cdp, path.join(OUT, '19-link-share.png'), false);
      const linkQr = await decodeQrFromPng(path.join(OUT, '19-link-share.png'));
      ok('链接模式二维码可解码', linkQr === link, linkQr ? linkQr.slice(0, 40) : 'fail');
    } finally {
      server.close();
    }

    /* --- 12. 极窄屏 320 + 多行粘贴 --- */
    await setViewport(cdp, 320, 568);
    await goto(cdp, PAGE);
    await sleep(400);
    const paste = await cdp.evaluate(`(() => {
      localStorage.clear();
      __bdDebug.getState().players = [];
      const inp = document.getElementById('playerInput');
      const dt = new DataTransfer();
      dt.setData('text/plain', '张三' + String.fromCharCode(10) + '李四' + String.fromCharCode(10) + '王五');
      inp.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return __bdDebug.getState().players.map(p => p.n);
    })()`);
    ok('多行粘贴能拆成多名选手', JSON.stringify(paste) === JSON.stringify(['张三', '李四', '王五']), JSON.stringify(paste));

    await cdp.evaluate(`(() => {
      const names = ['陈一','赵二','孙三','周四','吴五','郑六','王七','冯八','陈九','褚十','卫甲','蒋乙','沈丙','韩丁','杨戊','朱己'];
      document.getElementById('btnBulk').click();
      document.getElementById('bulkText').value = names.join(String.fromCharCode(10));
      document.getElementById('btnBulkImport').click();
      __bdDebug.draw();
    })()`);
    await sleep(600);
    await shot(cdp, path.join(OUT, '20-320-result.png'), true);
    const ox320 = await cdp.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    ok('320 宽度没有横向溢出', ox320 <= 0, String(ox320));

    // 320x568 打开二维码面板：面板要能内部滚动，不能被裁掉
    await cdp.evaluate('document.getElementById("btnShare").click()');
    await sleep(600);
    await shot(cdp, path.join(OUT, '22-small-share.png'), false);
    const sm = await cdp.evaluate(`(() => {
      const sheet = document.querySelector('#shareWrap .sheet');
      const body = document.querySelector('#shareWrap .sheet-body');
      const r = sheet.getBoundingClientRect();
      return {
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        vh: window.innerHeight,
        scrollable: body.scrollHeight > body.clientHeight,
      };
    })()`);
    ok('小屏面板不超出视口', sm.top >= 0 && sm.bottom <= sm.vh, JSON.stringify(sm));
    await cdp.evaluate('__bdDebug.closeShare()');

    /* --- 13. 长名字 / 生僻字 --- */
    await setViewport(cdp, 390, 844);
    await goto(cdp, PAGE);
    await sleep(400);
    await cdp.evaluate(`(() => {
      localStorage.clear();
      __bdDebug.getState().players = [];
      document.getElementById('btnBulk').click();
      document.getElementById('bulkText').value = ['欧阳娜娜','司马相如','爱新觉罗·启星','阿卜杜拉·买买提','张三丰','李四光'].join(String.fromCharCode(10));
      document.getElementById('btnBulkImport').click();
      __bdDebug.getState().groupCount = 2;
      __bdDebug.draw();
    })()`);
    await sleep(500);
    await shot(cdp, path.join(OUT, '21-long-names.png'), true);

    report.shots = (await fsp.readdir(OUT)).sort();
    report.ok = report.checks.every((c) => c.pass);

    ws.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  } finally {
    child.kill();
    await sleep(300);
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});

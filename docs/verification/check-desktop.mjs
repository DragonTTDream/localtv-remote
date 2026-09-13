/**
 * T3 harness — localtv-remote 桌面魔改 验证（无头 Chrome）
 * 写者：云端（本地模型在此任务上超时失败）
 * 关键点：脚本必须放在装有 puppeteer-core 的目录下，Node 才解析得到模块。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'public', 'control');
const CHROME =
  '/home/loong/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const PORT = 8766;
const PAGE_URL = `http://127.0.0.1:${PORT}/`;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT_JSON = path.join(HERE, 'evidence.json');
const OUT_PNG_DESKTOP = path.join(HERE, 'desktop.png');
const OUT_PNG_MOBILE = path.join(HERE, 'mobile.png');

const TAG_CLICK = 0x06; // BINARY_TAG.CLICK（controller.js:182）

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

const results = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const add = (name, pass, actual) => {
  results.push({ name, pass: !!pass, actual });
  log(name, pass ? 'PASS' : 'FAIL', JSON.stringify(actual)?.slice(0, 260));
};

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = p === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, p);
  fs.readFile(file, (e, buf) => {
    if (e) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

let browser = null;
const watchdog = setTimeout(() => {
  log('WATCHDOG_TIMEOUT (300s)');
  finish(3);
}, 300000);

async function finish(code) {
  clearTimeout(watchdog);
  try {
    if (browser) await browser.close();
  } catch {}
  try {
    server.close();
  } catch {}
  try {
    fs.writeFileSync(OUT_JSON, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  } catch (e) {
    log('write evidence failed', String(e));
  }
  process.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  log('static server up on', PORT);

  browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--touch-events=enabled'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200));
  });

  // 加载前注入：stub WebSocket（记录所有 send）+ 伪造 sessionToken 直接进 remote 面板
  await page.evaluateOnNewDocument(() => {
    window.__sent = [];
    class FakeWS {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.binaryType = 'blob';
        this._l = {};
        setTimeout(() => {
          this.readyState = 1;
          (this._l.open || []).forEach((f) => f({}));
          // 关键：controller.js:313/318 的 sendMessage/sendBinary 都有 `!isAuthenticated` 守卫，
          // 而 isAuthenticated 只在收到服务器的 auth_ok 后才置真 —— stub 必须回这一条，
          // 否则所有输入帧被静默丢弃（首轮 5/10 失败就是这里）。
          const ev = {
            data: JSON.stringify({
              type: 'auth_ok',
              sessionToken: 'test-token',
              remoteCursorVisible: false,
            }),
          };
          (this._l.message || []).forEach((f) => f(ev));
        }, 0);
      }
      addEventListener(t, f) {
        (this._l[t] = this._l[t] || []).push(f);
      }
      removeEventListener() {}
      send(d) {
        if (d instanceof ArrayBuffer) {
          window.__sent.push({ kind: 'binary', bytes: Array.from(new Uint8Array(d)) });
        } else if (ArrayBuffer.isView(d)) {
          window.__sent.push({
            kind: 'binary',
            bytes: Array.from(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)),
          });
        } else {
          window.__sent.push({ kind: 'text', data: String(d) });
        }
      }
      close() {
        this.readyState = 3;
      }
    }
    window.WebSocket = FakeWS;
    try {
      localStorage.setItem('localtv.remote.sessionToken', 'test-token');
    } catch {}
  });

  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => {
      const t = document.getElementById('trackpad');
      return !!t && t.offsetParent !== null && t.getBoundingClientRect().width > 50;
    },
    { timeout: 20000, polling: 200 },
  );
  log('page ready — remote panel visible');

  const rect = () =>
    page.$eval('#trackpad', (e) => {
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
  const frames = () => page.evaluate(() => window.__sent);
  const clear = () => page.evaluate(() => { window.__sent.length = 0; });
  const clickByte = async () => {
    const f = (await frames()).find((x) => x.kind === 'binary' && x.bytes[0] === TAG_CLICK);
    return f ? f.bytes[1] : null;
  };

  const r0 = await rect();
  await page.screenshot({ path: OUT_PNG_DESKTOP });

  // A — 捕获开关生效
  await page.click('#btn-lock');
  await sleep(400);
  const lockEl = await page.evaluate(
    () => (document.pointerLockElement && document.pointerLockElement.id) || null,
  );
  add('A_pointer_lock_element_is_trackpad', lockEl === 'trackpad', { pointerLockElement: lockEl });

  // B — 锁定后用 movementX/Y 发相对位移
  await clear();
  await page.mouse.move(r0.cx + 40, r0.cy + 20);
  await sleep(600);
  const moveFrames = (await frames()).filter((f) => f.kind === 'binary');
  add('B_relative_move_frame_while_locked', moveFrames.length > 0, {
    count: moveFrames.length,
    firstFrames: moveFrames.slice(0, 3),
  });

  // J — 锁定态下左键点击（用户实测报告：进入捕获后左键失灵）
  // 注：首版 harness 只在「退出捕获后」测左键（E），漏了锁定态，这是验证盲区。
  await clear();
  await page.mouse.click(r0.cx, r0.cy, { button: 'left' });
  await sleep(400);
  const jByte = await clickByte();
  add('J_left_click_while_pointer_locked', jByte === 0, {
    buttonIndex: jByte,
    expect: 0,
    stillLocked: await page.evaluate(
      () => (document.pointerLockElement && document.pointerLockElement.id) || null,
    ),
  });

  // B2 — 退出捕获
  await page.evaluate(() => document.exitPointerLock && document.exitPointerLock());
  await sleep(400);
  const afterExit = await page.evaluate(
    () => (document.pointerLockElement && document.pointerLockElement.id) || null,
  );
  add('B2_exit_pointer_lock', afterExit === null, { pointerLockElement: afterExit });

  // C — 右键 → button index 2
  await clear();
  await page.mouse.click(r0.cx, r0.cy, { button: 'right' });
  await sleep(400);
  const cByte = await clickByte();
  add('C_right_click_button_index_2', cByte === 2, { buttonIndex: cByte, expect: 2 });

  // D — 中键 → button index 1
  await clear();
  await page.mouse.click(r0.cx, r0.cy, { button: 'middle' });
  await sleep(400);
  const dByte = await clickByte();
  add('D_middle_click_button_index_1', dByte === 1, { buttonIndex: dByte, expect: 1 });

  // E — 左键回归 → button index 0
  await clear();
  await page.mouse.click(r0.cx, r0.cy, { button: 'left' });
  await sleep(400);
  const eByte = await clickByte();
  add('E_left_click_button_index_0', eByte === 0, { buttonIndex: eByte, expect: 0 });

  // F — 双指轻点（触摸路径）→ 右键，确认未回归
  await clear();
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: Math.round(r0.cx - 25), y: Math.round(r0.cy) },
      { x: Math.round(r0.cx + 25), y: Math.round(r0.cy) },
    ],
  });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  const fByte = await clickByte();
  add('F_two_finger_tap_sends_right_click', fByte === 2, {
    buttonIndex: fByte,
    expect: 2,
    note: '触摸双指轻点路径（未回归判据）',
  });

  // ── 拖拽（按下/抬起）断言 N/O/P/Q ──────────────────────────
  const tagOf = (f) => (f.kind === 'binary' ? f.bytes[0] : null);
  const tagsSent = async () => (await frames()).filter((f) => f.kind === 'binary').map(tagOf);

  // N — 捕获态下：按下 → 拖动 60px → 松开，应发出 DOWN(3) + 位移(1) + UP(4)，且不发 CLICK(6)
  await page.click('#btn-lock');
  await sleep(300);
  await clear();
  await page.mouse.move(r0.cx, r0.cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(r0.cx + i * 10, r0.cy + i * 3);
    await sleep(30);
  }
  await page.mouse.up();
  await sleep(500);
  const dragTags = await tagsSent();
  add(
    'N_drag_sends_down_moves_up',
    dragTags.includes(0x03) && dragTags.includes(0x01) && dragTags.includes(0x04) && !dragTags.includes(0x06),
    { tags: dragTags.slice(0, 14), expect: '3,1…,4 且无 6' },
  );
  await page.evaluate(() => document.exitPointerLock && document.exitPointerLock());
  await sleep(300);

  // O — 轻点（几乎不动）仍是 CLICK(6)，不该发 DOWN/UP
  await clear();
  await page.mouse.click(r0.cx, r0.cy, { button: 'left' });
  await sleep(500);
  const tapTags = await tagsSent();
  add('O_tap_still_sends_click', tapTags.includes(0x06) && !tapTags.includes(0x03), {
    tags: tapTags,
    expect: '含 6、不含 3',
  });

  // P — 粘滞左键：点一下 → DOWN(3) + 高亮；再点一下 → UP(4)
  await clear();
  await page.click('#btn-left-drag');
  await sleep(300);
  const pDownTags = await tagsSent();
  const pPressed = await page.$eval('#btn-left-drag', (e) => e.getAttribute('aria-pressed'));
  await clear();
  await page.click('#btn-left-drag');
  await sleep(300);
  const pUpTags = await tagsSent();
  const pReleased = await page.$eval('#btn-left-drag', (e) => e.getAttribute('aria-pressed'));
  add(
    'P_sticky_left_toggles_down_up',
    pDownTags.includes(0x03) && pUpTags.includes(0x04) && pPressed === 'true' && pReleased === 'false',
    { downTags: pDownTags, upTags: pUpTags, pressed: pPressed, released: pReleased },
  );

  // Q — 粘滞左键按住时，触摸单指轻点不再发 CLICK(6)（否则会把左键松开）
  await clear();
  await page.click('#btn-left-drag'); // 按住
  await sleep(200);
  await clear();
  const cdp2 = await page.createCDPSession();
  await cdp2.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: Math.round(r0.cx), y: Math.round(r0.cy) }],
  });
  await sleep(60);
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  const qTags = await tagsSent();
  add('Q_sticky_left_suppresses_tap_click', !qTags.includes(0x06), { tags: qTags, expect: '不含 6' });
  await page.click('#btn-left-drag'); // 松开粘滞左键
  await sleep(200);

  // G — 手机端：只隐藏「捕获指针」，粘滞左键必须可用（本次新增需求）
  const desktopLockDisplay = await page.$eval('#btn-lock', (e) => getComputedStyle(e).display);
  const desktopLeftDisplay = await page.$eval('#btn-left-drag', (e) => getComputedStyle(e).display);
  await page.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await sleep(500);
  const mobileLockDisplay = await page.$eval('#btn-lock', (e) => getComputedStyle(e).display);
  const mobileLeftDisplay = await page.$eval('#btn-left-drag', (e) => getComputedStyle(e).display);
  await page.screenshot({ path: OUT_PNG_MOBILE });
  add(
    'G_touch_keeps_left_button_hides_capture',
    desktopLockDisplay !== 'none' &&
      desktopLeftDisplay !== 'none' &&
      mobileLockDisplay === 'none' &&
      mobileLeftDisplay !== 'none',
    {
      desktop: { lock: desktopLockDisplay, left: desktopLeftDisplay },
      mobile: { lock: mobileLockDisplay, left: mobileLeftDisplay },
      expect: { mobileLock: 'none', mobileLeft: 'not none' },
    },
  );

  // H — 两种模式下触控板几何未回归
  const rm = await rect();
  add('H_trackpad_geometry_both_modes', rm.w > 50 && rm.h > 50 && r0.w > 50 && r0.h > 50, {
    desktop: { w: Math.round(r0.w), h: Math.round(r0.h) },
    mobile: { w: Math.round(rm.w), h: Math.round(rm.h) },
  });

  // ── 音量拖动条（K/L/M）—— 验收断言的唯一尺子 ──
  const volTrackRect = () =>
    page.$eval('#volume-track', (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cy: r.y + r.height / 2 };
    });
  const lastVolumeSet = async () => {
    const arr = (await frames()).filter(
      (f) => f.kind === 'text' && /"type":\s*"volume_set"/.test(f.data),
    );
    if (!arr.length) return null;
    try {
      return JSON.parse(arr[arr.length - 1].data).percent;
    } catch {
      return null;
    }
  };
  const dragVolumeTo = async (frac) => {
    const t = await volTrackRect();
    const x = Math.round(t.x + t.w * frac);
    await page.mouse.move(x, Math.round(t.cy));
    await page.mouse.down();
    await page.mouse.move(x, Math.round(t.cy), { steps: 2 });
    await page.mouse.up();
    await sleep(500); // volume_set 有 120ms 防抖
  };

  let trackExists = true;
  await clear();
  try {
    await dragVolumeTo(0.25);
  } catch (err) {
    trackExists = false;
    add('K_volume_drag_25_percent', false, { error: '找不到可拖动的 #volume-track：' + String(err).slice(0, 120) });
  }
  if (trackExists) {
    const p25 = await lastVolumeSet();
    add('K_volume_drag_25_percent', typeof p25 === 'number' && p25 >= 20 && p25 <= 30, {
      percent: p25,
      expect: '20–30',
    });
    await clear();
    await dragVolumeTo(0.8);
    const p80 = await lastVolumeSet();
    add('L_volume_drag_80_percent', typeof p80 === 'number' && p80 >= 75 && p80 <= 85, {
      percent: p80,
      expect: '75–85',
    });
    await clear();
    await page.click('#vol-up');
    await sleep(500);
    const pUp = await lastVolumeSet();
    add('M_volume_up_button_still_works', typeof pUp === 'number' && typeof p80 === 'number' && pUp > p80, {
      before: p80,
      afterUp: pUp,
    });
  }

  // I — 无页面错误
  add('I_no_page_errors', errs.length === 0, { errors: errs.slice(0, 5) });

  const failed = results.filter((r) => !r.pass);
  log(`DONE — ${results.length - failed.length}/${results.length} passed`);
  await finish(failed.length ? 1 : 0);
} catch (e) {
  log('HARNESS_ERROR', String(e).slice(0, 400));
  add('harness_execution', false, { error: String(e).slice(0, 400) });
  await finish(2);
}

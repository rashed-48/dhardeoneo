/**
 * Browser tests: drives the production build in headless Chrome.
 *
 *   npm run test:browser
 *
 * This is kept out of `npm test` because it needs Chrome installed and builds
 * the SPA first. It starts its own server on a spare port with a throwaway
 * database, so nothing needs to be running and development data is untouched.
 *
 * It covers the things only a real browser can show: that the session cookie is
 * unreachable from JavaScript, that checkout survives a declined card, and that
 * a lapsed session sends someone to the login screen rather than stranding them
 * on a form.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const PORT = 4400 + Math.floor(Math.random() * 400);
const APP = `http://127.0.0.1:${PORT}`;
const DEBUG_PORT = PORT + 1000;
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-browser-'));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

if (!chromePath) {
  console.log('SKIP  No Chrome found. Set CHROME_PATH to run the browser tests.');
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  process.exit(0);
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
let chrome;
let ws;

async function main() {
  console.log('Building the SPA...');
  const build = spawnSync('npm', ['--prefix', 'web', 'run', 'build'], {
    cwd: ROOT, stdio: 'inherit', shell: true,
  });
  if (build.status !== 0) throw new Error('web build failed');

  console.log(`Starting the server on ${PORT}...`);
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SHELF_DATA_DIR: path.join(WORK_DIR, 'data'),
      SHELF_SECRET: 'browser-test-secret-long-enough',
      NODE_ENV: 'test', // keeps the cookie usable over plain http
    },
    stdio: 'pipe',
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`${APP}/api/health`)).ok) break; } catch { /* starting */ }
    await sleep(250);
  }

  chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, '--remote-allow-origins=*',
    '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--window-size=1440,1000', `--user-data-dir=${path.join(WORK_DIR, 'profile')}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error('Chrome debugger never became available');

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (message) => {
    const msg = JSON.parse(message.data);
    if (msg.id) { pending.get(msg.id)?.(msg.result ?? {}); pending.delete(msg.id); return; }
    if (msg.method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(msg.params.entry.text || ''))
      consoleErrors.push('CSP: ' + msg.params.entry.text);
    if (msg.method === 'Runtime.exceptionThrown')
      consoleErrors.push(msg.params.exceptionDetails.exception?.description?.split('\n')[0] || 'exception');
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });

  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const waitFor = async (expression, tries = 80) => {
    for (let i = 0; i < tries; i++) { if (await evaluate(expression)) return true; await sleep(250); }
    return false;
  };
  const go = async (url) => { await send('Page.navigate', { url }); };
  const typeInto = async (selector, value) => {
    const present = await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
    if (!present) throw new Error(`field never appeared: ${selector}`);
    return rawType(selector, value);
  };
  const rawType = (selector, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Network.enable');

  const signIn = async () => {
    await go(`${APP}/login`);
    await waitFor("!!document.querySelector('input[type=email]')");
    await typeInto('input[type=email]', 'ayesha@shelf.app');
    await typeInto('input[type=password]', 'password123');
    await sleep(250);
    await evaluate("document.querySelector('form button[type=submit]').click()");
    return waitFor("location.pathname === '/'");
  };

  // --- public pages ---
  await go(`${APP}/browse`);
  await waitFor("document.body.innerText.includes('available near')");
  await sleep(2500);
  const covers = await evaluate(`(() => {
    const imgs = [...document.querySelectorAll('img[alt^="Cover of"]')];
    return {
      count: imgs.length,
      broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      sameOrigin: imgs.slice(0, 5).every(i => (i.getAttribute('src') || '').startsWith('/covers/')),
    };
  })()`);
  check('browse renders cover art', covers.count > 20, `found=${covers.count}`);
  check('no cover image is broken', covers.broken === 0, `broken=${covers.broken}`);
  check('covers are served same-origin', covers.sameOrigin);

  // --- the session must be invisible to scripts ---
  check('sign in through the form', await signIn());
  check('no auth token in localStorage', !(await evaluate("localStorage.getItem('shelf.token')")));
  check('session cookie hidden from document.cookie',
    !(await evaluate("document.cookie.includes('shelf_session')")));

  // --- checkout, including a declined card ---
  await go(`${APP}/dashboard?tab=borrowing`);
  await waitFor("document.body.innerText.includes('Your rentals')");
  await sleep(2000);
  check('a rental is waiting for payment',
    /waiting for payment/i.test(await evaluate('document.body.innerText')));

  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Pay \\u09f3/.test(x.textContent.trim()));
    if (b) b.click();
    return !!b;
  })()`);
  check('checkout opens', await waitFor(`!!document.querySelector('[role="dialog"]')`));

  const payInSheet = `(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'no-dialog';
    const b = [...d.querySelectorAll('button')].find(x => /^Pay \\u09f3/.test(x.textContent.trim()));
    if (!b) return 'no-button';
    if (b.disabled) return 'disabled';
    b.click();
    return 'clicked';
  })()`;

  await typeInto('input[autocomplete="cc-number"]', '4000 0000 0000 0002');
  await typeInto('input[autocomplete="cc-exp"]', '12/31');
  await typeInto('input[autocomplete="cc-csc"]', '123');
  await sleep(300);
  await evaluate(payInSheet);
  check('a declined card is reported in the sheet',
    await waitFor(`!!document.querySelector('[role="dialog"] [role=alert]')`));
  const declineText = await evaluate(`document.querySelector('[role="dialog"] [role=alert]')?.textContent || ''`);
  check('the decline reason comes from the gateway', /declined/i.test(declineText), declineText);

  await typeInto('input[autocomplete="cc-number"]', '4242 4242 4242 4242');
  await sleep(300);
  await evaluate(payInSheet);
  check('a good card closes the sheet', await waitFor(`!document.querySelector('[role="dialog"]')`));
  await sleep(2000);

  const afterPayment = await evaluate('document.body.innerText');
  check('the receipt line appears', /You paid/.test(afterPayment));
  check('only the card brand and last four are shown', /Visa ···· 4242/.test(afterPayment));

  const onServer = await evaluate(`(async () => {
    const res = await fetch('/api/rentals?role=borrower', { credentials: 'same-origin' });
    const { items } = await res.json();
    const r = items.find(i => i.awaitingPayment === false && i.amountPaid > 0);
    return r ? { paid: r.amountPaid } : null;
  })()`);
  check('the server recorded the payment', onServer && onServer.paid > 0, JSON.stringify(onServer));

  // --- a lapsed session must not strand anyone ---
  await go(`${APP}/dashboard?tab=lending`);
  await waitFor("document.body.innerText.includes('Your rentals')");
  await sleep(1500);
  await send('Network.clearBrowserCookies');

  await evaluate(`[...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/lend')?.click()`);
  check('an expired session redirects to login', await waitFor("location.pathname === '/login'"),
    `path=${await evaluate('location.pathname')}`);
  check('the login screen explains why',
    /signed out after a while away/i.test(await evaluate('document.body.innerText')));

  await typeInto('input[type=email]', 'ayesha@shelf.app');
  await typeInto('input[type=password]', 'password123');
  await sleep(250);
  await evaluate("document.querySelector('form button[type=submit]').click()");
  check('signing back in returns to the intended page',
    await waitFor("location.pathname === '/lend'"), `path=${await evaluate('location.pathname')}`);

  // --- guards against false positives ---
  await send('Network.clearBrowserCookies');
  await go(`${APP}/browse`);
  await waitFor("document.body.innerText.includes('available near')");
  await sleep(1500);
  check('signed-out browsing is never hijacked', await evaluate("location.pathname === '/browse'"));

  await go(`${APP}/login`);
  await waitFor("!!document.querySelector('input[type=email]')");
  await typeInto('input[type=email]', 'ayesha@shelf.app');
  await typeInto('input[type=password]', 'the-wrong-password');
  await sleep(250);
  await evaluate("document.querySelector('form button[type=submit]').click()");
  await sleep(1500);
  const loginError = await evaluate(`document.querySelector('[role=alert]')?.textContent || ''`);
  check('a wrong password is an error, not a session expiry',
    /wrong email or password/i.test(loginError) && (await evaluate("location.pathname === '/login'")),
    loginError);

  check('no console or CSP errors', consoleErrors.length === 0, consoleErrors.join(' | '));
}

try {
  await main();
} catch (error) {
  check('browser suite ran to completion', false, error.message);
} finally {
  try { ws?.close(); } catch { /* already gone */ }
  chrome?.kill();
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  await sleep(500);
  // Chrome profiles are hundreds of megabytes; never leave them behind.
  try {
    fs.rmSync(WORK_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    console.warn(`Could not remove ${WORK_DIR}; delete it by hand.`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);

// Render every .page of the given test HTML files to PNG with headless Chrome (CDP).
// The PNGs are the backgrounds that ink.js composites the child's strokes onto
// when saving a photo of a page.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function renderPages(htmlFiles, outDir) {
  await mkdir(outDir, { recursive: true });
  const prof = await mkdtemp(join(tmpdir(), 'nam-render-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 40 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(250); }
    }
    if (!targets) throw new Error('Chrome did not start');
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;

    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1200, deviceScaleFactor: 2, mobile: false });
    for (const file of htmlFiles) {
      const base = file.split('/').pop().replace(/\.html$/, '');
      await send('Page.navigate', { url: `file://${file}?render=1` });
      await sleep(800);
      await evaluate('new Promise((r) => (document.readyState === "complete" ? r() : addEventListener("load", r))).then(() => document.fonts.ready).then(() => 1)');
      await sleep(300);
      const rects = await evaluate('[...document.querySelectorAll(".page")].map((p) => { const b = p.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })');
      for (let n = 0; n < rects.length; n++) {
        const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...rects[n], scale: 1 }, captureBeyondViewport: true });
        await writeFile(join(outDir, `${base}-${n + 1}.png`), Buffer.from(r.result.data, 'base64'));
      }
      console.log(`rendered ${base}: ${rects.length} pages`);
    }
    ws.close();
  } finally {
    chrome.kill();
    await sleep(300);
    await rm(prof, { recursive: true, force: true });
  }
}

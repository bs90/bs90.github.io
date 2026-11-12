// Tablet handwriting layer for A4 worksheet pages (.page).
// - One page at a time, scaled to the screen ("ぜんたい") or to the width ("おおきく").
// - One finger / pen / mouse writes; two fingers scroll. Once a pen is seen,
//   fingers only scroll (palm rejection).
// - Strokes are kept per page in localStorage, so a reload keeps the work.
(() => {
  const pages = [...document.querySelectorAll('.page')];
  if (!pages.length) return;
  if (new URLSearchParams(location.search).has('render')) return; // build-time page rendering
  const testId = location.pathname.split('/').pop().replace(/\.html$/, '') || 'test';
  const build = document.body.dataset.build || '';
  const answerIdx = pages.map((p, i) => (p.classList.contains('answer-page') ? i : -1)).filter((i) => i >= 0);
  const KEY = 'nam-ink:' + location.pathname;
  const COLORS = { pen: '#222', red: '#e0362c' };
  const WIDTH = { pen: 2.6, red: 2.6 };
  const ERASE_R = 9;

  let ink = {};
  try { ink = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { ink = {}; }
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(ink)); } catch { /* storage unavailable */ }
    }, 300);
  };

  let tool = 'pen';
  let fit = 'page';
  let showAnswers = false;
  let cur = 0;
  let penSeen = false;
  const history = [];

  // A4 page size in CSS px, measured before any page is hidden.
  const PW = pages[0].offsetWidth;
  const PH = pages[0].offsetHeight;

  // ---------- DOM ----------
  document.body.classList.add('ink-viewer');
  const bar = document.createElement('div');
  bar.className = 'ink-bar';
  bar.innerHTML = `
    <a class="ib" href="./">もくじ</a>
    <span class="grp">
      <button class="ib" data-a="prev">まえ</button>
      <span class="pg"></span>
      <button class="ib" data-a="next">つぎ</button>
    </span>
    <span class="grp">
      <button class="ib tool" data-t="pen"><i class="dot" style="background:${COLORS.pen}"></i>えんぴつ</button>
      <button class="ib tool" data-t="red"><i class="dot" style="background:${COLORS.red}"></i>あか</button>
      <button class="ib tool" data-t="eraser">けしゴム</button>
      <button class="ib" data-a="undo">もどす</button>
      <button class="ib" data-a="clear">ぜんぶ けす</button>
    </span>
    <span class="grp">
      <button class="ib" data-a="photo">しゃしん</button>
      <button class="ib" data-a="fit"></button>
      ${answerIdx.length ? '<button class="ib small" data-a="answers">こたえ</button>' : ''}
    </span>`;
  document.body.prepend(bar);

  const stage = document.createElement('div');
  stage.className = 'ink-stage';
  const holders = pages.map((page, i) => {
    const h = document.createElement('div');
    h.className = 'ink-holder';
    page.parentNode.insertBefore(h, page);
    h.appendChild(page);
    const c = document.createElement('canvas');
    c.className = 'ink-canvas';
    page.appendChild(c);
    attach(c, i);
    return h;
  });
  holders.forEach((h) => stage.appendChild(h));
  document.body.appendChild(stage);
  const canvases = pages.map((p) => p.querySelector('.ink-canvas'));

  // ---------- layout ----------
  const W = () => PW;
  const H = () => PH;
  let scale = 1;

  function visible() {
    return pages.map((_, i) => i).filter((i) => showAnswers || !answerIdx.includes(i));
  }

  function layout() {
    const vis = visible();
    if (!vis.includes(cur)) cur = vis[0];
    const barH = bar.offsetHeight;
    const vw = document.documentElement.clientWidth - 12;
    const vh = window.innerHeight - barH - 12;
    scale = Math.min(vw / W(), vh / H()) * (fit === 'page' ? 1 : 1.7);
    const dpr = window.devicePixelRatio || 1;
    holders.forEach((h, i) => {
      h.style.display = i === cur ? '' : 'none';
      h.style.width = W() * scale + 'px';
      h.style.height = H() * scale + 'px';
      pages[i].style.transform = `scale(${scale})`;
      const c = canvases[i];
      c.width = Math.round(W() * scale * dpr);
      c.height = Math.round(H() * scale * dpr);
      redraw(i);
    });
    bar.querySelector('.pg').textContent = `${vis.indexOf(cur) + 1} / ${vis.length}`;
    bar.querySelector('[data-a="fit"]').textContent = fit === 'page' ? 'おおきく' : 'ぜんたい';
    bar.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.t === tool));
    const ans = bar.querySelector('[data-a="answers"]');
    if (ans) ans.classList.toggle('on', showAnswers);
  }

  function go(d) {
    const vis = visible();
    const k = vis.indexOf(cur) + d;
    if (k < 0 || k >= vis.length) return;
    cur = vis[k];
    window.scrollTo(0, 0);
    layout();
  }

  // ---------- drawing ----------
  const strokes = (i) => (ink[i] ||= []);

  function ctxFor(i) {
    const c = canvases[i];
    const ctx = c.getContext('2d');
    const k = c.width / W();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }

  function drawStroke(ctx, s) {
    const p = s.p;
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
    for (let j = 1; j < p.length - 1; j++) {
      const mx = (p[j][0] + p[j + 1][0]) / 2;
      const my = (p[j][1] + p[j + 1][1]) / 2;
      ctx.quadraticCurveTo(p[j][0], p[j][1], mx, my);
    }
    if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    ctx.stroke();
  }

  function redraw(i) {
    const ctx = ctxFor(i);
    ctx.clearRect(0, 0, W(), H());
    strokes(i).forEach((s) => drawStroke(ctx, s));
  }

  function attach(c, i) {
    const touches = new Map();
    let drawing = null; // { id, s }
    let pan = null; // { x, y }

    const pt = (e) => {
      const r = c.getBoundingClientRect();
      return [
        Math.round(((e.clientX - r.left) / r.width) * W() * 10) / 10,
        Math.round(((e.clientY - r.top) / r.height) * H() * 10) / 10,
      ];
    };
    const mid = () => {
      const v = [...touches.values()];
      return { x: v.reduce((a, t) => a + t.x, 0) / v.length, y: v.reduce((a, t) => a + t.y, 0) / v.length };
    };

    function eraseAt(p) {
      const list = strokes(i);
      const hit = list.filter((s) => s.p.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < ERASE_R));
      if (!hit.length) return;
      ink[i] = list.filter((s) => !hit.includes(s));
      history.push({ type: 'erase', page: i, strokes: hit });
      redraw(i);
      save();
    }

    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') penSeen = true;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2 || penSeen) {
          if (drawing && drawing.touch) {
            strokes(i).pop();
            drawing = null;
            redraw(i);
          }
          pan = mid();
          return;
        }
      }
      if (drawing) return;
      c.setPointerCapture(e.pointerId);
      const p = pt(e);
      if (tool === 'eraser') {
        drawing = { id: e.pointerId, erase: true, touch: e.pointerType === 'touch' };
        eraseAt(p);
        return;
      }
      const s = { c: COLORS[tool], w: WIDTH[tool], p: [p] };
      strokes(i).push(s);
      drawing = { id: e.pointerId, s, touch: e.pointerType === 'touch' };
      drawStroke(ctxFor(i), s);
      e.preventDefault();
    });

    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pan) {
          const m = mid();
          window.scrollBy(pan.x - m.x, pan.y - m.y);
          pan = m;
          return;
        }
      }
      if (!drawing || drawing.id !== e.pointerId) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (drawing.erase) {
        evs.forEach((ev) => eraseAt(pt(ev)));
        return;
      }
      const ctx = ctxFor(i);
      const s = drawing.s;
      ctx.strokeStyle = s.c;
      ctx.lineWidth = s.w;
      evs.forEach((ev) => {
        const p = pt(ev);
        const last = s.p[s.p.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.6) return;
        s.p.push(p);
        ctx.beginPath();
        ctx.moveTo(last[0], last[1]);
        ctx.lineTo(p[0], p[1]);
        ctx.stroke();
      });
    });

    const end = (e) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (pan) {
          if (touches.size === 0) pan = null;
          else pan = mid();
        }
      }
      if (!drawing || drawing.id !== e.pointerId) return;
      if (!drawing.erase) {
        history.push({ type: 'add', page: i, stroke: drawing.s });
        redraw(i);
        save();
      }
      drawing = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  function undo() {
    const h = history.pop();
    if (!h) return;
    if (h.type === 'add') ink[h.page] = strokes(h.page).filter((s) => s !== h.stroke);
    if (h.type === 'erase') strokes(h.page).push(...h.strokes);
    if (h.type === 'clear') ink[h.page] = h.strokes;
    redraw(h.page);
    save();
  }

  // ---------- photo ----------
  // Background = page PNG rendered at build time; strokes are drawn on top.
  // Saving goes through the share sheet (iOS/Android: "画像を保存" -> Photos),
  // falling back to a file download. The preview <img> also supports long-press save.
  const shot = document.createElement('div');
  shot.className = 'ink-photo';
  shot.hidden = true;
  shot.innerHTML = `
    <div class="box">
      <img alt="">
      <div class="row">
        <button class="ib main" data-p="save">しゃしんに　ほぞん</button>
        <button class="ib" data-p="close">とじる</button>
      </div>
      <p class="hint">ほぞんできない ときは、しゃしんを ながおし →「写真に保存」</p>
    </div>`;
  document.body.appendChild(shot);
  let shotFile = null;
  let shotUrl = '';

  const loadImg = (src) =>
    new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });

  async function makePhoto() {
    const i = cur;
    const bg = await loadImg(`assets/pages/${testId}-${i + 1}.png?v=${build}`);
    const c = document.createElement('canvas');
    c.width = bg.naturalWidth;
    c.height = bg.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(bg, 0, 0);
    const k = c.width / W();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokes(i).forEach((s) => drawStroke(ctx, s));
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    ctx.font = '600 11px "Klee One", sans-serif';
    ctx.fillStyle = '#999';
    ctx.textAlign = 'right';
    ctx.fillText(`${document.title}  ${i + 1}ページ  ${stamp}`, W() - 14, H() - 10);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const name = `${testId}-p${i + 1}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.png`;
    shotFile = new File([blob], name, { type: 'image/png' });
    if (shotUrl) URL.revokeObjectURL(shotUrl);
    shotUrl = URL.createObjectURL(blob);
    shot.querySelector('img').src = shotUrl;
    shot.hidden = false;
  }

  function download() {
    const a = document.createElement('a');
    a.href = shotUrl;
    a.download = shotFile.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  shot.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.p === 'close') { shot.hidden = true; return; }
    if (b.dataset.p === 'save' && shotFile) {
      if (navigator.canShare && navigator.canShare({ files: [shotFile] })) {
        try { await navigator.share({ files: [shotFile] }); } catch (err) { if (err.name !== 'AbortError') download(); }
      } else {
        download();
      }
    }
  });

  // ---------- toolbar ----------
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.t) { tool = b.dataset.t; layout(); return; }
    const a = b.dataset.a;
    if (a === 'prev') go(-1);
    if (a === 'next') go(1);
    if (a === 'undo') undo();
    if (a === 'clear' && strokes(cur).length && confirm('このページの　じを　ぜんぶ　けしますか？')) {
      history.push({ type: 'clear', page: cur, strokes: strokes(cur) });
      ink[cur] = [];
      redraw(cur);
      save();
    }
    if (a === 'photo') {
      b.disabled = true;
      makePhoto().catch(() => alert('しゃしんを つくれませんでした')).finally(() => { b.disabled = false; });
    }
    if (a === 'fit') { fit = fit === 'page' ? 'width' : 'page'; layout(); }
    if (a === 'answers') { showAnswers = !showAnswers; if (showAnswers) cur = answerIdx[0]; layout(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') undo();
  });

  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 120); });
  // Layout depends on web fonts only for text, not for page size, but wait anyway so the first paint is stable.
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(layout);
  layout();
})();

#!/usr/bin/env node
// Build Nam's test pages from nam/_src/tests/*.json into nam/<id>.html, plus nam/index.html.
//
//   node nam/_src/build.mjs
//
// Jekyll skips folders that start with "_", so this source folder is not published.
//
// Kanji markup:
//   [学校|がっこう]  question target — yomi: kanji + empty furigana box
//                                     kaki: furigana + one empty box per kanji
//   {木|き}         kanji with furigana (review sheet)
// Kanji scoring: one unit per yomi target and per kaki box; 100 is split evenly.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPages } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isKanji = (c) => /[一-鿿]/.test(c);
const ROBO = 'assets/robokun.png';
const BUILD = Date.now().toString(36); // cache-buster for ink.js and page images

const head = (title) => `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Klee+One:wght@400;600&display=block" rel="stylesheet">
<link rel="stylesheet" href="assets/sheet.css?v=${BUILD}">
<link rel="stylesheet" href="assets/ink.css?v=${BUILD}">
<script src="assets/ink.js?v=${BUILD}" defer></script>
</head>
<body data-build="${BUILD}">`;
const foot = '</body>\n</html>\n';

const header = (title, { score = false } = {}) => `
  <div class="header">
    <img src="${ROBO}" alt="">
    <h1>${esc(title)}</h1>
    <div class="name-box">なまえ<span></span></div>
    ${score ? '<div class="score-box"><span></span>／100てん</div>' : ''}
  </div>`;
const footer = `<div class="footer"><img src="${ROBO}" alt="">さいごまで　よく　がんばったね！</div>`;

// ---------- kanji ----------
function parse(s) {
  const out = [];
  const re = /\[([^|\]]+)\|([^\]]+)\]|\{([^|}]+)\|([^}]+)\}/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    if (m[1]) out.push({ t: 'target', w: m[1], r: m[2] });
    else out.push({ t: 'ruby', w: m[3], r: m[4] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}
const ruby = (w, r) => `<ruby>${esc(w)}<rt>${esc(r)}</rt></ruby>`;
const rich = (s) => parse(s).map((p) => (p.t === 'text' ? esc(p.v) : ruby(p.w, p.r))).join('');

function kanjiTest(spec) {
  const answers = { yomi: [], kaki: [] };
  const renderQ = (s, mode) => {
    const ans = [];
    answers[mode].push(ans);
    return parse(s)
      .map((p) => {
        if (p.t === 'text') return esc(p.v);
        if (p.t === 'ruby') return ruby(p.w, p.r);
        if (mode === 'yomi') {
          ans.push(`${esc(p.w)}<span>${esc(p.r)}</span>`);
          const len = Math.max([...p.w].length, [...p.r].length * 0.75);
          return `<span class="ty">${esc(p.w)}<span class="fbox" style="height:${len}em"></span></span>`;
        }
        const boxes = [...p.w]
          .map((c) => {
            if (!isKanji(c)) return esc(c);
            ans.push(`<span>${esc(c)}</span>`);
            return '<span class="kbox"></span>';
          })
          .join('');
        return `<span class="tk">${boxes}<span class="kfuri">${esc(p.r)}</span></span>`;
      })
      .join('');
  };
  const units = (qs, mode) =>
    qs.flatMap(parse).filter((p) => p.t === 'target').reduce((n, p) => n + (mode === 'yomi' ? 1 : [...p.w].filter(isKanji).length), 0);
  const total = units(spec.yomi, 'yomi') + units(spec.kaki, 'kaki');
  const pts = 100 / total;
  const ptsLabel = Number.isInteger(pts) ? `（1つ ${pts}てん）` : '';

  const section = (title, qs, mode) => {
    const items = qs.map((s, i) => `<div class="q"><span class="qn">${i + 1}</span>${renderQ(s, mode)}</div>`);
    const half = Math.ceil(items.length / 2);
    return `
  <div class="sec-title">${title}<span class="pts">${ptsLabel}</span></div>
  <div class="band b-${mode}">${items.slice(0, half).join('')}</div>
  <div class="band b-${mode}">${items.slice(half).join('')}</div>`;
  };

  const review = `
<div class="page review">
  ${header(`${spec.title}　おさらい`)}
  <p class="lead">まいにち　こえに　だして　よもう！　<small>${esc(spec.source)}</small></p>
  ${spec.review
    .map(
      (g) => `
  <div class="group-title">${esc(g.group)}</div>
  <div class="cells">${g.kanji
    .map(
      (k) => `
    <div class="cell">
      <div class="big">${esc(k.c)}</div>
      <div class="info">
        <div class="r">${esc(k.r)}${k.note ? `<span class="note">${esc(k.note)}</span>` : ''}</div>
        <div class="w">${k.w.map((w) => `<span class="word">${rich(w)}</span>`).join('<span class="sep">・</span>')}</div>
      </div>
    </div>`,
    )
    .join('')}
  </div>`,
    )
    .join('')}
</div>`;

  const yomi = section('一　かん字の　よみがなを　かきましょう。', spec.yomi, 'yomi');
  const kaki = section('二　□に　かん字を　かきましょう。', spec.kaki, 'kaki');
  const p1 = `<div class="page test">${header(spec.title, { score: true })}${yomi}</div>`;
  const p2 = `<div class="page test">${header(`${spec.title}（つづき）`)}${kaki}${footer}</div>`;
  const ansPage = `
<div class="page answer-page">
  <h2>こたえ（おうちの方へ）— ${esc(spec.title)}</h2>
  <p class="meta">${esc(spec.source)}　／　${total}もん × ${Number.isInteger(pts) ? pts : pts.toFixed(1)}てん</p>
  <h3>一　よみ</h3>
  <ol class="answers">${answers.yomi.map((a, i) => `<li><b>${i + 1}</b>${a.join('　')}</li>`).join('')}</ol>
  <h3>二　かき</h3>
  <ol class="answers">${answers.kaki.map((a, i) => `<li><b>${i + 1}</b>${a.join('')}</li>`).join('')}</ol>
</div>`;
  return head(spec.title) + review + p1 + p2 + ansPage + foot;
}

// ---------- sansu ----------
const calc = (expr) => {
  const m = expr.match(/^\s*(\d+)\s*([+-])\s*(\d+)\s*$/);
  if (!m) throw new Error(`bad expression: ${expr}`);
  return m[2] === '+' ? +m[1] + +m[3] : +m[1] - +m[3];
};
const show = (expr) => esc(expr.replace(/-/g, '－').replace(/\+/g, '＋').replace(/\s+/g, ' '));

function sansuTest(spec) {
  let total = 0;
  const answers = [];
  const pagesHtml = spec.pages.map((secs, pi) => {
    const body = secs
      .map((sec) => {
        const ans = { title: sec.title, list: [] };
        answers.push(ans);
        total += sec.pts * sec.items.length;
        if (sec.kind === 'calc') {
          const items = sec.items
            .map((e, i) => {
              ans.list.push(`${show(e)} = <span>${calc(e)}</span>`);
              return `<div class="calc"><span class="qn">${i + 1}</span><span class="expr">${show(e)} =</span><span class="ans-box"></span></div>`;
            })
            .join('');
          return `<div class="sec-title">${esc(sec.title)}<span class="pts">（1もん ${sec.pts}てん）</span></div><div class="calc-grid">${items}</div>`;
        }
        const half = sec.pts / 2;
        const items = sec.items
          .map((w, i) => {
            ans.list.push(`しき ${show(w.shiki)} = ${calc(w.shiki)}　こたえ <span>${calc(w.shiki)}${esc(w.unit)}</span>`);
            return `<div class="wp"><p><span class="qn">${i + 1}</span><span>${esc(w.text)}</span></p>
          <div class="wp-row">しき<span class="shiki"></span><span class="gap"></span>こたえ<span class="kotae"></span>${esc(w.unit)}</div></div>`;
          })
          .join('');
        return `<div class="sec-title">${esc(sec.title)}<span class="pts">（しき ${half}てん・こたえ ${half}てん）</span></div>${items}`;
      })
      .join('');
    const last = pi === spec.pages.length - 1;
    return `<div class="page sansu">${header(pi === 0 ? spec.title : `${spec.title}（つづき）`, { score: pi === 0 })}${body}${last ? footer : ''}</div>`;
  });
  if (total !== 100) console.warn(`warning: ${spec.id} totals ${total} points`);
  const ansPage = `
<div class="page answer-page sansu">
  <h2>こたえ（おうちの方へ）— ${esc(spec.title)}</h2>
  <p class="meta">${esc(spec.subtitle)}　／　${total}てん</p>
  ${answers.map((a) => `<h3>${esc(a.title)}</h3><ol class="answers">${a.list.map((x, i) => `<li><b>${i + 1}</b>${x}</li>`).join('')}</ol>`).join('')}
</div>`;
  return head(spec.title) + pagesHtml.join('') + ansPage + foot;
}

// ---------- index ----------
function indexPage(specs) {
  const card = (s) => `
    <a class="card ${s.type}" href="${s.id}.html">
      <span class="tag">${s.type === 'kanji' ? 'こくご' : 'さんすう'}</span>
      <span class="t">${esc(s.title)}</span>
      <span class="sub">${esc(s.subtitle || '')}</span>
      <span class="date">${esc(s.date || '')}</span>
    </a>`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nam の テスト</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Klee+One:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Klee One", "Hiragino Kaku Gothic ProN", sans-serif; background: #fbf5f2; color: #2b2b2b; padding: 16px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 14px; background: #e2574c; color: white; border-radius: 16px; padding: 14px 18px; margin-bottom: 18px; }
  header img { width: 56px; height: 56px; }
  header h1 { font-size: 28px; font-weight: 600; }
  header p { font-size: 14px; opacity: .9; }
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .card { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: inherit; background: white; border-radius: 14px; padding: 16px; border: 2px solid #f0dcd6; }
  .card:active { transform: scale(.98); }
  .card .tag { align-self: flex-start; font-size: 13px; font-weight: 600; color: white; background: #e2574c; border-radius: 8px; padding: 2px 10px; }
  .card.sansu .tag { background: #3f9a4a; }
  .card.sansu { border-color: #d5ead7; }
  .card .t { font-size: 24px; font-weight: 600; }
  .card .sub { font-size: 15px; color: #555; }
  .card .date { font-size: 12px; color: #999; }
  .hint { margin-top: 22px; font-size: 13px; color: #777; line-height: 1.8; }
</style>
</head>
<body>
<div class="wrap">
  <header><img src="${ROBO}" alt=""><div><h1>Nam の テスト</h1><p>やりたい　テストを　えらんでね</p></div></header>
  <div class="list">${specs.map(card).join('')}</div>
  <p class="hint">おうちの方へ：ペン・1本ゆびで書く／2本ゆびでスクロール。書いた内容はこの端末に保存されます（「ぜんぶ けす」で消去）。「こたえ」ボタンで答えのページを表示。</p>
</div>
</body>
</html>
`;
}

// ---------- main ----------
const dir = join(here, 'tests');
const specs = [];
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
  const spec = JSON.parse(await readFile(join(dir, f), 'utf8'));
  const html = spec.type === 'kanji' ? kanjiTest(spec) : sansuTest(spec);
  await writeFile(join(outDir, `${spec.id}.html`), html);
  specs.push(spec);
  console.log(`wrote ${spec.id}.html`);
}
await renderPages(specs.map((s) => join(outDir, `${s.id}.html`)), join(outDir, 'assets/pages'));
specs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
await writeFile(join(outDir, 'index.html'), indexPage(specs));
console.log(`wrote index.html (${specs.length} tests)`);

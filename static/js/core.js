/* Inkwell — core: utilities, vault index, link resolution, Markdown rendering. */
'use strict';

// ------------------------------------------------------------------ utils
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (p) => p.split('/').pop().replace(/\.md$/i, '');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (d, n) => (d ? d + '/' + n : n);
const vaultUrl = (p) => '/vault/' + p.split('/').map(encodeURIComponent).join('/');
const isImg = (p) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const store = {
  get(k, d) { try { const v = localStorage.getItem('iw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('iw.' + k, JSON.stringify(v)); } catch {} },
};
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const cleanName = (s) => s.replace(/[\\:*?"<>|#^\[\]]/g, '').replace(/\s+/g, ' ').trim();
const slug = (s) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

async function api(method, ep, { qs, body, raw } = {}) {
  const url = '/api/' + ep + (qs ? '?' + new URLSearchParams(qs) : '');
  const res = await fetch(url, {
    method,
    headers: body && !raw ? { 'Content-Type': 'application/json' } : {},
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; e.data = data; throw e; }
  return data;
}

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 5000 : 2600);
}

// ------------------------------------------------------------------ state
const S = {
  index: { notes: [], folders: [], files: [] },
  pathMap: new Map(),   // lower path -> path
  nameMap: new Map(),   // lower basename -> [paths]
  fileMap: new Map(),   // lower basename / lower path -> file path (attachments)
  noteByPath: new Map(),
  open: new Set(store.get('open', [])),
  contentCache: new Map(),
  bookmarks: [],
  // S.cur (the active tab's note: {path, mtime, dirty}) is defined in workspace.js
};

function rebuildMaps() {
  S.pathMap.clear(); S.nameMap.clear(); S.fileMap.clear(); S.noteByPath.clear();
  for (const n of S.index.notes) {
    S.noteByPath.set(n.path, n);
    S.pathMap.set(n.path.toLowerCase(), n.path);
    const k = base(n.path).toLowerCase();
    if (!S.nameMap.has(k)) S.nameMap.set(k, []);
    S.nameMap.get(k).push(n.path);
  }
  for (const f of S.index.files) {
    S.fileMap.set(f.toLowerCase(), f);
    const k = f.split('/').pop().toLowerCase();
    if (!S.fileMap.has(k)) S.fileMap.set(k, f);
  }
}

/** Resolve a link target (wikilink or md link) to a vault path, or null. */
function resolve(target, from = '') {
  let t = (target || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!t) return from || null;
  const tl = t.toLowerCase();
  const withMd = tl.endsWith('.md') ? tl : tl + '.md';
  if (S.pathMap.has(withMd)) return S.pathMap.get(withMd);
  if (tl.includes('/')) {
    for (const [lp, p] of S.pathMap) if (lp.endsWith('/' + withMd)) return p;
  }
  const cands = S.nameMap.get(withMd.slice(0, -3).split('/').pop());
  if (cands && !tl.includes('/')) {
    if (cands.length === 1) return cands[0];
    const fd = dirOf(from);
    return cands.find((c) => dirOf(c) === fd) || [...cands].sort((a, b) => a.length - b.length)[0];
  }
  if (S.fileMap.has(tl)) return S.fileMap.get(tl);
  return null;
}

/** Name to use in a [[link]] to path — basename, or path if ambiguous. */
function linkText(path) {
  const b = base(path);
  return (S.nameMap.get(b.toLowerCase()) || []).length > 1 ? path.replace(/\.md$/i, '') : b;
}

const FM_RE = /^---\n([\s\S]*?)\n?(?:---|\.\.\.)[ \t]*(?:\n|$)/;
function stripCode(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');
}
const WL_RE = /!?\[\[([^\[\]|#\n]*)(#[^\[\]|\n]*)?(\|[^\[\]\n]*)?\]\]/g;
const TAG_RE = /(?:^|\s)#([A-Za-z0-9_\-\/]*[A-Za-z_\-\/][A-Za-z0-9_\-\/]*)/g;
function analyse(text) {
  const body = stripCode(text);
  const links = [...body.matchAll(WL_RE)].map((m) => m[1].trim()).filter(Boolean);
  for (const m of body.matchAll(/\]\(([^)\s]+\.md)\)/g)) if (!m[1].includes('://')) links.push(decodeURIComponent(m[1]));
  const fm = body.match(/^---\n[\s\S]*?\n---\n/);
  const tagBody = fm ? body.slice(fm[0].length) : body;
  const tags = new Set([...tagBody.matchAll(TAG_RE)].map((m) => m[1].toLowerCase()));
  if (fm) {
    const tm = fm[0].match(/^tags?:[ \t]*(.*)$/m);
    if (tm) {
      if (tm[1].trim()) tm[1].replace(/[\[\]]/g, '').split(/[,\s]+/).forEach((t) => t && tags.add(t.replace(/^#|['"]/g, '').toLowerCase()));
      else { const after = fm[0].slice(fm[0].indexOf(tm[0]) + tm[0].length); for (const l of after.split('\n').slice(1)) { const mm = l.match(/^\s*-\s*(.+)$/); if (!mm) break; tags.add(mm[1].replace(/^#|['"]/g, '').trim().toLowerCase()); } }
    }
  }
  return { links, tags: [...tags].sort() };
}

async function getContent(path) {
  const n = S.noteByPath.get(path);
  const c = S.contentCache.get(path);
  if (c && n && c.mtime === n.mtime) return c.content;
  const d = await api('GET', 'note', { qs: { path } });
  S.contentCache.set(path, { mtime: d.mtime, content: d.content });
  return d.content;
}

// ------------------------------------------------------------------ markdown
let RCTX = { from: '', depth: 0 };
function parseWikiInner(inner) {
  let alias = null, heading = null, target = inner;
  const pi = target.indexOf('|');
  if (pi >= 0) { alias = target.slice(pi + 1).trim(); target = target.slice(0, pi); }
  const hi = target.indexOf('#');
  if (hi >= 0) { heading = target.slice(hi + 1).replace(/^\^/, '').trim(); target = target.slice(0, hi); }
  return { target: target.trim(), heading, alias };
}

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'wikilink', level: 'inline',
      start(src) { const i = src.indexOf('[['); if (i < 0) return; return i > 0 && src[i - 1] === '!' ? i - 1 : i; },
      tokenizer(src) {
        const m = /^(!?)\[\[([^\[\]\n]+?)\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], embed: !!m[1], ...parseWikiInner(m[2]) };
      },
      renderer(t) {
        const resolved = resolve(t.target, RCTX.from);
        if (t.embed) {
          if (resolved && isImg(resolved)) {
            const w = t.alias && /^\d+(x\d+)?$/.test(t.alias) ? ` width="${t.alias.split('x')[0]}"` : '';
            return `<img src="${esc(vaultUrl(resolved))}" alt="${esc(t.alias && !w ? t.alias : base(resolved))}"${w}>`;
          }
          if (resolved && !resolved.toLowerCase().endsWith('.md')) {
            return `<a class="ext" href="${esc(vaultUrl(resolved))}" target="_blank">${esc(resolved.split('/').pop())}</a>`;
          }
          if (resolved && RCTX.depth < 1) {
            return `<span class="embed-ph" data-embed="${esc(resolved)}" data-heading="${esc(t.heading || '')}"></span>`;
          }
        }
        const label = t.alias || (t.target ? t.target + (t.heading ? ' › ' + t.heading : '') : t.heading || '');
        return `<a class="wl${resolved ? '' : ' unresolved'}" href="#" data-target="${esc(t.target)}" data-heading="${esc(t.heading || '')}" data-from="${esc(RCTX.from)}">${esc(label)}</a>`;
      },
    },
    {
      name: 'tag', level: 'inline',
      start(src) { const m = /(^|[\s(])#[A-Za-z0-9_\-\/]*[A-Za-z_\-\/]/.exec(src); return m ? m.index + m[1].length : undefined; },
      tokenizer(src) {
        const m = /^#([A-Za-z0-9_\-\/]*[A-Za-z_\-\/][A-Za-z0-9_\-\/]*)/.exec(src);
        if (m) return { type: 'tag', raw: m[0], tag: m[1] };
      },
      renderer(t) { return `<a class="tag" href="#" data-tag="${esc(t.tag.toLowerCase())}">#${esc(t.tag)}</a>`; },
    },
    {
      name: 'mark', level: 'inline',
      start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^==([^=\n](?:[^\n]*?[^=\n])?)==/.exec(src);
        if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
    },
  ],
});

function renderMarkdown(src, from, depth = 0) {
  const m = src.match(FM_RE);
  if (m) src = src.slice(m[0].length);
  const prev = RCTX; RCTX = { from, depth };
  let html;
  try { html = marked.parse(src); } finally { RCTX = prev; }
  const root = document.createElement('div');
  root.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  postProcess(root, from, depth);
  return root;
}

function postProcess(root, from, depth) {
  const d = dirOf(from);
  // heading ids
  const seen = {};
  for (const h of $$('h1,h2,h3,h4,h5,h6', root)) {
    let id = slug(h.textContent) || 'h'; seen[id] = (seen[id] || 0) + 1;
    if (seen[id] > 1) id += '-' + seen[id];
    h.id = 'h-' + id;
  }
  // links
  for (const a of $$('a[href]', root)) {
    if (a.classList.contains('wl') || a.classList.contains('tag')) continue;
    const href = a.getAttribute('href');
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; a.classList.add('ext'); continue; }
    if (href.startsWith('#')) continue;
    const rel = normPath(join(d, decodeURIComponent(href.split('#')[0])));
    const r = resolve(rel) || resolve(decodeURIComponent(href.split('#')[0]), from);
    a.classList.add('wl'); if (!r) a.classList.add('unresolved');
    a.dataset.target = r || rel.replace(/\.md$/i, '');
    a.dataset.heading = href.includes('#') ? decodeURIComponent(href.split('#')[1]) : '';
    a.setAttribute('href', '#');
  }
  for (const img of $$('img', root)) {
    const src = img.getAttribute('src') || '';
    if (/^([a-z]+:|\/vault\/)/i.test(src)) continue;
    const p = resolve(normPath(join(d, decodeURIComponent(src)))) || normPath(join(d, decodeURIComponent(src)));
    img.src = vaultUrl(p);
  }
  // tasks
  let ti = 0;
  for (const cb of $$('li input[type=checkbox]', root)) {
    const li = cb.closest('li');
    li.classList.add('task');
    if (cb.checked) li.classList.add('done');
    if (depth === 0) { cb.disabled = false; cb.dataset.task = ti++; } else cb.disabled = true;
    const span = document.createElement('span');
    let n = cb.nextSibling;
    while (n && !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))) { const nx = n.nextSibling; span.appendChild(n); n = nx; }
    cb.after(span);
  }
  // callouts  > [!note] Title
  for (const bq of $$('blockquote', root)) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') continue;
    const m = p.innerHTML.match(/^\[!([\w-]+)\][+-]?\s*([^<\n]*)(<br>\n?)?/);
    if (!m) continue;
    bq.classList.add('callout', 'callout-' + m[1].toLowerCase());
    p.innerHTML = p.innerHTML.slice(m[0].length);
    const title = document.createElement('div');
    title.className = 'callout-title';
    title.textContent = m[2].trim() || m[1];
    bq.prepend(title);
    if (!p.innerHTML.trim()) p.remove();
  }
  // embeds
  for (const ph of $$('.embed-ph', root)) {
    const path = ph.dataset.embed, heading = ph.dataset.heading;
    const box = document.createElement('div');
    box.className = 'embed';
    box.innerHTML = `<div class="embed-title" data-open="${esc(path)}">${esc(base(path))}${heading ? ' › ' + esc(heading) : ''}</div><div class="embed-body muted small">…</div>`;
    ph.replaceWith(box);
    getContent(path).then((text) => {
      if (heading) text = sectionOf(text, heading) ?? text;
      const body = box.querySelector('.embed-body');
      body.className = 'embed-body';
      body.replaceChildren(...renderMarkdown(text, path, depth + 1).childNodes);
    }).catch(() => { box.querySelector('.embed-body').textContent = 'Could not load embed.'; });
  }
}

function normPath(p) {
  const out = [];
  for (const seg of p.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
  return out.join('/');
}

function sectionOf(text, heading) {
  const lines = text.split('\n');
  const want = slug(heading);
  const start = lines.findIndex((l) => { const m = l.match(/^(#{1,6})\s+(.*)$/); return m && slug(m[2]) === want; });
  if (start < 0) return null;
  const lvl = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const m = lines[i].match(/^(#{1,6})\s/); if (m && m[1].length <= lvl) { end = i; break; } }
  return lines.slice(start, end).join('\n');
}
// ------------------------------------------------------------------ fuzzy
function fuzzy(q, s) {
  q = q.toLowerCase(); const sl = s.toLowerCase();
  if (!q) return { score: 0, pos: [] };
  let qi = 0, score = 0, last = -2; const pos = [];
  for (let j = 0; j < sl.length && qi < q.length; j++) {
    if (sl[j] === q[qi]) {
      pos.push(j);
      score += 1 + (j === last + 1 ? 4 : 0) + (j === 0 || /[\s\/\-_.]/.test(sl[j - 1]) ? 3 : 0);
      last = j; qi++;
    }
  }
  if (qi < q.length) return null;
  if (sl.startsWith(q)) score += 10;
  return { score: score - s.length * 0.02, pos };
}
function rank(q, items, keyFn) {
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    const f = fuzzy(q.trim(), key);
    if (f) out.push({ item, score: f.score, pos: f.pos.filter((p) => p < (item.label || key).length) });
  }
  if (!q.trim()) out.sort((a, b) => (S.noteByPath.get(b.item.path)?.mtime || 0) - (S.noteByPath.get(a.item.path)?.mtime || 0));
  else out.sort((a, b) => b.score - a.score);
  return out;
}
function hlPos(s, pos) {
  if (!pos || !pos.length) return esc(s);
  const set = new Set(pos); let o = '';
  for (let i = 0; i < s.length; i++) o += set.has(i) ? `<b>${esc(s[i])}</b>` : esc(s[i]);
  return o;
}

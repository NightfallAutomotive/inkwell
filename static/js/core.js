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
  return text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/<(style|script)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<[a-zA-Z/][^>\n]*>/gi, ' ').replace(/`[^`\n]*`/g, '');
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
  // HTML blocks become sandboxed frames; leave a placeholder for each
  const frames = [];
  for (const r of htmlRegions(src).reverse()) {
    frames.unshift(r.html);
    src = src.slice(0, r.from) + `\n\n<div data-html-frame="${r.from}"></div>\n\n` + src.slice(r.to);
  }
  const prev = RCTX; RCTX = { from, depth };
  let html;
  try { html = marked.parse(src); } finally { RCTX = prev; }
  const root = document.createElement('div');
  root.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  $$('[data-html-frame]', root).forEach((ph, i) => { if (frames[i] != null) ph.replaceWith(makeHtmlFrame(frames[i], from)); });
  postProcess(root, from, depth);
  return root;
}

// ------------------------------------------------------------------ HTML blocks
const INLINE_TAGS = new Set('a abbr b bdi bdo br cite code data del dfn em i img input ins kbd label mark q s samp small span strong sub sup time u var wbr'.split(' '));
const VOID_TAGS = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));

/** Find runs of raw HTML in a note (outside code fences and frontmatter).
 *  A run starts at a line beginning with a block-level tag, comment or doctype and
 *  ends where that element closes — blank lines inside it are fine. Adjacent runs
 *  separated only by blank lines are merged, so a <style> applies to the markup after it. */
function htmlRegions(text) {
  const out = [];
  const lines = text.split('\n');
  const starts = []; let off = 0;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  let i = 0;
  const fm = text.match(FM_RE);
  if (fm) while (i < lines.length && starts[i] < fm[0].length) i++;
  let fence = null;
  const endOf = (j) => starts[j] + lines[j].length;
  while (i < lines.length) {
    const line = lines[i];
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; i++; continue; }
    if (f) { fence = f[1]; i++; continue; }
    const m = /^ {0,3}(?:(<!--)|(<!doctype\b)|<([a-zA-Z][\w-]*)(?=[\s>\/]|$))/i.exec(line);
    const tag = m && m[3] && m[3].toLowerCase();
    if (!m || (tag && INLINE_TAGS.has(tag))) { i++; continue; }
    let j = i;
    if (m[1]) { while (j < lines.length && !lines[j].includes('-->')) j++; }
    else if (m[2]) { j = lines.length - 1; for (let k = i; k < lines.length; k++) if (/<\/html\s*>/i.test(lines[k])) { j = k; break; } }
    else if (!VOID_TAGS.has(tag) && !new RegExp(`^\\s*<${tag}\\b[^>]*/>\\s*$`, 'i').test(line)) {
      const open = new RegExp(`<${tag}(?=[\\s>/])[^>]*?(/?)>`, 'gi'), close = new RegExp(`</${tag}\\s*>`, 'gi');
      let depth = 0, closed = false;
      for (let k = i; k < lines.length; k++) {
        for (const o of lines[k].matchAll(open)) if (!o[1]) depth++;
        depth -= (lines[k].match(close) || []).length;
        if (depth <= 0) { j = k; closed = true; break; }
      }
      if (!closed) { j = i; while (j + 1 < lines.length && lines[j + 1].trim()) j++; } // unclosed: stop at the next blank line
    }
    j = Math.min(j, lines.length - 1);
    const prevR = out[out.length - 1];
    const gapBlank = prevR && lines.slice(prevR.lastLine + 1, i).every((l) => !l.trim());
    if (prevR && gapBlank) { prevR.to = endOf(j); prevR.lastLine = j; }
    else out.push({ from: starts[i], to: endOf(j), lastLine: j });
    i = j + 1;
  }
  for (const r of out) r.html = text.slice(r.from, r.to);
  return out;
}

/** Build the srcdoc for an HTML block: the user's markup plus a <base> so relative links
 *  and images resolve in the vault, and a tiny script that reports the content height. */
function htmlFrameDoc(html, from, id) {
  const baseHref = location.origin + vaultUrl(dirOf(from) ? dirOf(from) + '/' : '').replace(/\/?$/, '/');
  const cs = getComputedStyle(document.documentElement);
  const head = `<meta charset="utf-8"><base href="${esc(baseHref)}" target="_blank">`
    + `<style>html{color-scheme:${document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}}body{margin:0;padding:1px 0;background:transparent;color:${cs.getPropertyValue('--fg').trim()};font:16px/1.6 ${cs.getPropertyValue('--sans').trim()};overflow-wrap:break-word}a{color:${cs.getPropertyValue('--link').trim()}}img{max-width:100%}</style>`
    + `<script>(()=>{let last=0;const post=()=>{const h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(Math.abs(h-last)>1){last=h;parent.postMessage({inkwellFrame:${JSON.stringify(id)},h},'*');}};addEventListener('load',post);new ResizeObserver(post).observe(document.documentElement);post();})()<\/script>`;
  if (/<html[\s>]/i.test(html)) {
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + head) : html.replace(/<html[^>]*>/i, (h) => h + '<head>' + head + '</head>');
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
let frameSeq = 0;
function makeHtmlFrame(html, from) {
  const id = 'f' + (++frameSeq);
  const f = document.createElement('iframe');
  f.className = 'html-frame';
  f.dataset.fid = id;
  // no allow-same-origin: scripts run, but can't touch Inkwell or your notes
  f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals');
  f.setAttribute('loading', 'lazy');
  f.style.height = '40px';
  f.srcdoc = htmlFrameDoc(html, from, id);
  return f;
}
addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d.inkwellFrame !== 'string' || typeof d.h !== 'number') return;
  const f = document.querySelector(`iframe.html-frame[data-fid="${CSS.escape(d.inkwellFrame)}"]`);
  if (f && f.contentWindow === e.source) f.style.height = Math.max(16, Math.min(d.h, 3000)) + 'px';
});

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

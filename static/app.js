/* Inkwell — local Markdown notes. Single-file client. */
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
  cur: null,            // {path, mtime, dirty}
  hist: [], hi: -1,
  mode: store.get('mode', 'split'),
  lastEditMode: store.get('lastEditMode', 'split'),
  open: new Set(store.get('open', [])),
  contentCache: new Map(),
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
    const tm = fm[0].match(/^tags?:\s*(.*)$/m);
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
  let fm = '';
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) { fm = m[1]; src = src.slice(m[0].length); }
  const prev = RCTX; RCTX = { from, depth };
  let html;
  try { html = marked.parse(src); } finally { RCTX = prev; }
  const root = document.createElement('div');
  root.innerHTML = (fm ? `<div class="fm">${esc(fm)}</div>` : '') + DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
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

// ------------------------------------------------------------------ elements
const el = {
  app: $('#app'), doc: $('#doc'), editor: $('#editor'), title: $('#title'), preview: $('#preview'),
  editWrap: $('#edit-wrap'), previewWrap: $('#preview-wrap'), tree: $('#tree'), crumbs: $('#crumbs'),
  saveState: $('#save-state'),
};

// ------------------------------------------------------------------ index & tree
async function refreshIndex({ quiet = false } = {}) {
  let idx;
  try { idx = await api('GET', 'index'); } catch (e) { if (!quiet) toast('Cannot reach Inkwell server: ' + e.message, true); return; }
  const prevSig = S.index.notes.map((n) => n.path + n.mtime).join('|') + S.index.folders.join('|') + S.index.files.join('|');
  S.index = idx;
  rebuildMaps();
  const sig = idx.notes.map((n) => n.path + n.mtime).join('|') + idx.folders.join('|') + idx.files.join('|');
  $('#vault-path').textContent = idx.vault;
  $('#vault-path').title = idx.vault;
  $('#st-vault').textContent = `${idx.notes.length} notes`;
  if (sig === prevSig && quiet) return;
  renderTree(); renderTags();
  if (S.cur) {
    const n = S.noteByPath.get(S.cur.path);
    if (!n) { /* deleted externally */ if (!S.cur.dirty) { toast(`"${base(S.cur.path)}" was removed`); closeNote(); } }
    else if (Math.abs(n.mtime - S.cur.mtime) > 0.001 && !S.cur.dirty && !S.saving) {
      const d = await api('GET', 'note', { qs: { path: S.cur.path } });
      const sel = [el.editor.selectionStart, el.editor.selectionEnd];
      el.editor.value = d.content; S.cur.mtime = d.mtime; autosize();
      el.editor.setSelectionRange(...sel);
      renderPreview();
    }
    renderRight();
  }
  if (graph.view && !$('#graph').hidden) graph.update();
}

function buildTree() {
  const root = { name: '', path: '', folders: new Map(), items: [] };
  const ensure = (p) => {
    if (!p) return root;
    let node = root;
    let acc = '';
    for (const seg of p.split('/')) {
      acc = join(acc, seg);
      if (!node.folders.has(seg)) node.folders.set(seg, { name: seg, path: acc, folders: new Map(), items: [] });
      node = node.folders.get(seg);
    }
    return node;
  };
  S.index.folders.forEach(ensure);
  for (const n of S.index.notes) ensure(dirOf(n.path)).items.push({ type: 'note', path: n.path, name: base(n.path), mtime: n.mtime, ctime: n.ctime });
  for (const f of S.index.files) ensure(dirOf(f)).items.push({ type: 'file', path: f, name: f.split('/').pop(), mtime: 0, ctime: 0 });
  return root;
}

function renderTree() {
  const sort = $('#sort').value;
  const cmp = (a, b) => (sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : (b[sort] || 0) - (a[sort] || 0));
  const frag = document.createDocumentFragment();
  const walk = (node, container) => {
    for (const f of [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      const open = S.open.has(f.path);
      const row = document.createElement('div');
      row.className = 'ti folder' + (open ? ' open' : '');
      row.dataset.path = f.path; row.dataset.type = 'folder'; row.draggable = true;
      row.innerHTML = `<span class="tw">▶</span><span class="nm">${esc(f.name)}</span>`;
      container.appendChild(row);
      if (open) { const kids = document.createElement('div'); kids.className = 'kids'; walk(f, kids); container.appendChild(kids); }
    }
    for (const it of [...node.items].sort(cmp)) {
      const row = document.createElement('div');
      row.className = 'ti ' + it.type + (S.cur && S.cur.path === it.path ? ' active' : '');
      row.dataset.path = it.path; row.dataset.type = it.type; row.draggable = true;
      row.innerHTML = it.type === 'note'
        ? `<span class="tw"></span><span class="nm">${esc(it.name)}</span>`
        : `<span class="tw"></span><span class="nm">${esc(it.name.replace(/\.[^.]+$/, ''))}</span><span class="ext">${esc((it.name.match(/\.[^.]+$/) || [''])[0].slice(1))}</span>`;
      container.appendChild(row);
    }
  };
  walk(buildTree(), frag);
  el.tree.replaceChildren(frag);
}

function saveOpen() { store.set('open', [...S.open]); }
function reveal(path) {
  let d = dirOf(path), changed = false;
  while (d) { if (!S.open.has(d)) { S.open.add(d); changed = true; } d = dirOf(d); }
  if (changed) { saveOpen(); renderTree(); }
  const row = $$('.ti', el.tree).find((r) => r.dataset.path === path);
  row?.scrollIntoView({ block: 'nearest' });
}

el.tree.addEventListener('click', (e) => {
  const row = e.target.closest('.ti'); if (!row) return;
  const { path, type } = row.dataset;
  if (type === 'folder') { S.open.has(path) ? S.open.delete(path) : S.open.add(path); saveOpen(); renderTree(); }
  else if (type === 'note') openNote(path);
  else window.open(vaultUrl(path), '_blank');
});
el.tree.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const row = e.target.closest('.ti');
  if (!row) return showCtx(e, [{ label: 'New note', fn: () => newNote('') }, { label: 'New folder', fn: () => newFolder('') }]);
  const { path, type } = row.dataset;
  if (type === 'folder') {
    showCtx(e, [
      { label: 'New note here', fn: () => newNote(path) },
      { label: 'New folder here', fn: () => newFolder(path) },
      '-',
      { label: 'Rename…', fn: () => renamePath(path, 'folder') },
      { label: 'Delete', danger: true, fn: () => deletePath(path, 'folder') },
    ]);
  } else {
    showCtx(e, [
      ...(type === 'note' ? [{ label: 'Open', fn: () => openNote(path) }] : [{ label: 'Open in new tab', fn: () => window.open(vaultUrl(path), '_blank') }]),
      { label: 'Copy wikilink', fn: () => copyText(`[[${type === 'note' ? linkText(path) : path.split('/').pop()}]]`) },
      '-',
      { label: 'Rename…', fn: () => renamePath(path, type) },
      { label: 'Move to…', fn: () => movePath(path) },
      { label: 'Delete', danger: true, fn: () => deletePath(path, type) },
    ]);
  }
});
// drag & drop move
let dragPath = null;
el.tree.addEventListener('dragstart', (e) => { const r = e.target.closest('.ti'); if (!r) return; dragPath = r.dataset.path; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `[[${base(dragPath)}]]`); });
el.tree.addEventListener('dragover', (e) => {
  if (!dragPath) return;
  e.preventDefault();
  $$('.drop-target', el.tree).forEach((x) => x.classList.remove('drop-target'));
  const r = e.target.closest('.ti.folder');
  r?.classList.add('drop-target');
});
el.tree.addEventListener('dragleave', (e) => { if (!el.tree.contains(e.relatedTarget)) $$('.drop-target', el.tree).forEach((x) => x.classList.remove('drop-target')); });
el.tree.addEventListener('drop', async (e) => {
  if (!dragPath) return;
  e.preventDefault();
  $$('.drop-target', el.tree).forEach((x) => x.classList.remove('drop-target'));
  const r = e.target.closest('.ti');
  let folder = r ? (r.dataset.type === 'folder' ? r.dataset.path : dirOf(r.dataset.path)) : '';
  const src = dragPath; dragPath = null;
  if (folder === src || folder.startsWith(src + '/') || dirOf(src) === folder) return;
  await doRename(src, join(folder, src.split('/').pop()), false);
});
el.tree.addEventListener('dragend', () => { dragPath = null; });
$('#sort').value = store.get('sort', 'name');
$('#sort').addEventListener('change', () => { store.set('sort', $('#sort').value); renderTree(); });

// ------------------------------------------------------------------ open / save
async function openNote(path, { push = true, line = null, heading = null, focus = false } = {}) {
  hideHover();
  await save();
  let d;
  try { d = await api('GET', 'note', { qs: { path } }); }
  catch (e) { toast(`Cannot open ${path}: ${e.message}`, true); return; }
  S.cur = { path: d.path, mtime: d.mtime, dirty: false };
  S.contentCache.set(d.path, { mtime: d.mtime, content: d.content });
  el.doc.classList.remove('empty');
  el.editor.value = d.content;
  el.title.value = base(d.path);
  el.editWrap.scrollTop = 0; el.previewWrap.scrollTop = 0;
  autosize();
  setSaveState('');
  if (push) { S.hist = S.hist.slice(0, S.hi + 1); if (S.hist[S.hi] !== d.path) { S.hist.push(d.path); S.hi++; } }
  updateNav();
  renderCrumbs();
  renderPreview();
  renderRight();
  $$('.ti', el.tree).forEach((r) => r.classList.toggle('active', r.dataset.path === d.path));
  reveal(d.path);
  store.set('last', d.path);
  history.replaceState(null, '', '#/' + encodeURI(d.path));
  document.title = `${base(d.path)} — Inkwell`;
  if (heading) gotoHeading(heading);
  else if (line != null) gotoLine(line);
  else if (focus) el.editor.focus();
}

function closeNote() {
  S.cur = null;
  el.doc.classList.add('empty');
  el.crumbs.textContent = '';
  document.title = 'Inkwell';
  history.replaceState(null, '', '#');
  renderRight();
  $$('.ti.active', el.tree).forEach((r) => r.classList.remove('active'));
}

function renderCrumbs() {
  if (!S.cur) return;
  const parts = S.cur.path.split('/');
  parts[parts.length - 1] = base(S.cur.path);
  el.crumbs.innerHTML = parts.map((p, i) => (i === parts.length - 1 ? `<span style="color:var(--fg2)">${esc(p)}</span>` : `<span>${esc(p)}</span>`)).join(' / ');
}
function updateNav() { $('#btn-back').disabled = S.hi <= 0; $('#btn-fwd').disabled = S.hi >= S.hist.length - 1; }
function goHist(delta) {
  const ni = S.hi + delta;
  if (ni < 0 || ni >= S.hist.length) return;
  S.hi = ni; openNote(S.hist[ni], { push: false });
}
$('#btn-back').onclick = () => goHist(-1);
$('#btn-fwd').onclick = () => goHist(1);

function setSaveState(s) { el.saveState.textContent = s; }

let saveTimer = null;
function scheduleSave() {
  if (!S.cur) return;
  S.cur.dirty = true;
  setSaveState('Editing…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

async function save(force = false) {
  clearTimeout(saveTimer);
  if (S.saving) await S.saving;
  if (!S.cur || !S.cur.dirty) return;
  const cur = S.cur, content = el.editor.value;
  let conflict = null;
  S.saving = (async () => {
    try {
      const r = await api('PUT', 'note', { qs: { path: cur.path }, body: { content, baseMtime: cur.mtime, force } });
      cur.mtime = r.mtime;
      S.contentCache.set(cur.path, { mtime: r.mtime, content });
      const n = S.noteByPath.get(cur.path);
      if (n) Object.assign(n, { mtime: r.mtime, ...analyse(content) });
      if (S.cur === cur && el.editor.value === content) { cur.dirty = false; setSaveState('Saved'); }
    } catch (e) {
      if (e.status === 409) conflict = e;
      else { toast('Save failed: ' + e.message, true); setSaveState('Not saved!'); }
    }
  })();
  await S.saving;
  S.saving = null;
  if (conflict) {
    const overwrite = await ask(`"${base(cur.path)}" was changed outside Inkwell. Keep your version (overwrite the file) or reload the version on disk?`, null, { ok: 'Overwrite', cancel: 'Reload from disk' });
    if (overwrite) { cur.mtime = conflict.data.mtime; return save(true); }
    cur.dirty = false;
    if (S.cur === cur) await openNote(cur.path, { push: false });
  } else if (S.cur && S.cur.dirty && el.editor.value !== content) {
    scheduleSave();
  }
}
window.addEventListener('beforeunload', (e) => { if (S.cur?.dirty) { save(); e.preventDefault(); e.returnValue = ''; } });

// ------------------------------------------------------------------ preview
function renderPreview() {
  if (!S.cur) return;
  const node = renderMarkdown(el.editor.value, S.cur.path, 0);
  if (S.mode === 'preview') {
    const h = document.createElement('div');
    h.className = 'inline-title'; h.textContent = base(S.cur.path);
    node.prepend(h);
  }
  el.preview.replaceChildren(...node.childNodes);
  updateStatus();
}
const renderPreviewSoon = debounce(() => { renderPreview(); renderRightLive(); }, 160);

el.preview.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  const open = e.target.closest('[data-open]');
  if (open) { e.preventDefault(); return openNote(open.dataset.open); }
  if (!a) return;
  if (a.classList.contains('tag')) { e.preventDefault(); return searchFor('tag:' + a.dataset.tag); }
  if (a.classList.contains('wl')) { e.preventDefault(); followLink(a.dataset.target, a.dataset.heading, a.dataset.from || S.cur?.path); }
});
el.preview.addEventListener('change', (e) => {
  const cb = e.target;
  if (cb.matches('input[type=checkbox][data-task]')) toggleTask(+cb.dataset.task, cb.checked);
});

async function followLink(target, heading, from) {
  if (!target) { if (heading) gotoHeading(heading); return; }
  const r = resolve(target, from);
  if (r) {
    if (!r.toLowerCase().endsWith('.md')) return window.open(vaultUrl(r), '_blank');
    if (S.cur && r === S.cur.path) return heading && gotoHeading(heading);
    return openNote(r, { heading: heading || null });
  }
  // unresolved: create it
  const name = cleanName(target.split('/').pop());
  if (!name) return;
  const d = target.includes('/') ? normPath(dirOf(target)) : '';
  await createNote(join(d, name + '.md'), '');
}

function toggleTask(idx, checked) {
  const lines = el.editor.value.split('\n');
  let inFence = false, n = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i].match(/^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/);
    if (m && ++n === idx) {
      lines[i] = m[1] + (checked ? 'x' : ' ') + m[3];
      const sel = [el.editor.selectionStart, el.editor.selectionEnd];
      el.editor.value = lines.join('\n');
      el.editor.setSelectionRange(...sel);
      scheduleSave(); renderPreviewSoon();
      return;
    }
  }
}

// hover previews
let hoverTimer = null, hoverEl = null;
function hideHover() { clearTimeout(hoverTimer); hoverEl = null; $('#hover').hidden = true; }
for (const ev of ['mousedown', 'keydown', 'wheel']) document.addEventListener(ev, hideHover, true);
document.addEventListener('mouseover', (e) => {
  const a = e.target.closest('a.wl:not(.unresolved), .bl[data-path], .out[data-path]:not(.unresolved)');
  if (!a || a.closest('#hover')) return;
  clearTimeout(hoverTimer);
  hoverEl = a;
  hoverTimer = setTimeout(async () => {
    if (hoverEl !== a || !a.isConnected) return;
    const path = a.dataset.path || resolve(a.dataset.target, a.dataset.from || S.cur?.path);
    if (!path || !path.toLowerCase().endsWith('.md') || path === S.cur?.path) return;
    try {
      let text = await getContent(path);
      if (a.dataset.heading) text = sectionOf(text, a.dataset.heading) ?? text;
      if (hoverEl !== a || !a.isConnected) return;
      const h = $('#hover');
      h.className = 'md';
      if (text.trim()) h.replaceChildren(...renderMarkdown(text.slice(0, 4000), path, 1).childNodes);
      else h.innerHTML = `<div class="empty">${esc(base(path))} is empty</div>`;
      const r = a.getBoundingClientRect();
      h.hidden = false;
      const x = Math.min(r.left, innerWidth - 440), y = r.bottom + 330 > innerHeight ? Math.max(8, r.top - 330) : r.bottom + 6;
      h.style.left = Math.max(8, x) + 'px'; h.style.top = y + 'px';
    } catch {}
  }, 500);
});
document.addEventListener('mouseout', (e) => {
  const a = e.target.closest('a.wl, .bl, .out');
  if (a && !a.contains(e.relatedTarget)) hideHover();
});

// ------------------------------------------------------------------ editor
function autosize() {
  const st = el.editWrap.scrollTop;
  el.editor.style.height = 'auto';
  el.editor.style.height = el.editor.scrollHeight + 'px';
  el.editWrap.scrollTop = st;
}

function caretXY(ta, pos) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'wordSpacing', 'textIndent'])
    div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px' });
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = ta.value.slice(pos) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const r = ta.getBoundingClientRect();
  const out = { x: r.left + span.offsetLeft - ta.scrollLeft, y: r.top + span.offsetTop - ta.scrollTop, top: span.offsetTop, h: parseFloat(cs.lineHeight) || 24 };
  div.remove();
  return out;
}

function insertText(text, selStart = null, selEnd = null) {
  el.editor.focus();
  if (selStart != null) el.editor.setSelectionRange(selStart, selEnd ?? selStart);
  if (!document.execCommand('insertText', false, text)) {
    el.editor.setRangeText(text, el.editor.selectionStart, el.editor.selectionEnd, 'end');
    el.editor.dispatchEvent(new Event('input'));
  }
}

function lineBounds(v, pos) {
  const s = v.lastIndexOf('\n', pos - 1) + 1;
  let e = v.indexOf('\n', pos); if (e < 0) e = v.length;
  return [s, e];
}

function gotoLine(n) {
  const lines = el.editor.value.split('\n');
  n = Math.max(0, Math.min(n, lines.length - 1));
  let off = 0; for (let i = 0; i < n; i++) off += lines[i].length + 1;
  if (S.mode !== 'preview') {
    el.editor.focus({ preventScroll: true });
    el.editor.setSelectionRange(off, off + lines[n].length);
    const c = caretXY(el.editor, off);
    el.editWrap.scrollTop = el.editor.offsetTop + c.top - el.editWrap.clientHeight / 3;
  }
  if (S.mode !== 'edit') {
    el.previewWrap.scrollTop = (n / Math.max(1, lines.length)) * (el.previewWrap.scrollHeight - el.previewWrap.clientHeight);
  }
}

function gotoHeading(h) {
  const want = slug(h);
  const lines = el.editor.value.split('\n');
  const i = lines.findIndex((l) => { const m = l.match(/^#{1,6}\s+(.*)$/); return m && slug(m[1]) === want; });
  if (i < 0) return;
  gotoLine(i);
  if (S.mode !== 'edit') {
    const hs = $$('h1,h2,h3,h4,h5,h6', el.preview).filter((x) => !x.closest('.embed'));
    const target = hs.find((x) => slug(x.textContent) === want);
    if (target) el.previewWrap.scrollTop = target.offsetTop - 20;
  }
}

el.editor.addEventListener('input', () => { autosize(); scheduleSave(); renderPreviewSoon(); checkAC(); });
el.editor.addEventListener('click', () => checkAC());
el.editor.addEventListener('blur', () => setTimeout(() => { if (!$('#ac').matches(':hover')) closeAC(); }, 150));
el.editWrap.addEventListener('scroll', () => {
  if (S.mode !== 'split') return;
  const r = el.editWrap.scrollTop / Math.max(1, el.editWrap.scrollHeight - el.editWrap.clientHeight);
  el.previewWrap.scrollTop = r * (el.previewWrap.scrollHeight - el.previewWrap.clientHeight);
});

el.editor.addEventListener('keydown', (e) => {
  const ta = el.editor, v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
  if (!$('#ac').hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveAC(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptAC(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeAC(); return; }
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); wrap(e.key === 'b' ? '**' : '*'); return; }
  if (mod && e.key === 'k') { e.preventDefault(); const sel = v.slice(s, en); insertText(`[${sel}]()`); ta.setSelectionRange(s + sel.length + 3, s + sel.length + 3); return; }
  if (mod && e.key === 'l') { e.preventDefault(); cycleTask(); return; }
  if (e.key === '[' && !mod && !e.altKey) {
    e.preventDefault();
    if (s !== en) { const sel = v.slice(s, en); insertText('[' + sel + ']'); ta.setSelectionRange(s + 1, s + 1 + sel.length); }
    else { insertText('[]'); ta.setSelectionRange(s + 1, s + 1); }
    checkAC(); return;
  }
  if (e.key === ']' && s === en && v[s] === ']') { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
  if (e.key === 'Backspace' && s === en && v[s - 1] === '[' && v[s] === ']') { e.preventDefault(); insertText('', s - 1, s + 1); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const [ls] = lineBounds(v, s); const [, le] = lineBounds(v, en);
    const block = v.slice(ls, le);
    const isList = /^\s*([-*+]|\d+[.)])\s/.test(block);
    if (e.shiftKey) {
      const out = block.split('\n').map((l) => l.replace(/^(\t| {1,4})/, '')).join('\n');
      insertText(out, ls, le); ta.setSelectionRange(ls, ls + out.length);
    } else if (s !== en || isList) {
      const out = block.split('\n').map((l) => '\t' + l).join('\n');
      insertText(out, ls, le);
      if (s === en) ta.setSelectionRange(s + 1, s + 1); else ta.setSelectionRange(ls, ls + out.length);
    } else insertText('\t');
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !mod && s === en) {
    const [ls] = lineBounds(v, s);
    const line = v.slice(ls, s);
    const m = line.match(/^(\s*(?:>\s*)*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/);
    const q = !m && line.match(/^(\s*>\s*)+(.*)$/);
    if (m) {
      e.preventDefault();
      if (!m[7].trim() && !v.slice(s, lineBounds(v, s)[1]).trim()) { insertText('', ls, s); ta.setSelectionRange(ls, ls); return; } // empty item ends list
      const marker = m[3] ? (+m[3] + 1) + m[4] : m[2];
      insertText('\n' + m[1] + marker + m[5] + (m[6] ? '[ ] ' : ''));
      return;
    }
    if (q) {
      e.preventDefault();
      if (!q[2].trim()) { insertText('', ls, s); ta.setSelectionRange(ls, ls); return; }
      insertText('\n' + line.match(/^(\s*>\s*)+/)[0]);
    }
  }
});

function wrap(mark) {
  const ta = el.editor, s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
  if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) { insertText(sel.slice(mark.length, -mark.length)); ta.setSelectionRange(s, e - mark.length * 2); return; }
  insertText(mark + sel + mark);
  ta.setSelectionRange(s + mark.length, e + mark.length);
}
function cycleTask() {
  const ta = el.editor, v = ta.value, [ls, le] = lineBounds(v, ta.selectionStart);
  const line = v.slice(ls, le); let out;
  const m = line.match(/^(\s*)([-*+]\s+)(\[([ xX])\]\s+)?(.*)$/);
  if (!m) out = line.replace(/^(\s*)/, '$1- [ ] ');
  else if (!m[3]) out = m[1] + m[2] + '[ ] ' + m[5];
  else if (m[4] === ' ') out = m[1] + m[2] + '[x] ' + m[5];
  else out = m[1] + m[2] + m[5];
  const cur = ta.selectionStart + (out.length - line.length);
  insertText(out, ls, le); ta.setSelectionRange(cur, cur);
}

// paste / drop attachments
async function uploadFile(file, nameHint) {
  const ext = (file.name.match(/\.[^.]+$/) || ['.' + (file.type.split('/')[1] || 'bin')])[0];
  const d = new Date();
  const name = nameHint || file.name || `Pasted image ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ext}`;
  const r = await api('POST', 'upload', { qs: { path: 'attachments/' + name }, raw: file });
  await refreshIndex({ quiet: true });
  return r.path;
}
el.editor.addEventListener('paste', async (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) {
    try {
      const d = new Date();
      const p = await uploadFile(f, f.type.startsWith('image/') && (!f.name || f.name === 'image.png') ? `Pasted image ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png` : null);
      insertText(`![[${p.split('/').pop()}]]`);
    } catch (err) { toast('Upload failed: ' + err.message, true); }
  }
});
el.editor.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) {
    try { const p = await uploadFile(f); insertText(`![[${p.split('/').pop()}]]\n`); } catch (err) { toast('Upload failed: ' + err.message, true); }
  }
});

// title rename
el.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); el.editor.focus(); el.editor.setSelectionRange(0, 0); }
  if (e.key === 'Escape') { el.title.value = base(S.cur.path); el.editor.focus(); }
});
el.title.addEventListener('blur', async () => {
  if (!S.cur) return;
  const name = cleanName(el.title.value);
  if (!name || name === base(S.cur.path)) { el.title.value = base(S.cur.path); return; }
  const to = join(dirOf(S.cur.path), name + '.md');
  const ok = await doRename(S.cur.path, to, true);
  if (!ok) el.title.value = base(S.cur.path);
});

// ------------------------------------------------------------------ autocomplete
const AC = { kind: null, start: 0, items: [], sel: 0 };
function checkAC() {
  const ta = el.editor, pos = ta.selectionStart;
  if (pos !== ta.selectionEnd) return closeAC();
  const before = ta.value.slice(Math.max(0, pos - 120), pos);
  let m = /\[\[([^\[\]\n|#]*)$/.exec(before);
  if (m) {
    const q = m[1];
    const pool = [...S.index.notes.map((n) => ({ path: n.path, label: base(n.path), sub: dirOf(n.path) })), ...S.index.files.map((f) => ({ path: f, label: f.split('/').pop(), sub: dirOf(f) }))];
    AC.items = rank(q, pool, (x) => x.label + ' ' + x.path).slice(0, 14);
    if (q.trim() && !AC.items.some((x) => x.item.label.toLowerCase() === q.trim().toLowerCase())) AC.items.push({ item: { label: q.trim(), sub: 'new note', create: true }, pos: [] });
    AC.kind = 'link'; AC.start = pos - q.length;
  } else if ((m = /(?:^|\s)#([\w\-\/]+)$/.exec(before))) {
    const q = m[1].toLowerCase();
    AC.items = allTags().filter(([t]) => t.includes(q) && t !== q).slice(0, 12).map(([t, n]) => ({ item: { label: t, sub: n + '' }, pos: [] }));
    AC.kind = 'tag'; AC.start = pos - m[1].length;
  } else return closeAC();
  if (!AC.items.length) return closeAC();
  AC.sel = 0;
  const box = $('#ac');
  box.innerHTML = AC.items.map((r, i) => `<div class="pi${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="pt">${AC.kind === 'tag' ? '#' : ''}${hlPos(r.item.label, r.pos)}</span><span class="pp">${esc(r.item.sub || '')}</span></div>`).join('');
  const c = caretXY(ta, pos);
  box.hidden = false;
  const y = c.y + c.h + 260 > innerHeight ? c.y - Math.min(260, box.offsetHeight) - 4 : c.y + c.h + 2;
  box.style.left = Math.min(c.x, innerWidth - 310) + 'px';
  box.style.top = y + 'px';
}
function closeAC() { $('#ac').hidden = true; AC.kind = null; }
function moveAC(d) {
  AC.sel = (AC.sel + d + AC.items.length) % AC.items.length;
  $$('#ac .pi').forEach((x, i) => x.classList.toggle('sel', i === AC.sel));
  $$('#ac .pi')[AC.sel]?.scrollIntoView({ block: 'nearest' });
}
function acceptAC(i = AC.sel) {
  const r = AC.items[i]; if (!r) return;
  const ta = el.editor, pos = ta.selectionStart;
  if (AC.kind === 'link') {
    const it = r.item;
    const text = it.create ? it.label : it.path.toLowerCase().endsWith('.md') ? linkText(it.path) : it.label;
    const hasClose = ta.value.slice(pos, pos + 2) === ']]';
    insertText(text + (hasClose ? '' : ']]'), AC.start, pos);
    const after = AC.start + text.length + 2;
    ta.setSelectionRange(after, after);
  } else {
    insertText(r.item.label + ' ', AC.start, pos);
  }
  closeAC();
}
$('#ac').addEventListener('mousedown', (e) => { const p = e.target.closest('.pi'); if (p) { e.preventDefault(); acceptAC(+p.dataset.i); } });

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

// ------------------------------------------------------------------ sidebars
function setTab(name) {
  $$('.st').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('#left .pane').forEach((p) => (p.hidden = p.id !== 'pane-' + name));
  if (el.app.classList.contains('no-left')) toggleLeft(true);
  if (name === 'search') setTimeout(() => $('#search-input').focus(), 0);
}
$$('.st').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

function allTags() {
  const m = new Map();
  for (const n of S.index.notes) for (const t of n.tags) m.set(t, (m.get(t) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function renderTags() {
  const tags = allTags();
  $('#tag-list').innerHTML = tags.length
    ? tags.map(([t, n]) => `<div class="tag-row" data-tag="${esc(t)}"><span>#${esc(t)}</span><span class="n">${n}</span></div>`).join('')
    : '<div class="empty" style="padding:10px">No tags yet. Write #something in a note.</div>';
}
$('#tag-list').addEventListener('click', (e) => { const r = e.target.closest('.tag-row'); if (r) searchFor('tag:' + r.dataset.tag); });

function searchFor(q) { setTab('search'); $('#search-input').value = q; runSearch(); }
const runSearch = debounce(async () => {
  const q = $('#search-input').value.trim();
  const box = $('#search-results');
  if (!q) { box.innerHTML = ''; return; }
  let results;
  let tm;
  if ((tm = q.match(/^tag:#?(\S+)$/i))) {
    const t = tm[1].toLowerCase();
    results = S.index.notes.filter((n) => n.tags.some((x) => x === t || x.startsWith(t + '/'))).map((n) => ({ path: n.path, snippets: [] }));
  } else if ((tm = q.match(/^path:(.+)$/i))) {
    const t = tm[1].trim().toLowerCase();
    results = S.index.notes.filter((n) => n.path.toLowerCase().includes(t)).map((n) => ({ path: n.path, snippets: [] }));
  } else {
    try { results = await api('GET', 'search', { qs: { q } }); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  const terms = q.replace(/^(tag|path):/i, '').split(/\s+/).filter(Boolean);
  const termRe = terms.length ? new RegExp('(' + terms.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi') : null;
  const hl = (s) => (termRe ? esc(s).replace(termRe, '<mark>$1</mark>') : esc(s));
  box.innerHTML = `<div class="muted small" style="padding:2px 8px 6px">${results.length} result${results.length === 1 ? '' : 's'}</div>` + results.map((r) => `
    <div class="sr" data-path="${esc(r.path)}">
      <div class="t">${hl(base(r.path))}</div>
      ${dirOf(r.path) ? `<div class="p">${esc(dirOf(r.path))}</div>` : ''}
      ${r.snippets.map((s) => `<div class="s" data-line="${s.line}">${hl(s.text)}</div>`).join('')}
    </div>`).join('');
}, 220);
$('#search-input').addEventListener('input', runSearch);
$('#search-results').addEventListener('click', (e) => {
  const r = e.target.closest('.sr'); if (!r) return;
  const s = e.target.closest('.s');
  openNote(r.dataset.path, { line: s ? +s.dataset.line : null });
});

// right panel
function backlinksOf(path) {
  return S.index.notes.filter((n) => n.path !== path && n.links.some((l) => resolve(l, n.path) === path));
}
let rightSeq = 0;
async function renderRight() {
  const seq = ++rightSeq;
  renderRightLive();
  const bl = $('#backlinks');
  if (!S.cur) { bl.innerHTML = ''; $('#bl-count').textContent = ''; $('#unlinked').innerHTML = ''; return; }
  const path = S.cur.path;
  const notes = backlinksOf(path);
  $('#bl-count').textContent = notes.length || '';
  $('#st-links').textContent = `${notes.length} backlink${notes.length === 1 ? '' : 's'}`;
  if (!notes.length) { bl.innerHTML = '<div class="empty">No backlinks</div>'; }
  else {
    bl.innerHTML = notes.map((n) => `<div class="bl" data-path="${esc(n.path)}"><div class="t">${esc(base(n.path))}</div><div class="s">…</div></div>`).join('');
    for (const n of notes) {
      getContent(n.path).then((text) => {
        if (seq !== rightSeq) return;
        const lines = text.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => [...l.matchAll(WL_RE)].some((m) => resolve(m[1].trim(), n.path) === path) || [...l.matchAll(/\]\(([^)\s]+\.md)\)/g)].some((m) => resolve(normPath(join(dirOf(n.path), decodeURIComponent(m[1])))) === path));
        const row = $$('.bl', bl).find((x) => x.dataset.path === n.path);
        if (row) row.querySelector('.s').innerHTML = lines.slice(0, 3).map(({ l, i }) => `<div data-line="${i}">${esc(l.trim().slice(0, 200)).replace(/(\[\[[^\]]*\]\])/g, '<mark>$1</mark>')}</div>`).join('') || '';
      }).catch(() => {});
    }
  }
  if ($('#unlinked').closest('details').open) renderUnlinked(seq);
  else { $('#unlinked').innerHTML = ''; $('#um-count').textContent = ''; }
  if ($('#local-graph').closest('details').open) localGraph.update();
}
$('#backlinks').addEventListener('click', (e) => {
  const r = e.target.closest('.bl'); if (!r) return;
  const ln = e.target.closest('[data-line]');
  openNote(r.dataset.path, { line: ln ? +ln.dataset.line : null });
});

async function renderUnlinked(seq = rightSeq) {
  const box = $('#unlinked');
  if (!S.cur) return;
  const path = S.cur.path, name = base(path);
  if (name.length < 3) { box.innerHTML = '<div class="empty">Name too short</div>'; return; }
  box.innerHTML = '<div class="empty">Searching…</div>';
  let res; try { res = await api('GET', 'search', { qs: { q: name } }); } catch { return; }
  if (seq !== rightSeq) return;
  const linked = new Set(backlinksOf(path).map((n) => n.path));
  const re = new RegExp(`(^|[^\\p{L}\\p{N}\\[|])(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}\\p{N}\\]])`, 'iu');
  const hits = res.filter((r) => r.path !== path && !linked.has(r.path)).map((r) => ({ ...r, snippets: r.snippets.filter((s) => re.test(s.text)) })).filter((r) => r.snippets.length);
  $('#um-count').textContent = hits.length || '';
  box.innerHTML = hits.length ? hits.map((r) => `<div class="bl" data-path="${esc(r.path)}"><button class="link-btn" data-link="${esc(r.path)}">Link</button><div class="t">${esc(base(r.path))}</div><div class="s">${r.snippets.slice(0, 2).map((s) => `<div data-line="${s.line}">${esc(s.text.slice(0, 200)).replace(re, '$1<mark>$2</mark>')}</div>`).join('')}</div></div>`).join('') : '<div class="empty">No unlinked mentions</div>';
  box.dataset.re = re.source;
}
$('#unlinked').closest('details').addEventListener('toggle', (e) => { if (e.target.open) renderUnlinked(); });
$('#unlinked').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-link]');
  if (btn) {
    e.stopPropagation();
    const p = btn.dataset.link;
    const name = base(S.cur.path), target = linkText(S.cur.path);
    const re = new RegExp(`(^|[^\\p{L}\\p{N}\\[|])(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}\\p{N}\\]])`, 'iu');
    try {
      const d = await api('GET', 'note', { qs: { path: p } });
      // skip code when linking: only replace outside fences
      const parts = d.content.split(/(^```[\s\S]*?^```)/m);
      let done = false;
      const out = parts.map((part, i) => {
        if (done || i % 2) return part;
        return part.replace(re, (m0, pre, word) => { if (done) return m0; done = true; return pre + (word === target ? `[[${target}]]` : `[[${target}|${word}]]`); });
      }).join('');
      if (!done) return toast('Mention not found');
      await api('PUT', 'note', { qs: { path: p }, body: { content: out, baseMtime: d.mtime } });
      toast(`Linked in ${base(p)}`);
      await refreshIndex(); renderRight();
    } catch (err) { toast('Link failed: ' + err.message, true); }
    return;
  }
  const r = e.target.closest('.bl'); if (!r) return;
  const ln = e.target.closest('[data-line]');
  openNote(r.dataset.path, { line: ln ? +ln.dataset.line : null });
});

function renderRightLive() {
  const out = $('#outgoing'), tg = $('#note-tags'), ol = $('#outline');
  if (!S.cur) { out.innerHTML = tg.innerHTML = ol.innerHTML = ''; return; }
  const text = el.editor.value;
  const { links, tags } = analyse(text);
  const uniq = [...new Map(links.map((l) => [l.toLowerCase(), l])).values()];
  out.innerHTML = uniq.length ? uniq.map((l) => { const r = resolve(l, S.cur.path); return `<div class="out${r ? '' : ' unresolved'}" ${r ? `data-path="${esc(r)}"` : ''} data-target="${esc(l)}">${esc(r ? base(r) : l)}${r ? '' : ' <span class="small">(create)</span>'}</div>`; }).join('') : '<div class="empty">No outgoing links</div>';
  tg.innerHTML = tags.length ? tags.map((t) => `<span class="tag-chip" data-tag="${esc(t)}" style="display:inline-block;margin:2px;font-size:12px;background:var(--tag-bg);color:var(--accent);padding:1px 8px;border-radius:10px;cursor:pointer">#${esc(t)}</span>`).join('') : '<div class="empty">No tags</div>';
  const heads = [];
  let inFence = false;
  text.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    const m = !inFence && l.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (m) heads.push({ lvl: m[1].length, text: m[2], line: i });
  });
  const min = Math.min(...heads.map((h) => h.lvl));
  ol.innerHTML = heads.length ? heads.map((h) => `<div class="ol" data-line="${h.line}" data-h="${esc(h.text)}" style="padding-left:${(h.lvl - min) * 12 + 4}px">${esc(h.text)}</div>`).join('') : '<div class="empty">No headings</div>';
  const words = (text.replace(/^---\n[\s\S]*?\n---\n/, '').match(/\S+/g) || []).length;
  $('#st-words').textContent = `${words.toLocaleString()} words · ${text.length.toLocaleString()} chars`;
}
function updateStatus() { renderRightLive(); }
$('#outgoing').addEventListener('click', (e) => { const r = e.target.closest('.out'); if (r) followLink(r.dataset.target, '', S.cur.path); });
$('#note-tags').addEventListener('click', (e) => { const r = e.target.closest('[data-tag]'); if (r) searchFor('tag:' + r.dataset.tag); });
$('#outline').addEventListener('click', (e) => { const r = e.target.closest('.ol'); if (r) gotoHeading(r.dataset.h); });

// ------------------------------------------------------------------ file ops
function uniquePath(folder, name) {
  let p = join(folder, name + '.md'), i = 1;
  while (S.pathMap.has(p.toLowerCase())) p = join(folder, `${name} ${i++}.md`);
  return p;
}
async function createNote(path, content = '', { focusTitle = false } = {}) {
  try { await api('PUT', 'note', { qs: { path }, body: { content, create: true } }); }
  catch (e) { if (e.status !== 409) { toast('Create failed: ' + e.message, true); return; } }
  await refreshIndex({ quiet: true });
  renderTree();
  await openNote(path);
  if (S.mode === 'preview') setMode(S.lastEditMode);
  if (focusTitle) { el.title.focus(); el.title.select(); } else el.editor.focus();
}
async function newNote(folder) {
  if (folder == null) folder = '';
  await createNote(uniquePath(folder, 'Untitled'), '', { focusTitle: true });
}
async function newFolder(parent = '') {
  const name = await ask('New folder name', '');
  if (!name) return;
  const p = join(parent, cleanName(name));
  try { await api('POST', 'folder', { body: { path: p } }); S.open.add(p); if (parent) S.open.add(parent); saveOpen(); await refreshIndex(); }
  catch (e) { toast(e.message, true); }
}
async function doRename(from, to, updateLinks = true) {
  if (from === to) return true;
  await save();
  try {
    const r = await api('POST', 'rename', { body: { from, to, updateLinks } });
    const remap = (p) => (p === from ? r.path : p.startsWith(from + '/') ? r.path + p.slice(from.length) : p);
    S.hist = S.hist.map(remap);
    if (S.open.has(from)) { S.open.delete(from); S.open.add(r.path); saveOpen(); }
    if (S.cur) {
      const np = remap(S.cur.path);
      if (np !== S.cur.path) {
        S.cur.path = np; el.title.value = base(np); renderCrumbs();
        history.replaceState(null, '', '#/' + encodeURI(np)); document.title = `${base(np)} — Inkwell`; store.set('last', np);
      }
    }
    await refreshIndex();
    if (S.cur) { renderPreview(); reveal(S.cur.path); $$('.ti', el.tree).forEach((x) => x.classList.toggle('active', x.dataset.path === S.cur.path)); }
    if (r.linksUpdated) toast(`Updated links in ${r.linksUpdated} note${r.linksUpdated === 1 ? '' : 's'}`);
    return true;
  } catch (e) { toast('Rename failed: ' + e.message, true); return false; }
}
async function renamePath(path, type) {
  const isNote = type === 'note';
  const cur = isNote ? base(path) : path.split('/').pop();
  const name = await ask(`Rename ${type}`, cur);
  if (!name || cleanName(name) === cur) return;
  await doRename(path, join(dirOf(path), cleanName(name) + (isNote ? '.md' : '')), true);
}
async function movePath(path) {
  const dest = await ask('Move to folder (blank = vault root). Existing: ' + (S.index.folders.slice(0, 8).join(', ') || 'none'), dirOf(path));
  if (dest == null) return;
  const d = normPath(dest.trim());
  await doRename(path, join(d, path.split('/').pop()), false);
}
async function deletePath(path, type) {
  const ok = await ask(`Move "${path}" to the vault's .trash folder?${type === 'folder' ? ' Everything inside it goes too.' : ''}`, null, { ok: 'Delete', danger: true });
  if (!ok) return;
  await save();
  try {
    await api('POST', 'delete', { body: { path } });
    if (S.cur && (S.cur.path === path || S.cur.path.startsWith(path + '/'))) { S.cur.dirty = false; closeNote(); }
    S.hist = S.hist.filter((p) => p !== path && !p.startsWith(path + '/')); S.hi = Math.min(S.hi, S.hist.length - 1);
    updateNav();
    await refreshIndex();
    toast('Moved to .trash');
  } catch (e) { toast('Delete failed: ' + e.message, true); }
}
async function openDaily() {
  const ds = today();
  const path = `Daily/${ds}.md`;
  if (!S.pathMap.has(path.toLowerCase())) {
    let content = `# ${ds}\n\n`;
    const tpl = resolve('Templates/Daily');
    if (tpl) { try { content = (await getContent(tpl)).replace(/\{\{date\}\}/g, ds).replace(/\{\{title\}\}/g, ds).replace(/\{\{time\}\}/g, nowTime()); } catch {} }
    try { await api('PUT', 'note', { qs: { path }, body: { content, create: true } }); } catch (e) { if (e.status !== 409) return toast(e.message, true); }
    await refreshIndex({ quiet: true }); renderTree();
  }
  await openNote(path);
  if (S.mode !== 'preview') { el.editor.focus(); const l = el.editor.value.length; el.editor.setSelectionRange(l, l); }
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copied ' + t); } catch { toast('Clipboard unavailable', true); } }

// ------------------------------------------------------------------ modes / layout
function setMode(m) {
  S.mode = m; store.set('mode', m);
  if (m !== 'preview') { S.lastEditMode = m; store.set('lastEditMode', m); }
  el.doc.className = 'mode-' + m + (S.cur ? '' : ' empty');
  $$('#mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  if (S.cur) { renderPreview(); if (m !== 'preview') { autosize(); } }
}
$$('#mode-seg button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
function toggleLeft(force) {
  if (innerWidth <= 800) { el.app.classList.toggle('show-left-mobile'); return; }
  const hide = force === true ? false : force === false ? true : !el.app.classList.contains('no-left');
  el.app.classList.toggle('no-left', hide); store.set('noLeft', hide);
}
function toggleRight() { const h = !el.app.classList.contains('no-right'); el.app.classList.toggle('no-right', h); store.set('noRight', h); }
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t; store.set('theme', t);
  graph.view?.draw(); localGraph.view?.draw();
}
// resizers
for (const r of $$('.resizer')) {
  r.addEventListener('mousedown', (e) => {
    e.preventDefault(); r.classList.add('drag');
    const side = r.dataset.side;
    const move = (ev) => {
      const w = side === 'left' ? Math.max(160, Math.min(520, ev.clientX - 44)) : Math.max(200, Math.min(560, innerWidth - ev.clientX));
      el.app.style.setProperty(side === 'left' ? '--left-w' : '--right-w', w + 'px');
    };
    const up = () => {
      r.classList.remove('drag'); removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      store.set('widths', { l: el.app.style.getPropertyValue('--left-w'), r: el.app.style.getPropertyValue('--right-w') });
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
}

// ------------------------------------------------------------------ dialogs / menus
function ask(label, value = '', { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolveP) => {
    const box = $('#prompt'), input = $('#prompt-input'), form = $('.prompt-box', box);
    const isConfirm = value === null;
    $('#prompt-label').textContent = label;
    input.hidden = isConfirm; input.value = value || '';
    $('#prompt-ok').textContent = ok; $('#prompt-ok').className = danger ? 'danger' : 'primary';
    $('#prompt-cancel').textContent = cancel;
    box.hidden = false;
    setTimeout(() => (isConfirm ? $('#prompt-ok') : input).focus(), 0);
    if (!isConfirm) input.select();
    const done = (v) => { box.hidden = true; form.onsubmit = null; $('#prompt-cancel').onclick = null; box.onkeydown = null; box.onmousedown = null; resolveP(v); };
    form.onsubmit = (e) => { e.preventDefault(); done(isConfirm ? true : input.value); };
    $('#prompt-cancel').onclick = () => done(isConfirm ? false : null);
    box.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(isConfirm ? false : null); } };
    box.onmousedown = (e) => { if (e.target === box) done(isConfirm ? false : null); };
  });
}
function showCtx(e, items) {
  const m = $('#ctx');
  m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<div data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</div>`)).join('');
  m.hidden = false;
  m.style.left = Math.min(e.clientX, innerWidth - 190) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 8) + 'px';
  m.onclick = (ev) => { const d = ev.target.closest('[data-i]'); if (d) { m.hidden = true; items[+d.dataset.i].fn(); } };
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctx')) $('#ctx').hidden = true; });

// ------------------------------------------------------------------ palette
const COMMANDS = [
  { id: 'new-note', name: 'Create new note', key: 'Alt+N', fn: () => newNote(S.cur ? dirOf(S.cur.path) : '') },
  { id: 'new-folder', name: 'Create new folder', fn: () => newFolder('') },
  { id: 'daily', name: "Open today's daily note", key: 'Alt+D', fn: openDaily },
  { id: 'switcher', name: 'Quick switcher: open note', key: 'Ctrl+O', fn: () => openPalette('files') },
  { id: 'graph', name: 'Open graph view', key: 'Ctrl+G', fn: () => openGraph() },
  { id: 'search', name: 'Search all notes', key: 'Ctrl+Shift+F', fn: () => setTab('search') },
  { id: 'tags', name: 'Show tags', fn: () => setTab('tags') },
  { id: 'files', name: 'Show file explorer', fn: () => setTab('files') },
  { id: 'toggle-mode', name: 'Toggle reading / editing', key: 'Ctrl+E', fn: () => setMode(S.mode === 'preview' ? S.lastEditMode : 'preview') },
  { id: 'mode-split', name: 'Split editor and preview', key: 'Ctrl+Shift+E', fn: () => setMode('split') },
  { id: 'mode-edit', name: 'Source editor only', fn: () => setMode('edit') },
  { id: 'rename', name: 'Rename current note', need: true, fn: () => { if (S.mode === 'preview') setMode(S.lastEditMode); el.title.focus(); el.title.select(); } },
  { id: 'move', name: 'Move current note to folder…', need: true, fn: () => movePath(S.cur.path) },
  { id: 'delete', name: 'Delete current note', need: true, fn: () => deletePath(S.cur.path, 'note') },
  { id: 'copy-link', name: 'Copy wikilink to current note', need: true, fn: () => copyText(`[[${linkText(S.cur.path)}]]`) },
  { id: 'insert-date', name: "Insert today's date", need: true, fn: () => insertText(today()) },
  { id: 'insert-time', name: 'Insert current time', need: true, fn: () => insertText(nowTime()) },
  { id: 'insert-template', name: 'Insert template…', need: true, fn: () => openPalette('templates') },
  { id: 'toggle-task', name: 'Toggle checklist item', key: 'Ctrl+L', need: true, fn: cycleTask },
  { id: 'random', name: 'Open random note', fn: () => { const n = S.index.notes; if (n.length) openNote(n[Math.floor(Math.random() * n.length)].path); } },
  { id: 'reveal', name: 'Reveal current note in file explorer', need: true, fn: () => { setTab('files'); reveal(S.cur.path); } },
  { id: 'collapse-all', name: 'Collapse all folders', fn: () => { S.open.clear(); saveOpen(); renderTree(); } },
  { id: 'toggle-left', name: 'Toggle left sidebar', key: 'Ctrl+\\', fn: () => toggleLeft() },
  { id: 'toggle-right', name: 'Toggle right sidebar', fn: toggleRight },
  { id: 'theme', name: 'Toggle light / dark theme', fn: toggleTheme },
  { id: 'reload', name: 'Reload vault from disk', fn: () => refreshIndex().then(() => toast('Vault reloaded')) },
  { id: 'back', name: 'Navigate back', key: 'Alt+←', fn: () => goHist(-1) },
  { id: 'forward', name: 'Navigate forward', key: 'Alt+→', fn: () => goHist(1) },
  { id: 'palette', name: 'Command palette', key: 'Ctrl+P', fn: () => openPalette('commands') },
];
const CMD = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));
function runCmd(id) { const c = CMD[id]; if (!c) return; if (c.need && !S.cur) return toast('Open a note first'); c.fn(); }
document.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) runCmd(b.dataset.cmd); });

const PAL = { mode: 'commands', items: [], sel: 0 };
function openPalette(mode) {
  PAL.mode = mode;
  const inp = $('#palette-input');
  inp.value = '';
  inp.placeholder = mode === 'commands' ? 'Type a command…' : mode === 'templates' ? 'Pick a template from Templates/…' : 'Find or create a note…';
  $('#palette').hidden = false;
  fillPalette();
  setTimeout(() => inp.focus(), 0);
}
function closePalette() { $('#palette').hidden = true; if (S.cur && S.mode !== 'preview') el.editor.focus({ preventScroll: true }); }
function fillPalette() {
  const q = $('#palette-input').value;
  if (PAL.mode === 'commands') {
    PAL.items = rank(q, COMMANDS.map((c) => ({ ...c, label: c.name })), (c) => c.name);
  } else if (PAL.mode === 'templates') {
    PAL.items = rank(q, S.index.notes.filter((n) => n.path.toLowerCase().startsWith('templates/')).map((n) => ({ path: n.path, label: base(n.path) })), (x) => x.label);
  } else {
    PAL.items = rank(q, S.index.notes.map((n) => ({ path: n.path, label: base(n.path), sub: dirOf(n.path) })), (x) => x.label + ' ' + x.path).slice(0, 60);
    if (q.trim() && !PAL.items.some((r) => r.item.label.toLowerCase() === q.trim().toLowerCase())) PAL.items.push({ item: { label: q.trim(), create: true, sub: 'Enter to create' }, pos: [] });
  }
  PAL.sel = 0;
  $('#palette-list').innerHTML = PAL.items.map((r, i) => {
    const it = r.item;
    const right = PAL.mode === 'commands' ? (it.key ? `<kbd>${esc(it.key)}</kbd>` : '') : esc(it.sub || '');
    return `<div class="pi${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="pt">${it.create ? '＋ ' : ''}${hlPos(it.label, r.pos)}</span><span class="pp">${right}</span></div>`;
  }).join('') || `<div class="empty" style="padding:10px">${PAL.mode === 'templates' ? 'Create notes in a Templates/ folder to use them here.' : 'No matches'}</div>`;
}
async function acceptPalette(i = PAL.sel, forceCreate = false) {
  const q = $('#palette-input').value.trim();
  const r = PAL.items[i];
  closePalette();
  if (PAL.mode === 'commands') { if (r) runCmd(r.item.id); return; }
  if (PAL.mode === 'templates') {
    if (!r) return;
    const t = (await getContent(r.item.path)).replace(/\{\{date\}\}/g, today()).replace(/\{\{time\}\}/g, nowTime()).replace(/\{\{title\}\}/g, base(S.cur.path));
    insertText(t); return;
  }
  if (forceCreate || !r || r.item.create) {
    if (!q) return;
    const name = cleanName(q.split('/').pop());
    return createNote(join(q.includes('/') ? normPath(dirOf(q)) : '', name + '.md'));
  }
  openNote(r.item.path);
}
$('#palette-input').addEventListener('input', fillPalette);
$('#palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    PAL.sel = (PAL.sel + (e.key === 'ArrowDown' ? 1 : -1) + PAL.items.length) % Math.max(1, PAL.items.length);
    $$('#palette-list .pi').forEach((x, i) => x.classList.toggle('sel', i === PAL.sel));
    $$('#palette-list .pi')[PAL.sel]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') { e.preventDefault(); acceptPalette(PAL.sel, e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
});
$('#palette-list').addEventListener('click', (e) => { const p = e.target.closest('.pi'); if (p) acceptPalette(+p.dataset.i); });
$('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });

// ------------------------------------------------------------------ graph
class ForceGraph {
  constructor(canvas, { onClick, labelsAlways = false } = {}) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.onClick = onClick; this.labelsAlways = labelsAlways;
    this.nodes = []; this.links = []; this.t = { x: 0, y: 0, k: 1 }; this.alpha = 0; this.hover = null; this.raf = 0; this.drag = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bind();
  }
  resize() {
    const dpr = devicePixelRatio || 1, w = this.c.clientWidth, h = this.c.clientHeight;
    if (!w || !h) return;
    const first = !this.w;
    this.c.width = w * dpr; this.c.height = h * dpr; this.w = w; this.h = h; this.dpr = dpr;
    if (first) { this.t.x = w / 2; this.t.y = h / 2; }
    this.kick(0);
  }
  setData(nodes, links, focus) {
    const old = new Map(this.nodes.map((n) => [n.id, n]));
    const R = Math.sqrt(nodes.length) * 18 + 20;
    this.nodes = nodes.map((n) => { const o = old.get(n.id); const a = Math.random() * Math.PI * 2, r = Math.random() * R; return Object.assign(n, o ? { x: o.x, y: o.y, vx: 0, vy: 0 } : { x: n.id === focus ? 0 : Math.cos(a) * r, y: n.id === focus ? 0 : Math.sin(a) * r, vx: 0, vy: 0 }); });
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = links.map(([a, b]) => ({ s: byId.get(a), t: byId.get(b) })).filter((l) => l.s && l.t && l.s !== l.t);
    this.nb = new Map(this.nodes.map((n) => [n, new Set()]));
    for (const n of this.nodes) n.deg = 0;
    for (const l of this.links) { l.s.deg++; l.t.deg++; this.nb.get(l.s).add(l.t); this.nb.get(l.t).add(l.s); }
    this.focus = byId.get(focus) || null;
    this.kick(old.size ? 0.5 : 1);
  }
  kick(a) { this.alpha = Math.max(this.alpha, a); if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); }
  frame() {
    this.raf = 0;
    if (this.alpha > 0.004) { this.tick(); this.tick(); }
    this.draw();
    if (this.alpha > 0.004 || this.drag) this.raf = requestAnimationFrame(() => this.frame());
  }
  tick() {
    const N = this.nodes, a = this.alpha, n = N.length;
    for (let i = 0; i < n; i++) {
      const p = N[i];
      for (let j = i + 1; j < n; j++) {
        const q = N[j];
        let dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > 250000) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = (-220 * a) / d2;
        p.vx += dx * f; p.vy += dy * f; q.vx -= dx * f; q.vy -= dy * f;
      }
    }
    for (const l of this.links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 60) / d) * 0.06 * a;
      l.s.vx += dx * f; l.s.vy += dy * f; l.t.vx -= dx * f; l.t.vy -= dy * f;
    }
    for (const p of N) {
      p.vx -= p.x * 0.012 * a; p.vy -= p.y * 0.012 * a;
      if (p.fixed) { p.vx = p.vy = 0; continue; }
      p.vx *= 0.55; p.vy *= 0.55;
      p.x += p.vx; p.y += p.vy;
    }
    this.alpha *= 0.985;
  }
  colors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (v) => cs.getPropertyValue(v).trim();
    return { bg: g('--bg'), node: g('--fg3'), accent: g('--accent'), line: g('--line'), label: g('--fg2'), unres: g('--unres'), tag: '#5fa89c' };
  }
  radius(n) { return (n.kind === 'tag' ? 3 : 3.2) + Math.sqrt(n.deg || 0) * 1.6; }
  draw() {
    if (!this.w) return;
    const ctx = this.ctx, C = this.colors(), { x, y, k } = this.t;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.translate(x, y); ctx.scale(k, k);
    const hl = this.hover || (this.drag && this.drag.node);
    const near = hl ? this.nb.get(hl) : null;
    ctx.lineWidth = 1 / k;
    for (const l of this.links) {
      const on = hl && (l.s === hl || l.t === hl);
      ctx.strokeStyle = on ? C.accent : C.line;
      ctx.globalAlpha = hl && !on ? 0.35 : 1;
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
    }
    for (const n of this.nodes) {
      const dim = hl && n !== hl && !near.has(n);
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.fillStyle = n === hl || n === this.focus ? C.accent : n.kind === 'tag' ? C.tag : n.kind === 'unres' ? C.unres : C.node;
      ctx.beginPath(); ctx.arc(n.x, n.y, this.radius(n), 0, Math.PI * 2); ctx.fill();
    }
    const showAll = this.labelsAlways || k > 1.1 || this.nodes.length < 40;
    ctx.font = `${11 / k}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of this.nodes) {
      const emph = n === hl || (near && near.has(n)) || n === this.focus;
      if (!showAll && !emph) continue;
      ctx.globalAlpha = hl && !emph ? 0.25 : Math.min(1, showAll && !emph ? (k - 0.6) * 1.5 + (this.labelsAlways || this.nodes.length < 40 ? 1 : 0) : 1);
      ctx.fillStyle = emph ? getComputedStyle(document.documentElement).getPropertyValue('--fg') : C.label;
      ctx.fillText(n.label, n.x, n.y + this.radius(n) + 3 / k);
    }
    ctx.globalAlpha = 1;
  }
  world(e) { const r = this.c.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; return { mx, my, x: (mx - this.t.x) / this.t.k, y: (my - this.t.y) / this.t.k }; }
  nodeAt(p) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < this.radius(n) + 5 / this.t.k && d < bd) { best = n; bd = d; } }
    return best;
  }
  bind() {
    const c = this.c;
    c.addEventListener('pointerdown', (e) => {
      const p = this.world(e), n = this.nodeAt(p);
      c.setPointerCapture(e.pointerId);
      this.drag = n ? { node: n, moved: false, sx: p.mx, sy: p.my } : { pan: true, moved: false, sx: p.mx, sy: p.my, tx: this.t.x, ty: this.t.y };
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.world(e);
      if (this.drag) {
        if (Math.hypot(p.mx - this.drag.sx, p.my - this.drag.sy) > 3) this.drag.moved = true;
        if (this.drag.node && this.drag.moved) { Object.assign(this.drag.node, { x: p.x, y: p.y, fixed: true }); this.kick(0.25); }
        else if (this.drag.pan) { this.t.x = this.drag.tx + p.mx - this.drag.sx; this.t.y = this.drag.ty + p.my - this.drag.sy; this.kick(0); }
        return;
      }
      const n = this.nodeAt(p);
      if (n !== this.hover) { this.hover = n; c.style.cursor = n ? 'pointer' : 'grab'; this.kick(0); }
    });
    const end = (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null; c.style.cursor = 'grab';
      if (d.node) { d.node.fixed = false; if (!d.moved && this.onClick) this.onClick(d.node, e); }
      this.kick(0);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!this.drag && this.hover) { this.hover = null; this.kick(0); } });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.world(e);
      const k = Math.max(0.08, Math.min(8, this.t.k * Math.exp(-e.deltaY * 0.0015)));
      const f = k / this.t.k;
      this.t.x = p.mx - (p.mx - this.t.x) * f; this.t.y = p.my - (p.my - this.t.y) * f; this.t.k = k;
      this.kick(0);
    }, { passive: false });
  }
}

function graphData({ orphans = true, tags = false, unres = false, filter = '', local = null } = {}) {
  const nodes = new Map(), links = [];
  const add = (id, label, kind, path) => { if (!nodes.has(id)) nodes.set(id, { id, label, kind, path }); };
  for (const n of S.index.notes) add(n.path, base(n.path), 'note', n.path);
  for (const n of S.index.notes) {
    for (const l of n.links) {
      const r = resolve(l, n.path);
      if (r && nodes.has(r)) links.push([n.path, r]);
      else if (!r && unres) { add('?' + l.toLowerCase(), l, 'unres', null); links.push([n.path, '?' + l.toLowerCase()]); }
    }
    if (tags) for (const t of n.tags) { add('#' + t, '#' + t, 'tag', null); links.push([n.path, '#' + t]); }
  }
  let keep = new Set(nodes.keys());
  if (local) {
    keep = new Set([local]);
    for (const [a, b] of links) { if (a === local) keep.add(b); if (b === local) keep.add(a); }
  }
  if (filter) { const f = filter.toLowerCase(); keep = new Set([...keep].filter((id) => nodes.get(id).label.toLowerCase().includes(f))); }
  const L = links.filter(([a, b]) => keep.has(a) && keep.has(b));
  if (!orphans && !local) { const linked = new Set(L.flat()); keep = new Set([...keep].filter((id) => linked.has(id))); }
  return { nodes: [...keep].map((id) => ({ ...nodes.get(id) })), links: L };
}

const graph = {
  view: null,
  update() {
    const g = graphData({ orphans: $('#g-orphans').checked, tags: $('#g-tags').checked, unres: $('#g-unresolved').checked, filter: $('#g-filter').value.trim() });
    graph.view.setData(g.nodes, g.links, S.cur?.path);
  },
};
function graphClick(n) {
  if (n.kind === 'note') { closeGraph(); openNote(n.path); }
  else if (n.kind === 'tag') { closeGraph(); searchFor('tag:' + n.label.slice(1)); }
  else if (n.kind === 'unres') { closeGraph(); followLink(n.label, '', ''); }
}
function openGraph() {
  $('#graph').hidden = false;
  if (!graph.view) graph.view = new ForceGraph($('#graph-canvas'), { onClick: graphClick });
  requestAnimationFrame(() => { graph.view.resize(); graph.update(); });
  const prefs = store.get('graph', {});
  for (const k of ['orphans', 'tags', 'unresolved']) if (k in prefs) $('#g-' + k).checked = prefs[k];
}
function closeGraph() { $('#graph').hidden = true; }
for (const k of ['orphans', 'tags', 'unresolved']) $('#g-' + k).addEventListener('change', () => { store.set('graph', { orphans: $('#g-orphans').checked, tags: $('#g-tags').checked, unresolved: $('#g-unresolved').checked }); graph.update(); });
$('#g-filter').addEventListener('input', debounce(() => graph.update(), 200));
$('#g-close').onclick = closeGraph;

const localGraph = {
  view: null,
  update() {
    if (!S.cur) return;
    if (!localGraph.view) localGraph.view = new ForceGraph($('#local-graph'), { onClick: (n) => n.kind === 'note' && openNote(n.path), labelsAlways: true });
    const g = graphData({ local: S.cur.path });
    localGraph.view.t.k = 1;
    localGraph.view.setData(g.nodes, g.links, S.cur.path);
  },
};
$('#local-graph').closest('details').addEventListener('toggle', (e) => { if (e.target.open) requestAnimationFrame(() => { localGraph.update(); localGraph.view?.resize(); }); });

// ------------------------------------------------------------------ keyboard
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (!$('#graph').hidden) return closeGraph();
    if (!$('#palette').hidden) return closePalette();
    $('#ctx').hidden = true; $('#hover').hidden = true;
    return;
  }
  if (!$('#prompt').hidden) return;
  const go = (id) => { e.preventDefault(); runCmd(id); };
  if (mod && !e.shiftKey && k === 'p') return go('palette');
  if (mod && !e.shiftKey && k === 'o') return go('switcher');
  if (mod && !e.shiftKey && k === 'g') return go('graph');
  if (mod && !e.shiftKey && k === 'e') return go('toggle-mode');
  if (mod && e.shiftKey && k === 'e') return go('mode-split');
  if (mod && e.shiftKey && k === 'f') return go('search');
  if (mod && k === 's') { e.preventDefault(); save(); return; }
  if (mod && e.key === '\\') return go('toggle-left');
  if ((mod && !e.shiftKey && k === 'n') || (e.altKey && k === 'n')) return go('new-note');
  if (e.altKey && k === 'd') return go('daily');
  if (e.altKey && e.key === 'ArrowLeft') return go('back');
  if (e.altKey && e.key === 'ArrowRight') return go('forward');
});

// ------------------------------------------------------------------ boot
(async function boot() {
  const theme = store.get('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  const w = store.get('widths', {});
  if (w.l) el.app.style.setProperty('--left-w', w.l);
  if (w.r) el.app.style.setProperty('--right-w', w.r);
  if (store.get('noLeft', false)) el.app.classList.add('no-left');
  if (store.get('noRight', false)) el.app.classList.add('no-right');
  el.doc.classList.add('empty');
  setMode(S.mode);
  await refreshIndex();
  const fromHash = decodeURI(location.hash.replace(/^#\/?/, ''));
  const start = [fromHash, store.get('last', null), 'Welcome.md'].find((p) => p && S.noteByPath.has(p));
  if (start) await openNote(start);
  setInterval(() => { if (!document.hidden) refreshIndex({ quiet: true }); }, 6000);
  addEventListener('focus', () => refreshIndex({ quiet: true }));
  addEventListener('hashchange', () => { const p = decodeURI(location.hash.replace(/^#\/?/, '')); if (p && p !== S.cur?.path && S.noteByPath.has(p)) openNote(p); });
})();

/* Inkwell — sidebars: file tree, search, tags, bookmarks, right panel; file operations; dialogs. */
'use strict';

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
  for (const doc of [...DOCS.values()]) {
    const n = S.noteByPath.get(doc.path);
    if (!n) { if (!doc.dirty) { toast(`"${base(doc.path)}" was removed`); for (const t of tabsOfDoc(doc)) closeTab(t, { remember: false }); } }
    else if (Math.abs(n.mtime - doc.mtime) > 0.001 && !doc.dirty && !doc.saving) {
      try { const d = await api('GET', 'note', { qs: { path: doc.path } }); doc.mtime = d.mtime; setDocText(doc, d.content); } catch {}
    }
  }
  if (sig !== prevSig) for (const p of W.panes) { p.view.dispatch({ effects: refreshFx.of(null) }); if (p.active?.mode === 'read') p.renderRead(); }
  if (S.cur) renderRight();
  renderBookmarks();
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
  else if (type === 'note') openNote(path, { newTab: e.ctrlKey || e.metaKey });
  else window.open(vaultUrl(path), '_blank');
});
el.tree.addEventListener('auxclick', (e) => {
  const row = e.target.closest('.ti');
  if (e.button === 1 && row?.dataset.type === 'note') { e.preventDefault(); openNote(row.dataset.path, { newTab: true }); }
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
      ...(type === 'note' ? [
        { label: 'Open in new tab', fn: () => openNote(path, { newTab: true }) },
        { label: 'Open to the right', fn: () => openToRight(path) },
        { label: isBookmarked(path) ? 'Remove bookmark' : 'Bookmark', fn: () => toggleBookmark({ type: 'file', path }) },
      ] : [{ label: 'Open in browser tab', fn: () => window.open(vaultUrl(path), '_blank') }]),
      { label: 'Copy wikilink', fn: () => copyText(`[[${type === 'note' ? linkText(path) : path.split('/').pop()}]]`) },
      ...(type === 'note' ? [{ label: 'Merge into another note…', fn: () => pickMergeTarget(path) }, { label: 'File recovery…', fn: () => openRecovery(path) }] : []),
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
  openNote(r.dataset.path, { line: s ? +s.dataset.line : null, newTab: e.ctrlKey || e.metaKey });
});
$('#search-bm').addEventListener('click', () => { const q = $('#search-input').value.trim(); if (q) toggleBookmark({ type: 'search', query: q }); });

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
  openNote(r.dataset.path, { line: ln ? +ln.dataset.line : null, newTab: e.ctrlKey || e.metaKey });
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
  const text = curText();
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
$('#outline').addEventListener('contextmenu', (e) => {
  const r = e.target.closest('.ol'); if (!r || !S.cur) return;
  e.preventDefault();
  const path = S.cur.path, heading = r.dataset.h;
  showCtx(e, [{ label: 'Bookmark this heading', fn: () => toggleBookmark({ type: 'heading', path, heading }) }, { label: 'Copy link to heading', fn: () => copyText(`[[${linkText(path)}#${heading}]]`) }]);
});
$('#backlinks').addEventListener('auxclick', (e) => { const r = e.target.closest('.bl'); if (r && e.button === 1) { e.preventDefault(); openNote(r.dataset.path, { newTab: true }); } });

// ------------------------------------------------------------------ file ops
function uniquePath(folder, name) {
  let p = join(folder, name + '.md'), i = 1;
  while (S.pathMap.has(p.toLowerCase())) p = join(folder, `${name} ${i++}.md`);
  return p;
}
async function createNote(path, content = '', { focusTitle = false, newTab = false } = {}) {
  try { await api('PUT', 'note', { qs: { path }, body: { content, create: true } }); }
  catch (e) { if (e.status !== 409) { toast('Create failed: ' + e.message, true); return; } }
  await refreshIndex({ quiet: true });
  renderTree();
  const t = await openNote(path, { newTab });
  if (!t) return;
  if (t.mode === 'read') setTabMode(t, t.lastEdit || 'live');
  if (focusTitle) { t.pane.title.focus(); t.pane.title.select(); } else { t.pane.view.focus(); t.pane.view.dispatch({ selection: { anchor: t.pane.view.state.doc.length } }); }
  return t;
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
    const remap = (p) => (p === from ? r.path : p && p.startsWith(from + '/') ? r.path + p.slice(from.length) : p);
    for (const t of allTabs()) { t.hist = t.hist.map(remap); if (t.pending) t.pending = remap(t.pending); }
    if (S.open.has(from)) { S.open.delete(from); S.open.add(r.path); saveOpen(); }
    for (const doc of [...DOCS.values()]) {
      const np = remap(doc.path);
      if (np === doc.path) continue;
      DOCS.delete(doc.path); doc.path = np; DOCS.set(np, doc);
      for (const t of tabsOfDoc(doc)) {
        const spec = { effects: pathComp.reconfigure(notePath.of(np)) };
        if (t.pane.active === t) t.pane.view.dispatch(spec); else if (t.state) t.state = t.state.update(spec).state;
      }
    }
    if (remapBookmarks(remap)) saveBookmarks();
    await refreshIndex();
    for (const p of W.panes) p.show();
    activeChanged();
    saveLayout();
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
    const gone = (p) => p === path || p.startsWith(path + '/');
    for (const t of allTabs()) {
      if (t.doc && gone(t.doc.path)) { t.doc.dirty = false; await closeTab(t, { remember: false }); }
      else if (t.pending && gone(t.pending)) await closeTab(t, { remember: false });
    }
    for (const t of allTabs()) { t.hist = t.hist.filter((p) => !gone(p)); t.hi = Math.min(t.hi, t.hist.length - 1); }
    S.bookmarks = S.bookmarks.filter((b) => !(b.path && gone(b.path)));
    saveBookmarks();
    await refreshIndex();
    for (const p of W.panes) p.show();
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
  const t = await openNote(path);
  if (t && t.mode !== 'read') { const v = t.pane.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true }); }
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copied ' + t); } catch { toast('Clipboard unavailable', true); } }

// ------------------------------------------------------------------ modes / layout
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
  for (const p of W.panes) { p.view.dispatch({ effects: refreshFx.of(null) }); if (p.active?.mode === 'read') p.renderRead(); }
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

async function openToRight(path) {
  const p = P();
  const i = W.panes.indexOf(p);
  const target = W.panes[i + 1] || createPane(i + 1);
  await openNote(path, { pane: target, newTab: !!target.active?.doc });
}

// ------------------------------------------------------------------ bookmarks
const bmKey = (b) => b.type + ':' + (b.path || '') + ':' + (b.heading || b.query || '');
async function loadBookmarks() {
  try { const d = await api('GET', 'config/bookmarks'); S.bookmarks = Array.isArray(d) ? d : []; } catch { S.bookmarks = []; }
  renderBookmarks();
}
function saveBookmarks() {
  api('PUT', 'config/bookmarks', { body: S.bookmarks }).catch((e) => toast('Could not save bookmarks: ' + e.message, true));
  renderBookmarks();
  for (const p of W.panes) p.updateStar();
}
function isBookmarked(path) { return !!path && S.bookmarks.some((b) => b.type === 'file' && b.path === path); }
function toggleBookmark(b) {
  const k = bmKey(b);
  const i = S.bookmarks.findIndex((x) => bmKey(x) === k);
  if (i >= 0) { S.bookmarks.splice(i, 1); toast('Bookmark removed'); }
  else { S.bookmarks.push(b); toast('Bookmarked'); }
  saveBookmarks();
}
function remapBookmarks(remap) {
  let changed = false;
  for (const b of S.bookmarks) if (b.path) { const np = remap(b.path); if (np !== b.path) { b.path = np; changed = true; } }
  return changed;
}
function bookmarkLabel(b) {
  if (b.title) return b.title;
  if (b.type === 'search') return b.query;
  if (b.type === 'heading') return `${base(b.path)} › ${b.heading}`;
  return base(b.path);
}
function renderBookmarks() {
  const box = $('#bookmark-list');
  if (!box) return;
  if (!S.bookmarks.length) { box.innerHTML = '<div class="empty" style="padding:10px">No bookmarks yet. Use ☆ in a note\'s header, right-click a file, or bookmark a search.</div>'; return; }
  box.innerHTML = S.bookmarks.map((b, i) => {
    const missing = b.path && !S.noteByPath.has(b.path);
    const icon = b.type === 'search' ? '⌕' : b.type === 'heading' ? '§' : '★';
    return `<div class="bmk${missing ? ' missing' : ''}" draggable="true" data-i="${i}" ${b.path && !missing ? `data-path="${esc(b.path)}"` : ''} ${b.heading ? `data-heading="${esc(b.heading)}"` : ''} title="${esc(b.path || b.query || '')}"><span class="bmk-i">${icon}</span><span class="bmk-t">${esc(bookmarkLabel(b))}</span><button class="bmk-x" title="Remove">×</button></div>`;
  }).join('');
}
function openBookmark(b, newTab) {
  if (b.type === 'search') return searchFor(b.query);
  if (!S.noteByPath.has(b.path)) return toast(`"${b.path}" no longer exists`, true);
  openNote(b.path, { heading: b.heading || null, newTab });
}
let bmDrag = null;
$('#bookmark-list').addEventListener('click', (e) => {
  const r = e.target.closest('.bmk'); if (!r) return;
  const b = S.bookmarks[+r.dataset.i];
  if (e.target.closest('.bmk-x')) { S.bookmarks.splice(+r.dataset.i, 1); saveBookmarks(); return; }
  openBookmark(b, e.ctrlKey || e.metaKey);
});
$('#bookmark-list').addEventListener('auxclick', (e) => { const r = e.target.closest('.bmk'); if (r && e.button === 1) { e.preventDefault(); openBookmark(S.bookmarks[+r.dataset.i], true); } });
$('#bookmark-list').addEventListener('contextmenu', (e) => {
  const r = e.target.closest('.bmk'); if (!r) return;
  e.preventDefault();
  const i = +r.dataset.i, b = S.bookmarks[i];
  showCtx(e, [
    { label: 'Open in new tab', fn: () => openBookmark(b, true) },
    { label: 'Rename bookmark…', fn: async () => { const t = await ask('Bookmark title (blank = default)', b.title || bookmarkLabel(b)); if (t == null) return; if (t.trim() && t.trim() !== bookmarkLabel({ ...b, title: '' })) b.title = t.trim(); else delete b.title; saveBookmarks(); } },
    '-',
    { label: 'Remove bookmark', danger: true, fn: () => { S.bookmarks.splice(i, 1); saveBookmarks(); } },
  ]);
});
$('#bookmark-list').addEventListener('dragstart', (e) => { const r = e.target.closest('.bmk'); if (!r) return; bmDrag = +r.dataset.i; e.dataTransfer.effectAllowed = 'move'; const b = S.bookmarks[bmDrag]; if (b.path) e.dataTransfer.setData('text/plain', `[[${linkText(b.path)}${b.heading ? '#' + b.heading : ''}]]`); });
$('#bookmark-list').addEventListener('dragover', (e) => {
  if (bmDrag == null) return;
  e.preventDefault();
  $$('.bmk', $('#bookmark-list')).forEach((x) => x.classList.remove('drop-before'));
  e.target.closest('.bmk')?.classList.add('drop-before');
});
$('#bookmark-list').addEventListener('drop', (e) => {
  if (bmDrag == null) return;
  e.preventDefault();
  const r = e.target.closest('.bmk');
  const to = r ? +r.dataset.i : S.bookmarks.length;
  const [b] = S.bookmarks.splice(bmDrag, 1);
  S.bookmarks.splice(to > bmDrag ? to - 1 : to, 0, b);
  bmDrag = null;
  saveBookmarks();
});
$('#bookmark-list').addEventListener('dragend', () => { bmDrag = null; $$('.bmk.drop-before').forEach((x) => x.classList.remove('drop-before')); });

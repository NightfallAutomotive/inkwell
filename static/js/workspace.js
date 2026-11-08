/* Inkwell — workspace: panes (side by side), tabs, open notes, saving, modes, navigation. */
'use strict';

const el = { app: $('#app'), panes: $('#panes'), tree: $('#tree') };

/** One open note shared by every tab that shows it. */
const DOCS = new Map(); // path -> {path, mtime, dirty}
const W = { panes: [], active: null, closed: [] };
let tabSeq = 0, paneSeq = 0;

const P = () => W.active;
const T = () => W.active?.active || null;
Object.defineProperty(S, 'cur', { get: () => T()?.doc || null });
const allTabs = () => W.panes.flatMap((p) => p.tabs);
const tabsOfDoc = (doc) => allTabs().filter((t) => t.doc === doc);
const defaultMode = () => store.get('defaultMode', 'live');

function tabState(t) { return t.pane.active === t && t.state ? t.pane.view.state : t.state; }
function tabText(t) { return t?.doc ? tabState(t).doc.toString() : ''; }
function curText() { return tabText(T()); }
function docText(doc) { const t = tabsOfDoc(doc).find((x) => x.state); return t ? tabText(t) : null; }

const emptyState = EditorState.create({ doc: '' });

// ------------------------------------------------------------------ edits & mirroring
/** Copy a change made in `src` into every other tab showing the same note. */
function mirror(src, changes) {
  for (const t of tabsOfDoc(src.doc)) {
    if (t === src || !t.state) continue;
    const spec = { changes, annotations: [Remote.of(true), Transaction.addToHistory.of(false)] };
    if (t.pane.active === t) t.pane.view.dispatch(spec);
    else t.state = t.state.update(spec).state;
  }
}
/** Replace a range in a tab's note (works whether or not the tab is visible). */
function tabReplace(t, from, to, insert) {
  if (t.pane.active === t) { t.pane.view.dispatch({ changes: { from, to, insert } }); return; }
  const tr = t.state.update({ changes: { from, to, insert } });
  t.state = tr.state;
  mirror(t, tr.changes);
  noteEdited(t.doc);
}
/** Replace a note's whole text in every tab showing it (e.g. reloaded from disk), keeping cursors. */
function setDocText(doc, text) {
  const tabs = tabsOfDoc(doc).filter((t) => t.state);
  if (!tabs.length) return;
  const old = tabText(tabs[0]);
  if (old === text) return;
  let a = 0; while (a < old.length && a < text.length && old[a] === text[a]) a++;
  let b = 0; while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
  const changes = { from: a, to: old.length - b, insert: text.slice(a, text.length - b) };
  for (const t of tabs) {
    const spec = { changes, annotations: [Remote.of(true), Transaction.addToHistory.of(false)] };
    if (t.pane.active === t) t.pane.view.dispatch(spec); else t.state = t.state.update(spec).state;
  }
  noteEdited(doc, false);
}

const refreshUiSoon = debounce(() => {
  for (const p of W.panes) if (p.active?.doc) { p.renderProps(); if (p.active.mode === 'read') p.renderRead(); }
  renderRightLive();
}, 180);
function noteEdited(doc, save = true) {
  if (save) scheduleSave(doc);
  refreshUiSoon();
}

// ------------------------------------------------------------------ saving
function setSaveState(doc, s) { for (const p of W.panes) if (p.active?.doc === doc) p.saveState.textContent = s; }
function scheduleSave(doc) {
  if (!doc) return;
  if (!doc.dirty) { doc.dirty = true; renderAllTabbars(); }
  setSaveState(doc, 'Editing…');
  clearTimeout(doc.timer);
  doc.timer = setTimeout(() => save(doc), 700);
}
async function save(doc = S.cur, force = false) {
  if (!doc) return;
  clearTimeout(doc.timer);
  if (doc.saving) await doc.saving;
  if (!doc.dirty) return;
  const content = docText(doc);
  if (content == null) return;
  let conflict = null;
  doc.saving = (async () => {
    try {
      const r = await api('PUT', 'note', { qs: { path: doc.path }, body: { content, baseMtime: doc.mtime, force, snapshot: !!doc.forceSnap } });
      doc.forceSnap = false;
      doc.mtime = r.mtime;
      S.contentCache.set(doc.path, { mtime: r.mtime, content });
      const n = S.noteByPath.get(doc.path);
      if (n) Object.assign(n, { mtime: r.mtime, ...analyse(content) });
      if (docText(doc) === content) { doc.dirty = false; setSaveState(doc, 'Saved'); renderAllTabbars(); }
    } catch (e) {
      if (e.status === 409) conflict = e;
      else { toast('Save failed: ' + e.message, true); setSaveState(doc, 'Not saved!'); }
    }
  })();
  await doc.saving;
  doc.saving = null;
  if (conflict) {
    const overwrite = await ask(`"${base(doc.path)}" was changed outside Inkwell. Keep your version (overwrite the file) or reload the version on disk?`, null, { ok: 'Overwrite', cancel: 'Reload from disk' });
    if (overwrite) { doc.mtime = conflict.data.mtime; return save(doc, true); }
    const d = await api('GET', 'note', { qs: { path: doc.path } });
    doc.mtime = d.mtime; doc.dirty = false;
    setDocText(doc, d.content);
    setSaveState(doc, ''); renderAllTabbars();
  } else if (doc.dirty && docText(doc) !== content) scheduleSave(doc);
}
async function saveAll() { await Promise.all([...DOCS.values()].map((d) => save(d))); }
window.addEventListener('beforeunload', (e) => { saveLayout.now(); if ([...DOCS.values()].some((d) => d.dirty)) { saveAll(); e.preventDefault(); e.returnValue = ''; } });

/** Detach a tab from its note; forget the note once no tab shows it. */
function releaseDoc(t) {
  const doc = t.doc;
  t.doc = null; t.state = null;
  if (doc && !tabsOfDoc(doc).length) {
    if (doc.dirty) { const content = t._lastText; if (content != null) api('PUT', 'note', { qs: { path: doc.path }, body: { content, baseMtime: doc.mtime } }).catch((e) => toast('Save failed: ' + e.message, true)); }
    DOCS.delete(doc.path);
  }
}

// ------------------------------------------------------------------ panes
class Pane {
  constructor() {
    this.id = ++paneSeq; this.tabs = []; this.active = null; this.flex = 1;
    const root = this.root = document.createElement('section');
    root.className = 'leaf';
    root.innerHTML = `
      <div class="tabbar"><div class="tabs"></div><button class="tab-new" title="New tab (Alt+T)">＋</button><div class="grow"></div><button class="leaf-close" title="Close this pane">✕</button></div>
      <header class="note-head">
        <button class="nav back" title="Back (Alt+←)">‹</button><button class="nav fwd" title="Forward (Alt+→)">›</button>
        <div class="crumbs muted"></div><div class="head-spacer"></div>
        <span class="save-state muted small"></span>
        <button class="hbtn bm" title="Bookmark this note (Alt+B)">☆</button>
        <div class="seg mode-seg"><button data-mode="live" title="Live preview (Ctrl+E toggles reading)">Live</button><button data-mode="source" title="Source mode (Ctrl+Shift+E)">Source</button><button data-mode="read" title="Reading view (Ctrl+E)">Read</button></div>
        <button class="hbtn more" title="More options">⋯</button>
      </header>
      <div class="doc mode-live empty">
        <div class="empty-state"><img class="wordmark wm-dark" src="brand/wordmark-dark.svg" alt="Inkwell"><img class="wordmark wm-light" src="brand/wordmark-light.svg" alt="Inkwell"><h2>No note open</h2>
          <p><kbd>Ctrl</kbd>+<kbd>O</kbd> to open a note · <kbd>Alt</kbd>+<kbd>N</kbd> to create one · <kbd>Ctrl</kbd>+<kbd>P</kbd> for commands</p></div>
        <div class="edit-scroll"><div class="sheet"><input class="title" spellcheck="false" autocomplete="off"><div class="props" hidden></div><div class="cm-host"></div></div></div>
        <div class="read-scroll"><div class="sheet"><div class="inline-title"></div><div class="props read-props" hidden></div><article class="preview md"></article></div></div>
      </div>`;
    const q = (s) => root.querySelector(s);
    Object.assign(this, {
      tabsEl: q('.tabs'), crumbs: q('.crumbs'), saveState: q('.save-state'), bmBtn: q('.bm'), modeSeg: q('.mode-seg'),
      docEl: q('.doc'), editScroll: q('.edit-scroll'), readScroll: q('.read-scroll'), title: q('.title'),
      editProps: q('.edit-scroll .props'), readProps: q('.read-props'), cmHost: q('.cm-host'), preview: q('.preview'), inlineTitle: q('.inline-title'),
    });
    this.view = new EditorView({ parent: this.cmHost, state: emptyState, dispatchTransactions: (trs, view) => this.onTransactions(trs, view) });
    this.bind();
  }

  onTransactions(trs, view) {
    view.update(trs);
    const t = this.active;
    if (!t?.doc) return;
    let changed = false;
    for (const tr of trs) {
      if (!tr.docChanged) continue;
      changed = true;
      if (!tr.annotation(Remote)) { mirror(t, tr.changes); scheduleSave(t.doc); }
    }
    if (changed) refreshUiSoon();
  }

  propsBox() { return this.active?.mode === 'read' ? this.readProps : this.editProps; }
  renderProps() {
    const t = this.active;
    if (!t?.doc || t.mode === 'source') { this.editProps.hidden = true; this.editProps.dataset.sig = ''; }
    if (!t?.doc || t.mode !== 'read') { this.readProps.hidden = true; this.readProps.dataset.sig = ''; }
    if (t?.doc && t.mode !== 'source') renderProps(this.propsBox(), t);
  }

  bind() {
    const root = this.root;
    root.addEventListener('focusin', () => this.focusPane());
    root.addEventListener('mousedown', () => this.focusPane(), true);
    $('.tab-new', root).onclick = () => { const t = this.addTab(); this.activate(t); };
    $('.leaf-close', root).onclick = () => closePane(this);
    $('.back', root).onclick = () => goHist(-1, this);
    $('.fwd', root).onclick = () => goHist(1, this);
    this.bmBtn.onclick = () => this.active?.doc && toggleBookmark({ type: 'file', path: this.active.doc.path });
    $$('button', this.modeSeg).forEach((b) => (b.onclick = () => this.active?.doc && setTabMode(this.active, b.dataset.mode)));
    $('.more', root).onclick = (e) => { this.focusPane(); showCtx(e, moreMenu()); };
    // tabs
    this.tabsEl.addEventListener('mousedown', (e) => {
      const el2 = e.target.closest('.tab'); if (!el2) return;
      const t = this.tabs.find((x) => x.id === +el2.dataset.id);
      if (e.button === 1) { e.preventDefault(); closeTab(t); return; }
      if (e.button === 0 && !e.target.closest('.tab-x')) this.activate(t);
    });
    this.tabsEl.addEventListener('click', (e) => { const x = e.target.closest('.tab-x'); if (x) closeTab(this.tabs.find((t) => t.id === +x.closest('.tab').dataset.id)); });
    this.tabsEl.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    this.tabsEl.addEventListener('contextmenu', (e) => {
      const el2 = e.target.closest('.tab'); if (!el2) return;
      e.preventDefault();
      const t = this.tabs.find((x) => x.id === +el2.dataset.id);
      showCtx(e, [
        { label: 'Close', fn: () => closeTab(t) },
        { label: 'Close others', fn: () => [...this.tabs].filter((x) => x !== t).forEach((x) => closeTab(x)) },
        '-',
        ...(t.doc || t.pending ? [{ label: 'Split right', fn: () => splitRight(t) }, { label: isBookmarked(t.doc?.path || t.pending) ? 'Remove bookmark' : 'Bookmark', fn: () => toggleBookmark({ type: 'file', path: t.doc?.path || t.pending }) }] : []),
      ]);
    });
    // tab drag & drop (reorder, or move to another pane)
    this.tabsEl.addEventListener('dragstart', (e) => {
      const el2 = e.target.closest('.tab'); if (!el2) return;
      DRAG.tab = this.tabs.find((x) => x.id === +el2.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      const t = DRAG.tab;
      if (t.doc || t.pending) e.dataTransfer.setData('text/plain', `[[${linkText(t.doc?.path || t.pending)}]]`);
    });
    const tabbar = $('.tabbar', root);
    tabbar.addEventListener('dragover', (e) => {
      if (!DRAG.tab) return;
      e.preventDefault();
      const idx = this.dropIndex(e.clientX);
      $$('.tab', this.tabsEl).forEach((x, i) => { x.classList.toggle('drop-before', i === idx); x.classList.toggle('drop-after', idx === this.tabs.length && i === this.tabs.length - 1); });
    });
    tabbar.addEventListener('dragleave', (e) => { if (!tabbar.contains(e.relatedTarget)) clearDropMarks(); });
    tabbar.addEventListener('drop', (e) => {
      if (!DRAG.tab) return;
      e.preventDefault(); clearDropMarks();
      moveTab(DRAG.tab, this, this.dropIndex(e.clientX));
      DRAG.tab = null;
    });
    this.tabsEl.addEventListener('dragend', () => { DRAG.tab = null; clearDropMarks(); });
    // title → rename
    this.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); this.view.focus(); this.view.dispatch({ selection: { anchor: firstBodyPos(this.view.state) } }); }
      if (e.key === 'Escape') { this.title.value = base(this.active.doc.path); this.view.focus(); }
    });
    this.title.addEventListener('blur', async () => {
      const t = this.active; if (!t?.doc) return;
      const name = cleanName(this.title.value);
      if (!name || name === base(t.doc.path)) { this.title.value = base(t.doc.path); return; }
      const ok = await doRename(t.doc.path, join(dirOf(t.doc.path), name + '.md'), true);
      if (!ok) this.title.value = base(t.doc.path);
    });
    // reading view: links, tasks, embeds
    this.preview.addEventListener('click', (e) => {
      const a = e.target.closest('a'), open = e.target.closest('[data-open]');
      const newTab = e.ctrlKey || e.metaKey;
      if (open) { e.preventDefault(); return openNote(open.dataset.open, { newTab }); }
      if (!a) return;
      if (a.classList.contains('tag')) { e.preventDefault(); return searchFor('tag:' + a.dataset.tag); }
      if (a.classList.contains('wl')) { e.preventDefault(); followLink(a.dataset.target, a.dataset.heading, a.dataset.from || this.active?.doc?.path, { newTab }); }
    });
    this.preview.addEventListener('auxclick', (e) => {
      const a = e.target.closest('a.wl'); if (!a || e.button !== 1) return;
      e.preventDefault(); followLink(a.dataset.target, a.dataset.heading, a.dataset.from || this.active?.doc?.path, { newTab: true });
    });
    this.preview.addEventListener('change', (e) => {
      const cb = e.target;
      if (cb.matches('input[type=checkbox][data-task]')) toggleTask(this.active, +cb.dataset.task, cb.checked);
    });
    bindProps(this.editProps, () => this.active);
    bindProps(this.readProps, () => this.active);
  }

  dropIndex(x) {
    const els = $$('.tab', this.tabsEl);
    for (let i = 0; i < els.length; i++) { const r = els[i].getBoundingClientRect(); if (x < r.left + r.width / 2) return i; }
    return els.length;
  }

  focusPane() {
    if (W.active === this) return;
    const prev = W.active;
    W.active = this;
    prev?.root.classList.remove('active');
    this.root.classList.add('active');
    activeChanged();
  }

  addTab(index = this.tabs.length, mode = defaultMode()) {
    const t = { id: ++tabSeq, pane: this, doc: null, state: null, mode, lastEdit: mode === 'read' ? 'live' : mode, hist: [], hi: -1, scroll: 0 };
    this.tabs.splice(index, 0, t);
    this.updateCloseBtn();
    return t;
  }

  /** Stash the visible tab's editor state and scroll position. */
  stash() {
    const t = this.active;
    if (!t) return;
    if (t.state) t.state = this.view.state;
    t.scroll = t.mode === 'read' ? this.readScroll.scrollTop : this.editScroll.scrollTop;
  }

  async activate(t, { focus = true } = {}) {
    if (this.active !== t) {
      this.stash();
      this.active = t;
      this.view.setState(t.state || emptyState);
    }
    if (focus) { this.focusPane(); }
    if (t.pending) {
      const path = t.pending; t.pending = null;
      if (S.noteByPath.has(path)) await loadIntoTab(t, path, { push: true });
    }
    this.show();
    requestAnimationFrame(() => { if (t.mode === 'read') this.readScroll.scrollTop = t.scroll || 0; else this.editScroll.scrollTop = t.scroll || 0; });
    if (W.active === this) activeChanged();
    saveLayout();
  }

  /** Bring the DOM in line with the active tab. */
  show() {
    const t = this.active;
    const has = !!t?.doc;
    this.docEl.className = 'doc mode-' + (t?.mode || 'live') + (has ? '' : ' empty');
    $$('button', this.modeSeg).forEach((b) => b.classList.toggle('on', b.dataset.mode === t?.mode));
    this.modeSeg.style.visibility = has ? '' : 'hidden';
    this.bmBtn.style.visibility = has ? '' : 'hidden';
    if (has) {
      this.title.value = base(t.doc.path);
      this.crumbs.innerHTML = t.doc.path.split('/').map((p, i, a) => (i === a.length - 1 ? `<span class="leaf-name">${esc(base(t.doc.path))}</span>` : `<span>${esc(p)}</span>`)).join(' / ');
      this.saveState.textContent = t.doc.dirty ? 'Editing…' : '';
      this.updateStar();
      this.renderProps();
      if (t.mode === 'read') this.renderRead();
    } else { this.crumbs.textContent = ''; this.saveState.textContent = ''; this.preview.innerHTML = ''; }
    $('.back', this.root).disabled = !t || t.hi <= 0;
    $('.fwd', this.root).disabled = !t || t.hi >= t.hist.length - 1;
    this.renderTabs();
  }

  updateStar() { const on = !!this.active?.doc && isBookmarked(this.active.doc.path); this.bmBtn.textContent = on ? '★' : '☆'; this.bmBtn.classList.toggle('on', on); }

  renderRead() {
    const t = this.active;
    if (!t?.doc) return;
    this.inlineTitle.textContent = base(t.doc.path);
    renderProps(this.readProps, t);
    const node = renderMarkdown(tabText(t), t.doc.path, 0);
    this.preview.replaceChildren(...node.childNodes);
  }

  renderTabs() {
    this.tabsEl.innerHTML = this.tabs.map((t) => {
      const path = t.doc?.path || t.pending;
      return `<div class="tab${t === this.active ? ' active' : ''}${t.doc?.dirty ? ' dirty' : ''}" draggable="true" data-id="${t.id}" title="${esc(path || 'New tab')}"><span class="tab-t">${esc(path ? base(path) : 'New tab')}</span><button class="tab-x" title="Close (Alt+W)">×</button></div>`;
    }).join('');
    this.tabsEl.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  updateCloseBtn() { for (const p of W.panes) $('.leaf-close', p.root).hidden = W.panes.length < 2; }
}

const DRAG = { tab: null };
function clearDropMarks() { $$('.tab.drop-before, .tab.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); }
function renderAllTabbars() { for (const p of W.panes) p.renderTabs(); }
function firstBodyPos(state) {
  const m = state.doc.sliceString(0, 4000).match(FM_RE);
  return m ? Math.min(state.doc.length, m[0].length) : 0;
}

function createPane(index = W.panes.length) {
  const p = new Pane();
  W.panes.splice(index, 0, p);
  layoutPanes();
  p.updateCloseBtn();
  return p;
}
function layoutPanes() {
  el.panes.replaceChildren();
  W.panes.forEach((p, i) => {
    if (i) {
      const r = document.createElement('div');
      r.className = 'leaf-resizer';
      r.addEventListener('mousedown', (e) => startPaneResize(e, i));
      el.panes.appendChild(r);
    }
    p.root.style.flex = `${p.flex} 1 0`;
    el.panes.appendChild(p.root);
  });
}
function startPaneResize(e, i) {
  e.preventDefault();
  const a = W.panes[i - 1], b = W.panes[i];
  const ra = a.root.getBoundingClientRect(), rb = b.root.getBoundingClientRect();
  const total = ra.width + rb.width, sum = a.flex + b.flex;
  const move = (ev) => {
    const wa = Math.max(220, Math.min(total - 220, ev.clientX - ra.left));
    a.flex = (wa / total) * sum; b.flex = sum - a.flex;
    a.root.style.flex = `${a.flex} 1 0`; b.root.style.flex = `${b.flex} 1 0`;
  };
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); saveLayout(); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}
async function closePane(p) {
  if (W.panes.length < 2) return;
  p.stash();
  for (const t of [...p.tabs]) { if (t.doc) await save(t.doc); t._lastText = tabText(t); releaseDoc(t); }
  const i = W.panes.indexOf(p);
  W.panes.splice(i, 1);
  const next = W.panes[Math.max(0, i - 1)];
  layoutPanes();
  next.updateCloseBtn();
  W.active = null;
  next.focusPane();
  next.view.focus();
  saveLayout();
}

// ------------------------------------------------------------------ tabs
async function loadIntoTab(t, path, { push = true } = {}) {
  let doc = DOCS.get(path), text;
  if (doc && docText(doc) != null) text = docText(doc);
  else {
    let d;
    try { d = await api('GET', 'note', { qs: { path } }); }
    catch (e) { toast(`Cannot open ${path}: ${e.message}`, true); return false; }
    S.contentCache.set(d.path, { mtime: d.mtime, content: d.content });
    path = d.path; text = d.content;
    doc = DOCS.get(path) || { path, mtime: d.mtime, dirty: false };
    DOCS.set(path, doc);
  }
  if (t.doc && t.doc !== doc) {
    if (t.doc.dirty) await save(t.doc);
    t._lastText = tabText(t);
    releaseDoc(t);
  }
  t.doc = doc;
  t.state = makeState(text, path, t.mode);
  t.scroll = 0;
  if (t.pane.active === t) t.pane.view.setState(t.state);
  if (push) { t.hist = t.hist.slice(0, t.hi + 1); if (t.hist[t.hi] !== path) { t.hist.push(path); t.hi++; } }
  return true;
}

async function openNote(path, { push = true, line = null, heading = null, focus = false, newTab = false, pane = null, mode = null } = {}) {
  hideHover();
  const p = pane || P();
  let t = p.active;
  if (newTab || !t) { t = p.addTab(t ? p.tabs.indexOf(t) + 1 : p.tabs.length, mode || defaultMode()); }
  else if (mode) t.mode = mode;
  if (t.doc?.path !== path || t.pending) {
    t.pending = null;
    if (!(await loadIntoTab(t, path, { push }))) { if (!t.doc) closeTab(t); return; }
  }
  await p.activate(t);
  if (heading) gotoHeading(heading, t);
  else if (line != null) gotoLine(line, t);
  else if (focus && t.mode !== 'read') p.view.focus();
  return t;
}

async function closeTab(t, { remember = true } = {}) {
  if (!t) return;
  const p = t.pane;
  if (p.active === t) p.stash();
  if (t.doc) { await save(t.doc); if (remember) W.closed.push({ path: t.doc.path, mode: t.mode }); }
  t._lastText = t.state ? tabText(t) : null;
  const i = p.tabs.indexOf(t);
  if (i < 0) return;
  p.tabs.splice(i, 1);
  releaseDoc(t);
  if (!p.tabs.length) {
    if (W.panes.length > 1) return closePane(p);
    p.addTab();
  }
  if (p.active === t) { p.active = null; await p.activate(p.tabs[Math.min(i, p.tabs.length - 1)], { focus: W.active === p }); }
  else p.renderTabs();
  saveLayout();
}

function moveTab(t, toPane, index) {
  const from = t.pane;
  const oldIdx = from.tabs.indexOf(t);
  if (from === toPane) {
    if (index === oldIdx || index === oldIdx + 1) return;
    from.tabs.splice(oldIdx, 1);
    from.tabs.splice(index > oldIdx ? index - 1 : index, 0, t);
    from.renderTabs(); saveLayout();
    return;
  }
  if (from.active === t) from.stash();
  from.tabs.splice(oldIdx, 1);
  const wasActive = from.active === t;
  t.pane = toPane;
  toPane.stash();
  toPane.tabs.splice(index, 0, t);
  if (wasActive) {
    from.active = null;
    from.view.setState(emptyState);
    if (!from.tabs.length) {
      if (W.panes.length > 1) {
        const i = W.panes.indexOf(from);
        W.panes.splice(i, 1); layoutPanes(); toPane.updateCloseBtn();
      } else from.addTab();
    }
    if (from.tabs.length) from.activate(from.tabs[Math.min(oldIdx, from.tabs.length - 1)], { focus: false });
  } else from.renderTabs();
  toPane.active = null;
  toPane.activate(t);
}

async function splitRight(t = T()) {
  if (!t) return;
  const src = t.pane;
  src.stash();
  const p = createPane(W.panes.indexOf(src) + 1);
  const nt = p.addTab(0, t.mode === 'read' ? 'read' : t.mode);
  const path = t.doc?.path || t.pending;
  if (path) await loadIntoTab(nt, path);
  await p.activate(nt);
  if (path && t.state) {
    const sel = tabState(t).selection.main.head;
    p.view.dispatch({ selection: { anchor: Math.min(sel, p.view.state.doc.length) }, effects: EditorView.scrollIntoView(Math.min(sel, p.view.state.doc.length), { y: 'center' }) });
  }
  return nt;
}

function newTab() { const p = P(); const t = p.addTab(p.tabs.indexOf(p.active) + 1); p.activate(t); }
function cycleTab(d) { const p = P(); if (p.tabs.length < 2) return; const i = p.tabs.indexOf(p.active); p.activate(p.tabs[(i + d + p.tabs.length) % p.tabs.length]); }
function reopenClosed() { const c = W.closed.pop(); if (c && S.noteByPath.has(c.path)) openNote(c.path, { newTab: true, mode: c.mode }); }

/** Run whenever the focused pane or its tab changes. */
function activeChanged() {
  const t = T();
  const path = t?.doc?.path;
  $$('.ti', el.tree).forEach((r) => r.classList.toggle('active', r.dataset.path === path));
  if (path) { reveal(path); store.set('last', path); history.replaceState(null, '', '#/' + encodeURI(path)); document.title = `${base(path)} — Inkwell`; }
  else { document.title = 'Inkwell'; history.replaceState(null, '', '#'); }
  renderRight();
}

// ------------------------------------------------------------------ modes
function setTabMode(t, m) {
  if (!t?.doc || t.mode === m) return;
  t.pane.stash();
  const wasRead = t.mode === 'read';
  t.mode = m;
  if (m !== 'read') { t.lastEdit = m; store.set('defaultMode', m); }
  const spec = { effects: liveComp.reconfigure(m === 'live' ? liveExt : []) };
  if (t.pane.active === t) t.pane.view.dispatch(spec); else t.state = t.state.update(spec).state;
  t.pane.show();
  if (m !== 'read' && wasRead) setTimeout(() => t.pane.view.focus(), 0);
  saveLayout();
}
const toggleRead = () => { const t = T(); if (t?.doc) setTabMode(t, t.mode === 'read' ? t.lastEdit || 'live' : 'read'); };
const toggleLiveSource = () => { const t = T(); if (t?.doc) setTabMode(t, t.mode === 'source' ? 'live' : 'source'); };

// ------------------------------------------------------------------ history
function goHist(delta, p = P()) {
  const t = p.active; if (!t) return;
  const ni = t.hi + delta;
  if (ni < 0 || ni >= t.hist.length) return;
  t.hi = ni;
  p.focusPane();
  openNote(t.hist[ni], { push: false, pane: p });
}

// ------------------------------------------------------------------ navigation within a note
function gotoLine(n, t = T()) {
  if (!t?.doc) return;
  const p = t.pane, state = tabState(t);
  n = Math.max(0, Math.min(n, state.doc.lines - 1));
  const line = state.doc.line(n + 1);
  if (t.mode === 'read') {
    p.readScroll.scrollTop = (n / Math.max(1, state.doc.lines)) * (p.readScroll.scrollHeight - p.readScroll.clientHeight);
    return;
  }
  p.view.focus();
  p.view.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 120 }) });
}
function gotoHeading(h, t = T()) {
  if (!t?.doc) return;
  const want = slug(h);
  const lines = tabText(t).split('\n');
  const i = lines.findIndex((l) => { const m = l.match(/^#{1,6}\s+(.*)$/); return m && slug(m[1]) === want; });
  if (i < 0) return;
  if (t.mode === 'read') {
    const target = $$('h1,h2,h3,h4,h5,h6', t.pane.preview).filter((x) => !x.closest('.embed')).find((x) => slug(x.textContent) === want);
    if (target) t.pane.readScroll.scrollTop = target.offsetTop - 20;
    return;
  }
  gotoLine(i, t);
}

async function followLink(target, heading, from, { newTab = false } = {}) {
  if (!target) { if (heading) gotoHeading(heading); return; }
  const r = resolve(target, from);
  if (r) {
    if (!r.toLowerCase().endsWith('.md')) return window.open(vaultUrl(r), '_blank');
    if (!newTab && S.cur && r === S.cur.path) return heading && gotoHeading(heading);
    return openNote(r, { heading: heading || null, newTab });
  }
  const name = cleanName(target.split('/').pop());
  if (!name) return;
  const d = target.includes('/') ? normPath(dirOf(target)) : '';
  await createNote(join(d, name + '.md'), '', { newTab });
}

function toggleTask(t, idx, checked) {
  const state = tabState(t);
  let inFence = false, n = -1;
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (/^\s*(```|~~~)/.test(line.text)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.text.match(/^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/);
    if (m && ++n === idx) { const pos = line.from + m[1].length; tabReplace(t, pos, pos + 1, checked ? 'x' : ' '); return; }
  }
}

// ------------------------------------------------------------------ hover previews
let hoverTimer = null, hoverEl = null;
function hideHover() { clearTimeout(hoverTimer); hoverEl = null; $('#hover').hidden = true; }
for (const ev of ['mousedown', 'keydown', 'wheel']) document.addEventListener(ev, hideHover, true);
document.addEventListener('mouseover', (e) => {
  const a = e.target.closest('a.wl:not(.unresolved), .bl[data-path], .out[data-path]:not(.unresolved), .bmk[data-path]');
  if (!a || a.closest('#hover')) return;
  clearTimeout(hoverTimer);
  hoverEl = a;
  hoverTimer = setTimeout(async () => {
    if (hoverEl !== a || !a.isConnected) return;
    const path = a.dataset.path || resolve(a.dataset.target, a.dataset.from || S.cur?.path);
    if (!path || !path.toLowerCase().endsWith('.md') || (path === S.cur?.path && !a.dataset.heading)) return;
    try {
      let text = DOCS.has(path) && docText(DOCS.get(path)) != null ? docText(DOCS.get(path)) : await getContent(path);
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
  const a = e.target.closest('a.wl, .bl, .out, .bmk');
  if (a && !a.contains(e.relatedTarget)) hideHover();
});

// ------------------------------------------------------------------ layout persistence
const saveLayout = Object.assign(debounce(() => saveLayout.now(), 400), {
  now() {
    if (!W.panes.length) return;
    store.set('workspace', {
      active: W.panes.indexOf(W.active),
      panes: W.panes.map((p) => ({ flex: p.flex, active: p.tabs.indexOf(p.active), tabs: p.tabs.map((t) => ({ path: t.doc?.path || t.pending || null, mode: t.mode })) })),
    });
  },
});
async function restoreLayout(startPath) {
  const ws = store.get('workspace', null);
  if (ws?.panes?.length) {
    for (const sp of ws.panes) {
      const p = createPane();
      p.flex = sp.flex || 1;
      for (const st of sp.tabs) {
        const t = p.addTab(p.tabs.length, st.mode || defaultMode());
        if (st.path && S.noteByPath.has(st.path)) t.pending = st.path;
      }
      if (!p.tabs.length) p.addTab();
    }
    layoutPanes();
    for (const [i, sp] of ws.panes.entries()) {
      const p = W.panes[i];
      p.active = null;
      await p.activate(p.tabs[Math.max(0, Math.min(sp.active, p.tabs.length - 1))], { focus: false });
    }
    W.panes[Math.max(0, Math.min(ws.active, W.panes.length - 1))].focusPane();
    if (startPath && S.cur?.path !== startPath) {
      const existing = allTabs().find((t) => (t.doc?.path || t.pending) === startPath);
      if (existing) { existing.pane.focusPane(); await existing.pane.activate(existing); } else await openNote(startPath);
    }
    return;
  }
  const p = createPane();
  p.addTab();
  p.focusPane();
  await p.activate(p.tabs[0]);
  if (startPath) await openNote(startPath);
}

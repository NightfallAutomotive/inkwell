/* Inkwell — command palette, graph, file recovery, note composer, keyboard, boot. */
'use strict';

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
  { id: 'toggle-mode', name: 'Toggle reading view', key: 'Ctrl+E', need: true, fn: toggleRead },
  { id: 'toggle-source', name: 'Toggle live preview / source mode', key: 'Ctrl+Shift+E', need: true, fn: toggleLiveSource },
  { id: 'mode-live', name: 'Live preview mode', need: true, fn: () => setTabMode(T(), 'live') },
  { id: 'mode-source', name: 'Source mode', need: true, fn: () => setTabMode(T(), 'source') },
  { id: 'mode-read', name: 'Reading view', need: true, fn: () => setTabMode(T(), 'read') },
  { id: 'rename', name: 'Rename current note', need: true, fn: () => { const t = T(); if (t.mode === 'read') setTabMode(t, t.lastEdit || 'live'); t.pane.title.focus(); t.pane.title.select(); } },
  { id: 'move', name: 'Move current note to folder…', need: true, fn: () => movePath(S.cur.path) },
  { id: 'delete', name: 'Delete current note', need: true, fn: () => deletePath(S.cur.path, 'note') },
  { id: 'copy-link', name: 'Copy wikilink to current note', need: true, fn: () => copyText(`[[${linkText(S.cur.path)}]]`) },
  { id: 'insert-date', name: "Insert today's date", need: true, noSlash: true, fn: () => insertText(today()) },
  { id: 'insert-time', name: 'Insert current time', need: true, noSlash: true, fn: () => insertText(nowTime()) },
  { id: 'insert-template', name: 'Insert template…', need: true, fn: () => openPalette('templates') },
  { id: 'toggle-task', name: 'Toggle checklist item', key: 'Ctrl+L', need: true, noSlash: true, fn: () => editing() && cycleTaskCmd(P().view) },
  { id: 'add-property', name: 'Add property', need: true, noSlash: true, fn: () => addProperty(T()) },
  // tabs & panes
  { id: 'new-tab', name: 'New tab', key: 'Alt+T', fn: newTab },
  { id: 'close-tab', name: 'Close current tab', key: 'Alt+W', fn: () => closeTab(T()) },
  { id: 'reopen-tab', name: 'Reopen closed tab', key: 'Alt+Shift+T', fn: reopenClosed },
  { id: 'next-tab', name: 'Next tab', key: 'Alt+]', fn: () => cycleTab(1) },
  { id: 'prev-tab', name: 'Previous tab', key: 'Alt+[', fn: () => cycleTab(-1) },
  { id: 'close-others', name: 'Close other tabs', fn: () => { const t = T(); [...t.pane.tabs].filter((x) => x !== t).forEach((x) => closeTab(x)); } },
  { id: 'split-right', name: 'Split right', key: 'Alt+\\', need: true, fn: () => splitRight() },
  { id: 'close-pane', name: 'Close current pane', fn: () => closePane(P()) },
  { id: 'focus-next-pane', name: 'Focus next pane', key: 'Alt+.', fn: () => { const i = W.panes.indexOf(P()); const p = W.panes[(i + 1) % W.panes.length]; p.focusPane(); p.active?.mode !== 'read' && p.view.focus(); } },
  // bookmarks, recovery, composer
  { id: 'bookmark', name: 'Bookmark current note', key: 'Alt+B', need: true, fn: () => toggleBookmark({ type: 'file', path: S.cur.path }) },
  { id: 'bookmarks', name: 'Show bookmarks', fn: () => setTab('bookmarks') },
  { id: 'recovery', name: 'File recovery: restore an earlier version', need: true, fn: () => openRecovery(S.cur.path) },
  { id: 'merge', name: 'Merge current note into another note…', need: true, fn: () => pickMergeTarget(S.cur.path) },
  { id: 'extract', name: 'Extract selection to a new note…', need: true, fn: extractSelection },
  { id: 'random', name: 'Open random note', noSlash: true, fn: () => { const n = S.index.notes; if (n.length) openNote(n[Math.floor(Math.random() * n.length)].path); } },
  { id: 'reveal', name: 'Reveal current note in file explorer', need: true, fn: () => { setTab('files'); reveal(S.cur.path); } },
  { id: 'collapse-all', name: 'Collapse all folders', fn: () => { S.open.clear(); saveOpen(); renderTree(); } },
  { id: 'toggle-left', name: 'Toggle left sidebar', key: 'Ctrl+\\', fn: () => toggleLeft() },
  { id: 'toggle-right', name: 'Toggle right sidebar', fn: toggleRight },
  { id: 'theme', name: 'Toggle light / dark theme', fn: toggleTheme },
  { id: 'settings', name: 'Open settings', key: 'Ctrl+,', fn: openSettings },
  { id: 'guide', name: 'How to use Inkwell (open the guide)', fn: () => openGuide() },
  { id: 'sign-out', name: 'Sign out', noSlash: true, fn: async () => { await saveAll(); await api('POST', 'logout'); location.href = '/login'; } },
  { id: 'reload', name: 'Reload vault from disk', fn: () => refreshIndex().then(() => toast('Vault reloaded')) },
  { id: 'back', name: 'Navigate back', key: 'Alt+←', fn: () => goHist(-1) },
  { id: 'forward', name: 'Navigate forward', key: 'Alt+→', fn: () => goHist(1) },
  { id: 'palette', name: 'Command palette', key: 'Ctrl+P', fn: () => openPalette('commands') },
];
const CMD = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));
function runCmd(id) { const c = CMD[id]; if (!c) return; if (c.need && !S.cur) return toast('Open a note first'); c.fn(); }
/** Items for the ⋯ menu in a note's header. */
function moreMenu() {
  const t = T();
  if (!t?.doc) return [{ label: 'Split right', fn: () => splitRight() }, { label: 'Close this tab', fn: () => closeTab(t) }];
  const path = t.doc.path;
  return [
    { label: 'Open in new tab', fn: () => openNote(path, { newTab: true }) },
    { label: 'Split right', fn: () => splitRight(t) },
    '-',
    { label: isBookmarked(path) ? 'Remove bookmark' : 'Bookmark', fn: () => toggleBookmark({ type: 'file', path }) },
    { label: 'Add property', fn: () => addProperty(t) },
    { label: 'Copy wikilink', fn: () => copyText(`[[${linkText(path)}]]`) },
    { label: 'Reveal in file explorer', fn: () => { setTab('files'); reveal(path); } },
    '-',
    { label: 'Extract selection to new note…', fn: extractSelection },
    { label: 'Merge into another note…', fn: () => pickMergeTarget(path) },
    { label: 'File recovery…', fn: () => openRecovery(path) },
    '-',
    { label: 'Rename…', fn: () => runCmd('rename') },
    { label: 'Move to…', fn: () => movePath(path) },
    { label: 'Delete', danger: true, fn: () => deletePath(path, 'note') },
  ];
}
/** The active pane's editor, if a note is open in an editing mode. */
function editing() { const t = T(); if (!t?.doc) return null; if (t.mode === 'read') { toast('Switch to Live or Source mode to edit'); return null; } return P().view; }
function insertText(text) { const v = editing(); if (!v) return; v.dispatch(v.state.replaceSelection(text), { scrollIntoView: true }); v.focus(); }
document.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) runCmd(b.dataset.cmd); });

const PAL = { mode: 'commands', items: [], sel: 0 };
function openPalette(mode) {
  PAL.mode = mode;
  const inp = $('#palette-input');
  inp.value = '';
  inp.placeholder = { commands: 'Type a command…', templates: 'Pick a template from Templates/…', merge: `Merge "${PAL.mergeFrom ? base(PAL.mergeFrom) : ''}" into…` }[mode] || 'Find or create a note…';
  $('#palette').hidden = false;
  fillPalette();
  setTimeout(() => inp.focus(), 0);
}
function closePalette() { $('#palette').hidden = true; const t = T(); if (t?.doc && t.mode !== 'read') t.pane.view.focus(); }
function fillPalette() {
  const q = $('#palette-input').value;
  if (PAL.mode === 'commands') {
    PAL.items = rank(q, COMMANDS.map((c) => ({ ...c, label: c.name })), (c) => c.name);
  } else if (PAL.mode === 'merge') {
    PAL.items = rank(q, S.index.notes.filter((n) => n.path !== PAL.mergeFrom).map((n) => ({ path: n.path, label: base(n.path), sub: dirOf(n.path) })), (x) => x.label + ' ' + x.path).slice(0, 60);
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
let newTabNext = false;
async function acceptPalette(i = PAL.sel, forceCreate = false) {
  const q = $('#palette-input').value.trim();
  const r = PAL.items[i];
  closePalette();
  if (PAL.mode === 'commands') { if (r) runCmd(r.item.id); return; }
  if (PAL.mode === 'merge') { if (r) mergeNotes(PAL.mergeFrom, r.item.path); return; }
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
  openNote(r.item.path, { newTab: newTabNext });
}
$('#palette-input').addEventListener('input', fillPalette);
$('#palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    PAL.sel = (PAL.sel + (e.key === 'ArrowDown' ? 1 : -1) + PAL.items.length) % Math.max(1, PAL.items.length);
    $$('#palette-list .pi').forEach((x, i) => x.classList.toggle('sel', i === PAL.sel));
    $$('#palette-list .pi')[PAL.sel]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') { e.preventDefault(); newTabNext = e.ctrlKey || e.metaKey; acceptPalette(PAL.sel, e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
});
$('#palette-list').addEventListener('mousemove', (e) => {
  const p = e.target.closest('.pi'); if (!p || +p.dataset.i === PAL.sel) return;
  PAL.sel = +p.dataset.i;
  $$('#palette-list .pi').forEach((x, i) => x.classList.toggle('sel', i === PAL.sel));
});
$('#palette-list').addEventListener('click', (e) => { const p = e.target.closest('.pi'); if (p) { newTabNext = e.ctrlKey || e.metaKey; acceptPalette(+p.dataset.i); } });
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
    return { bg: g('--bg'), node: g('--fg3'), accent: g('--accent'), line: g('--line'), label: g('--fg2'), unres: g('--unres'), tag: g('--green') };
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
function graphClick(n, e) {
  if (n.kind === 'note') { closeGraph(); openNote(n.path, { newTab: e?.ctrlKey || e?.metaKey }); }
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

// ------------------------------------------------------------------ file recovery
const REC = { path: null, snaps: [], sel: -1, cache: new Map(), current: '' };
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let pre = 0; while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0; while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf);
  const n = a2.length, m = b2.length, W1 = m + 1;
  if (n * m > 4e6) return null;
  const dp = new Uint32Array((n + 1) * W1);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W1 + j] = a2[i] === b2[j] ? dp[(i + 1) * W1 + j + 1] + 1 : Math.max(dp[(i + 1) * W1 + j], dp[i * W1 + j + 1]);
  const out = A.slice(0, pre).map((t) => ({ t, k: ' ' }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a2[i] === b2[j]) { out.push({ t: a2[i], k: ' ' }); i++; j++; }
    else if (dp[(i + 1) * W1 + j] >= dp[i * W1 + j + 1]) out.push({ t: a2[i++], k: '-' });
    else out.push({ t: b2[j++], k: '+' });
  }
  while (i < n) out.push({ t: a2[i++], k: '-' });
  while (j < m) out.push({ t: b2[j++], k: '+' });
  for (const t of A.slice(A.length - suf)) out.push({ t, k: ' ' });
  return out;
}
function renderDiff(rows) {
  const keep = rows.map((r, i) => r.k !== ' ' || rows.slice(Math.max(0, i - 3), i + 4).some((x) => x.k !== ' '));
  let html = '', skipped = 0;
  rows.forEach((r, i) => {
    if (!keep[i]) { skipped++; return; }
    if (skipped) { html += `<div class="dl skip">⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}</div>`; skipped = 0; }
    html += `<div class="dl ${r.k === '+' ? 'add' : r.k === '-' ? 'del' : ''}"><span class="dk">${r.k === ' ' ? '' : r.k}</span>${esc(r.t) || ' '}</div>`;
  });
  if (skipped) html += `<div class="dl skip">⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}</div>`;
  return html;
}
const fmtTime = (t) => { const d = new Date(t * 1000); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
function ago(t) {
  const s = Date.now() / 1000 - t;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
async function freshText(path) {
  const d = DOCS.get(path), t = d && docText(d);
  if (t != null) return t;
  return (await api('GET', 'note', { qs: { path } })).content;
}
async function openRecovery(path) {
  if (DOCS.has(path)) await save(DOCS.get(path));
  let snaps;
  try { snaps = await api('GET', 'snapshots', { qs: { path } }); } catch (e) { return toast(e.message, true); }
  Object.assign(REC, { path, snaps, sel: -1, cache: new Map(), current: await freshText(path) });
  $('#rec-path').textContent = path;
  $('#recovery').hidden = false;
  $('#rec-list').innerHTML = snaps.length
    ? snaps.map((s, i) => `<div class="rec-item" data-i="${i}"><div>${esc(fmtTime(s.time))}</div><div class="muted small">${ago(s.time)} · ${(s.size / 1024).toFixed(1)} KB</div></div>`).join('')
    : '<div class="empty" style="padding:12px">No earlier versions yet.<br><br>Inkwell saves a copy of a note before changing it, at most once every 5 minutes, and keeps copies for 14 days.</div>';
  $('#rec-view').innerHTML = '';
  $('#rec-restore').disabled = $('#rec-copy').disabled = true;
  $('#rec-info').textContent = '';
  if (snaps.length) recSelect(0);
}
async function recSelect(i) {
  REC.sel = i;
  $$('.rec-item').forEach((x) => x.classList.toggle('sel', +x.dataset.i === i));
  const s = REC.snaps[i];
  let content = REC.cache.get(s.id);
  if (content == null) {
    try { content = (await api('GET', 'snapshot', { qs: { path: REC.path, id: s.id } })).content; REC.cache.set(s.id, content); }
    catch (e) { $('#rec-view').textContent = 'Could not load: ' + e.message; return; }
  }
  if (REC.sel !== i) return;
  $('#rec-restore').disabled = $('#rec-copy').disabled = false;
  const diff = $('#rec-diff').checked ? lineDiff(REC.current, content) : null;
  if (diff) {
    const adds = diff.filter((r) => r.k === '+').length, dels = diff.filter((r) => r.k === '-').length;
    $('#rec-info').textContent = adds || dels ? `Restoring adds ${adds} line${adds === 1 ? '' : 's'} and removes ${dels} compared with the note now.` : 'Same as the note now.';
    $('#rec-view').innerHTML = renderDiff(diff);
  } else {
    $('#rec-info').textContent = $('#rec-diff').checked ? 'Too large to compare; showing the full version.' : '';
    $('#rec-view').innerHTML = `<pre class="rec-full">${esc(content)}</pre>`;
  }
}
function closeRecovery() { $('#recovery').hidden = true; }
$('#rec-list').addEventListener('click', (e) => { const r = e.target.closest('.rec-item'); if (r) recSelect(+r.dataset.i); });
$('#rec-diff').addEventListener('change', () => REC.sel >= 0 && recSelect(REC.sel));
$('#rec-close').onclick = closeRecovery;
$('#recovery').addEventListener('mousedown', (e) => { if (e.target.id === 'recovery') closeRecovery(); });
$('#rec-copy').onclick = () => { const c = REC.cache.get(REC.snaps[REC.sel]?.id); if (c != null) copyText(c); };
$('#rec-restore').onclick = async () => {
  const s = REC.snaps[REC.sel], content = REC.cache.get(s?.id);
  if (content == null) return;
  const path = REC.path, doc = DOCS.get(path), t = doc && tabsOfDoc(doc).find((x) => x.state);
  closeRecovery();
  try {
    if (t) { doc.forceSnap = true; tabReplace(t, 0, tabText(t).length, content); await save(doc); }
    else await api('PUT', 'note', { qs: { path }, body: { content, snapshot: true } });
    await refreshIndex({ quiet: true });
    toast(`Restored the version from ${fmtTime(s.time)}. The replaced text was saved as a snapshot${t ? ', and Ctrl+Z undoes it' : ''}.`);
  } catch (e) { toast('Restore failed: ' + e.message, true); }
};

// ------------------------------------------------------------------ note composer
function pickMergeTarget(path) { PAL.mergeFrom = path; openPalette('merge'); }
function mergeText(dst, src) {
  const fd = parseFrontmatter(dst), fs = parseFrontmatter(src);
  let head = dst, body = src;
  if (fs) {
    body = src.slice(fs.to);
    if (fs.ok && (!fd || fd.ok)) {
      const props = fd ? fd.props.map((p) => ({ ...p })) : [];
      for (const p of fs.props) {
        const ex = props.find((x) => x.key === p.key);
        if (!ex) props.push(p);
        else if (Array.isArray(ex.value) || Array.isArray(p.value)) ex.value = [...new Set([].concat(ex.value ?? [], p.value ?? []).map(String))];
      }
      head = `---\n${serializeProps(props)}\n---\n` + (fd ? dst.slice(fd.to) : dst);
    } else body = '```yaml\n' + fs.yaml + '\n```\n' + body;
  }
  head = head.replace(/\s+$/, ''); body = body.replace(/^\s+|\s+$/g, '');
  return (head ? head + '\n\n' : '') + body + '\n';
}
async function mergeNotes(src, dst) {
  if (!src || !dst || src === dst) return;
  const ok = await ask(`Merge "${base(src)}" into "${base(dst)}"? Its text goes at the end of "${base(dst)}", links to it are pointed at "${base(dst)}", and "${base(src)}" moves to .trash.`, null, { ok: 'Merge' });
  if (!ok) return;
  await saveAll();
  try {
    const merged = mergeText(await freshText(dst), await freshText(src));
    const dDoc = DOCS.get(dst), dt = dDoc && tabsOfDoc(dDoc).find((x) => x.state);
    if (dt) { dDoc.forceSnap = true; tabReplace(dt, 0, tabText(dt).length, merged); await save(dDoc); }
    else { const n = await api('GET', 'note', { qs: { path: dst } }); await api('PUT', 'note', { qs: { path: dst }, body: { content: merged, baseMtime: n.mtime, snapshot: true } }); }
    const r = await api('POST', 'relink', { body: { from: src, to: dst } });
    const sDoc = DOCS.get(src);
    if (sDoc) sDoc.dirty = false;
    let reuse = null;
    for (const t of allTabs()) if ((t.doc?.path || t.pending) === src) { if (t === T()) reuse = t.pane; await closeTab(t, { remember: false }); }
    await api('POST', 'delete', { body: { path: src } });
    if (remapBookmarks((p) => (p === src ? dst : p))) saveBookmarks();
    await refreshIndex();
    await openNote(dst, reuse ? { pane: reuse } : {});
    toast(`Merged into ${base(dst)}` + (r.linksUpdated ? ` · links updated in ${r.linksUpdated} note${r.linksUpdated === 1 ? '' : 's'}` : ''));
  } catch (e) { toast('Merge failed: ' + e.message, true); }
}
async function extractSelection() {
  const v = editing(); if (!v) return;
  const t = T(), sel = v.state.selection.main;
  if (sel.empty) return toast('Select the text to extract first');
  const text = v.state.sliceDoc(sel.from, sel.to);
  const firstLine = text.split('\n').find((l) => l.trim()) || '';
  const hm = firstLine.match(/^#{1,6}\s+(.*?)\s*#*$/);
  const suggestion = cleanName((hm ? hm[1] : firstLine.replace(/^\s*([-*+>]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')).slice(0, 60));
  const name = await ask('Name for the new note', suggestion || 'Untitled');
  if (!name || !cleanName(name)) return;
  const path = uniquePath(dirOf(t.doc.path), cleanName(name));
  let body = text.replace(/^\s+/, '');
  if (hm && cleanName(hm[1]) === base(path)) body = body.slice(body.indexOf('\n') + 1 || body.length).replace(/^\n+/, '');
  try { await api('PUT', 'note', { qs: { path }, body: { content: body.replace(/\s*$/, '\n'), create: true } }); }
  catch (e) { return toast('Create failed: ' + e.message, true); }
  await refreshIndex({ quiet: true });
  const link = `[[${linkText(path)}]]`;
  if (tabState(t).sliceDoc(sel.from, sel.to) === text) tabReplace(t, sel.from, sel.to, link);
  else toast('The note was created, but the text changed meanwhile so it was not replaced', true);
  toast(`Extracted to "${base(path)}"`);
}

// ------------------------------------------------------------------ keyboard
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (!$('#recovery').hidden) { e.preventDefault(); return closeRecovery(); }
    if (!$('#settings').hidden) { e.preventDefault(); return closeSettings(); }
    if (!$('#graph').hidden) return closeGraph();
    if (!$('#palette').hidden) return closePalette();
    $('#ctx').hidden = true; $('#hover').hidden = true;
    return;
  }
  if (!$('#prompt').hidden || !$('#recovery').hidden) return;
  const go = (id) => { e.preventDefault(); e.stopPropagation(); runCmd(id); };
  if (mod && !e.shiftKey && !e.altKey && k === 'p') return go('palette');
  if (mod && !e.shiftKey && !e.altKey && k === 'o') return go('switcher');
  if (mod && !e.shiftKey && !e.altKey && k === 'g') return go('graph');
  if (mod && !e.shiftKey && !e.altKey && k === 'e') return go('toggle-mode');
  if (mod && e.shiftKey && k === 'e') return go('toggle-source');
  if (mod && e.shiftKey && k === 'f') return go('search');
  if (mod && !e.altKey && k === 's') { e.preventDefault(); e.stopPropagation(); saveAll(); return; }
  if (mod && e.key === '\\') return go('toggle-left');
  if (mod && e.key === ',') return go('settings');
  if (!e.altKey || mod) return;
  if (k === 'n') return go('new-note');
  if (k === 'd') return go('daily');
  if (k === 'b') return go('bookmark');
  if (k === 't') return go(e.shiftKey ? 'reopen-tab' : 'new-tab');
  if (k === 'w') return go('close-tab');
  if (e.key === ']' || e.code === 'BracketRight') return go('next-tab');
  if (e.key === '[' || e.code === 'BracketLeft') return go('prev-tab');
  if (e.key === '\\' || e.code === 'Backslash') return go('split-right');
  if (e.code === 'Period') return go('focus-next-pane');
  if (/^Digit[1-9]$/.test(e.code)) { e.preventDefault(); e.stopPropagation(); const p = P(); const i = +e.code.slice(5) - 1; const t = e.code === 'Digit9' ? p.tabs[p.tabs.length - 1] : p.tabs[i]; if (t) p.activate(t); return; }
  if (e.key === 'ArrowLeft') return go('back');
  if (e.key === 'ArrowRight') return go('forward');
}, true);

// ------------------------------------------------------------------ server version
const SERVER_STALE_MSG = 'Inkwell was updated, but the old version is still running in the background, so bookmarks, file recovery and merging won\'t work. Close Inkwell and start it again from the app menu.';
async function checkServer() {
  try {
    const p = await api('GET', 'ping');
    if (!p.version) { S.serverStale = true; toast(SERVER_STALE_MSG, true, 15000); }
  } catch {}
}

// ------------------------------------------------------------------ boot
(async function boot() {
  applyTheme();
  const w = store.get('widths', {});
  if (w.l) el.app.style.setProperty('--left-w', w.l);
  if (w.r) el.app.style.setProperty('--right-w', w.r);
  if (store.get('noLeft', false)) el.app.classList.add('no-left');
  if (store.get('noRight', false)) el.app.classList.add('no-right');
  await refreshIndex();
  checkServer();
  await loadBookmarks();
  const fromHash = decodeURI(location.hash.replace(/^#\/?/, ''));
  const hasLayout = !!store.get('workspace', null)?.panes?.length;
  const start = [fromHash, hasLayout ? null : store.get('last', null), hasLayout ? null : 'Getting started.md'].find((p) => p && S.noteByPath.has(p));
  await restoreLayout(start);
  setInterval(() => { if (!document.hidden) refreshIndex({ quiet: true }); }, 6000);
  addEventListener('focus', () => refreshIndex({ quiet: true }));
  addEventListener('hashchange', () => { const p = decodeURI(location.hash.replace(/^#\/?/, '')); if (p && p !== S.cur?.path && S.noteByPath.has(p)) openNote(p); });
})();

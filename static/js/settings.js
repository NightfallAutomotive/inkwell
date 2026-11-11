/* Inkwell — settings: theme, text size, note font, accent and custom colours. Stored per browser. */
'use strict';

const SET_DEFAULTS = { size: 16, font: 'serif', side: 1, accent: null, custom: { dark: null, light: null } };
const ACCENTS = [
  ['Frost', null], ['Teal', '#8fbcbb'], ['Sky', '#81a1c1'], ['Deep blue', '#5e81ac'],
  ['Red', '#bf616a'], ['Orange', '#d08770'], ['Yellow', '#ebcb8b'], ['Green', '#a3be8c'], ['Purple', '#b48ead'],
];
const NORD = { dark: { bg: '#2e3440', fg: '#eceff4' }, light: { bg: '#eceff4', fg: '#2e3440' } };
let SET = loadSettings();

function loadSettings() {
  const s = store.get('settings', {});
  return { ...SET_DEFAULTS, ...s, custom: { ...SET_DEFAULTS.custom, ...(s.custom || {}) } };
}
function saveSettings() { store.set('settings', SET); }

// ------------------------------------------------------------------ colour maths
const hex2rgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const rgb2hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
const lum = (h) => { const [r, g, b] = hex2rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const alpha = (h, a) => `rgba(${hex2rgb(h).join(',')},${a})`;

// ------------------------------------------------------------------ applying
function currentTheme() {
  const t = store.get('theme', 'system');
  if (t === 'dark' || t === 'light') return t;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme() {
  document.documentElement.dataset.theme = currentTheme();
  applySettings();
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (store.get('theme', 'system') === 'system') { applyTheme(); themeChanged(); } });

function applySettings() {
  const root = document.documentElement;
  root.style.setProperty('--note-size', SET.size + 'px');
  root.style.setProperty('--note-font', SET.font === 'sans' ? 'var(--sans)' : SET.font === 'mono' ? 'var(--mono)' : 'var(--serif)');
  root.style.setProperty('--side-zoom', SET.side);
  // colours go in a stylesheet so the dark/light switch still swaps palettes
  let css = '';
  for (const theme of ['dark', 'light']) {
    const c = SET.custom[theme];
    let rules = '';
    if (c) {
      const dark = lum(c.bg) < lum(c.fg);
      const towards = dark ? '#ffffff' : '#000000';
      rules += `--bg:${c.bg};--bg2:${dark ? mix(c.bg, '#000000', 0.12) : mix(c.bg, '#000000', 0.03)};--bg3:${mix(c.bg, towards, dark ? 0.09 : 0.08)};--line:${mix(c.bg, towards, dark ? 0.13 : 0.12)};`
        + `--fg:${c.fg};--fg2:${mix(c.fg, c.bg, 0.22)};--fg3:${mix(c.fg, c.bg, 0.45)};--code-bg:${mix(c.bg, towards, dark ? 0.07 : 0.05)};--unres:${mix(c.fg, c.bg, 0.55)};`;
    }
    if (SET.accent) {
      const a = theme === 'light' && lum(SET.accent) > 0.4 ? mix(SET.accent, '#000000', 0.3) : SET.accent;
      const bg = c ? c.bg : NORD[theme].bg;
      rules += `--accent:${a};--link:${a};--accent-soft:${alpha(a, 0.15)};--sel:${alpha(a, 0.3)};--on-accent:${lum(a) > 0.35 ? mix(bg, '#000000', 0.4) : '#eceff4'};`;
    }
    if (rules) css += `:root[data-theme="${theme}"]{${rules}}\n`;
  }
  let st = $('#user-theme');
  if (!st) { st = document.createElement('style'); st.id = 'user-theme'; document.head.appendChild(st); }
  st.textContent = css;
}

/** Redraw things that read colours once (graphs, HTML frames, rendered notes). */
function themeChanged() {
  if (typeof graph === 'undefined') return;
  graph.view?.draw(); localGraph.view?.draw();
  for (const p of W.panes) { p.view.dispatch({ effects: refreshFx.of(null) }); if (p.active?.mode === 'read') p.renderRead(); p.view.requestMeasure(); }
}
const themeChangedSoon = debounce(themeChanged, 250);

// ------------------------------------------------------------------ window
function openSettings() {
  $('#settings').hidden = false;
  renderSettings();
  setTimeout(() => $('#set-size').focus(), 0);
}
function closeSettings() { $('#settings').hidden = true; const t = T(); if (t?.doc && t.mode !== 'read') t.pane.view.focus(); }

function renderSettings() {
  const theme = currentTheme();
  $('#set-size').value = SET.size;
  $('#set-size-val').textContent = SET.size + ' px';
  const on = (sel, v) => $$(sel + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  on('#set-font', SET.font);
  on('#set-side', SET.side);
  on('#set-theme', store.get('theme', 'system'));
  $('#set-accent').innerHTML = ACCENTS.map(([name, c]) => `<button class="sw${(SET.accent || null) === c ? ' on' : ''}" data-c="${c || ''}" title="${name}${c ? '' : ' (Nord default)'}" aria-label="${name}" style="background:${c || (theme === 'dark' ? '#88c0d0' : '#5e81ac')}"></button>`).join('')
    + `<input type="color" class="sw-custom" id="set-accent-custom" title="Pick any colour" value="${SET.accent || (theme === 'dark' ? '#88c0d0' : '#5e81ac')}">`;
  $('#set-bgtheme').textContent = theme;
  const c = SET.custom[theme] || NORD[theme];
  $('#set-bg').value = c.bg; $('#set-fg').value = c.fg;
  $('#set-bgreset').hidden = !SET.custom[theme];
  renderVaultRow();
}

function changed({ colours = false } = {}) { saveSettings(); applySettings(); renderSettings(); if (colours) themeChangedSoon(); else for (const p of W.panes) p.view.requestMeasure(); }

$('#set-size').addEventListener('input', (e) => { SET.size = +e.target.value; changed(); });
$('#set-font').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { SET.font = b.dataset.v; changed(); } });
$('#set-side').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { SET.side = +b.dataset.v; changed(); } });
$('#set-theme').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  store.set('theme', b.dataset.v); applyTheme(); renderSettings(); themeChanged();
});
$('#set-accent').addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (b) { SET.accent = b.dataset.c || null; changed({ colours: true }); } });
$('#set-accent').addEventListener('input', (e) => { if (e.target.id === 'set-accent-custom') { SET.accent = e.target.value; saveSettings(); applySettings(); themeChangedSoon(); } });
for (const id of ['set-bg', 'set-fg']) {
  $('#' + id).addEventListener('input', () => {
    const theme = currentTheme();
    SET.custom[theme] = { bg: $('#set-bg').value, fg: $('#set-fg').value };
    saveSettings(); applySettings(); $('#set-bgreset').hidden = false; themeChangedSoon();
  });
}
$('#set-bgreset').addEventListener('click', () => { SET.custom[currentTheme()] = null; changed({ colours: true }); });
$('#set-reset').addEventListener('click', async () => {
  const ok = await ask('Reset text size, fonts and colours to the defaults?', null, { ok: 'Reset', danger: true });
  if (!ok) return;
  SET = { ...SET_DEFAULTS, custom: { dark: null, light: null } };
  store.set('theme', 'system'); applyTheme();
  changed({ colours: true });
});
$('#set-close').onclick = closeSettings;
$('#set-guide').onclick = () => { closeSettings(); openGuide(); };

// ------------------------------------------------------------------ notes folder
const VP = { path: '', busy: false, typed: false };
function renderVaultRow() { $('#set-vault-cur').textContent = S.index?.vaultDisplay || S.index?.vault || ''; }
async function vpLoad(path) {
  let d;
  try { d = await api('GET', 'dirs', { qs: path ? { path } : {} }); } catch (e) { return toast('Could not list folders: ' + e.message, true); }
  VP.path = d.path; VP.typed = false;
  $('#vp-path').value = d.display;
  $('#vp-list').innerHTML = (d.parent ? `<button class="vp-up" data-p="${esc(d.parent)}">↑ Up one folder</button>` : '')
    + (d.dirs.length ? d.dirs.map((n) => `<button data-p="${esc(d.path + '/' + n)}">📁 ${esc(n)}</button>`).join('') : '<div class="vp-empty">No folders in here</div>');
  $('#vp-use').disabled = d.isVault;
  $('#vp-use').title = d.isVault ? 'Your notes are already saved here' : '';
}
$('#set-vault-change').addEventListener('click', () => { const box = $('#set-vault-pick'); box.hidden = !box.hidden; if (!box.hidden) vpLoad(''); });
$('#vp-cancel').addEventListener('click', () => { $('#set-vault-pick').hidden = true; });
$('#vp-list').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (b) vpLoad(b.dataset.p); });
$('#vp-path').addEventListener('input', () => { VP.typed = true; $('#vp-use').disabled = false; });
$('#vp-path').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); vpLoad($('#vp-path').value); }
  if (e.key === 'Escape') { e.stopPropagation(); $('#set-vault-pick').hidden = true; }
});
$('#vp-new').addEventListener('click', async () => {
  const name = (await ask('Name of the new folder', 'Notes', { ok: 'Create' }) || '').trim();
  if (!name) return;
  if (/[\\/]/.test(name) || name.startsWith('.')) return toast('Use a plain folder name, without slashes or a leading dot.', true);
  // nothing is created on disk until "Use this folder"; just point the picker at it
  VP.path = VP.path + '/' + name; VP.typed = false;
  $('#vp-path').value = $('#vp-path').value.replace(/\/?$/, '/') + name;
  $('#vp-list').innerHTML = '<div class="vp-empty">New folder — created when you press “Use this folder”</div>';
  $('#vp-use').disabled = false;
});
$('#vp-use').addEventListener('click', async () => {
  if (VP.busy) return;
  // a path typed but not yet opened with Enter still counts
  const shown = $('#vp-path').value.trim();
  const target = VP.typed && shown ? shown : VP.path;
  const copy = $('#vp-copy').checked;
  const ok = await ask(copy
    ? `Copy your notes into ${shown} and save new notes there from now on? Your current folder stays as it is.`
    : `Save notes in ${shown} from now on? Your current notes stay where they are and won't show in Inkwell.`, null, { ok: 'Use this folder' });
  if (!ok) return;
  VP.busy = true; $('#vp-use').disabled = true; $('#vp-use').textContent = copy ? 'Copying…' : 'Switching…';
  try {
    await saveAll();
    const r = await api('POST', 'vault', { body: { path: target, copy } });
    // open tabs and the last note belong to the old folder
    for (const k of ['workspace', 'last', 'open']) store.set(k, null);
    let msg = 'Notes folder changed.';
    if (copy) msg += ` ${r.copied} file${r.copied === 1 ? '' : 's'} copied` + (r.skipped ? `, ${r.skipped} left alone because a file with the same name was already there.` : '.');
    sessionStorage.setItem('iw.flash', msg);
    location.hash = ''; location.reload();
  } catch (e) {
    toast('Could not change the notes folder: ' + e.message, true);
  } finally {
    VP.busy = false; $('#vp-use').disabled = false; $('#vp-use').textContent = 'Use this folder';
  }
});
try { const m = sessionStorage.getItem('iw.flash'); if (m) { sessionStorage.removeItem('iw.flash'); setTimeout(() => toast(m, false, 8000), 800); } } catch {}

// ------------------------------------------------------------------ guide
const GUIDE_PATH = 'Inkwell Guide.md';
const guideVersion = (text) => +((text.match(/^guide-version:\s*(\d+)/m) || [])[1] || 0);
/** Open the how-to guide, adding it to the vault (or updating an older copy) first. */
async function openGuide() {
  let bundled;
  try { const r = await fetch('guide.md', { cache: 'no-cache' }); if (!r.ok) throw new Error(r.statusText); bundled = await r.text(); }
  catch (e) { return toast('Could not load the guide: ' + e.message, true); }
  const existing = S.pathMap.get(GUIDE_PATH.toLowerCase());
  try {
    if (!existing) {
      await api('PUT', 'note', { qs: { path: GUIDE_PATH }, body: { content: bundled, create: true } });
    } else {
      const cur = DOCS.has(existing) ? docText(DOCS.get(existing)) : (await api('GET', 'note', { qs: { path: existing } })).content;
      if (guideVersion(cur) < guideVersion(bundled)) {
        const doc = DOCS.get(existing), t = doc && tabsOfDoc(doc).find((x) => x.state);
        if (t) { doc.forceSnap = true; tabReplace(t, 0, tabText(t).length, bundled); await save(doc); }
        else await api('PUT', 'note', { qs: { path: existing }, body: { content: bundled, snapshot: true } });
        toast('The guide was updated. Your previous copy is in File recovery.');
      }
    }
  } catch (e) { return toast('Could not add the guide to your vault: ' + e.message, true); }
  await refreshIndex({ quiet: true });
  const t = await openNote(existing || GUIDE_PATH, { newTab: !!S.cur });
  if (t && t.mode === 'source') setTabMode(t, 'live');
}
$('#settings').addEventListener('mousedown', (e) => { if (e.target.id === 'settings') closeSettings(); });

applySettings();

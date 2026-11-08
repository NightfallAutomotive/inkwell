/* Inkwell — properties: YAML frontmatter parsing/serialising and the properties panel. */
'use strict';

const LIST_KEYS = new Set(['tags', 'tag', 'aliases', 'alias', 'cssclasses', 'cssclass']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;

function unquote(s) {
  s = s.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s[0] === '"' ? s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}
function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return unquote(s);
}
function splitFlow(s) {
  const out = []; let cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; }
    else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => unquote(x)).filter((x) => x !== '');
}

/** Parse leading frontmatter. Returns null when the note has none.
 *  {from, to, yaml, props: [{key, value}], ok} — ok=false when the YAML uses features we don't edit. */
function parseFrontmatter(text) {
  const m = text.match(FM_RE);
  if (!m) return null;
  const yaml = m[1];
  const props = [];
  let ok = true;
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const km = line.match(/^([^\s:#][^:]*?):(?:\s+(.*)|\s*)$/);
    if (!km) { ok = false; continue; }
    const key = km[1].trim(), rest = (km[2] || '').trim();
    if (rest === '|' || rest === '>' || /^[|>][+-]?$/.test(rest)) { ok = false; continue; }
    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) { ok = false; continue; }
      props.push({ key, value: splitFlow(rest.slice(1, -1)) });
    } else if (rest.startsWith('{')) { ok = false; }
    else if (rest) props.push({ key, value: scalar(rest) });
    else {
      const items = [];
      while (i + 1 < lines.length && /^\s*-(\s|$)/.test(lines[i + 1])) items.push(unquote(lines[++i].replace(/^\s*-\s?/, '')));
      if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !items.length) { ok = false; while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) i++; }
      props.push({ key, value: items.length ? items : (LIST_KEYS.has(key.toLowerCase()) ? [] : null) });
    }
  }
  return { from: 0, to: m[0].length, yaml, props, ok };
}

function yamlStr(s) {
  s = String(s);
  if (s === '') return '""';
  if (/^[\s]|[\s]$|^[-?:,\[\]{}#&*!|>'"%@`]|: | #|^(true|false|null|~|yes|no)$|^-?\d+(\.\d+)?$/i.test(s) || s.includes('\n')) return JSON.stringify(s);
  return s;
}
function serializeProps(props) {
  const out = [];
  for (const { key, value } of props) {
    if (!key) continue;
    if (Array.isArray(value)) {
      if (!value.length) out.push(`${key}: []`);
      else { out.push(`${key}:`); for (const v of value) out.push(`  - ${yamlStr(v)}`); }
    } else if (value == null) out.push(`${key}:`);
    else if (typeof value === 'boolean' || typeof value === 'number') out.push(`${key}: ${value}`);
    else out.push(`${key}: ${DATE_RE.test(value) || DATETIME_RE.test(value) ? value : yamlStr(value)}`);
  }
  return out.join('\n');
}

function propType(key, value) {
  if (Array.isArray(value) || LIST_KEYS.has(key.toLowerCase())) return 'list';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && DATE_RE.test(value)) return 'date';
  if (typeof value === 'string' && DATETIME_RE.test(value)) return 'datetime';
  return 'text';
}
const TYPE_ICON = { text: '≡', list: '☰', number: '#', checkbox: '☑', date: '▦', datetime: '◷' };
const TYPE_NAME = { text: 'Text', list: 'List', number: 'Number', checkbox: 'Checkbox', date: 'Date', datetime: 'Date & time' };

function convertValue(value, type) {
  const asText = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value);
  switch (type) {
    case 'list': return Array.isArray(value) ? value : asText ? asText.split(/\s*,\s*/).filter(Boolean) : [];
    case 'checkbox': return value === true || /^(true|yes|1)$/i.test(asText);
    case 'number': { const n = parseFloat(asText); return Number.isFinite(n) ? n : null; }
    case 'date': return DATE_RE.test(asText.slice(0, 10)) ? asText.slice(0, 10) : today();
    case 'datetime': return DATETIME_RE.test(asText) ? asText.replace(' ', 'T').slice(0, 16) : `${DATE_RE.test(asText.slice(0, 10)) ? asText.slice(0, 10) : today()}T${nowTime()}`;
    default: return asText;
  }
}

/** Write props back into the tab's note, creating or removing the frontmatter block as needed. */
function writeProps(tab, props) {
  const text = tabText(tab);
  const fm = parseFrontmatter(text);
  const yaml = serializeProps(props);
  const block = yaml || fm ? `---\n${yaml}${yaml ? '\n' : ''}---\n` : '';
  if (fm) tabReplace(tab, fm.from, fm.to, props.length ? block : '');
  else if (props.length) tabReplace(tab, 0, 0, block);
}

/** Render the properties panel for `tab` into `box`. */
function renderProps(box, tab, { force = false } = {}) {
  if (!tab?.doc) { box.hidden = true; box.dataset.sig = ''; return; }
  const text = tabText(tab);
  const fm = parseFrontmatter(text);
  const sig = fm ? fm.yaml + '\u0000' + fm.ok : '';
  if (!force && box.dataset.sig === sig) return;
  if (!force && fm && box.contains(document.activeElement)) { box.dataset.stale = '1'; return; }
  box.dataset.sig = sig; delete box.dataset.stale;
  if (!fm) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const collapsed = store.get('propsCollapsed', false);
  box.classList.toggle('collapsed', collapsed);
  let html = `<div class="props-head"><span class="tw">▶</span> Properties</div>`;
  if (!fm.ok) {
    html += `<div class="props-raw"><div class="muted small">This frontmatter uses YAML the properties view can't edit. Switch to Source mode to change it.</div><pre>${esc(fm.yaml)}</pre></div>`;
    box.innerHTML = html; return;
  }
  html += '<div class="props-body">';
  fm.props.forEach((p, i) => {
    const type = propType(p.key, p.value);
    let editor;
    if (type === 'list') {
      const isTags = /^tags?$/i.test(p.key);
      editor = `<div class="pv-list">${(p.value || []).map((v, j) => `<span class="chip${isTags ? ' is-tag' : ''}" data-j="${j}"><span class="chip-t">${esc(v)}</span><button class="chip-x" data-x="${j}" title="Remove">×</button></span>`).join('')}<input class="pv-add" placeholder="${(p.value || []).length ? '' : 'Empty'}" spellcheck="false"></div>`;
    } else if (type === 'checkbox') editor = `<input type="checkbox" class="pv" ${p.value ? 'checked' : ''}>`;
    else if (type === 'number') editor = `<input type="number" class="pv" value="${p.value ?? ''}" placeholder="Empty">`;
    else if (type === 'date') editor = `<input type="date" class="pv" value="${esc(p.value)}">`;
    else if (type === 'datetime') editor = `<input type="datetime-local" class="pv" value="${esc(String(p.value).replace(' ', 'T').slice(0, 16))}">`;
    else editor = `<input class="pv" value="${esc(p.value ?? '')}" placeholder="Empty" spellcheck="false">`;
    html += `<div class="prop" data-i="${i}" data-type="${type}"><button class="pk-type" title="${TYPE_NAME[type]} — click to change type">${TYPE_ICON[type]}</button><input class="pk" value="${esc(p.key)}" spellcheck="false"><div class="pv-wrap">${editor}</div><button class="prop-del" title="Remove property">×</button></div>`;
  });
  html += `</div><button class="prop-add">＋ Add property</button>`;
  box.innerHTML = html;
}

function bindProps(box, getTab) {
  const cur = () => { const t = getTab(); const fm = t?.doc && parseFrontmatter(tabText(t)); return fm && fm.ok ? { t, fm } : null; };
  const commit = (mut) => { const c = cur(); if (!c) return; const props = c.fm.props.map((p) => ({ ...p, value: Array.isArray(p.value) ? [...p.value] : p.value })); if (mut(props) === false) return; writeProps(c.t, props); renderProps(box, c.t, { force: true }); };
  const idx = (e) => +e.target.closest('.prop')?.dataset.i;

  box.addEventListener('click', (e) => {
    if (e.target.closest('.props-head')) { const c = !box.classList.contains('collapsed'); box.classList.toggle('collapsed', c); store.set('propsCollapsed', c); return; }
    if (e.target.closest('.prop-add')) {
      commit((props) => { let k = 'property', n = 1; while (props.some((p) => p.key === k)) k = `property${n++}`; props.push({ key: k, value: null }); });
      const rows = $$('.prop .pk', box); const last = rows[rows.length - 1]; last?.focus(); last?.select();
      return;
    }
    if (e.target.closest('.prop-del')) { const i = idx(e); commit((props) => { props.splice(i, 1); }); return; }
    if (e.target.closest('.chip-x')) { const i = idx(e), j = +e.target.closest('.chip-x').dataset.x; commit((props) => { props[i].value.splice(j, 1); }); return; }
    const chip = e.target.closest('.chip.is-tag .chip-t');
    if (chip) { searchFor('tag:' + chip.textContent.replace(/^#/, '').toLowerCase()); return; }
    const tb = e.target.closest('.pk-type');
    if (tb) {
      const i = idx(e);
      showCtx(e, Object.keys(TYPE_NAME).map((type) => ({ label: (tb.closest('.prop').dataset.type === type ? '✓ ' : ' ') + TYPE_NAME[type], fn: () => commit((props) => { props[i].value = convertValue(props[i].value, type); }) })));
    }
  });
  box.addEventListener('change', (e) => {
    const i = idx(e); if (Number.isNaN(i)) return;
    const t = e.target;
    if (t.classList.contains('pk')) {
      const k = t.value.trim().replace(/:/g, '');
      commit((props) => { if (!k || props.some((p, j) => j !== i && p.key === k)) { t.value = props[i].key; return false; } props[i].key = k; });
    } else if (t.classList.contains('pv')) {
      const type = t.closest('.prop').dataset.type;
      commit((props) => {
        if (type === 'checkbox') props[i].value = t.checked;
        else if (type === 'number') props[i].value = t.value === '' ? null : Number(t.value);
        else if (type === 'datetime') props[i].value = t.value || null;
        else props[i].value = t.value === '' ? null : t.value;
      });
    }
  });
  box.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.classList.contains('pv-add')) {
      if ((e.key === 'Enter' || e.key === ',') && t.value.trim()) {
        e.preventDefault();
        const i = idx(e), v = t.value.trim().replace(/^#/, '');
        t.value = '';
        commit((props) => { props[i].value = [...(props[i].value || []), v]; });
        $$('.prop', box)[i]?.querySelector('.pv-add')?.focus();
      } else if (e.key === 'Backspace' && !t.value) {
        const i = idx(e); commit((props) => { if (!props[i].value?.length) return false; props[i].value.pop(); });
        $$('.prop', box)[i]?.querySelector('.pv-add')?.focus();
      }
    } else if (e.key === 'Enter' && t.matches('input:not([type=checkbox])')) { e.preventDefault(); t.blur(); }
    else if (e.key === 'Escape') { t.blur(); }
  });
  box.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.classList.contains('pv-add') && t.value.trim()) { const i = idx(e), v = t.value.trim().replace(/^#/, ''); t.value = ''; commit((props) => { props[i].value = [...(props[i].value || []), v]; }); }
    setTimeout(() => { if (box.dataset.stale && !box.contains(document.activeElement)) renderProps(box, getTab(), { force: true }); }, 0);
  });
}

/** Command: add a property to the current note (creating frontmatter if needed). */
function addProperty(tab) {
  if (!tab?.doc) return;
  const fm = parseFrontmatter(tabText(tab));
  if (fm && !fm.ok) return toast('This frontmatter can only be edited in Source mode', true);
  if (tab.mode === 'source') setTabMode(tab, 'live');
  const props = fm ? fm.props : [];
  let k = 'property', n = 1; while (props.some((p) => p.key === k)) k = `property${n++}`;
  writeProps(tab, [...props, { key: k, value: null }]);
  const box = tab.pane.propsBox();
  renderProps(box, tab, { force: true });
  box.classList.remove('collapsed');
  const rows = $$('.prop .pk', box); const last = rows[rows.length - 1]; last?.focus(); last?.select();
}

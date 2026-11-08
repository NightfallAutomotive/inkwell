/* Inkwell — editor: CodeMirror 6 setup, Markdown syntax extensions, live preview,
   autocomplete ([[links]], #tags, /slash commands) and editing commands. */
'use strict';

const {
  EditorState, EditorSelection, StateField, StateEffect, Compartment, Annotation, Transaction, Facet,
  EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection, dropCursor, placeholder, highlightSpecialChars,
  history: cmHistory, historyKeymap, defaultKeymap, indentMore, indentLess,
  syntaxTree, syntaxHighlighting, HighlightStyle, indentUnit, ensureSyntaxTree,
  markdown, markdownLanguage, tags: HT, Tag,
  autocompletion, closeBrackets, closeBracketsKeymap, startCompletion, acceptCompletion,
  search, searchKeymap, codeLanguages,
} = CM;

/** Changes copied in from another tab or from disk: don't re-mirror or re-save them. */
const Remote = Annotation.define();
/** Ask live-preview decorations to rebuild (e.g. after the vault index changed). */
const refreshFx = StateEffect.define();
/** The vault path of the note a state belongs to (for resolving relative links). */
const notePath = Facet.define({ combine: (v) => v[0] || '' });
const pathComp = new Compartment();
const liveComp = new Compartment();

// ------------------------------------------------------------------ Markdown syntax extensions
const hashtagTag = Tag.define(), highlightTag = Tag.define(), wikiTag = Tag.define();

const FrontmatterExt = {
  defineNodes: [{ name: 'Frontmatter', block: true, style: HT.meta }],
  parseBlock: [{
    name: 'Frontmatter', before: 'HorizontalRule',
    parse(cx, line) {
      if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
      let end = line.text.length;
      while (cx.nextLine()) {
        end = cx.lineStart + line.text.length;
        if (/^(---|\.\.\.)\s*$/.test(line.text)) break;
      }
      cx.addElement(cx.elt('Frontmatter', 0, end));
      cx.nextLine();
      return true;
    },
  }],
};

const WikiLinkExt = {
  defineNodes: [
    { name: 'WikiLink', style: wikiTag },
    { name: 'WikiMark', style: HT.processingInstruction },
    { name: 'WikiTarget' }, { name: 'WikiAlias' },
  ],
  parseInline: [{
    name: 'WikiLink', before: 'Link',
    parse(cx, next, pos) {
      let open;
      if (next === 33 && cx.char(pos + 1) === 91 && cx.char(pos + 2) === 91) open = 3;
      else if (next === 91 && cx.char(pos + 1) === 91) open = 2;
      else return -1;
      for (let i = pos + open; i < cx.end - 1; i++) {
        const c = cx.char(i);
        if (c === 10 || c === 91) return -1;
        if (c !== 93) continue;
        if (cx.char(i + 1) !== 93 || i === pos + open) return -1;
        const s = pos + open, inner = cx.slice(s, i), pipe = inner.indexOf('|');
        const kids = [cx.elt('WikiMark', pos, s)];
        if (pipe >= 0) kids.push(cx.elt('WikiTarget', s, s + pipe), cx.elt('WikiMark', s + pipe, s + pipe + 1), cx.elt('WikiAlias', s + pipe + 1, i));
        else kids.push(cx.elt('WikiTarget', s, i));
        kids.push(cx.elt('WikiMark', i, i + 2));
        return cx.addElement(cx.elt('WikiLink', pos, i + 2, kids));
      }
      return -1;
    },
  }],
};

const TagExt = {
  defineNodes: [{ name: 'Hashtag', style: hashtagTag }],
  parseInline: [{
    name: 'Hashtag',
    parse(cx, next, pos) {
      if (next !== 35) return -1;
      const prev = pos > cx.offset ? cx.char(pos - 1) : -1;
      if (prev !== -1 && !/[\s(]/.test(String.fromCharCode(prev))) return -1;
      const m = /^#([A-Za-z0-9_\-\/]*[A-Za-z_\-\/][A-Za-z0-9_\-\/]*)/.exec(cx.slice(pos, Math.min(cx.end, pos + 200)));
      return m ? cx.addElement(cx.elt('Hashtag', pos, pos + m[0].length)) : -1;
    },
  }],
};

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };
const HighlightExt = {
  defineNodes: [{ name: 'Highlight', style: { 'Highlight/...': highlightTag } }, { name: 'HighlightMark', style: HT.processingInstruction }],
  parseInline: [{
    name: 'Highlight', after: 'Emphasis',
    parse(cx, next, pos) {
      if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      const b = pos > cx.offset ? cx.char(pos - 1) : -1, a = cx.char(pos + 2);
      const sB = b < 0 || /\s/.test(String.fromCharCode(b)), sA = a < 0 || /\s/.test(String.fromCharCode(a));
      return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sA, !sB);
    },
  }],
};

const mdSupport = markdown({
  base: markdownLanguage,
  codeLanguages,
  extensions: [FrontmatterExt, WikiLinkExt, TagExt, HighlightExt],
});

const inkHighlight = HighlightStyle.define([
  { tag: HT.heading, class: 'cmt-heading' },
  { tag: HT.strong, class: 'cmt-strong' },
  { tag: HT.emphasis, class: 'cmt-em' },
  { tag: HT.strikethrough, class: 'cmt-strike' },
  { tag: [HT.link, wikiTag], class: 'cmt-link' },
  { tag: HT.url, class: 'cmt-url' },
  { tag: HT.monospace, class: 'cmt-code' },
  { tag: HT.quote, class: 'cmt-quote' },
  { tag: [HT.processingInstruction, HT.meta], class: 'cmt-meta' },
  { tag: HT.contentSeparator, class: 'cmt-hr' },
  { tag: hashtagTag, class: 'cmt-tag' },
  { tag: highlightTag, class: 'cmt-mark' },
  { tag: [HT.keyword, HT.operatorKeyword, HT.modifier, HT.controlKeyword, HT.definitionKeyword], class: 'tok-kw' },
  { tag: [HT.string, HT.special(HT.string), HT.regexp, HT.character], class: 'tok-str' },
  { tag: [HT.comment, HT.lineComment, HT.blockComment, HT.docComment], class: 'tok-com' },
  { tag: [HT.number, HT.bool, HT.null, HT.atom, HT.integer, HT.float], class: 'tok-num' },
  { tag: [HT.function(HT.variableName), HT.function(HT.propertyName)], class: 'tok-fn' },
  { tag: [HT.typeName, HT.className, HT.namespace], class: 'tok-type' },
  { tag: [HT.propertyName, HT.attributeName], class: 'tok-prop' },
  { tag: HT.tagName, class: 'tok-tag' },
  { tag: HT.invalid, class: 'tok-bad' },
]);

// ------------------------------------------------------------------ helpers
function selTouches(state, from, to) {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}
function linesTouched(state, from, to) {
  return selTouches(state, state.doc.lineAt(from).from, state.doc.lineAt(to).to);
}
/** Parse "[[target#heading|alias]]" / "![[…]]" text into parts. */
function wikiParts(text) {
  const embed = text.startsWith('!');
  return { embed, ...parseWikiInner(text.slice(embed ? 3 : 2, -2)) };
}

// headings get a size class on their line in both live and source mode
const headingLines = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = this.build(v); }
  update(u) { if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view); }
  build(view) {
    const out = [];
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter(n) {
          const m = /^(?:ATX|Setext)Heading(\d)$/.exec(n.name);
          if (m) out.push(Decoration.line({ class: 'cm-hd cm-h' + m[1] }).range(view.state.doc.lineAt(n.from).from));
          if (n.name === 'Paragraph' || n.name === 'FencedCode') return false;
        },
      });
    }
    return Decoration.set(out, true);
  }
}, { decorations: (v) => v.decorations });

// ------------------------------------------------------------------ widgets
class BulletW extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-lp-bullet'; s.textContent = '•'; return s; }
}
class CheckW extends WidgetType {
  constructor(checked) { super(); this.checked = checked; }
  eq(o) { return o.checked === this.checked; }
  toDOM(view) {
    const c = document.createElement('input');
    c.type = 'checkbox'; c.className = 'cm-lp-check'; c.checked = this.checked;
    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(c);
      const ch = view.state.sliceDoc(pos + 1, pos + 2);
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: /[xX]/.test(ch) ? ' ' : 'x' } });
    });
    return c;
  }
  ignoreEvent() { return true; }
}
class TextW extends WidgetType {
  constructor(text, cls) { super(); this.text = text; this.cls = cls; }
  eq(o) { return o.text === this.text && o.cls === this.cls; }
  toDOM() { const s = document.createElement('span'); s.className = this.cls; s.textContent = this.text; return s; }
}
class ImageW extends WidgetType {
  constructor(src, alt, width) { super(); this.src = src; this.alt = alt; this.width = width; }
  eq(o) { return o.src === this.src && o.width === this.width && o.alt === this.alt; }
  toDOM() {
    const i = document.createElement('img');
    i.className = 'cm-lp-img'; i.src = this.src; i.alt = this.alt || '';
    if (this.width) i.width = this.width;
    return i;
  }
}
function revealOnMouseDown(dom, view) {
  dom.addEventListener('mousedown', (e) => {
    if (e.target.closest('a, input, button, [data-open]')) return;
    e.preventDefault();
    const pos = view.posAtDOM(dom);
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
  });
}
class BlockW extends WidgetType {
  /** kind: 'table' | 'embed' | 'image'. `text` is the Markdown source of the block. */
  constructor(kind, text, from) { super(); this.kind = kind; this.text = text; this.from = from; }
  eq(o) { return o.kind === this.kind && o.text === this.text && o.from === this.from; }
  get estimatedHeight() { return this.kind === 'table' ? 30 * this.text.split('\n').length : 120; }
  toDOM(view) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-block cm-lp-' + this.kind + ' md';
    const node = renderMarkdown(this.text, view.state.facet(notePath), 0);
    wrap.append(...node.childNodes);
    for (const cb of $$('input[type=checkbox]', wrap)) cb.disabled = true;
    revealOnMouseDown(wrap, view);
    return wrap;
  }
  ignoreEvent(e) { return e.type !== 'mousedown' || !!e.target.closest?.('a, [data-open]'); }
}

// ------------------------------------------------------------------ live preview
const hideMark = Decoration.replace({});

function buildLive(view) {
  const { state } = view;
  const doc = state.doc, path = state.facet(notePath);
  const focused = view.hasFocus;
  const touches = (f, t) => focused && selTouches(state, f, t);
  const lineOn = (pos) => focused && linesTouched(state, pos, pos);
  const out = [];
  const seen = new Set();
  const add = (deco, from, to = from) => { const k = from + ':' + to + ':' + (deco.spec.class || deco.spec.widget?.constructor.name || 'r'); if (seen.has(k)) return; seen.add(k); out.push(deco.range(from, to)); };
  const lineDeco = (pos, cls) => add(Decoration.line({ class: cls }), doc.lineAt(pos).from);
  const hide = (f, t) => { if (t > f) add(hideMark, f, t); };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(n) {
        const name = n.name;
        switch (name) {
          case 'Frontmatter': case 'Table': return false;
          case 'HeaderMark': {
            const p = n.node.parent?.name || '';
            if (p.startsWith('ATXHeading') && !lineOn(n.from)) {
              const line = doc.lineAt(n.from);
              if (n.from === line.from) hide(n.from, Math.min(line.to, n.to + (doc.sliceString(n.to, n.to + 1) === ' ' ? 1 : 0)));
              else hide(n.from - (doc.sliceString(n.from - 1, n.from) === ' ' ? 1 : 0), n.to);
            } else if (p.startsWith('SetextHeading') && !lineOn(n.from)) hide(n.from, n.to);
            return;
          }
          case 'EmphasisMark': case 'StrikethroughMark': case 'HighlightMark': {
            const par = n.node.parent;
            if (par && !touches(par.from, par.to)) hide(n.from, n.to);
            return;
          }
          case 'CodeMark': {
            const par = n.node.parent;
            if (par?.name === 'InlineCode' && !touches(par.from, par.to)) hide(n.from, n.to);
            return;
          }
          case 'InlineCode': if (!touches(n.from, n.to)) add(Decoration.mark({ class: 'cm-lp-code-inline' }), n.from, n.to); return;
          case 'Link': {
            if (touches(n.from, n.to)) return;
            const marks = [], node = n.node; let url = null;
            for (let c = node.firstChild; c; c = c.nextSibling) { if (c.name === 'LinkMark') marks.push(c); if (c.name === 'URL') url = c; }
            if (marks.length < 2 || !url) return;
            const href = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '');
            const textFrom = marks[0].to, textTo = marks[1].from;
            hide(n.from, textFrom); hide(textTo, n.to);
            if (/^[a-z][a-z0-9+.-]*:/i.test(href)) add(Decoration.mark({ tagName: 'a', class: 'cm-lp-link ext', attributes: { 'data-href': href } }), textFrom, textTo);
            else {
              const target = normPath(join(dirOf(path), decodeURIComponent(href.split('#')[0])));
              const r = resolve(target) || resolve(decodeURIComponent(href.split('#')[0]), path);
              add(Decoration.mark({ tagName: 'a', class: 'cm-lp-wl wl' + (r ? '' : ' unresolved'), attributes: { 'data-target': r || target.replace(/\.md$/i, ''), 'data-heading': href.includes('#') ? decodeURIComponent(href.split('#')[1]) : '', 'data-from': path } }), textFrom, textTo);
            }
            return;
          }
          case 'Image': {
            if (touches(n.from, n.to)) return false;
            const node = n.node; let url = null;
            for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === 'URL') url = c;
            if (!url) return false;
            const src = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '');
            const m = /^!\[([^\]]*)\]/.exec(doc.sliceString(n.from, n.to));
            const full = /^[a-z]+:/i.test(src) ? src : vaultUrl(resolve(normPath(join(dirOf(path), decodeURIComponent(src)))) || normPath(join(dirOf(path), decodeURIComponent(src))));
            add(Decoration.replace({ widget: new ImageW(full, m ? m[1] : '') }), n.from, n.to);
            return false;
          }
          case 'URL': {
            const p = n.node.parent?.name;
            if (p === 'Link' || p === 'Image' || p === 'LinkReference') return;
            const href = doc.sliceString(n.from, n.to);
            add(Decoration.mark({ tagName: 'a', class: 'cm-lp-link ext', attributes: { 'data-href': /^www\./i.test(href) ? 'https://' + href : href } }), n.from, n.to);
            return;
          }
          case 'Autolink': if (!touches(n.from, n.to)) { hide(n.from, n.from + 1); hide(n.to - 1, n.to); } return;
          case 'WikiLink': {
            if (touches(n.from, n.to)) return false;
            const w = wikiParts(doc.sliceString(n.from, n.to));
            const r = resolve(w.target, path);
            if (w.embed) {
              if (r && isImg(r)) add(Decoration.replace({ widget: new ImageW(vaultUrl(r), w.alias && !/^\d+(x\d+)?$/.test(w.alias) ? w.alias : base(r), w.alias && /^\d+(x\d+)?$/.test(w.alias) ? +w.alias.split('x')[0] : 0) }), n.from, n.to);
              return false;
            }
            let lf = n.from + 2, lt = n.to - 2;
            for (let c = n.node.firstChild; c; c = c.nextSibling) if (c.name === 'WikiAlias') { lf = c.from; lt = c.to; }
            if (lt <= lf) return false;
            hide(n.from, lf); hide(lt, n.to);
            add(Decoration.mark({ tagName: 'a', class: 'cm-lp-wl wl' + (r ? '' : ' unresolved'), attributes: { 'data-target': w.target, 'data-heading': w.heading || '', 'data-from': path } }), lf, lt);
            return false;
          }
          case 'Hashtag': add(Decoration.mark({ class: 'cm-lp-tag', attributes: { 'data-tag': doc.sliceString(n.from + 1, n.to).toLowerCase() } }), n.from, n.to); return;
          case 'ListMark': {
            const item = n.node.parent, list = item?.parent;
            if (list?.name !== 'BulletList' || lineOn(n.from)) return;
            let isTask = false;
            for (let c = item.firstChild; c; c = c.nextSibling) if (c.name === 'Task') isTask = true;
            if (isTask) hide(n.from, Math.min(doc.lineAt(n.from).to, n.to + 1));
            else add(Decoration.replace({ widget: new BulletW() }), n.from, n.to);
            return;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(n.from + 1, n.from + 2));
            if (!touches(n.from, n.to)) add(Decoration.replace({ widget: new CheckW(checked) }), n.from, n.to);
            const task = n.node.parent;
            if (checked && task && task.to > n.to + 1) add(Decoration.mark({ class: 'cm-lp-done' }), n.to + 1, task.to);
            return;
          }
          case 'QuoteMark': {
            if (!lineOn(n.from)) hide(n.from, Math.min(doc.lineAt(n.from).to, n.to + (doc.sliceString(n.to, n.to + 1) === ' ' ? 1 : 0)));
            return;
          }
          case 'Blockquote': {
            if (n.node.parent?.name === 'Blockquote') return;
            const first = doc.lineAt(n.from);
            const cm = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/.exec(first.text);
            const cls = cm ? `cm-lp-quote cm-lp-callout callout-${cm[2].toLowerCase()}` : 'cm-lp-quote';
            for (let pos = n.from; pos <= n.to;) {
              const line = doc.lineAt(pos);
              lineDeco(line.from, cls + (line.from === first.from ? ' cm-lp-q-first' : '') + (line.to >= n.to ? ' cm-lp-q-last' : '') + (cm && line.from === first.from ? ' cm-lp-callout-title' : ''));
              pos = line.to + 1;
            }
            if (cm && !lineOn(first.from)) {
              const s = first.from + cm[1].length, e = s + 3 + cm[2].length + cm[3].length;
              const after = doc.sliceString(e, first.to);
              const pad = after.length - after.trimStart().length;
              if (cm[4].trim()) hide(s, e + pad);
              else add(Decoration.replace({ widget: new TextW(cm[2][0].toUpperCase() + cm[2].slice(1).toLowerCase(), 'cm-lp-callout-name') }), s, e + pad);
            }
            return;
          }
          case 'HorizontalRule': if (!lineOn(n.from)) { lineDeco(n.from, 'cm-lp-hr'); hide(n.from, n.to); } return;
          case 'FencedCode': {
            const firstLine = doc.lineAt(n.from), lastLine = doc.lineAt(n.to);
            const active = touches(firstLine.from, lastLine.to);
            for (let pos = n.from; pos <= n.to;) {
              const line = doc.lineAt(pos);
              const fence = !active && (line.number === firstLine.number || (line.number === lastLine.number && /^\s*(```|~~~)/.test(line.text) && lastLine.number > firstLine.number));
              lineDeco(line.from, 'cm-lp-code' + (line.number === firstLine.number ? ' cm-lp-code-first' : '') + (line.number === lastLine.number ? ' cm-lp-code-last' : '') + (fence ? ' cm-lp-fence' : ''));
              pos = line.to + 1;
            }
            if (!active) {
              const info = /^\s*(?:```|~~~)\s*([\w+#-]*)/.exec(firstLine.text);
              hide(firstLine.from, firstLine.to);
              if (info && info[1]) add(Decoration.widget({ widget: new TextW(info[1], 'cm-lp-lang'), side: 1 }), firstLine.to);
              if (lastLine.number > firstLine.number && /^\s*(```|~~~)/.test(lastLine.text)) hide(lastLine.from, lastLine.to);
            }
            return false;
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
}

const livePlugin = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = buildLive(v); }
  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((t) => t.effects.some((e) => e.is(refreshFx) || e.is(pathComp.reconfigure)))) {
      this.decorations = buildLive(u.view);
    }
  }
}, { decorations: (v) => v.decorations });

// Block-level replacements (frontmatter, tables, whole-line embeds) have to come from a state field.
function buildBlocks(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 40) || syntaxTree(state);
  const doc = state.doc, out = [], path = state.facet(notePath);
  tree.iterate({
    enter(n) {
      if (n.name === 'Frontmatter') { out.push(Decoration.replace({ block: true }).range(n.from, n.to)); return false; }
      if (n.name === 'Table') {
        const f = doc.lineAt(n.from), t = doc.lineAt(n.to);
        if (f.from === n.from && !selTouches(state, f.from, t.to)) out.push(Decoration.replace({ block: true, widget: new BlockW('table', doc.sliceString(f.from, t.to), f.from) }).range(f.from, t.to));
        return false;
      }
      if (n.name === 'Paragraph') {
        const f = doc.lineAt(n.from);
        if (f.from !== n.from || f.to < n.to) return false;
        const text = f.text.trim();
        const m = /^!\[\[([^\[\]\n]+)\]\]$/.exec(text);
        if (m && !selTouches(state, f.from, f.to)) {
          const w = parseWikiInner(m[1]);
          const r = resolve(w.target, path);
          if (r && r.toLowerCase().endsWith('.md')) out.push(Decoration.replace({ block: true, widget: new BlockW('embed', text, f.from) }).range(f.from, f.to));
        }
        return false;
      }
      if (/^(FencedCode|CodeBlock|HTMLBlock|ATXHeading\d|SetextHeading\d|HorizontalRule)$/.test(n.name)) return false;
    },
  });
  return Decoration.set(out, true);
}
const liveBlocks = StateField.define({
  create: buildBlocks,
  update(deco, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.effects.some((e) => e.is(refreshFx) || e.is(pathComp.reconfigure))) return buildBlocks(tr.state);
    return deco;
  },
  provide: (f) => [EditorView.decorations.from(f)],
});
// keep the cursor out of the hidden frontmatter
const fmAtomic = EditorView.atomicRanges.of((view) => {
  const first = syntaxTree(view.state).topNode.firstChild;
  if (!first || first.name !== 'Frontmatter') return Decoration.none;
  const end = Math.min(view.state.doc.length, first.to + 1);
  return Decoration.set([hideMark.range(0, end)]);
});

const liveExt = [livePlugin, liveBlocks, fmAtomic, EditorView.editorAttributes.of({ class: 'cm-live' })];

// ------------------------------------------------------------------ editing commands
function wrapSel(view, mark) {
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    const sel = state.sliceDoc(r.from, r.to);
    const before = state.sliceDoc(r.from - mark.length, r.from), after = state.sliceDoc(r.to, r.to + mark.length);
    if (before === mark && after === mark) {
      return { changes: [{ from: r.from - mark.length, to: r.from }, { from: r.to, to: r.to + mark.length }], range: EditorSelection.range(r.from - mark.length, r.to - mark.length) };
    }
    if (sel.length >= mark.length * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
      return { changes: { from: r.from, to: r.to, insert: sel.slice(mark.length, -mark.length) }, range: EditorSelection.range(r.from, r.to - mark.length * 2) };
    }
    return { changes: { from: r.from, to: r.to, insert: mark + sel + mark }, range: EditorSelection.range(r.from + mark.length, r.to + mark.length) };
  }));
  return true;
}
function insertMdLink(view) {
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    const sel = state.sliceDoc(r.from, r.to);
    if (/^https?:\/\//.test(sel)) return { changes: { from: r.from, to: r.to, insert: `[](${sel})` }, range: EditorSelection.cursor(r.from + 1) };
    return { changes: { from: r.from, to: r.to, insert: `[${sel}]()` }, range: EditorSelection.cursor(r.from + sel.length + 3) };
  }));
  return true;
}
function cycleTaskCmd(view) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = line.text.match(/^(\s*)([-*+]\s+)(\[([ xX])\]\s+)?(.*)$/);
        let out;
        if (!m) out = line.text.replace(/^(\s*)/, '$1- [ ] ');
        else if (!m[3]) out = m[1] + m[2] + '[ ] ' + m[5];
        else if (m[4] === ' ') out = m[1] + m[2] + '[x] ' + m[5];
        else out = m[1] + m[2] + m[5];
        changes.push({ from: line.from, to: line.to, insert: out });
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes });
  return true;
}
function tabKey(view) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  if (!state.selection.main.empty || /^\s*([-*+]|\d+[.)])\s/.test(line.text) || /^\s*>/.test(line.text)) return indentMore(view);
  view.dispatch(state.replaceSelection('\t'));
  return true;
}
/** Set a line's block prefix (heading, list, quote…), replacing any existing one. */
function setLinePrefix(view, prefix, pos = view.state.selection.main.head) {
  const line = view.state.doc.lineAt(pos);
  const m = line.text.match(/^(\s*)(#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*(?:\[![\w-]+\]\s*)?)?/);
  const indent = m[1], old = m[2] || '';
  const from = line.from + indent.length, to = from + old.length;
  view.dispatch({ changes: { from, to, insert: prefix }, selection: { anchor: line.to - old.length + prefix.length } });
}

const inkKeymap = [
  { key: 'Mod-b', run: (v) => wrapSel(v, '**') },
  { key: 'Mod-i', run: (v) => wrapSel(v, '*') },
  { key: 'Mod-Shift-h', run: (v) => wrapSel(v, '==') },
  { key: 'Mod-Shift-x', run: (v) => wrapSel(v, '~~') },
  { key: 'Mod-`', run: (v) => wrapSel(v, '`') },
  { key: 'Mod-k', run: insertMdLink },
  { key: 'Mod-l', run: cycleTaskCmd },
  { key: 'Tab', run: acceptCompletion },
  { key: 'Tab', run: tabKey, shift: indentLess },
];

// ------------------------------------------------------------------ autocomplete
function inCode(state, pos) {
  for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (/^(FencedCode|InlineCode|CodeBlock|Frontmatter|CodeText)$/.test(n.name)) return true;
  return false;
}
const closeLink = (text) => (view, c, from, to) => {
  const close = view.state.sliceDoc(to, to + 2) === ']]' ? '' : ']]';
  view.dispatch({ changes: { from, to, insert: text + close }, selection: { anchor: from + text.length + 2 } });
};
function headingsOf(text) {
  const out = []; let inFence = false;
  for (const l of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    const m = !inFence && l.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (m) out.push({ lvl: m[1].length, text: m[2] });
  }
  return out;
}
function wikiSource(ctx) {
  const m = ctx.matchBefore(/!?\[\[[^\[\]\n]*$/);
  if (!m || inCode(ctx.state, m.from)) return null;
  const open = m.text.startsWith('!') ? 3 : 2;
  const inner = m.text.slice(open), from = m.from + open;
  if (inner.includes('|')) return null;
  const here = ctx.state.facet(notePath);
  const hi = inner.indexOf('#');
  if (hi >= 0) {
    const target = inner.slice(0, hi);
    const p = target ? resolve(target, here) : here;
    if (!p || !p.toLowerCase().endsWith('.md')) return null;
    const textP = p === here ? Promise.resolve(ctx.state.doc.toString()) : getContent(p);
    return textP.then((text) => ({
      from: from + hi + 1,
      options: headingsOf(text).map((h) => ({ label: h.text, detail: 'H' + h.lvl, apply: closeLink(h.text) })),
      validFor: /^[^\]\n|]*$/,
    }));
  }
  const options = [];
  for (const n of S.index.notes) options.push({ label: base(n.path), detail: dirOf(n.path), apply: closeLink(linkText(n.path)), type: 'note' });
  for (const f of S.index.files) options.push({ label: f.split('/').pop(), detail: dirOf(f), apply: closeLink(f.split('/').pop()), type: 'file', boost: -1 });
  const q = inner.trim();
  if (q && !options.some((o) => o.label.toLowerCase().startsWith(q.toLowerCase()))) options.push({ label: q, detail: 'new note', apply: closeLink(q), boost: -99 });
  return { from, options, validFor: /^[^\[\]\n|#]*$/ };
}
function tagSource(ctx) {
  const m = ctx.matchBefore(/(?:^|[\s(])#[\w\-\/]+$/);
  if (!m) return null;
  const hash = m.from + m.text.indexOf('#');
  if (inCode(ctx.state, hash)) return null;
  return { from: hash + 1, options: allTags().map(([t, n]) => ({ label: t, detail: String(n), type: 'tag' })), validFor: /^[\w\-\/]*$/ };
}

const SLASH = [
  { label: 'Heading 1', prefix: '# ' }, { label: 'Heading 2', prefix: '## ' }, { label: 'Heading 3', prefix: '### ' },
  { label: 'Bullet list', prefix: '- ' }, { label: 'Numbered list', prefix: '1. ' }, { label: 'Task', prefix: '- [ ] ' },
  { label: 'Quote', prefix: '> ' }, { label: 'Callout', prefix: '> [!note] ' },
  { label: 'Code block', insert: '```\n', after: '\n```' },
  { label: 'Table', insert: '| Column 1 | Column 2 |\n| --- | --- |\n| ', after: ' |  |\n' },
  { label: 'Divider', insert: '---\n' },
  { label: 'Link to note', insert: '[[', after: ']]', complete: true },
  { label: 'Embed note or image', insert: '![[', after: ']]', complete: true },
  { label: 'Bold', insert: '**', after: '**' }, { label: 'Italic', insert: '*', after: '*' },
  { label: 'Highlight', insert: '==', after: '==' }, { label: 'Strikethrough', insert: '~~', after: '~~' },
  { label: 'Inline code', insert: '`', after: '`' },
  { label: "Today's date", text: () => today() }, { label: 'Current time', text: () => nowTime() },
  { label: 'Add property', run: () => addProperty(T()) },
  { label: 'Insert template…', run: () => openPalette('templates') },
];
function slashSource(ctx) {
  const m = ctx.matchBefore(/(?:^|\s)\/(?:[\w\-][\w\- ]{0,30})?$/);
  if (!m) return null;
  const slash = m.from + m.text.indexOf('/');
  if (inCode(ctx.state, slash)) return null;
  const apply = (fn) => (view, c, from, to) => { view.dispatch({ changes: { from: from - 1, to } }); fn(view, from - 1); };
  const options = SLASH.map((s) => ({
    label: s.label, type: 'slash',
    apply: apply((view, pos) => {
      if (s.prefix) setLinePrefix(view, s.prefix, pos);
      else if (s.text) view.dispatch({ changes: { from: pos, insert: s.text() }, selection: { anchor: pos + s.text().length } });
      else if (s.insert) {
        view.dispatch({ changes: { from: pos, insert: s.insert + (s.after || '') }, selection: { anchor: pos + s.insert.length } });
        if (s.complete) setTimeout(() => startCompletion(view), 0);
      } else if (s.run) setTimeout(s.run, 0);
    }),
  }));
  for (const c of COMMANDS) if (!c.noSlash) options.push({ label: c.name, detail: c.key || 'command', type: 'command', boost: -10, apply: apply(() => setTimeout(() => runCmd(c.id), 0)) });
  return { from: slash + 1, options, validFor: /^(?:[\w\-][\w\- ]{0,30})?$/ };
}

// ------------------------------------------------------------------ DOM events
function linkNodeAt(state, pos) {
  for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'WikiLink') { const w = wikiParts(state.sliceDoc(n.from, n.to)); return { target: w.target, heading: w.heading }; }
    if (n.name === 'Link' || n.name === 'Image') {
      for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === 'URL') return { href: state.sliceDoc(c.from, c.to) };
      return null;
    }
    if (n.name === 'URL') return { href: state.sliceDoc(n.from, n.to) };
    if (n.name === 'Hashtag') return { tag: state.sliceDoc(n.from + 1, n.to).toLowerCase() };
  }
  return null;
}
function followHref(href, from, newTab) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || /^www\./i.test(href)) return window.open(/^www\./i.test(href) ? 'https://' + href : href, '_blank', 'noopener');
  const clean = decodeURIComponent(href.replace(/^<|>$/g, '').split('#')[0]);
  const heading = href.includes('#') ? decodeURIComponent(href.split('#')[1]) : '';
  const rel = normPath(join(dirOf(from), clean));
  followLink(resolve(rel) || clean, heading, from, { newTab });
}
const editorEvents = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button > 1) return false;
    const newTab = e.ctrlKey || e.metaKey || e.button === 1;
    const from = view.state.facet(notePath);
    const a = e.target.closest?.('.cm-lp-wl, .cm-lp-link, .cm-lp-tag');
    if (a) {
      e.preventDefault();
      if (a.classList.contains('cm-lp-tag')) searchFor('tag:' + a.dataset.tag);
      else if (a.dataset.href) followHref(a.dataset.href, from, newTab);
      else followLink(a.dataset.target, a.dataset.heading, a.dataset.from || from, { newTab });
      return true;
    }
    const blk = e.target.closest?.('.cm-lp-block [data-open], .cm-lp-block a');
    if (blk) {
      e.preventDefault();
      if (blk.dataset.open) openNote(blk.dataset.open, { newTab });
      else if (blk.classList.contains('tag')) searchFor('tag:' + blk.dataset.tag);
      else if (blk.classList.contains('wl')) followLink(blk.dataset.target, blk.dataset.heading, blk.dataset.from || from, { newTab });
      else if (blk.href) window.open(blk.href, '_blank', 'noopener');
      return true;
    }
    if (newTab) {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      const l = pos != null && linkNodeAt(view.state, pos);
      if (l) {
        e.preventDefault();
        if (l.tag) searchFor('tag:' + l.tag);
        else if (l.href) followHref(l.href, from, true);
        else followLink(l.target, l.heading, from, { newTab: true });
        return true;
      }
    }
    return false;
  },
  paste(e, view) {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return false;
    e.preventDefault();
    (async () => {
      for (const f of files) {
        try {
          const d = new Date();
          const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
          const p = await uploadFile(f, f.type.startsWith('image/') && (!f.name || f.name === 'image.png') ? `Pasted image ${stamp}.png` : null);
          view.dispatch(view.state.replaceSelection(`![[${p.split('/').pop()}]]`));
        } catch (err) { toast('Upload failed: ' + err.message, true); }
      }
    })();
    return true;
  },
  drop(e, view) {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
    (async () => {
      let at = pos;
      for (const f of files) {
        try { const p = await uploadFile(f); const ins = `![[${p.split('/').pop()}]]\n`; view.dispatch({ changes: { from: at, insert: ins } }); at += ins.length; }
        catch (err) { toast('Upload failed: ' + err.message, true); }
      }
    })();
    return true;
  },
});

async function uploadFile(file, nameHint) {
  const ext = (file.name.match(/\.[^.]+$/) || ['.' + (file.type.split('/')[1] || 'bin')])[0];
  const d = new Date();
  const name = nameHint || file.name || `Pasted image ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ext}`;
  const r = await api('POST', 'upload', { qs: { path: 'attachments/' + name }, raw: file });
  await refreshIndex({ quiet: true });
  return r.path;
}

// ------------------------------------------------------------------ state factory
const baseExtensions = [
  cmHistory(), drawSelection(), dropCursor(), highlightSpecialChars(),
  EditorState.allowMultipleSelections.of(true),
  indentUnit.of('\t'), EditorState.tabSize.of(4),
  EditorView.lineWrapping,
  mdSupport,
  markdownLanguage.data.of({ closeBrackets: { brackets: ['(', '[', '{'] } }),
  syntaxHighlighting(inkHighlight), headingLines,
  closeBrackets(),
  autocompletion({ override: [wikiSource, tagSource, slashSource], icons: false, activateOnTyping: true, maxRenderedOptions: 60 }),
  search({ top: true }),
  placeholder('Start writing…   [[ to link · / for commands'),
  keymap.of([...inkKeymap, ...closeBracketsKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
  editorEvents,
  EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
];

function makeState(text, path, mode) {
  return EditorState.create({
    doc: text,
    extensions: [pathComp.of(notePath.of(path)), liveComp.of(mode === 'live' ? liveExt : []), baseExtensions],
  });
}

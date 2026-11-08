// Entry point for the bundled CodeMirror build (static/vendor/codemirror.min.js).
// Everything Inkwell's editor needs is re-exported on the global `CM`.
// Rebuild with: python3 tools/build_codemirror.py
export {
  EditorState, EditorSelection, StateField, StateEffect, Compartment, Annotation,
  RangeSetBuilder, Transaction, Prec, Facet, Text,
} from '@codemirror/state';
export {
  EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection, dropCursor,
  placeholder, highlightSpecialChars, rectangularSelection, crosshairCursor,
} from '@codemirror/view';
export {
  defaultKeymap, history, historyKeymap, indentMore, indentLess, undo, redo,
} from '@codemirror/commands';
export {
  syntaxTree, syntaxHighlighting, HighlightStyle, LanguageDescription, StreamLanguage,
  indentUnit, bracketMatching, ensureSyntaxTree,
} from '@codemirror/language';
export {
  markdown, markdownLanguage, markdownKeymap, insertNewlineContinueMarkup, deleteMarkupBackward,
} from '@codemirror/lang-markdown';
export { GFM, Strikethrough } from '@lezer/markdown';
export { tags, styleTags, Tag } from '@lezer/highlight';
export {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, startCompletion,
  acceptCompletion, completionStatus, closeCompletion,
} from '@codemirror/autocomplete';
export { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';

// Code-fence languages
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';

const L = (name, alias, support) => LanguageDescription.of({ name, alias, support });
export const codeLanguages = [
  L('JavaScript', ['js', 'javascript', 'mjs', 'cjs'], javascript()),
  L('TypeScript', ['ts', 'typescript'], javascript({ typescript: true })),
  L('JSX', ['jsx'], javascript({ jsx: true })),
  L('TSX', ['tsx'], javascript({ jsx: true, typescript: true })),
  L('Python', ['py', 'python'], python()),
  L('CSS', ['css', 'scss'], css()),
  L('HTML', ['html', 'htm', 'xml', 'svg'], html()),
  L('JSON', ['json', 'jsonc'], json()),
  L('YAML', ['yaml', 'yml'], yaml()),
  // LanguageDescription needs a LanguageSupport; a bare Language crashes the Markdown code-block parser
  L('Shell', ['sh', 'bash', 'zsh', 'shell', 'console'], new LanguageSupport(StreamLanguage.define(shell))),
];

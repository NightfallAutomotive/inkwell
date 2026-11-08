<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="static/brand/wordmark-dark.svg">
    <img src="static/brand/wordmark-light.svg" alt="Inkwell" width="300">
  </picture>
</h1>

A personal Markdown notes app that runs locally. Notes are plain `.md` files in a folder (the vault), so they work with git, Syncthing or any other editor.

- **Server:** `server.py`, Python 3 standard library only, nothing to install. Listens on 127.0.0.1 only.
- **UI:** `static/` (`js/` holds the app code). Everything it needs is bundled in `static/vendor/`, so it works offline: marked 12.0.2, DOMPurify 3.1.6, and a CodeMirror 6 build for the editor. To rebuild that bundle, run `python3 tools/build_codemirror.py` (no Node needed; the versions are pinned in `tools/codemirror.lock.json`).

## Run

```bash
./inkwell.sh            # vault = ~/Notes (created with a Welcome note if empty)
./inkwell.sh ~/MyVault  # any folder
python3 server.py --port 9000 --no-browser
```

Then open <http://127.0.0.1:8473/>. Running it again while it's already up just opens the tab.

App-menu entry (optional): `cp inkwell.desktop ~/.local/share/applications/`

## Features

- **Editor:** live preview renders Markdown as you type and shows the raw syntax only where your cursor is. Source mode shows plain Markdown and Reading view shows the rendered note. Each tab remembers its own mode.
- **Tabs and split panes:** open notes in tabs, split panes side by side, drag tabs to reorder them or move them between panes, and resize panes. Your layout is restored when you reopen Inkwell.
- **Properties:** frontmatter appears as an editable panel of text, list, number, checkbox and date fields. Tags show as chips. Source mode still shows the raw YAML.
- **Bookmarks:** bookmark notes (☆ in the header, or `Alt+B`), searches and headings. They are saved in `<vault>/.inkwell/bookmarks.json`.
- **HTML:** raw HTML in a note renders like a web page in Live and Read modes, with its own CSS and JavaScript. Blank lines inside an element are fine, and a `<style>` block applies to the HTML right after it. Click into the block, or use its **Edit HTML** button, to see the source. Each block runs in a sandboxed frame, so its scripts can't reach Inkwell or your other notes and its CSS can't restyle the app. Short inline tags like `<kbd>`, `<sub>` or `<span style="…">` render in place.
- **Slash commands:** type `/` for headings, lists, tasks, callouts, tables, code blocks, links, dates, templates and every palette command.
- **File recovery:** before a note is changed, Inkwell saves a copy in `<vault>/.inkwell/snapshots/`, at most one every 5 minutes, kept for 14 days. The recovery window shows what changed and can restore any copy.
- **Note composer:** merge one note into another (links to it are updated), or extract the selected text into a new note that is linked from where it was.
- File tree with folders, drag-and-drop moves, right-click menu, and sorting by name, modified or created date
- `[[Wikilinks]]`, `[[Note#Heading]]`, `[[Note|alias]]` and `![[embeds]]` for notes and images, with autocomplete for notes and headings
- Renaming a note rewrites `[[links]]` to it across the vault
- Clicking an unresolved link creates that note. `Ctrl`+click or middle-click opens a link in a new tab
- Backlinks, unlinked mentions (with a one-click **Link** button), outgoing links, outline and a local graph
- Graph view: drag, zoom, filter, and toggle orphans, tags and unresolved links
- `#tags` (including nested `#a/b`) and frontmatter `tags:`, a tag pane, and `tag:`/`path:` search
- Full-text search, plus `Ctrl+F` to find within a note
- Daily notes in `Daily/YYYY-MM-DD.md`, using `Templates/Daily.md` if it exists; `{{date}}`, `{{time}}` and `{{title}}` are filled in
- Insert any template from `Templates/`
- Checkboxes, callouts (`> [!tip] Title`), `==highlight==`, tables and syntax-highlighted code blocks
- Pasting or dropping an image saves it to `attachments/`
- Autosave, plus a warning if the file changed on disk while you were editing it
- Deletes go to `<vault>/.trash/`
- Nord light and dark themes; sidebars can be resized

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+P | Command palette |
| Ctrl+O | Quick switcher (Shift+Enter creates a note, Ctrl+Enter opens it in a new tab) |
| Alt+N | New note |
| Alt+D | Today's daily note |
| Ctrl+E | Toggle Reading view |
| Ctrl+Shift+E | Switch live preview / source mode |
| Alt+T / Alt+W | New tab / close tab |
| Alt+Shift+T | Reopen closed tab |
| Alt+[ / Alt+] | Previous / next tab |
| Alt+1…9 | Go to tab 1–8, or the last tab |
| Alt+\\ | Split right |
| Alt+. | Focus the next pane |
| Alt+B | Bookmark the current note |
| Ctrl+G | Graph |
| Ctrl+Shift+F | Search all notes |
| Ctrl+F | Find in note |
| Ctrl+B / Ctrl+I / Ctrl+K | Bold / italic / Markdown link |
| Ctrl+Shift+H | Highlight |
| Ctrl+L | Cycle checklist item |
| Alt+← / Alt+→ | Back / forward |
| Ctrl+\\ | Toggle sidebar |

Tab shortcuts use Alt because browsers keep Ctrl+T and Ctrl+W for themselves.

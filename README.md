# Inkwell

A personal Markdown notes app that runs locally. Notes are plain `.md` files in a folder (the vault), so they work with git, Syncthing or any other editor.

- **Server:** `server.py`, Python 3 standard library only, nothing to install. Listens on 127.0.0.1 only.
- **UI:** `static/`. The Markdown and sanitiser libraries (marked 12.0.2, DOMPurify 3.1.6) are bundled in `static/vendor/`, so it works offline.

## Run

```bash
./inkwell.sh            # vault = ~/Notes (created with a Welcome note if empty)
./inkwell.sh ~/MyVault  # any folder
python3 server.py --port 9000 --no-browser
```

Then open <http://127.0.0.1:8473/>. Running it again while it's already up just opens the tab.

App-menu entry (optional): `cp inkwell.desktop ~/.local/share/applications/`

## Features

- File tree with folders, drag-and-drop moves, right-click menu, and sorting by name, modified or created date
- Editor with live preview: Edit, Split or Read mode
- `[[Wikilinks]]`, `[[Note#Heading]]`, `[[Note|alias]]` and `![[embeds]]` for notes and images, with autocomplete when you type `[[`
- Renaming a note rewrites `[[links]]` to it across the vault
- Clicking an unresolved link creates that note
- Backlinks, unlinked mentions (with a one-click **Link** button), outgoing links, outline and a local graph
- Graph view: drag, zoom, filter, and toggle orphans, tags and unresolved links
- `#tags` (including nested `#a/b`) and frontmatter `tags:`, a tag pane, and `tag:`/`path:` search
- Full-text search
- Daily notes in `Daily/YYYY-MM-DD.md`, using `Templates/Daily.md` if it exists; `{{date}}`, `{{time}}` and `{{title}}` are filled in
- Insert any template from `Templates/`
- Checkboxes you can click in preview, callouts (`> [!tip] Title`), `==highlight==`
- Pasting or dropping an image saves it to `attachments/`
- Autosave, plus a warning if the file changed on disk while you were editing it
- Deletes go to `<vault>/.trash/`
- Light and dark themes; sidebars can be resized

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+P | Command palette |
| Ctrl+O | Quick switcher (Shift+Enter creates a note) |
| Alt+N | New note |
| Alt+D | Today's daily note |
| Ctrl+E / Ctrl+Shift+E | Toggle reading mode / split view |
| Ctrl+G | Graph |
| Ctrl+Shift+F | Search |
| Ctrl+B / Ctrl+I / Ctrl+K | Bold / italic / Markdown link |
| Ctrl+L | Cycle checklist item |
| Alt+← / Alt+→ | Back / forward |
| Ctrl+\\ | Toggle sidebar |

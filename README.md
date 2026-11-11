<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="static/brand/wordmark-dark.svg">
    <img src="static/brand/wordmark-light.svg" alt="Inkwell" width="300">
  </picture>
</h1>

A personal Markdown notes app that runs locally. Notes are plain `.md` files in a folder (the vault), so they work with git, Syncthing or any other editor.

- **Server:** `server.py`, Python 3 standard library only, nothing to install. It listens on 127.0.0.1 unless you set a password and choose otherwise.
- **UI:** `static/` (`js/` holds the app code). Everything it needs is bundled in `static/vendor/`, so it works offline: marked 12.0.2, DOMPurify 3.1.6, and a CodeMirror 6 build for the editor. To rebuild that bundle, run `python3 tools/build_codemirror.py` (no Node needed; the versions are pinned in `tools/codemirror.lock.json`).

## Install

```bash
git clone https://github.com/NightfallAutomotive/inkwell.git
cd inkwell
./install.sh                    # or: ./install.sh --vault ~/MyNotes --service
```

Run it from a normal terminal, not one built into a Flatpak app such as a code editor. This installs Inkwell for your user (no root needed): the app goes in `~/.local/share/inkwell`, the `inkwell` command in `~/.local/bin`, and an entry with its icon in your app menu. It opens in its own window when Chromium, Chrome, Brave, Edge or Vivaldi is installed (normal or Flatpak), and in a browser tab otherwise.

- `--vault DIR` sets the notes folder (default `~/Notes`).
- `--service` starts Inkwell in the background whenever you log in.
- To update, run `git pull && ./install.sh`. A running Inkwell is replaced by the new version the next time you open it.
- To remove Inkwell, run `./install.sh --uninstall`. Your notes and settings stay.

In Chrome or Edge you can also use **Install Inkwell** in the address bar to get a standalone app window.

### As an AppImage

To make a single file that runs on most Linux desktops with nothing to install:

```bash
python3 tools/build_appimage.py      # makes dist/Inkwell-<version>-x86_64.AppImage
```

The AppImage bundles its own Python, so the computer running it doesn't need one. It opens Inkwell in a Chromium-family app window if one is installed, otherwise in a browser tab. To run it, make it executable (`chmod +x Inkwell-*.AppImage`) and double-click it. Gear Lever or AppImageLauncher can add it to the app menu. Settings and notes are the same as the `install.sh` version (`~/.config/inkwell`, `~/Notes`).

### As a Flatpak

Inkwell can also be built as a Flatpak that runs in its own window and shows up in GNOME Software. See [flatpak/README.md](flatpak/README.md).

### Command line

```bash
inkwell                  # start (or switch to) Inkwell
inkwell ~/OtherVault     # open a different vault
inkwell --open tab       # in a browser tab instead of an app window (or: none)
inkwell --set-vault DIR  # change the default vault (or use ⚙ Settings → Notes folder)
inkwell --set-password   # require a password (needed for online use)
inkwell --help
```

Settings are kept in `~/.config/inkwell/config.json`. To run Inkwell without installing, use `python3 server.py` from this folder.

## Use it online

Inkwell can be reached from your phone or anywhere else once it has a password and a way in, such as Tailscale, Cloudflare Tunnel or your own domain. [docs/online.md](docs/online.md) has the step-by-step guide.

## Features

New to Inkwell? Open **⚙ Settings → Open the guide** for a how-to note covering everything below, with working examples.

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
- **Settings** (⚙ in the left bar, or `Ctrl+,`): note text size and font, sidebar text size, theme (dark, light or match system), accent colour, and custom background and text colours for each theme. They are saved per browser.

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
| Ctrl+, | Settings |

Tab shortcuts use Alt because browsers keep Ctrl+T and Ctrl+W for themselves.

## Problems and licence

To report a bug, email robert@nightfallautomotive.co.uk (see [SUPPORT.md](SUPPORT.md)).

Inkwell is MIT licensed (see [LICENSE](LICENSE)). The bundled components and their licences are listed in [licenses/](licenses/README.md).

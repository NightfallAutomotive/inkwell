---
guide-version: 2
tags:
  - inkwell
---
# How to use Inkwell

Everything below is a working example. Switch this note to **Source** mode (top right of the note) to see exactly what was typed to make each thing, or just put your cursor on a line in **Live** mode to reveal it.

> [!tip] Quickest way in
> Type `/` anywhere in a note to get a menu of everything you can insert, or press `Ctrl+P` for every command in the app.

## Notes and folders

- **New note:** `Alt+N`, the ✚ button, or right-click in the file list.
- **Rename:** click the big title at the top of a note and type. Links to it elsewhere update by themselves.
- **Move:** drag a note onto a folder in the file list.
- **Delete:** right-click → Delete. It goes to the `.trash` folder in your vault, not gone for good.
- **Find a note fast:** `Ctrl+O`, start typing, Enter. `Shift+Enter` creates a note with that name.

Your notes are plain `.md` files in your vault folder, so you can back them up, sync them or open them in any editor.

## Tick boxes

Type a dash, a space, then `[ ]` and a space:

- [ ] This is a tick box, click it
- [x] This one is already ticked
- [ ] Press `Ctrl+L` on any line to turn it into a tick box, tick it, or remove it

After a tick box line, pressing Enter starts another one. Press Enter on an empty one to stop.

## Text styles

| Type this | To get |
| --- | --- |
| `**bold**` | **bold** (or `Ctrl+B`) |
| `*italic*` | *italic* (or `Ctrl+I`) |
| `==highlight==` | ==highlight== (or `Ctrl+Shift+H`) |
| `~~crossed out~~` | ~~crossed out~~ |
| `` `code` `` | `code` |

## Headings and lists

Start a line with `#` and a space for a big heading, `##` for a smaller one, down to `######`. Headings appear in the **Outline** in the right panel, so you can jump around long notes.

- A dash and a space starts a bullet list
	- Press `Tab` to indent, `Shift+Tab` to go back
1. A number, full stop and space starts a numbered list
2. Enter carries the list on for you

> A line starting with `>` is a quote.

---

Three dashes on their own line make a divider, like the one above.

## Links between notes

Type `[[` and pick a note from the list, like this link back to [[Welcome]].

- `[[Note name]]` links to a note. If it doesn't exist yet, clicking it creates it.
- `[[Note name#Heading]]` links to a heading inside a note.
- `[[Note name|other words]]` shows *other words* but still links to the note.
- `Ctrl`+click (or middle-click) a link to open it in a new tab.
- Hover over a link for a moment to preview the note.

The **Backlinks** panel on the right shows every note that links to the one you're reading. **Unlinked mentions** finds notes that mention this one by name without linking, with a one-click **Link** button.

## Tags

Write `#` followed by a word anywhere, like #inkwell or #ideas/cars. Click a tag to see every note that has it. The **Tags** tab on the left lists them all. A `/` makes nested tags such as #ideas/cars.

## Properties

The panel at the very top of this note is **Properties**. Use them for things like status, dates or ratings.

- Add one with `/add property`, or the ⋯ menu → Add property.
- Click the icon beside a property to change its type: text, list, number, tick box or date.
- Properties called `tags` work as tags.

In Source mode they show as the lines between `---` at the top of the note.

## Callouts

Start a quote with `[!type]` to make a coloured box:

> [!note] Note
> Blue, for general notes.

> [!warning] Warning
> Orange, for things to be careful of.

> [!danger] Danger
> Red. There's also `[!tip]` (green), `[!question]` (yellow) and `[!example]` (purple).

## Tables

| Part | Qty | Price |
| --- | --- | --- |
| Turbo hose | 1 | £24.99 |
| Clamps | 4 | £3.20 |

Type `/table` to start one. Put your cursor in a table to edit it.

## Code

Three backticks and a language name start a code block with colours:

```python
def hello():
    print("Hello from Inkwell")
```

## Pictures and embeds

- Paste or drag a picture into a note. It's saved to the `attachments` folder.
- `![[picture.png]]` shows a picture from your vault. `![[picture.png|300]]` makes it 300 pixels wide.
- `![[Note name]]` shows a whole other note inside this one.

## HTML

Raw HTML shows as it would on a website, with its own styles and scripts:

<div style="padding:14px 18px;border-radius:10px;background:linear-gradient(135deg,#5e81ac,#88c0d0);color:#fff;font-family:sans-serif">
  <b>This box is HTML.</b> Click into it, or use its <b>Edit HTML</b> button, to see the code.
</div>

Each HTML block runs in a sealed box, so its scripts can't touch your other notes.

## Live, Source and Read

The three buttons at the top right of every note:

- **Live** shows formatting as you type and reveals the codes on the line you're editing.
- **Source** shows everything as plain text.
- **Read** shows the finished note, with nothing to edit by accident.

`Ctrl+E` switches to Read and back. `Ctrl+Shift+E` switches between Live and Source.

## Tabs and side by side

- `Alt+T` opens a new tab and `Alt+W` closes one. `Alt+Shift+T` brings back the last one you closed.
- `Alt+[` and `Alt+]` move between tabs, and `Alt+1` to `Alt+9` jump straight to one.
- `Alt+\` (or ⋯ → Split right) puts two notes side by side. Drag tabs between the sides, and drag the line between them to resize.
- If the same note is open twice, both copies update as you type.

Inkwell remembers your tabs when you close it.

## Bookmarks

Click the ☆ at the top of a note (or press `Alt+B`) to bookmark it. Bookmarks appear in the **Bookmarks** tab on the left. You can also bookmark a search (☆ beside the search box) or a heading (right-click it in the Outline). Drag bookmarks to reorder them.

## Search

`Ctrl+Shift+F` searches every note. Also try:

- `tag:ideas` for notes with a tag
- `path:Daily` for notes in a folder

`Ctrl+F` finds text inside the note you're in.

## Daily notes and templates

- `Alt+D` opens today's note in the `Daily` folder, creating it if needed.
- Put notes in a folder called `Templates` and insert them with `/insert template`. In a template, `{{date}}`, `{{time}}` and `{{title}}` are filled in for you.
- A template called `Templates/Daily` is used for every new daily note.

## Graph

`Ctrl+G` shows how all your notes link together. Scroll to zoom, drag to move around, and click a dot to open that note. The **Local graph** in the right panel shows just the notes around the one you're in.

## Getting things back

- **Undo:** `Ctrl+Z`.
- **File recovery:** ⋯ → File recovery shows earlier versions of a note with the changes highlighted. Inkwell keeps a copy before a note changes (at most every 5 minutes) for 14 days.
- **Deleted notes** are in the `.trash` folder inside your vault.

## Tidying up notes

- **Extract:** select some text, then ⋯ → Extract selection to new note. It moves into its own note and leaves a link behind.
- **Merge:** ⋯ → Merge into another note adds this note to the end of another, points every link at it, and moves this one to `.trash`.

## Settings

The ⚙ button on the far left (or `Ctrl+,`) changes text size, the note font, sidebar text size, dark or light theme, the accent colour, and your own background and text colours. ◐ flips quickly between dark and light.

## Using Inkwell on your phone or online

Inkwell can be reached from your phone, a laptop or anywhere else. Set a password with `inkwell --set-password`, then follow the step-by-step guide in `docs/online.md` (in the Inkwell folder, or on GitHub). Tailscale is the easiest and most private way. Once it's working, use your phone browser's *Add to Home screen* for an app icon.

## All the shortcuts

| Keys | What it does |
| --- | --- |
| `Ctrl+P` | Every command |
| `Ctrl+O` | Find or create a note |
| `Alt+N` | New note |
| `Alt+D` | Today's daily note |
| `Ctrl+E` | Read mode on and off |
| `Ctrl+Shift+E` | Live and Source |
| `Alt+T` / `Alt+W` | New tab / close tab |
| `Alt+\` | Side by side |
| `Alt+B` | Bookmark this note |
| `Ctrl+G` | Graph |
| `Ctrl+Shift+F` | Search all notes |
| `Ctrl+F` | Find in this note |
| `Ctrl+B` / `Ctrl+I` | Bold / italic |
| `Ctrl+K` | Insert a web link |
| `Ctrl+L` | Tick box on this line |
| `Alt+←` / `Alt+→` | Back / forward |
| `Ctrl+\` | Show or hide the file list |
| `Ctrl+,` | Settings |

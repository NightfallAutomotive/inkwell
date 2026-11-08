#!/usr/bin/env python3
"""Inkwell — a local, folder-based Markdown notes app.

Usage:  python3 server.py [VAULT_DIR] [--port 8473] [--no-browser]
Notes are plain .md files inside VAULT_DIR (default ~/Notes).
Binds to 127.0.0.1 only.
"""
import argparse
import json
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
VAULT: Path = Path.home() / "Notes"
TRASH = ".trash"
IGNORED = {".trash", ".git", ".obsidian", ".inkwell", "node_modules", ".stfolder"}
WRITE_LOCK = threading.Lock()

WIKILINK_RE = re.compile(r"!?\[\[([^\[\]|#\n]*)(#[^\[\]|\n]*)?(\|[^\[\]\n]*)?\]\]")
TAG_RE = re.compile(r"(?:^|(?<=\s))#([A-Za-z0-9_\-/]*[A-Za-z_\-/][A-Za-z0-9_\-/]*)")
FENCE_RE = re.compile(r"^(```|~~~).*?^\1", re.S | re.M)
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
HTML_CODE_RE = re.compile(r"<(style|script)\b.*?</\1\s*>|<!--.*?-->|<[a-zA-Z/][^>\n]*>", re.S | re.I)
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)
META = ".inkwell"                  # per-vault app data (bookmarks, snapshots)
SNAP_INTERVAL = 5 * 60             # at most one automatic snapshot per note per 5 minutes
SNAP_KEEP_DAYS = 14
SNAP_MAX = 100                     # per note
CONFIG_NAMES = {"bookmarks"}


# ---------------------------------------------------------------- helpers
def safe_path(rel: str) -> Path:
    """Resolve a vault-relative path, refusing anything outside the vault."""
    rel = (rel or "").replace("\\", "/").lstrip("/")
    p = (VAULT / rel).resolve()
    if p != VAULT and VAULT not in p.parents:
        raise PermissionError("path escapes vault")
    return p


def rel_of(p: Path) -> str:
    return p.relative_to(VAULT).as_posix()


def strip_code(text: str) -> str:
    text = FENCE_RE.sub("", text)
    text = HTML_CODE_RE.sub(" ", text)  # CSS colours like #5e81ac aren't tags
    return INLINE_CODE_RE.sub("", text)


def frontmatter_tags(text: str):
    m = FRONTMATTER_RE.match(text)
    if not m:
        return []
    tags = []
    lines = m.group(1).splitlines()
    for i, line in enumerate(lines):
        mm = re.match(r"^tags?:\s*(.*)$", line)
        if not mm:
            continue
        val = mm.group(1).strip()
        if val.startswith("["):
            tags += [t.strip(" '\"#") for t in val.strip("[]").split(",")]
        elif val:
            tags += [t.strip(" '\"#") for t in re.split(r"[,\s]+", val)]
        else:
            for nxt in lines[i + 1:]:
                m2 = re.match(r"^\s*-\s*(.+)$", nxt)
                if not m2:
                    break
                tags.append(m2.group(1).strip(" '\"#"))
    return [t for t in tags if t]


def analyse(text: str):
    body = strip_code(text)
    links = []
    for m in WIKILINK_RE.finditer(body):
        target = m.group(1).strip()
        if target:
            links.append(target)
    md_links = re.findall(r"\]\(([^)\s]+\.md)\)", body)
    links += [l.replace("%20", " ") for l in md_links if "://" not in l]
    fm = FRONTMATTER_RE.match(body)
    tag_body = body[fm.end():] if fm else body
    tags = set(t.lower() for t in TAG_RE.findall(tag_body))
    tags |= set(t.lower() for t in frontmatter_tags(text))
    return links, sorted(tags)


def walk_vault():
    notes, folders, files = [], [], []
    for root, dirs, fnames in os.walk(VAULT):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED and not d.startswith("."))
        rp = Path(root)
        if rp != VAULT:
            folders.append(rel_of(rp))
        for f in sorted(fnames):
            if f.startswith("."):
                continue
            p = rp / f
            (notes if f.lower().endswith(".md") else files).append(p)
    return notes, folders, files


def build_index():
    notes, folders, files = walk_vault()
    out = []
    for p in notes:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
            st = p.stat()
        except OSError:
            continue
        links, tags = analyse(text)
        out.append({
            "path": rel_of(p),
            "mtime": st.st_mtime,
            "ctime": getattr(st, "st_birthtime", st.st_ctime),
            "size": st.st_size,
            "links": links,
            "tags": tags,
        })
    return {
        "vault": str(VAULT),
        "notes": out,
        "folders": folders,
        "files": [rel_of(p) for p in files],
    }


def search(q: str, limit=200):
    q = q.strip()
    if not q:
        return []
    terms = [t.lower() for t in q.split()]
    notes, _, _ = walk_vault()
    results = []
    for p in notes:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = rel_of(p)
        low = text.lower()
        name_low = rel.lower()
        if not all(t in low or t in name_low for t in terms):
            continue
        score = sum(5 for t in terms if t in name_low)
        snippets = []
        for line_no, line in enumerate(text.splitlines()):
            ll = line.lower()
            if any(t in ll for t in terms):
                snippets.append({"line": line_no, "text": line.strip()[:240]})
                score += 1
                if len(snippets) >= 5:
                    break
        results.append({"path": rel, "score": score, "snippets": snippets})
    results.sort(key=lambda r: -r["score"])
    return results[:limit]


# ---------------------------------------------------------------- snapshots
def snap_dir(rel: str) -> Path:
    return VAULT / META / "snapshots" / rel


def snapshot(p: Path, text=None, force=False):
    """Save a copy of note `p` (its current content, or `text`) for file recovery.

    Skipped when the newest snapshot is under SNAP_INTERVAL old (unless forced) or identical.
    """
    try:
        if text is None:
            if not p.is_file():
                return
            text = p.read_text(encoding="utf-8", errors="replace")
        d = snap_dir(rel_of(p))
        snaps = sorted(d.glob("*.md")) if d.is_dir() else []
        if snaps:
            newest = snaps[-1]
            if not force and time.time() - newest.stat().st_mtime < SNAP_INTERVAL:
                return
            if newest.read_text(encoding="utf-8", errors="replace") == text:
                return
        if not text.strip():
            return
        d.mkdir(parents=True, exist_ok=True)
        name = time.strftime("%Y%m%d-%H%M%S")
        target, i = d / f"{name}.md", 1
        while target.exists():
            target, i = d / f"{name}-{i}.md", i + 1
        target.write_text(text, encoding="utf-8")
        snaps.append(target)
        cutoff = time.time() - SNAP_KEEP_DAYS * 86400
        for old in snaps[:-1]:
            if old.stat().st_mtime < cutoff or len(snaps) > SNAP_MAX:
                old.unlink(missing_ok=True)
                snaps.remove(old)
    except OSError:
        pass  # recovery is best-effort; never block a save


def list_snapshots(rel: str):
    d = snap_dir(rel)
    out = []
    if d.is_dir():
        for f in sorted(d.glob("*.md"), reverse=True):
            st = f.stat()
            out.append({"id": f.stem, "time": st.st_mtime, "size": st.st_size})
    return out


def move_snapshots(src_rel: str, dst_rel: str):
    s, d = snap_dir(src_rel), snap_dir(dst_rel)
    if s.exists() and not d.exists():
        d.parent.mkdir(parents=True, exist_ok=True)
        os.rename(s, d)


def rewrite_links(old_name: str, new_name: str):
    """Update [[old_name...]] references across the vault after a rename."""
    pat = re.compile(r"(!?\[\[)" + re.escape(old_name) + r"((?:#[^\[\]|\n]*)?(?:\|[^\[\]\n]*)?\]\])", re.I)
    changed = 0
    notes, _, _ = walk_vault()
    for p in notes:
        try:
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        new_text, n = pat.subn(lambda m: m.group(1) + new_name + m.group(2), text)
        if n:
            snapshot(p, text)
            p.write_text(new_text, encoding="utf-8")
            changed += 1
    return changed


def link_name(rel: str) -> str:
    """The name used in a wikilink: basename without .md."""
    name = rel.rsplit("/", 1)[-1]
    return name[:-3] if name.lower().endswith(".md") else name


# ---------------------------------------------------------------- handler
class Handler(BaseHTTPRequestHandler):
    server_version = "Inkwell/1.0"

    def log_message(self, fmt, *args):  # quieter console
        if os.environ.get("INKWELL_DEBUG"):
            super().log_message(fmt, *args)

    # -- response helpers
    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, p: Path, cache=False):
        if not p.is_file():
            return self.send_json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        data = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=3600" if cache else "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def check_origin(self):
        """Block cross-site writes: only same-origin browser requests may mutate."""
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        host = self.headers.get("Host", "")
        return urlparse(origin).netloc == host

    def route(self, method):
        url = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(url.query).items()}
        path = url.path
        try:
            hostname = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            if hostname not in ("127.0.0.1", "localhost", "::1"):
                return self.send_json({"error": "bad host"}, 403)  # DNS-rebinding guard
            if method != "GET" and not self.check_origin():
                return self.send_json({"error": "bad origin"}, 403)
            if path.startswith("/api/"):
                return self.api(method, path[5:], qs)
            if method != "GET":
                return self.send_json({"error": "method"}, 405)
            if path.startswith("/vault/"):
                from urllib.parse import unquote
                return self.send_file(safe_path(unquote(path[7:])))
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            p = (STATIC_DIR / rel).resolve()
            if STATIC_DIR not in p.parents:
                return self.send_json({"error": "not found"}, 404)
            return self.send_file(p, cache="/vendor/" in path)
        except PermissionError as e:
            return self.send_json({"error": str(e)}, 403)
        except FileNotFoundError as e:
            return self.send_json({"error": f"not found: {e.filename or ''}"}, 404)
        except FileExistsError as e:
            return self.send_json({"error": f"already exists: {e.filename or ''}"}, 409)
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": f"{type(e).__name__}: {e}"}, 500)

    def api(self, method, ep, qs):
        if ep == "ping" and method == "GET":
            return self.send_json({"app": "inkwell", "vault": str(VAULT)})

        if ep == "index" and method == "GET":
            return self.send_json(build_index())

        if ep == "search" and method == "GET":
            return self.send_json(search(qs.get("q", "")))

        if ep == "note":
            p = safe_path(qs.get("path", ""))
            if method == "GET":
                text = p.read_text(encoding="utf-8", errors="replace")
                return self.send_json({"path": rel_of(p), "content": text, "mtime": p.stat().st_mtime})
            if method == "PUT":
                body = self.body_json()
                with WRITE_LOCK:
                    if body.get("create") and p.exists():
                        raise FileExistsError(rel_of(p))
                    base = body.get("baseMtime")
                    if base and p.exists() and abs(p.stat().st_mtime - base) > 0.001 and not body.get("force"):
                        return self.send_json({"error": "conflict", "mtime": p.stat().st_mtime}, 409)
                    if p.is_file():
                        snapshot(p, force=bool(body.get("snapshot")))
                    p.parent.mkdir(parents=True, exist_ok=True)
                    tmp = p.with_name(f".{p.name}.inkwell-tmp")
                    tmp.write_text(body.get("content", ""), encoding="utf-8")
                    os.replace(tmp, p)
                return self.send_json({"ok": True, "path": rel_of(p), "mtime": p.stat().st_mtime})
            if method == "DELETE":
                return self.send_json(self.trash(p))

        if ep == "delete" and method == "POST":
            return self.send_json(self.trash(safe_path(self.body_json().get("path", ""))))

        if ep == "folder" and method == "POST":
            p = safe_path(self.body_json().get("path", ""))
            p.mkdir(parents=True, exist_ok=True)
            return self.send_json({"ok": True})

        if ep == "rename" and method == "POST":
            body = self.body_json()
            src, dst = safe_path(body["from"]), safe_path(body["to"])
            if src == VAULT or dst == VAULT:
                raise PermissionError("cannot rename vault root")
            if dst.exists() and dst.resolve() != src.resolve() and src.as_posix().lower() != dst.as_posix().lower():
                raise FileExistsError(rel_of(dst))
            with WRITE_LOCK:
                dst.parent.mkdir(parents=True, exist_ok=True)
                os.rename(src, dst)
                move_snapshots(body["from"].strip("/"), rel_of(dst))
                updated = 0
                if body.get("updateLinks", True) and dst.is_file():
                    old, new = link_name(body["from"]), link_name(rel_of(dst))
                    if old != new:
                        updated = rewrite_links(old, new)
            return self.send_json({"ok": True, "path": rel_of(dst), "linksUpdated": updated})

        if ep == "relink" and method == "POST":
            # point [[links]] at note `from` to note `to` instead (used by "merge notes")
            body = self.body_json()
            old, new = link_name(body["from"]), link_name(body["to"])
            with WRITE_LOCK:
                updated = rewrite_links(old, new) if old != new else 0
            return self.send_json({"ok": True, "linksUpdated": updated})

        if ep == "snapshots" and method == "GET":
            return self.send_json(list_snapshots(rel_of(safe_path(qs.get("path", "")))))

        if ep == "snapshot" and method == "GET":
            rel = rel_of(safe_path(qs.get("path", "")))
            sid = qs.get("id", "")
            if not re.fullmatch(r"[0-9]{8}-[0-9]{6}(-[0-9]+)?", sid):
                raise PermissionError("bad snapshot id")
            f = snap_dir(rel) / f"{sid}.md"
            return self.send_json({"id": sid, "time": f.stat().st_mtime, "content": f.read_text(encoding="utf-8", errors="replace")})

        if ep.startswith("config/"):
            name = ep[7:]
            if name not in CONFIG_NAMES:
                return self.send_json({"error": "unknown config"}, 404)
            f = VAULT / META / f"{name}.json"
            if method == "GET":
                return self.send_json(json.loads(f.read_text(encoding="utf-8")) if f.is_file() else None)
            if method == "PUT":
                data = self.body_json()
                with WRITE_LOCK:
                    f.parent.mkdir(parents=True, exist_ok=True)
                    tmp = f.with_name(f".{f.name}.tmp")
                    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
                    os.replace(tmp, f)
                return self.send_json({"ok": True})

        if ep == "upload" and method == "POST":
            # raw bytes body, ?path=attachments/name.png
            p = safe_path(qs.get("path", ""))
            stem, suf, i = p.stem, p.suffix, 1
            while p.exists():
                p = p.with_name(f"{stem}-{i}{suf}")
                i += 1
            p.parent.mkdir(parents=True, exist_ok=True)
            n = int(self.headers.get("Content-Length") or 0)
            p.write_bytes(self.rfile.read(n))
            return self.send_json({"ok": True, "path": rel_of(p)})

        return self.send_json({"error": f"unknown endpoint {method} {ep}"}, 404)

    def trash(self, p: Path):
        if p == VAULT:
            raise PermissionError("cannot delete vault root")
        dest_dir = VAULT / TRASH / time.strftime("%Y%m%d-%H%M%S")
        dest = dest_dir / rel_of(p)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(p), str(dest))
        return {"ok": True, "trashed": rel_of(dest)}

    def do_GET(self):
        self.route("GET")

    def do_PUT(self):
        self.route("PUT")

    def do_POST(self):
        self.route("POST")

    def do_DELETE(self):
        self.route("DELETE")


WELCOME = """# Welcome to Inkwell

Your notes are plain Markdown files in this folder:

`{vault}`

## Things to try
- Link notes with double brackets: [[Getting started]]
- Add tags like `#ideas` anywhere in a note
- `Alt+N` new note, `Ctrl+P` command palette, `Ctrl+O` quick switcher
- Type `/` in a note for formatting and commands
- `Ctrl+E` toggles reading view, `Ctrl+Shift+E` switches live preview / source
- `Alt+T` new tab, `Alt+\\` split right, `Ctrl+click` a link to open it in a new tab
- `Ctrl+G` opens the graph
- `Alt+D` opens today's daily note

- [ ] Click checkboxes to tick them off
- [x] Install Inkwell
"""

GETTING_STARTED = """# Getting started

This note is linked from [[Welcome]]. Check the **Backlinks** panel on the right.

Embed images with `![[picture.png]]` or paste an image straight into the editor;
it is saved to `attachments/`.

#inkwell #howto
"""


def is_inkwell(port: int) -> bool:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1.5) as r:
            return json.loads(r.read() or b"{}").get("app") == "inkwell"
    except Exception:  # noqa: BLE001
        return False


def main():
    global VAULT
    ap = argparse.ArgumentParser(description="Inkwell local notes")
    ap.add_argument("vault", nargs="?", default=os.environ.get("INKWELL_VAULT", str(Path.home() / "Notes")))
    ap.add_argument("--port", type=int, default=int(os.environ.get("INKWELL_PORT", 8473)))
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    VAULT = Path(args.vault).expanduser().resolve()
    fresh = not VAULT.exists() or not any(VAULT.iterdir())
    VAULT.mkdir(parents=True, exist_ok=True)
    if fresh:
        (VAULT / "Welcome.md").write_text(WELCOME.format(vault=VAULT), encoding="utf-8")
        (VAULT / "Getting started.md").write_text(GETTING_STARTED, encoding="utf-8")

    srv = None
    for port in range(args.port, args.port + 20):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            # Port taken: if it's Inkwell already, just open it; otherwise try the next port.
            if is_inkwell(port):
                url = f"http://127.0.0.1:{port}/"
                print(f"Inkwell already running at {url}")
                if not args.no_browser:
                    webbrowser.open(url)
                sys.exit(0)
            print(f"Port {port} is used by another app, trying {port + 1}")
    if srv is None:
        sys.exit(f"No free port in {args.port}-{args.port + 19}")
    url = f"http://127.0.0.1:{port}/"
    print(f"Inkwell serving vault {VAULT}\n  → {url}   (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()

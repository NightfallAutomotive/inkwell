#!/usr/bin/env python3
"""Inkwell — a local, folder-based Markdown notes app.

Usage:  python3 server.py [VAULT_DIR] [--port 8473] [--open window|tab|none]
        python3 server.py --set-password      (required before allowing access from other devices)
Notes are plain .md files inside VAULT_DIR (default ~/Notes, or "vault" in the config file).
Settings live in ~/.config/inkwell/config.json. Listens on 127.0.0.1 unless told otherwise.
"""
import argparse
import hashlib
import hmac
import json
import secrets
import subprocess
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
# Identifies this build, so a newer launch can replace an older server that is still running.
VERSION = __import__("hashlib").sha1((APP_DIR / "server.py").read_bytes()).hexdigest()[:12]
SERVER = None
CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "inkwell"
CONFIG_FILE = CONFIG_DIR / "config.json"
CONFIG: dict = {}
SESSION_DAYS = 30
COOKIE = "inkwell_session"
LOGIN_FAILS: list = []  # timestamps of recent failed logins


# ---------------------------------------------------------------- config & login
def load_config():
    global CONFIG
    try:
        CONFIG = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        CONFIG = {}
    return CONFIG


def save_config():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_FILE.with_name(".config.json.tmp")
    tmp.write_text(json.dumps(CONFIG, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONFIG_FILE)


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    n = 300_000
    return f"pbkdf2_sha256${n}${salt.hex()}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, n).hex()}"


def check_password(pw: str) -> bool:
    try:
        _, n, salt, digest = CONFIG["password"].split("$")
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(n)).hex()
        return hmac.compare_digest(got, digest)
    except (KeyError, ValueError):
        return False


def password_set() -> bool:
    return bool(CONFIG.get("password"))


def make_session() -> str:
    exp = str(int(time.time()) + SESSION_DAYS * 86400)
    sig = hmac.new(CONFIG["secret"].encode(), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def session_valid(token: str) -> bool:
    try:
        exp, sig = token.split(".", 1)
        good = hmac.new(CONFIG["secret"].encode(), exp.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, good) and int(exp) > time.time()
    except (KeyError, ValueError):
        return False


LOGIN_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Inkwell</title><link rel="icon" type="image/svg+xml" href="/brand/skull.svg"><link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#2e3440">
<style>
:root{color-scheme:dark;--bg:#2e3440;--bg2:#3b4252;--fg:#eceff4;--fg3:#8e9ab0;--accent:#88c0d0;--red:#bf616a}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#eceff4;--bg2:#e5e9f0;--fg:#2e3440;--fg3:#6b778d;--accent:#5e81ac}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;padding:0 16px}
form{width:min(340px,100%);display:grid;gap:14px}
img{width:220px;margin:0 auto 10px;display:block}
.l{display:none}@media (prefers-color-scheme:light){.d{display:none}.l{display:block}}
input{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--bg2);background:var(--bg2);color:var(--fg);outline:none}
input:focus{border-color:var(--accent)}
button{font:inherit;font-weight:600;padding:10px;border:0;border-radius:8px;background:var(--accent);color:var(--bg);cursor:pointer}
p{margin:0;min-height:1.5em;color:var(--red);font-size:13px;text-align:center}
</style></head><body>
<form id="f"><img class="d" src="/brand/wordmark-dark.svg" alt="Inkwell"><img class="l" src="/brand/wordmark-light.svg" alt="Inkwell">
<label for="pw" style="position:absolute;left:-9999px">Password</label>
<input id="pw" type="password" autocomplete="current-password" placeholder="Password" autofocus required>
<button>Sign in</button><p id="msg" role="alert"></p></form>
<script>
document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const m=document.getElementById('msg');m.textContent='';
const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
if(r.ok){location.href='/'+location.hash;return}const d=await r.json().catch(()=>({}));m.textContent=d.error||'Sign-in failed';};
</script></body></html>"""


# ---------------------------------------------------------------- opening a window
CHROMIUM_CMDS = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "brave-browser", "brave",
                 "microsoft-edge", "microsoft-edge-stable", "vivaldi", "vivaldi-stable"]
CHROMIUM_FLATPAKS = ["org.chromium.Chromium", "com.google.Chrome", "com.brave.Browser", "com.microsoft.Edge",
                     "com.vivaldi.Vivaldi", "io.github.ungoogled_software.ungoogled_chromium"]


def find_app_browser():
    """A command that opens a URL in a Chromium-style app window (no tabs or address bar), or None."""
    custom = os.environ.get("INKWELL_BROWSER") or CONFIG.get("browser")
    if custom:
        return custom.split()
    for c in CHROMIUM_CMDS:
        if shutil.which(c):
            return [c]
    if shutil.which("flatpak"):
        try:
            apps = subprocess.run(["flatpak", "list", "--app", "--columns=application"], capture_output=True, text=True, timeout=5).stdout.split()
        except (OSError, subprocess.SubprocessError):
            apps = []
        for a in CHROMIUM_FLATPAKS:
            if a in apps:
                return ["flatpak", "run", a]
    return None


def open_ui(url: str, how: str):
    if how == "none":
        return
    if how == "window":
        cmd = find_app_browser()
        if cmd:
            try:
                subprocess.Popen(cmd + [f"--app={url}", "--class=Inkwell"], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                return
            except OSError:
                pass
    webbrowser.open(url)
STATIC_DIR = APP_DIR / "static"
VAULT: Path = Path.home() / "Notes"
TRASH = ".trash"
IGNORED = {".trash", ".git", ".obsidian", ".inkwell", "node_modules", ".stfolder"}
WRITE_LOCK = threading.Lock()

WIKILINK_RE = re.compile(r"!?\[\[([^\[\]|#\n]*)(#[^\[\]|\n]*)?(\|[^\[\]\n]*)?\]\]")
TAG_RE = re.compile(r"(?:^|(?<=\s))#([A-Za-z0-9_\-/]*[A-Za-z_][A-Za-z0-9_\-/]*)")
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
        "vaultDisplay": "~/" + VAULT.relative_to(Path.home()).as_posix() if Path.home() in VAULT.parents else str(VAULT),
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
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def send_json(self, obj, status=200, headers=None):
        data = json.dumps(obj).encode()
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, p: Path, cache=False, sandbox=False):
        if not p.is_file():
            return self.send_json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if p.suffix == ".webmanifest":
            ctype = "application/manifest+json"
        data = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        if sandbox:  # a vault file opened directly (e.g. an .html attachment) can't act as the app
            self.send_header("Content-Security-Policy", "sandbox")
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

    def session_ok(self):
        if not password_set():
            return True
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE and session_valid(v):
                return True
        return False

    def local_cli(self):
        """A request straight from this machine that isn't a browser or a proxy (the launcher)."""
        return (self.client_address[0] in ("127.0.0.1", "::1") and not self.headers.get("Origin")
                and not self.headers.get("X-Forwarded-For") and not self.headers.get("Forwarded"))

    def cookie_header(self, value, max_age):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
        return f"{COOKIE}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}"

    def route(self, method):
        url = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(url.query).items()}
        path = url.path
        try:
            hostname = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            if not password_set() and hostname not in ("127.0.0.1", "localhost", "::1"):
                # DNS-rebinding guard. With a password set, any address is fine: the login protects it.
                return self.send_json({"error": "Inkwell only answers on localhost until a password is set (run: inkwell --set-password)"}, 403)
            if method != "GET" and not self.check_origin():
                return self.send_json({"error": "bad origin"}, 403)
            public = path in ("/login", "/api/login", "/api/ping", "/manifest.webmanifest") or path.startswith("/brand/")
            if not public and not self.session_ok() and not (path == "/api/shutdown" and self.local_cli()):
                if path.startswith("/api/"):
                    return self.send_json({"error": "signed out"}, 401)
                self.send_response(302)
                self.send_header("Location", "/login")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if path == "/login" and method == "GET":
                if password_set() and self.session_ok():
                    self.send_response(302); self.send_header("Location", "/"); self.send_header("Content-Length", "0"); self.end_headers()
                    return
                data = LOGIN_PAGE.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
                return
            if path.startswith("/api/"):
                return self.api(method, path[5:], qs)
            if method != "GET":
                return self.send_json({"error": "method"}, 405)
            if path.startswith("/vault/"):
                from urllib.parse import unquote
                return self.send_file(safe_path(unquote(path[7:])), sandbox=True)
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            p = (STATIC_DIR / rel).resolve()
            if STATIC_DIR not in p.parents:
                return self.send_json({"error": "not found"}, 404)
            return self.send_file(p, cache="/vendor/" in path or "/brand/" in path)
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
            d = {"app": "inkwell", "version": VERSION, "auth": password_set()}
            if self.session_ok():
                d["vault"] = str(VAULT)
            return self.send_json(d)

        if ep == "login" and method == "POST":
            now = time.time()
            LOGIN_FAILS[:] = [t for t in LOGIN_FAILS if now - t < 600]
            if len(LOGIN_FAILS) >= 20:
                return self.send_json({"error": "Too many wrong passwords. Wait 10 minutes and try again."}, 429)
            if not password_set():
                return self.send_json({"ok": True})
            if check_password(str(self.body_json().get("password", ""))):
                return self.send_json({"ok": True}, headers={"Set-Cookie": self.cookie_header(make_session(), SESSION_DAYS * 86400)})
            LOGIN_FAILS.append(now)
            time.sleep(1.5)
            return self.send_json({"error": "Wrong password"}, 403)

        if ep == "logout" and method == "POST":
            return self.send_json({"ok": True}, headers={"Set-Cookie": self.cookie_header("", 0)})

        if ep == "shutdown" and method == "POST":
            # used by a newer launch to replace this server; same-origin/CLI only (see route())
            self.send_json({"ok": True})
            threading.Thread(target=SERVER.shutdown, daemon=True).start()
            return

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


GETTING_STARTED = """# Getting started

Your notes are plain Markdown files in this folder:

`{vault}`

New here? The [[Inkwell Guide]] shows how to do everything, from tick boxes to tabs and using Inkwell on your phone. It's also under **⚙ Settings → Open the guide**.

The guide links back to this note, so the **Backlinks** panel on the right lists it.

Embed images with `![[picture.png]]` or paste an image straight into the editor;
it is saved to `attachments/`.

#inkwell #howto
"""


def ping(port: int):
    """The /api/ping reply of an Inkwell on this port, or None if it isn't Inkwell."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1.5) as r:
            d = json.loads(r.read() or b"{}")
            return d if d.get("app") == "inkwell" else None
    except Exception:  # noqa: BLE001
        return None


def ask_shutdown(port: int) -> bool:
    import urllib.request
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/shutdown", data=b"{}", method="POST")
        with urllib.request.urlopen(req, timeout=2):
            pass
    except Exception:  # noqa: BLE001
        return False
    for _ in range(40):  # wait for the port to free up
        time.sleep(0.1)
        if ping(port) is None:
            return True
    return False


def set_password():
    import getpass
    pw = getpass.getpass("New Inkwell password: ")
    if len(pw) < 8:
        sys.exit("Use at least 8 characters.")
    if getpass.getpass("Type it again: ") != pw:
        sys.exit("The passwords didn't match. Nothing was changed.")
    CONFIG["password"] = hash_password(pw)
    CONFIG["secret"] = secrets.token_hex(32)  # also signs everyone out
    save_config()
    print(f"Password saved in {CONFIG_FILE}. Restart Inkwell for it to take effect.")


def start(argv=None):
    """Parse options and bind the server without serving yet.

    Returns (server, url, how): server is None when this Inkwell is already running (url points
    at it) or when a one-off command like --set-password ran (url is None too).
    """
    global VAULT, SERVER
    load_config()
    ap = argparse.ArgumentParser(description="Inkwell: local Markdown notes")
    ap.add_argument("vault", nargs="?", default=os.environ.get("INKWELL_VAULT") or CONFIG.get("vault") or str(Path.home() / "Notes"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("INKWELL_PORT") or CONFIG.get("port") or 8473))
    ap.add_argument("--host", default=os.environ.get("INKWELL_HOST") or CONFIG.get("host") or "127.0.0.1",
                    help="address to listen on; anything but localhost needs a password")
    ap.add_argument("--open", choices=["window", "tab", "none"], default=CONFIG.get("open") or "window",
                    help="open Inkwell in an app window (default), a browser tab, or not at all")
    ap.add_argument("--no-browser", action="store_true", help="same as --open none")
    ap.add_argument("--set-password", action="store_true", help="set the password needed to sign in, then exit")
    ap.add_argument("--remove-password", action="store_true", help="remove the password (localhost-only again), then exit")
    ap.add_argument("--set-vault", metavar="DIR", help="remember DIR as the default vault, then exit")
    args = ap.parse_args(argv)
    how = "none" if args.no_browser else args.open

    if args.set_password:
        set_password()
        return None, None, how
    if args.remove_password:
        CONFIG.pop("password", None)
        save_config()
        print("Password removed. Inkwell will only answer on localhost.")
        return None, None, how
    if args.set_vault:
        CONFIG["vault"] = str(Path(args.set_vault).expanduser().resolve())
        save_config()
        print(f"Default vault: {CONFIG['vault']}")
        return None, None, how

    local_only = args.host in ("127.0.0.1", "localhost", "::1")
    if not local_only and not password_set():
        sys.exit(f"Refusing to listen on {args.host} without a password: anyone who can reach it could read and change your notes.\n"
                 "Set one first with:  inkwell --set-password")
    if password_set() and not CONFIG.get("secret"):
        CONFIG["secret"] = secrets.token_hex(32)
        save_config()

    VAULT = Path(args.vault).expanduser().resolve()
    fresh = not VAULT.exists() or not any(VAULT.iterdir())
    VAULT.mkdir(parents=True, exist_ok=True)
    if fresh:
        (VAULT / "Getting started.md").write_text(GETTING_STARTED.format(vault=VAULT), encoding="utf-8")
        guide = STATIC_DIR / "guide.md"
        if guide.is_file():
            shutil.copyfile(guide, VAULT / "Inkwell Guide.md")

    srv = None
    for port in range(args.port, args.port + 20):
        try:
            srv = ThreadingHTTPServer((args.host, port), Handler)
            break
        except OSError:
            # Port taken. The same Inkwell build: just open it. An older build: replace it.
            # Anything else: try the next port.
            running = ping(port)
            if running and running.get("version") == VERSION:
                url = f"http://127.0.0.1:{port}/"
                print(f"Inkwell already running at {url}")
                return None, url, how
            if running and ask_shutdown(port):
                print(f"Replaced an older Inkwell on port {port}")
                try:
                    srv = ThreadingHTTPServer((args.host, port), Handler)
                    break
                except OSError:
                    pass
            if running:
                print(f"An older Inkwell on port {port} could not be stopped; close it and start Inkwell again")
            else:
                print(f"Port {port} is used by another app, trying {port + 1}")
    if srv is None:
        sys.exit(f"No free port in {args.port}-{args.port + 19}")
    SERVER = srv
    url = f"http://127.0.0.1:{port}/"
    print(f"Inkwell serving vault {VAULT}\n  → {url}   (Ctrl+C to stop)")
    if not local_only:
        print(f"  also listening on {args.host}:{port} (password required)")
    return srv, url, how


def main(argv=None):
    srv, url, how = start(argv)
    if url is None:
        return
    if srv is None:
        return open_ui(url, how)
    threading.Timer(0.6, lambda: open_ui(url, how)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()

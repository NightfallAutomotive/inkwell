#!/usr/bin/env python3
"""Build static/vendor/codemirror.min.js from tools/cm-entry.js.

No Node needed: downloads the npm packages and an esbuild binary straight from
the npm registry into a temporary folder, then bundles them into one IIFE that
defines the global `CM`.

    python3 tools/build_codemirror.py            # use versions in codemirror.lock.json
    python3 tools/build_codemirror.py --update   # re-resolve (versions >= 14 days old)
"""
import argparse
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = Path(__file__).with_name("codemirror.lock.json")
ENTRY = Path(__file__).with_name("cm-entry.js")
OUT = ROOT / "static" / "vendor" / "codemirror.min.js"
REGISTRY = "https://registry.npmjs.org/"
ROOTS = [
    "@codemirror/state", "@codemirror/view", "@codemirror/commands", "@codemirror/language",
    "@codemirror/lang-markdown", "@codemirror/autocomplete", "@codemirror/search",
    "@codemirror/lang-javascript", "@codemirror/lang-python", "@codemirror/lang-css",
    "@codemirror/lang-html", "@codemirror/lang-json", "@codemirror/lang-yaml",
    "@codemirror/legacy-modes", "@lezer/markdown", "@lezer/highlight",
]
ESBUILD = "@esbuild/linux-x64"
MIN_AGE = timedelta(days=14)

_meta = {}


def meta(name):
    if name not in _meta:
        with urllib.request.urlopen(REGISTRY + name.replace("/", "%2f"), timeout=30) as r:
            _meta[name] = json.load(r)
    return _meta[name]


def vtuple(v):
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", v)
    return tuple(int(x) for x in m.groups()) if m else None


def satisfies(v, rng):
    t = vtuple(v)
    if not t:
        return False
    for alt in rng.split("||"):
        ok = True
        for part in alt.split():
            part = part.strip()
            if part in ("*", "x", ""):
                continue
            op = re.match(r"^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?", part)
            if not op:
                ok = False
                break
            o = op.group(1) or "="
            nums = [int(x) if x and x != "x" else 0 for x in op.groups()[1:]]
            want = tuple(nums)
            if o == "^":
                hi = (want[0] + 1, 0, 0) if want[0] else ((0, want[1] + 1, 0) if want[1] else (0, 0, want[2] + 1))
                ok = want <= t < hi
            elif o == "~":
                ok = want <= t < (want[0], want[1] + 1, 0)
            elif o == ">=":
                ok = t >= want
            elif o == ">":
                ok = t > want
            elif o == "<=":
                ok = t <= want
            elif o == "<":
                ok = t < want
            else:
                ok = t == want if op.group(3) else t[0] == want[0]
            if not ok:
                break
        if ok:
            return True
    return False


def best(name, rng, cutoff):
    m = meta(name)
    times = m.get("time", {})
    cands = [v for v in m["versions"] if vtuple(v) and satisfies(v, rng)
             and datetime.fromisoformat(times[v].replace("Z", "+00:00")) <= cutoff]
    if not cands:
        raise SystemExit(f"no version of {name} matching {rng!r} older than {cutoff:%Y-%m-%d}")
    return max(cands, key=vtuple)


def resolve():
    cutoff = datetime.now(timezone.utc) - MIN_AGE
    chosen, queue = {}, [(n, "*") for n in ROOTS]
    while queue:
        name, rng = queue.pop()
        if name in chosen:
            if not satisfies(chosen[name], rng):
                print(f"warning: {name}@{chosen[name]} does not satisfy {rng}", file=sys.stderr)
            continue
        v = best(name, rng, cutoff)
        chosen[name] = v
        deps = meta(name)["versions"][v].get("dependencies", {})
        queue += list(deps.items())
    chosen[ESBUILD] = best(ESBUILD, "*", cutoff)
    return dict(sorted(chosen.items()))


def fetch(name, version, dest: Path):
    url = meta(name)["versions"][version]["dist"]["tarball"]
    with urllib.request.urlopen(url, timeout=60) as r:
        data = r.read()
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        for m in tf.getmembers():
            parts = Path(m.name).parts[1:]  # strip leading "package/"
            if not parts or ".." in parts or m.issym() or m.islnk():
                continue
            target = dest.joinpath(*parts)
            if m.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif m.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tf.extractfile(m).read())
                if m.mode & 0o111:
                    target.chmod(0o755)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="re-resolve versions instead of using the lockfile")
    args = ap.parse_args()
    if args.update or not LOCK.exists():
        versions = resolve()
        LOCK.write_text(json.dumps(versions, indent=2) + "\n")
        print(f"resolved {len(versions)} packages -> {LOCK.name}")
    else:
        versions = json.loads(LOCK.read_text())

    with tempfile.TemporaryDirectory(prefix="inkwell-cm-") as tmp:
        tmp = Path(tmp)
        nm = tmp / "node_modules"
        for name, v in versions.items():
            fetch(name, v, nm / name)
        esbuild = nm / ESBUILD / "bin" / "esbuild"
        shutil.copy(ENTRY, tmp / "entry.js")
        banner = "/* CodeMirror 6 bundle for Inkwell. MIT licensed: https://codemirror.net. " + \
                 "Built " + time.strftime("%Y-%m-%d") + " from: " + \
                 ", ".join(f"{k}@{v}" for k, v in versions.items() if k != ESBUILD) + " */"
        subprocess.run([str(esbuild), "entry.js", "--bundle", "--minify", "--format=iife",
                        "--global-name=CM", "--target=es2020", "--legal-comments=none",
                        f"--banner:js={banner}", f"--outfile={OUT}"], cwd=tmp, check=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

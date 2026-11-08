#!/usr/bin/env python3
"""Build Inkwell as an AppImage: one file that runs on most Linux desktops with nothing to install.

    python3 tools/build_appimage.py          -> dist/Inkwell-<version>-x86_64.AppImage

It bundles a portable CPython (python-build-standalone), so the person running it doesn't need
Python. Inkwell opens in a Chromium-family app window if one is installed, otherwise a browser tab.
Downloads are cached in ~/.cache/inkwell-build and pinned below (each at least two weeks old when chosen).
"""
import hashlib
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "inkwell-build"
DIST = ROOT / "dist"
ARCH = "x86_64"

PYTHON_URL = ("https://github.com/astral-sh/python-build-standalone/releases/download/20261021/"
              "cpython-3.12.15+20261021-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz")
APPIMAGETOOL_URL = "https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage"
RUNTIME_URL = "https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64"

# Parts of the bundled Python that Inkwell never uses (saves ~25 MB)
PY_DROP = ["include", "share", "lib/pkgconfig", "lib/itcl4.2.4", "lib/tcl8", "lib/tcl8.6", "lib/tk8.6", "lib/thread2.8.9"]
PY_LIB_DROP = ["test", "idlelib", "tkinter", "turtledemo", "ensurepip", "lib2to3", "pydoc_data", "unittest",
               "distutils", "venv", "lib-dynload/_tkinter.cpython-312-x86_64-linux-gnu.so",
               "lib-dynload/_test*", "lib-dynload/xxlimited*", "config-3.12-x86_64-linux-gnu"]


def fetch(url: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / url.rsplit("/", 1)[-1]
    if not dest.exists():
        print(f"downloading {dest.name}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f)
        tmp.rename(dest)
    return dest


def version() -> str:
    meta = (ROOT / "flatpak" / "io.github.NightfallAutomotive.Inkwell.metainfo.xml").read_text()
    return re.search(r'<release version="([^"]+)"', meta).group(1)


def main():
    ver = version()
    appdir = CACHE / "Inkwell.AppDir"
    shutil.rmtree(appdir, ignore_errors=True)
    share = appdir / "usr/share/inkwell"
    share.mkdir(parents=True)

    # app files
    shutil.copy(ROOT / "server.py", share / "server.py")
    shutil.copytree(ROOT / "static", share / "static")
    (share / "docs").mkdir()
    shutil.copy(ROOT / "docs/online.md", share / "docs/online.md")
    shutil.copy(ROOT / "LICENSE", share / "LICENSE")
    shutil.copytree(ROOT / "licenses", share / "licenses")

    # portable Python
    with tarfile.open(fetch(PYTHON_URL)) as tf:
        tf.extractall(appdir / "usr", filter="data") if sys.version_info >= (3, 12) else tf.extractall(appdir / "usr")
    py = appdir / "usr/python"
    for d in PY_DROP:
        shutil.rmtree(py / d, ignore_errors=True)
    lib = py / "lib/python3.12"
    for pattern in PY_LIB_DROP:
        for p in lib.glob(pattern):
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    for cache in list(py.rglob("__pycache__")):
        shutil.rmtree(cache, ignore_errors=True)

    # entry point, desktop entry, icons
    apprun = appdir / "AppRun"
    apprun.write_text('#!/bin/sh\n'
                      '# Inkwell AppImage entry point: run the bundled Python on the bundled server.\n'
                      'HERE="$(dirname "$(readlink -f "$0")")"\n'
                      'export PYTHONDONTWRITEBYTECODE=1\n'
                      'exec "$HERE/usr/python/bin/python3" -I "$HERE/usr/share/inkwell/server.py" "$@"\n')
    apprun.chmod(0o755)
    (appdir / "inkwell.desktop").write_text(
        "[Desktop Entry]\nType=Application\nName=Inkwell\nGenericName=Notes\n"
        "Comment=Markdown notes, linked together\nExec=inkwell\nIcon=inkwell\nTerminal=false\n"
        "Categories=Office;TextEditor;\nKeywords=notes;markdown;wiki;journal;\n"
        f"StartupWMClass=Inkwell\nX-AppImage-Version={ver}\n")
    shutil.copy(ROOT / "static/brand/skull.svg", appdir / "inkwell.svg")
    for size in (256, 512):
        d = appdir / f"usr/share/icons/hicolor/{size}x{size}/apps"
        d.mkdir(parents=True)
        shutil.copy(ROOT / f"static/brand/icon-{size}.png", d / "inkwell.png")
    shutil.copy(ROOT / "static/brand/icon-256.png", appdir / ".DirIcon")

    # pack
    tool, runtime = fetch(APPIMAGETOOL_URL), fetch(RUNTIME_URL)
    tool.chmod(tool.stat().st_mode | stat.S_IEXEC)
    DIST.mkdir(exist_ok=True)
    out = DIST / f"Inkwell-{ver}-{ARCH}.AppImage"
    out.unlink(missing_ok=True)
    env = {**os.environ, "ARCH": ARCH, "APPIMAGE_EXTRACT_AND_RUN": "1"}
    subprocess.run([str(tool), "--no-appstream", "--runtime-file", str(runtime), str(appdir), str(out)],
                   check=True, env=env, cwd=CACHE)
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    (DIST / (out.name + ".sha256")).write_text(f"{digest}  {out.name}\n")
    print(f"\nbuilt {out.relative_to(ROOT)}  ({out.stat().st_size / 1e6:.1f} MB)\nsha256 {digest}")


if __name__ == "__main__":
    main()

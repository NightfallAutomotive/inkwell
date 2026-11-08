#!/usr/bin/env bash
# Install Inkwell as a desktop app for the current user (no root needed).
#
#   ./install.sh                     install or update
#   ./install.sh --vault ~/MyNotes   also set the notes folder it opens
#   ./install.sh --service           also start Inkwell in the background at login
#   ./install.sh --uninstall         remove the app (your notes and settings are kept)
#
# Installs to ~/.local/share/inkwell, adds the `inkwell` command to ~/.local/bin,
# an app-menu entry and icons. Needs python3 (3.8+).
set -euo pipefail

SRC="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APP="$DATA/inkwell"
BIN="$HOME/.local/bin"
DESKTOP="$DATA/applications/inkwell.desktop"
ICONS="$DATA/icons/hicolor"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/inkwell.service"

vault="" service=0 uninstall=0
while [ $# -gt 0 ]; do
  case "$1" in
    --vault) vault="${2:?--vault needs a folder}"; shift 2 ;;
    --service) service=1; shift ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
done

refresh_menus() {
  command -v update-desktop-database >/dev/null && update-desktop-database "$DATA/applications" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -f -t "$ICONS" 2>/dev/null || true
}

if [ "$uninstall" = 1 ]; then
  if command -v systemctl >/dev/null && [ -f "$UNIT" ]; then
    systemctl --user disable --now inkwell.service 2>/dev/null || true
    rm -f "$UNIT"; systemctl --user daemon-reload 2>/dev/null || true
  fi
  rm -rf "$APP"
  rm -f "$BIN/inkwell" "$DESKTOP" "$ICONS/scalable/apps/inkwell.svg" "$ICONS/256x256/apps/inkwell.png" "$ICONS/512x512/apps/inkwell.png"
  refresh_menus
  echo "Inkwell removed. Your notes and ~/.config/inkwell (password, settings) were left alone."
  exit 0
fi

command -v python3 >/dev/null || { echo "Inkwell needs python3. Install it and run this again." >&2; exit 1; }
python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' || { echo "Inkwell needs Python 3.8 or newer." >&2; exit 1; }

# app files (replaced wholesale so removed files don't linger)
mkdir -p "$APP"
rm -rf "$APP/static.new"
cp -r "$SRC/static" "$APP/static.new"
rm -rf "$APP/static" && mv "$APP/static.new" "$APP/static"
cp "$SRC/server.py" "$APP/server.py"
cp "$SRC/README.md" "$APP/README.md"
[ -d "$SRC/docs" ] && { rm -rf "$APP/docs"; cp -r "$SRC/docs" "$APP/docs"; }

# command
mkdir -p "$BIN"
cat > "$BIN/inkwell" <<EOF
#!/bin/sh
# Inkwell launcher (installed by install.sh). Run with --help for options.
exec python3 "$APP/server.py" "\$@"
EOF
chmod +x "$BIN/inkwell"

# icons and menu entry
mkdir -p "$ICONS/scalable/apps" "$ICONS/256x256/apps" "$ICONS/512x512/apps" "$(dirname "$DESKTOP")"
cp "$SRC/static/brand/skull.svg" "$ICONS/scalable/apps/inkwell.svg"
cp "$SRC/static/brand/icon-256.png" "$ICONS/256x256/apps/inkwell.png"
cp "$SRC/static/brand/icon-512.png" "$ICONS/512x512/apps/inkwell.png"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Inkwell
GenericName=Notes
Comment=Markdown notes, linked together
Exec=$BIN/inkwell
Icon=inkwell
Terminal=false
Categories=Office;Utility;TextEditor;
Keywords=notes;markdown;wiki;journal;
StartupNotify=true
StartupWMClass=Inkwell
EOF
refresh_menus

if [ -n "$vault" ]; then python3 "$APP/server.py" --set-vault "$vault"; fi

# background service (optional), or restart it if it's already set up so the update takes effect
if [ "$service" = 1 ] || [ -f "$UNIT" ]; then
  if command -v systemctl >/dev/null; then
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT" <<EOF
[Unit]
Description=Inkwell notes server

[Service]
ExecStart=/usr/bin/env python3 $APP/server.py --open none
Restart=on-failure

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable inkwell.service >/dev/null 2>&1
    systemctl --user restart inkwell.service
    echo "Inkwell now runs in the background and starts when you log in."
  else
    echo "systemd isn't available, so --service was skipped." >&2
  fi
fi

echo "Inkwell installed. Open it from your app menu, or run: inkwell"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: $BIN isn't on your PATH, so use the app menu or $BIN/inkwell." ;; esac

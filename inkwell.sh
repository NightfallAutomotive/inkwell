#!/usr/bin/env bash
# Run Inkwell from this folder without installing. Usage: ./inkwell.sh [VAULT_DIR]  (see ./install.sh to install)
# If it's already running, this just opens the browser tab.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
exec python3 -u server.py "$@"

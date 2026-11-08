#!/usr/bin/env bash
# Launch Inkwell. Usage: ./inkwell.sh [VAULT_DIR]   (default ~/Notes)
# If it's already running, this just opens the browser tab.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
exec python3 -u server.py "$@"

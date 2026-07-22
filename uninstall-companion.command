#!/bin/zsh
set -e

AGENT_PATH="$HOME/Library/LaunchAgents/moe.ekyu.mortal-codex-bridge.plist"
APP_DIR="$HOME/Library/Application Support/MortalCodexBridge"
DATA_DIR="$APP_DIR/data"
if [[ -f "$AGENT_PATH" ]]; then
  DATA_DIR="$(/usr/bin/plutil -extract EnvironmentVariables.MORTAL_CODEX_DATA_DIR raw -o - "$AGENT_PATH" 2>/dev/null || print -r -- "$DATA_DIR")"
fi

/bin/launchctl bootout "gui/$UID/moe.ekyu.mortal-codex-bridge" >/dev/null 2>&1 || true
if [[ -f "$AGENT_PATH" ]]; then mv "$AGENT_PATH" "$HOME/.Trash/"; fi
if [[ -d "$APP_DIR/bridge" ]]; then
  TRASH_TARGET="$HOME/.Trash/MortalCodexBridge-bridge-$(date +%Y%m%d-%H%M%S)"
  mv "$APP_DIR/bridge" "$TRASH_TARGET"
fi

echo "常駐接続を解除し、ブリッジ本体をゴミ箱へ移動しました。"
echo "局面DBは $DATA_DIR/mahjong-coach.sqlite3 に残しています。"
read "?Enterで閉じます"

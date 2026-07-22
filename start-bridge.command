#!/bin/zsh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if [[ -x "/Applications/ChatGPT.app/Contents/Resources/codex" ]]; then
  # ChatGPTが作成するモデルキャッシュと同じ版を使い、CLI/キャッシュ形式の不一致を避ける。
  CODEX_PATH="/Applications/ChatGPT.app/Contents/Resources/codex"
elif command -v codex >/dev/null 2>&1; then
  CODEX_PATH="$(command -v codex)"
elif [[ -x "$HOME/.local/bin/codex" ]]; then
  CODEX_PATH="$HOME/.local/bin/codex"
elif [[ -x "/opt/homebrew/bin/codex" ]]; then
  CODEX_PATH="/opt/homebrew/bin/codex"
else
  echo "Codex CLIが見つかりません。先にCodex CLIをインストールしてください。"
  read "?Enterで閉じます"
  exit 1
fi

supports_sqlite() { "$1" -e "require('node:sqlite')" >/dev/null 2>&1; }

if command -v node >/dev/null 2>&1 && supports_sqlite "$(command -v node)"; then
  NODE_PATH_BIN="$(command -v node)"
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]] && supports_sqlite "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; then
  NODE_PATH_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  echo "SQLite対応のNode.jsが見つかりません。Node.js 22.13以上をインストールしてください。"
  read "?Enterで閉じます"
  exit 1
fi

export CODEX_BIN="$CODEX_PATH"
"$CODEX_PATH" login status || {
  echo "Codexへログインしてください。別のターミナルで codex login を実行します。"
  "$CODEX_PATH" login
}

exec "$NODE_PATH_BIN" "$SCRIPT_DIR/bridge/server.mjs"

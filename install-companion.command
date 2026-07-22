#!/bin/zsh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$HOME/Library/Application Support/MortalCodexBridge"
AGENT_DIR="$HOME/Library/LaunchAgents"
AGENT_PATH="$AGENT_DIR/moe.ekyu.mortal-codex-bridge.plist"
LOG_PATH="$HOME/Library/Logs/MortalCodexBridge.log"
EXISTING_DATA_DIR=""
if [[ -f "$AGENT_PATH" ]]; then
  EXISTING_DATA_DIR="$(/usr/bin/plutil -extract EnvironmentVariables.MORTAL_CODEX_DATA_DIR raw -o - "$AGENT_PATH" 2>/dev/null || true)"
fi
DATA_DIR="${MORTAL_CODEX_DATA_DIR:-${EXISTING_DATA_DIR:-$APP_DIR/data}}"

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
  echo "Codex CLIが見つかりません。先にCodexをインストールしてください。"
  read "?Enterで閉じます"
  exit 1
fi

CLAUDE_PATH=""
if command -v claude >/dev/null 2>&1; then
  CLAUDE_PATH="$(command -v claude)"
elif [[ -x "$HOME/.local/bin/claude" ]]; then
  CLAUDE_PATH="$HOME/.local/bin/claude"
elif [[ -x "$HOME/.claude/local/claude" ]]; then
  CLAUDE_PATH="$HOME/.claude/local/claude"
elif [[ -x "/opt/homebrew/bin/claude" ]]; then
  CLAUDE_PATH="/opt/homebrew/bin/claude"
elif [[ -x "/usr/local/bin/claude" ]]; then
  CLAUDE_PATH="/usr/local/bin/claude"
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

mkdir -p "$APP_DIR" "$AGENT_DIR"
/usr/bin/ditto "$SCRIPT_DIR/bridge" "$APP_DIR/bridge"
/usr/bin/ditto "$SCRIPT_DIR/prompts" "$APP_DIR/prompts"


/usr/bin/plutil -create xml1 "$AGENT_PATH"
/usr/bin/plutil -insert Label -string "moe.ekyu.mortal-codex-bridge" "$AGENT_PATH"
/usr/bin/plutil -insert ProgramArguments -json "[\"$NODE_PATH_BIN\",\"$APP_DIR/bridge/server.mjs\"]" "$AGENT_PATH"
ENVIRONMENT_JSON="{\"CODEX_BIN\":\"$CODEX_PATH\",\"MORTAL_CODEX_DATA_DIR\":\"$DATA_DIR\""
if [[ -n "$CLAUDE_PATH" ]]; then
  ENVIRONMENT_JSON+=",\"CLAUDE_BIN\":\"$CLAUDE_PATH\""
fi
ENVIRONMENT_JSON+="}"
/usr/bin/plutil -insert EnvironmentVariables -json "$ENVIRONMENT_JSON" "$AGENT_PATH"
/usr/bin/plutil -insert RunAtLoad -bool true "$AGENT_PATH"
/usr/bin/plutil -insert KeepAlive -bool true "$AGENT_PATH"
/usr/bin/plutil -insert ProcessType -string "Background" "$AGENT_PATH"
/usr/bin/plutil -insert StandardOutPath -string "$LOG_PATH" "$AGENT_PATH"
/usr/bin/plutil -insert StandardErrorPath -string "$LOG_PATH" "$AGENT_PATH"

/bin/launchctl bootout "gui/$UID/moe.ekyu.mortal-codex-bridge" >/dev/null 2>&1 || true
/bin/launchctl enable "gui/$UID/moe.ekyu.mortal-codex-bridge"
/bin/launchctl bootstrap "gui/$UID" "$AGENT_PATH"
/bin/launchctl kickstart -k "gui/$UID/moe.ekyu.mortal-codex-bridge"

echo "常駐接続をインストールしました。今後はターミナルを開かなくても自動接続します。"
if [[ -n "$CLAUDE_PATH" ]]; then
  echo "Claude CLIも検出しました。未ログインの場合は claude auth login を実行してください。"
else
  echo "Claudeは未導入です。Codexだけで利用できます。Claude導入後はこのインストーラーを再実行してください。"
fi
echo "ChromeでMortal画面を再読み込みしてください。"
read "?Enterで閉じます"

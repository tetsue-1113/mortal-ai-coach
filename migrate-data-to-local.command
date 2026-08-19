#!/bin/zsh
set -eu

LABEL="moe.ekyu.mortal-codex-bridge"
APP_DIR="${MORTAL_APP_DIR:-$HOME/Library/Application Support/MortalCodexBridge}"
AGENT_PATH="${MORTAL_AGENT_PATH:-$HOME/Library/LaunchAgents/${LABEL}.plist}"
LOCAL_DATA_DIR="${MORTAL_LOCAL_DATA_DIR:-$APP_DIR/data}"
DB_NAME="${MORTAL_CODEX_DB_NAME:-mahjong-coach.sqlite3}"
STATE_DIR="$APP_DIR/migration"
BACKUP_PLIST="$STATE_DIR/pre-local-data.plist"
PLUTIL_BIN="${PLUTIL_BIN:-/usr/bin/plutil}"
SQLITE_BIN="${SQLITE_BIN:-/usr/bin/sqlite3}"
LAUNCHCTL_BIN="${LAUNCHCTL_BIN:-/bin/launchctl}"
DITTO_BIN="${DITTO_BIN:-/usr/bin/ditto}"
CURL_BIN="${CURL_BIN:-/usr/bin/curl}"
MIGRATION_IN_PROGRESS=0

die() {
  print -u2 -- "$1"
  exit 1
}

current_data_dir() {
  [[ -f "$AGENT_PATH" ]] || die "LaunchAgentが見つかりません: $AGENT_PATH"
  "$PLUTIL_BIN" -extract EnvironmentVariables.MORTAL_CODEX_DATA_DIR raw -o - "$AGENT_PATH" 2>/dev/null \
    || die "現在のデータ保存先をLaunchAgentから読めません"
}

current_port() {
  local port
  port="$("$PLUTIL_BIN" -extract EnvironmentVariables.MORTAL_CODEX_PORT raw -o - "$AGENT_PATH" 2>/dev/null || print -r -- 38765)"
  [[ "$port" == <1-65535> ]] || die "ブリッジのポート設定が不正です"
  print -r -- "$port"
}

db_signature() {
  local db="$1"
  [[ -f "$db" ]] || die "SQLiteが見つかりません: $db"
  local integrity
  integrity="$("$SQLITE_BIN" "$db" 'PRAGMA integrity_check;' 2>/dev/null)" \
    || die "SQLiteの整合性確認に失敗しました"
  [[ "$integrity" == "ok" ]] || die "SQLiteの整合性が壊れています"
  "$SQLITE_BIN" -noheader "$db" \
    "SELECT (SELECT count(*) FROM reports)||':'||(SELECT count(*) FROM scenes)||':'||(SELECT count(*) FROM questions);" \
    2>/dev/null || die "SQLiteの件数確認に失敗しました"
}

copy_verified() {
  local source_db="$1" destination_db="$2"
  local destination_dir="${destination_db:h}"
  local temp_db="$destination_dir/.${DB_NAME}.migration.$$"

  mkdir -p "$destination_dir"
  chmod 700 "$destination_dir"
  if [[ -e "$destination_db" ]]; then
    cmp -s "$source_db" "$destination_db" \
      || die "移行先に内容の異なるSQLiteがあります。上書きしません: $destination_db"
    db_signature "$destination_db" >/dev/null
    return
  fi

  rm -f -- "$temp_db"
  if ! "$DITTO_BIN" "$source_db" "$temp_db"; then
    rm -f -- "$temp_db"
    die "SQLiteをコピーできませんでした"
  fi
  if ! cmp -s "$source_db" "$temp_db"; then
    rm -f -- "$temp_db"
    die "SQLiteのコピー内容が一致しません"
  fi
  if ! db_signature "$temp_db" >/dev/null; then
    rm -f -- "$temp_db"
    die "コピー後のSQLite検証に失敗しました"
  fi
  mv "$temp_db" "$destination_db"
  chmod 600 "$destination_db"
}

preflight() {
  local source_dir source_db destination_db
  source_dir="$(current_data_dir)"
  source_db="$source_dir/$DB_NAME"
  destination_db="$LOCAL_DATA_DIR/$DB_NAME"

  [[ "$source_dir" != "$LOCAL_DATA_DIR" ]] \
    || die "すでにローカル保存先を使用しています: $LOCAL_DATA_DIR"
  [[ -f "$source_db" ]] || die "移行元SQLiteが見つかりません: $source_db"
  db_signature "$source_db" >/dev/null
  if [[ -e "$destination_db" ]]; then
    cmp -s "$source_db" "$destination_db" \
      || die "移行先に内容の異なるSQLiteがあります。事前確認が必要です"
    db_signature "$destination_db" >/dev/null
  fi
  print -- "事前確認完了: SQLiteをローカル保存先へ安全にコピーできます"
}

restore_agent() {
  [[ -f "$BACKUP_PLIST" ]] || return 0
  "$LAUNCHCTL_BIN" bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  "$DITTO_BIN" "$BACKUP_PLIST" "$AGENT_PATH"
  "$LAUNCHCTL_BIN" bootstrap "gui/$UID" "$AGENT_PATH" >/dev/null 2>&1 || true
  "$LAUNCHCTL_BIN" kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1 || true
}

migration_cleanup() {
  local status=$?
  if [[ "$MIGRATION_IN_PROGRESS" == "1" ]]; then
    restore_agent
  fi
  return "$status"
}

wait_for_bridge() {
  local attempt port
  port="$(current_port)"
  for attempt in {1..10}; do
    if "$CURL_BIN" --fail --silent --max-time 2 \
      "http://127.0.0.1:${port}/api/v1/records/status" 2>/dev/null \
      | grep -Fq -- "$LOCAL_DATA_DIR/$DB_NAME"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

migrate() {
  [[ "${MORTAL_MIGRATION_CONFIRM:-0}" == "1" ]] \
    || die "実行には MORTAL_MIGRATION_CONFIRM=1 が必要です"

  local source_dir source_db destination_db before after plist_temp
  preflight
  source_dir="$(current_data_dir)"
  source_db="$source_dir/$DB_NAME"
  destination_db="$LOCAL_DATA_DIR/$DB_NAME"
  before="$(db_signature "$source_db")"

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  "$DITTO_BIN" "$AGENT_PATH" "$BACKUP_PLIST"
  MIGRATION_IN_PROGRESS=1
  trap migration_cleanup EXIT
  trap 'exit 130' INT TERM
  "$LAUNCHCTL_BIN" bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  [[ ! -e "${source_db}-wal" && ! -e "${source_db}-shm" ]] \
    || die "SQLiteのWALサイドカーファイルが残っているため、安全にコピーできません"

  copy_verified "$source_db" "$destination_db"

  plist_temp="$STATE_DIR/.local-data.plist.$$"
  "$DITTO_BIN" "$AGENT_PATH" "$plist_temp"
  "$PLUTIL_BIN" -replace EnvironmentVariables.MORTAL_CODEX_DATA_DIR -string "$LOCAL_DATA_DIR" "$plist_temp"
  mv "$plist_temp" "$AGENT_PATH"

  if ! "$LAUNCHCTL_BIN" bootstrap "gui/$UID" "$AGENT_PATH" >/dev/null 2>&1 \
    || ! "$LAUNCHCTL_BIN" kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1; then
    die "新しいLaunchAgentを起動できなかったため、元の設定へ戻しました"
  fi

  after="$(db_signature "$destination_db")"
  if [[ "$before" != "$after" ]] \
    || [[ "$(current_data_dir)" != "$LOCAL_DATA_DIR" ]] \
    || ! "$LAUNCHCTL_BIN" print "gui/$UID/$LABEL" >/dev/null 2>&1 \
    || ! wait_for_bridge; then
    die "切替後の検証に失敗したため、元のLaunchAgentへ戻しました"
  fi

  MIGRATION_IN_PROGRESS=0
  trap - EXIT INT TERM
  print -- "移行完了: ブリッジは端末ローカルのSQLiteを使用しています"
  print -- "旧SQLiteは削除せず元の場所に残しました"
}

verify() {
  local configured destination_db
  configured="$(current_data_dir)"
  destination_db="$LOCAL_DATA_DIR/$DB_NAME"
  [[ "$configured" == "$LOCAL_DATA_DIR" ]] || die "LaunchAgentがローカル保存先を指していません"
  db_signature "$destination_db" >/dev/null
  "$LAUNCHCTL_BIN" print "gui/$UID/$LABEL" >/dev/null 2>&1 \
    || die "ブリッジがlaunchdへ登録されていません"
  wait_for_bridge || die "ブリッジAPIがローカルSQLiteを使用していることを確認できません"
  print -- "検証完了: ローカルSQLiteとブリッジ登録は正常です"
}

self_test() {
  local root source destination divergent
  root="$(mktemp -d "${TMPDIR:-/tmp}/mortal-data-migration.XXXXXX")"
  trap "rm -rf -- ${(q)root}" EXIT INT TERM
  source="$root/source/$DB_NAME"
  destination="$root/destination/$DB_NAME"
  divergent="$root/divergent/$DB_NAME"
  mkdir -p "${source:h}" "${divergent:h}"
  "$SQLITE_BIN" "$source" <<'SQL'
CREATE TABLE reports(id INTEGER PRIMARY KEY);
CREATE TABLE scenes(id INTEGER PRIMARY KEY);
CREATE TABLE questions(id INTEGER PRIMARY KEY);
INSERT INTO reports VALUES (1);
INSERT INTO scenes VALUES (1);
INSERT INTO questions VALUES (1);
SQL
  copy_verified "$source" "$destination"
  cmp -s "$source" "$destination" || die "self-test: コピーが一致しません"
  copy_verified "$source" "$destination"
  "$SQLITE_BIN" "$divergent" 'CREATE TABLE reports(id); CREATE TABLE scenes(id); CREATE TABLE questions(id);'
  if (copy_verified "$source" "$divergent") >/dev/null 2>&1; then
    die "self-test: 異なる移行先を拒否できませんでした"
  fi
  print -- "self-test成功"
}

case "${1:-}" in
  preflight) preflight ;;
  migrate) migrate ;;
  verify) verify ;;
  self-test) self_test ;;
  *) die "使い方: $0 preflight|migrate|verify|self-test" ;;
esac

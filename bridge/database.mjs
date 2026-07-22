import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function defaultDataDir() {
  if (process.env.MORTAL_CODEX_DATA_DIR) return process.env.MORTAL_CODEX_DATA_DIR;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "MortalCodexBridge", "data");
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "MortalCodexBridge");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "MortalCodexBridge");
}

function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").all().map(row => row.name));
  const migrationDir = join(HERE, "migrations");
  for (const name of readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(migrationDir, name), "utf8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations(name) VALUES (?)").run(name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function textJson(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function openCoachDatabase() {
  const dataDir = defaultDataDir();
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, process.env.MORTAL_CODEX_DB_NAME || "mahjong-coach.sqlite3");
  const legacyPaths = process.platform === "darwin"
    ? [join(homedir(), "Library", "Application Support", "MortalCodexBridge", "coach.sqlite3")]
    : [];
  const legacyPath = legacyPaths.find(candidate => existsSync(candidate));
  if (!existsSync(path) && legacyPath) copyFileSync(legacyPath, path);
  const db = new DatabaseSync(path);
  // A single-file rollback journal is safer for an iCloud-synced location than WAL sidecar files.
  // The database must still never be opened from two Macs at the same time.
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  migrate(db);

  const upsertReport = db.prepare(`
    INSERT INTO reports(report_id, player_id) VALUES (?, ?)
    ON CONFLICT(report_id) DO UPDATE SET player_id=excluded.player_id, updated_at=CURRENT_TIMESTAMP`);
  const upsertScene = db.prepare(`
    INSERT INTO scenes(scene_id, report_id, kyoku, honba, junme, tiles_left, actual_json, expected_json,
      position_json, context_json, table_json, payload_json, explanation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scene_id) DO UPDATE SET
      report_id=excluded.report_id, kyoku=excluded.kyoku, honba=excluded.honba, junme=excluded.junme,
      tiles_left=excluded.tiles_left, actual_json=excluded.actual_json, expected_json=excluded.expected_json,
      position_json=excluded.position_json, context_json=excluded.context_json, table_json=excluded.table_json,
      payload_json=excluded.payload_json,
      explanation_json=COALESCE(excluded.explanation_json, scenes.explanation_json), updated_at=CURRENT_TIMESTAMP`);
  const deleteQuestions = db.prepare("DELETE FROM questions WHERE scene_id = ?");
  const insertQuestion = db.prepare("INSERT INTO questions(scene_id, message_index, role, content) VALUES (?, ?, ?, ?)");

  function saveScenes(records) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) {
        const scene = record.scene;
        upsertReport.run(scene.reportId, scene.playerId);
        upsertScene.run(
          scene.sceneId, scene.reportId, scene.position.kyoku, scene.position.honba, scene.position.junme,
          scene.position.tilesLeft, textJson(scene.actual), textJson(scene.expected), textJson(scene.position),
          textJson(scene.context), textJson(scene.table), textJson(scene), textJson(record.explanation)
        );
        if (Array.isArray(record.chat)) {
          deleteQuestions.run(scene.sceneId);
          record.chat.forEach((message, index) => insertQuestion.run(scene.sceneId, index, message.role, message.content));
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return records.length;
  }

  function status() {
    return {
      ok: true,
      path,
      exists: existsSync(path),
      reports: Number(db.prepare("SELECT COUNT(*) AS count FROM reports").get().count),
      scenes: Number(db.prepare("SELECT COUNT(*) AS count FROM scenes").get().count),
      questions: Number(db.prepare("SELECT COUNT(*) AS count FROM questions").get().count)
    };
  }

  return { path, saveScenes, status, close: () => db.close() };
}

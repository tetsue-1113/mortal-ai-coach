CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL CHECK (player_id BETWEEN 0 AND 3),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scenes (
  scene_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  kyoku INTEGER NOT NULL,
  honba INTEGER NOT NULL,
  junme INTEGER NOT NULL,
  tiles_left INTEGER,
  actual_json TEXT,
  expected_json TEXT,
  position_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  table_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  explanation_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS scenes_report_order
  ON scenes(report_id, kyoku, honba, junme);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id TEXT NOT NULL REFERENCES scenes(scene_id) ON DELETE CASCADE,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scene_id, message_index)
);

CREATE INDEX IF NOT EXISTS questions_scene_order
  ON questions(scene_id, message_index);

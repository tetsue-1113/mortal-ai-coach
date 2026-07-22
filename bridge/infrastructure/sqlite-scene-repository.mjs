import { openCoachDatabase } from "../database.mjs";

// Application層はこのsaveScenes/status契約だけへ依存し、SQLite固有処理を知らない。
export function createSQLiteSceneRepository() {
  return openCoachDatabase();
}

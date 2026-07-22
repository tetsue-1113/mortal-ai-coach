import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSceneService } from "./application/scene-service.mjs";
import { createRecordService } from "./application/record-service.mjs";
import { createSQLiteSceneRepository } from "./infrastructure/sqlite-scene-repository.mjs";
import { createCliProviderGateway } from "./infrastructure/cli-provider-gateway.mjs";
import { createBridgeApp } from "./http/bridge-app.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MORTAL_CODEX_PORT) || 38765;
const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(HERE, "..", "prompts");

function readPrompt(filename) {
  try { return readFileSync(join(PROMPTS_DIR, filename), "utf8"); }
  catch (error) {
    console.error(`Prompt file could not be loaded: ${filename}\n${error.message}`);
    process.exit(1);
  }
}

// Composition root: concrete infrastructure is selected only here.
const repository = createSQLiteSceneRepository();
const sceneService = createSceneService({
  sceneSystem: readPrompt("scene_analysis.system.md"),
  sceneUserTemplate: readPrompt("scene_analysis.user.template.md"),
  questionSystem: readPrompt("question_answer.system.md"),
  summarySystem: readPrompt("summary.system.md")
});
const recordService = createRecordService({ sceneService, repository });
const providerGateway = createCliProviderGateway();
const app = createBridgeApp({
  sceneService, recordService, providerGateway,
  schemas: {
    analysis: join(HERE, "report-schema.json"),
    summary: join(HERE, "summary-schema.json"),
    question: join(HERE, "question-schema.json")
  }
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`Mortal AI Coach logic server: http://${HOST}:${PORT}`);
  console.log("この画面を開いたままMortalを使用してください。終了はControl+Cです。");
});

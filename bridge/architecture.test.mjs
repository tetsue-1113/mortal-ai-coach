import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_VERSION, ROUTES, canonicalPath } from "./contracts/api.mjs";

test("v1 routes are stable and legacy routes remain compatible", () => {
  assert.equal(API_VERSION, "1.0");
  assert.equal(ROUTES.analyzeScene, "/api/v1/analyses/scene");
  assert.equal(canonicalPath("/analyze"), ROUTES.analyzeScene);
  assert.equal(canonicalPath("/records/status"), ROUTES.storageStatus);
});

test("server is only a composition root", async () => {
  const source = await readFile(new URL("server.mjs", import.meta.url), "utf8");
  assert.match(source, /createSceneService/);
  assert.match(source, /createRecordService/);
  assert.match(source, /createSQLiteSceneRepository/);
  assert.match(source, /createCliProviderGateway/);
  assert.match(source, /createBridgeApp/);
  assert.doesNotMatch(source, /computePushFold|buildScoreSimulation|DatabaseSync|spawn\(/);
});

test("extension talks to the versioned API through its transport boundary", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.match(background, /const API = "\/api\/v1"/);
  assert.match(background, /analyses\/scene/);
  assert.doesNotMatch(content, /fetch\(`http:\/\/127\.0\.0\.1/);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "extension/clients/bridge-client.js", "extension/adapters/mortal-page-adapter.js", "content.js"
  ]);
});

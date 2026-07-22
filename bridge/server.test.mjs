import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Bridge did not start");
}

function sampleScene() {
  return {
    sceneId: "report_test:0:0:4:dahai:5p:dahai:7s",
    reportId: "report_test",
    playerId: 0,
    position: { kyoku: 0, honba: 0, junme: 4, tilesLeft: 58 },
    context: { roundWind: "E", seatWind: "E", dealer: true },
    scores: [25000, 25000, 25000, 25000],
    hand: ["1m", "2m", "3m", "4m", "5m", "6m", "2p", "3p", "5p", "7p", "3s", "4s", "7s", "E"],
    calls: [],
    actual: { type: "dahai", pai: "5p" },
    expected: { type: "dahai", pai: "7s" },
    shanten: 1,
    flags: { furiten: false, selfRiichi: false, callDecision: false },
    metrics: { expectedQ: 0.4, actualQ: 0.3, loss: 0.1 },
    roundOutcome: { events: [{ type: "hora", actor: 2, target: 1, deltas: [0, -3900, 3900, 0] }], scoresAfter: [25000, 21100, 28900, 25000] },
    alternatives: [{ action: { type: "dahai", pai: "7s" }, q: 0.4, probability: 0.7 }],
    table: {
      doraIndicators: ["3p"],
      players: [
        { playerId: 0, relation: "self", seatWind: "E", riichiAccepted: false, discards: [{ tile: "9m", tsumogiri: false, riichiDeclaration: false, called: false }], calls: [] },
        { playerId: 1, relation: "shimocha", seatWind: "S", riichiAccepted: true, discards: [{ tile: "6p", tsumogiri: false, riichiDeclaration: true, called: false }], calls: [] },
        { playerId: 2, relation: "toimen", seatWind: "W", riichiAccepted: false, discards: [], calls: [{ type: "pon", pai: "P", consumed: ["P", "P"], fromPlayer: 3 }] },
        { playerId: 3, relation: "kamicha", seatWind: "N", riichiAccepted: false, discards: [], calls: [] }
      ]
    }
  };
}

test("SQLite migration and scene upsert API", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mortal-codex-test-"));
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [join(import.meta.dirname, "server.mjs")], {
    env: { ...process.env, MORTAL_CODEX_DATA_DIR: dataDir, MORTAL_CODEX_DB_NAME: "mahjong-coach.sqlite3", MORTAL_CODEX_PORT: String(port), CODEX_BIN: "codex-not-used-in-this-test" },
    stdio: "ignore"
  });
  const childClosed = new Promise(resolve => child.once("close", resolve));
  try {
    const base = `http://127.0.0.1:${port}`;
    const initial = await waitFor(`${base}/api/v1/records/status`);
    assert.equal(initial.scenes, 0);
    assert.equal(initial.apiVersion, "1.0");

    const saved = await fetch(`${base}/api/v1/records/scenes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenes: [{
        scene: sampleScene(),
        explanation: { reason: "河を含む説明", lesson: "宣言牌を確認する" },
        chat: [{ role: "user", content: "5pは危険？" }, { role: "assistant", content: "対下家では無筋です。" }]
      }] })
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).saved, 1);

    const status = await waitFor(`${base}/api/v1/records/status`);
    assert.equal(status.reports, 1);
    assert.equal(status.scenes, 1);
    assert.equal(status.questions, 2);
    assert.match(status.path, /mahjong-coach\.sqlite3$/);

    const upserted = await fetch(`${base}/records/scenes`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: sampleScene() })
    });
    assert.equal(upserted.status, 200);
    assert.equal((await waitFor(`${base}/api/v1/records/status`)).scenes, 1);

    const openHandScene = sampleScene();
    openHandScene.sceneId = "report_test:0:0:12:ankan:5p:ankan:5p";
    openHandScene.hand = ["1m", "2m", "3m", "5p"];
    openHandScene.actual = { type: "ankan", pai: "5p", consumed: ["5p", "5p", "5p", "5pr"] };
    openHandScene.expected = { ...openHandScene.actual };
    const openHandSaved = await fetch(`${base}/records/scenes`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: openHandScene })
    });
    assert.equal(openHandSaved.status, 200);
    assert.equal((await waitFor(`${base}/api/v1/records/status`)).scenes, 2);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await childClosed;
    await rm(dataDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createSceneService } from "./scene-service.mjs";

const service = createSceneService({
  sceneSystem: "", sceneUserTemplate: "{SCENE_JSON}", questionSystem: "", summarySystem: ""
});

function baseScene() {
  return {
    sceneId: "normalization-test", reportId: "test", playerId: 0,
    position: { kyoku: 0, honba: 0, junme: 4, tilesLeft: 58 },
    context: { roundWind: "E", seatWind: "E", dealer: true },
    scores: [25000, 25000, 25000, 25000],
    hand: ["2m","3m","3m","3m","6m","6m","3p","4p","4p","4p","4p","6p","5s","6s"],
    calls: [], actual: { type: "dahai", pai: "6p" }, expected: { type: "dahai", pai: "6p" },
    shanten: 2, flags: {}, metrics: {}, alternatives: [],
    table: { doraIndicators: [], players: [
      { playerId: 0, relation: "self", seatWind: "E", riichiAccepted: false, discards: [], calls: [] },
      { playerId: 1, relation: "shimocha", seatWind: "S", riichiAccepted: true, discards: [], calls: [] },
      { playerId: 2, relation: "toimen", seatWind: "W", riichiAccepted: false, discards: [], calls: [] },
      { playerId: 3, relation: "kamicha", seatWind: "N", riichiAccepted: false, discards: [], calls: [] }
    ] }
  };
}

test("normalization uses current hand shanten and preserves the source value", () => {
  const scene = service.normalize(baseScene());
  assert.equal(scene.sourceShanten, 2);
  assert.equal(scene.shanten, 1);
});

test("legacy scenes recover accepted riichi deposits and current scores", () => {
  const scene = service.normalize(baseScene());
  assert.equal(scene.table.kyotakuSticks, 1);
  assert.deepEqual(scene.scores, [25000, 24000, 25000, 25000]);
  assert.equal(scene.scoreSimulation.selfRon[0].kyotakuBonus, 1000);
});

test("current scenes do not subtract an accepted riichi deposit twice", () => {
  const input = baseScene();
  input.scores[1] = 24000;
  input.table.kyotakuSticks = 1;
  input.table.scoresIncludeRiichiDeposits = true;
  const scene = service.normalize(input);
  assert.deepEqual(scene.scores, [25000, 24000, 25000, 25000]);
  assert.equal(scene.table.kyotakuSticks, 1);
});

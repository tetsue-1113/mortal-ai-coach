import assert from "node:assert/strict";
import test from "node:test";
import { computePushFold, estimateOpponentThreat, estimateTileDanger } from "./push-fold.mjs";

function baseScene(overrides = {}) {
  return {
    position: { junme: 9, turnPhase: "中盤", isLastKyoku: false },
    context: { dealer: false }, standings: { selfRank: 2 }, shanten: 1,
    flags: { furiten: false }, actual: { type: "dahai", pai: "7p" }, expected: { type: "dahai", pai: "7p" },
    verifiedTileCounts: { dora: { total: 1 } },
    ukeire: { candidates: [{ tile: "7p", isActual: true, isMortalTop: true, shantenAfter: 1, ukeire: 24 }] },
    table: { visibleCounts: {}, players: [
      { playerId: 0, relation: "self", riichiAccepted: false, discards: [], calls: [], safety: { genbutsu: [], suji: [] } },
      { playerId: 1, relation: "shimocha", riichiAccepted: false, discards: [], calls: [], safety: { genbutsu: [], suji: [] } },
      { playerId: 2, relation: "toimen", riichiAccepted: false, discards: [], calls: [], safety: { genbutsu: [], suji: [] } },
      { playerId: 3, relation: "kamicha", riichiAccepted: false, discards: [], calls: [], safety: { genbutsu: [], suji: [] } }
    ] }, ...overrides
  };
}

test("a good one-shanten hand continues attacking when nobody has shown a threat", () => {
  const result = computePushFold(baseScene());
  assert.equal(result.code, "push"); assert.equal(result.label, "押し"); assert.equal(result.defenceScore, 0);
  assert.match(result.note, /期待値そのものではありません/);
});

test("a riichi against a slow hand produces a fold judgement", () => {
  const scene = baseScene({ shanten: 3, verifiedTileCounts: { dora: { total: 0 } },
    ukeire: { candidates: [{ tile: "7p", isActual: true, isMortalTop: true, shantenAfter: 3, ukeire: 8 }] } });
  scene.table.players[1] = { playerId: 1, relation: "shimocha", riichiAccepted: true,
    discards: [{ tile: "1m", tsumogiri: false }], calls: [], safety: { genbutsu: ["1m"], suji: ["4m"] } };
  const result = computePushFold(scene);
  assert.equal(result.code, "fold"); assert.equal(result.tileDanger.expected.label, "危");
  assert.ok(result.defenceScore > result.attackScore);
  assert.match(result.evidence.map(item => item.text).join(" "), /下家がリーチ済み/);
});

test("genbutsu and suji are distinguished against a riichi", () => {
  const player = { playerId: 2, relation: "toimen", riichiAccepted: true, safety: { genbutsu: ["7p"], suji: ["4m"] }, calls: [], discards: [] };
  const opponent = { player, threat: estimateOpponentThreat(player, 10) };
  assert.equal(estimateTileDanger("7p", [opponent], {}).label, "現");
  const suji = estimateTileDanger("4m", [opponent], {});
  assert.equal(suji.label, "中"); assert.match(suji.evidence[0], /単騎・双碰/);
});

test("two calls followed by tedashi raise the threat estimate", () => {
  const low = estimateOpponentThreat({ playerId: 3, relation: "kamicha", calls: [], discards: [], riichiAccepted: false }, 9);
  const high = estimateOpponentThreat({ playerId: 3, relation: "kamicha", riichiAccepted: false,
    calls: [{ type: "pon", atDiscardCount: 2 }, { type: "chi", atDiscardCount: 4 }],
    discards: [{ tile: "1m", tsumogiri: false }, { tile: "2m", tsumogiri: true }, { tile: "3m", tsumogiri: false },
      { tile: "4m", tsumogiri: true }, { tile: "5m", tsumogiri: false }, { tile: "6m", tsumogiri: false }] }, 9);
  assert.ok(high.score > low.score); assert.equal(high.callCount, 2); assert.equal(high.tedashiAfterCall, 2); assert.match(high.evidence, /2副露/);
});

test("an all-last top adds defensive weight while a chasing player adds attacking weight", () => {
  const top = baseScene({ position: { junme: 12, turnPhase: "中盤", isLastKyoku: true }, standings: { selfRank: 1 } });
  top.table.players[1] = { playerId: 1, relation: "shimocha", riichiAccepted: true, discards: [], calls: [], safety: { genbutsu: [], suji: [] } };
  const chase = structuredClone(top); chase.standings.selfRank = 4;
  const topResult = computePushFold(top); const chaseResult = computePushFold(chase);
  assert.ok(topResult.defenceScore > chaseResult.defenceScore); assert.ok(chaseResult.attackScore > topResult.attackScore);
});

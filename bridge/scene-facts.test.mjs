import assert from "node:assert/strict";
import test from "node:test";
import { computeSafety, computeStandings, computeVisibleCounts, decisionAxes, turnPhase, verifiedPerspective, verifiedTileCounts } from "./scene-facts.mjs";

function sceneFor(overrides = {}) {
  return {
    position: { turnPhase: "序盤", isLastKyoku: false },
    standings: { selfRank: 1, topDiff: 0, lastDiff: 0 },
    verifiedTileCounts: { dora: { omote: 0, aka: 0, total: 0 } },
    table: { kyotakuSticks: null, players: [{ relation: "self", riichiAccepted: false, calls: [] }] },
    ukeire: null,
    ...overrides
  };
}

const headings = scene => decisionAxes(scene).map(axis => axis.heading);

test("verified tile counts do not double-count recommended actions", () => {
  const counts = verifiedTileCounts(
    ["3m", "4m", "6m", "6m", "2p", "3p", "4p", "6p", "8p", "8p", "2s", "8s", "8s", "2s"],
    ["8s"]
  );
  assert.equal(counts.hand["8s"], 2);
  assert.equal(counts.doraIndicators["8s"], 1);
});

test("red fives count as the same tile kind", () => {
  const counts = verifiedTileCounts(["5mr", "5m", "5pr"], ["5p"]);
  assert.equal(counts.hand["5m"], 2);
  assert.equal(counts.hand["5p"], 1);
  assert.equal(counts.doraIndicators["5p"], 1);
});

test("verifiedTileCounts computes omote and aka dora in hand from indicators", () => {
  const counts = verifiedTileCounts(
    ["3m", "4m", "4m", "5mr", "6p", "2s", "2s", "E", "E"],
    ["3m", "1s"]
  );
  assert.equal(counts.dora.omote, 4);
  assert.equal(counts.dora.aka, 1);
  assert.equal(counts.dora.total, 5);
});

test("verifiedTileCounts wraps numbered, wind and dragon dora indicators", () => {
  assert.equal(verifiedTileCounts(["9m"], ["8m"]).dora.omote, 1);
  assert.equal(verifiedTileCounts(["E"], ["N"]).dora.omote, 1);
  assert.equal(verifiedTileCounts(["P"], ["C"]).dora.omote, 1);
});

test("verified perspective fixes the user seat and opponent relations", () => {
  const perspective = verifiedPerspective(2, "W", [
    { playerId: 0, relation: "self", seatWind: "E" },
    { playerId: 1, relation: "kamicha", seatWind: "S" },
    { playerId: 2, relation: "self", seatWind: "W" },
    { playerId: 3, relation: "shimocha", seatWind: "N" }
  ], [24000, 25000, 26000, 25000]);
  assert.equal(perspective.selfPlayerId, 2);
  assert.equal(perspective.selfSeatWind, "W");
  assert.equal(perspective.players.find(player => player.playerId === 2).relation, "自分");
  assert.equal(perspective.players.find(player => player.playerId === 0).relation, "対面");
  assert.equal(perspective.players.find(player => player.playerId === 2).relationCode, "self");
  assert.equal(perspective.selfScore, 26000);
  assert.equal(perspective.players.find(player => player.playerId === 0).score, 24000);
});

test("computeStandings ranks players and measures the gap to top/last", () => {
  const standings = computeStandings([25000, 32000, 18000, 25000], 0);
  assert.equal(standings.selfRank, 2);
  assert.equal(standings.isTopTied, false);
  assert.equal(standings.topDiff, 7000);
  assert.equal(standings.lastDiff, 7000);
  assert.equal(standings.players.find(p => p.playerId === 1).rank, 1);
  assert.equal(standings.players.find(p => p.playerId === 1).diffFromSelf, 7000);
  assert.equal(standings.players.find(p => p.playerId === 2).rank, 4);
  assert.equal(standings.players.find(p => p.playerId === 2).diffFromSelf, -7000);
});

test("computeStandings treats tied scores as the same rank", () => {
  const standings = computeStandings([30000, 30000, 25000, 15000], 1);
  assert.equal(standings.selfRank, 1);
  assert.equal(standings.isTopTied, true);
  assert.equal(standings.topDiff, 0);
  assert.equal(standings.players.find(p => p.playerId === 0).rank, 1);
  assert.equal(standings.players.find(p => p.playerId === 2).rank, 3);
});

test("computeStandings returns null when scores are incomplete", () => {
  assert.equal(computeStandings([25000, 25000, 25000], 0), null);
  assert.equal(computeStandings([25000, 25000, 25000, null], 0), null);
  assert.equal(computeStandings([25000, 25000, 25000, 25000], 9), null);
});

test("computeSafety marks discarded tiles as genbutsu and derives suji from them", () => {
  const safety = computeSafety(["4m", "6p", "E"]);
  assert.deepEqual(safety.genbutsu.sort(), ["4m", "6p", "E"].sort());
  assert.ok(safety.suji.includes("1m"));
  assert.ok(safety.suji.includes("7m"));
  assert.ok(safety.suji.includes("3p"));
  assert.ok(safety.suji.includes("9p"));
  assert.ok(!safety.suji.includes("4m"));
});

test("computeSafety normalizes red fives before matching suji", () => {
  const safety = computeSafety(["5mr"]);
  assert.deepEqual(safety.genbutsu, ["5m"]);
  assert.deepEqual(safety.suji.sort(), ["2m", "8m"].sort());
});

test("computeVisibleCounts sums tiles across hand, discards, calls and dora indicators", () => {
  const counts = computeVisibleCounts([
    ["5m", "5m"],
    ["3p"],
    ["5mr"],
    ["5m"]
  ]);
  assert.equal(counts["5m"], 4);
  assert.equal(counts["3p"], 1);
});

test("a wide ukeire gap makes hand structure the leading axis", () => {
  const scene = sceneFor({
    ukeire: { bestShanten: 2, candidates: [
      { tile: "7s", isMortalTop: true, isActual: false, shantenAfter: 2, ukeire: 39, keepsShanten: true },
      { tile: "5p", isMortalTop: false, isActual: true, shantenAfter: 2, ukeire: 25, keepsShanten: true }
    ] }
  });
  const result = decisionAxes(scene);
  assert.equal(result[0].heading, "手牌構造面");
  assert.match(result[0].note, /39枚/);
  // 平場・ドラ無し・リーチ無しなら、安全性や打点は出さない。
  assert.ok(!headings(scene).includes("安全性"));
  assert.ok(!headings(scene).includes("手役・打点面"));
});

test("an accepted riichi puts safety at the top", () => {
  const scene = sceneFor({
    table: { kyotakuSticks: null, players: [
      { relation: "self", riichiAccepted: false, calls: [] },
      { relation: "下家", riichiAccepted: true, calls: [] }
    ] },
    ukeire: { bestShanten: 2, candidates: [
      { tile: "7s", isMortalTop: true, isActual: false, shantenAfter: 2, ukeire: 30, keepsShanten: true },
      { tile: "5p", isMortalTop: false, isActual: true, shantenAfter: 2, ukeire: 29, keepsShanten: true }
    ] }
  });
  assert.equal(decisionAxes(scene)[0].heading, "安全性");
});

test("a discard that loses a shanten is reported as the decisive structural error", () => {
  const scene = sceneFor({
    ukeire: { bestShanten: 1, candidates: [
      { tile: "7s", isMortalTop: true, isActual: false, shantenAfter: 1, ukeire: 20, keepsShanten: true },
      { tile: "5p", isMortalTop: false, isActual: true, shantenAfter: 2, ukeire: 60, keepsShanten: false }
    ] }
  });
  const result = decisionAxes(scene);
  assert.equal(result[0].heading, "手牌構造面");
  assert.match(result[0].note, /後退/);
});

test("the final hand and a close race bring situation into the explanation", () => {
  const lastKyoku = sceneFor({ position: { turnPhase: "終盤", isLastKyoku: true } });
  assert.equal(decisionAxes(lastKyoku)[0].heading, "状況判断");

  const chasing = sceneFor({ standings: { selfRank: 3, topDiff: 12000, lastDiff: 2000 } });
  assert.ok(headings(chasing).includes("状況判断"));

  // 大差の平場では着順の話を持ち出さない。
  const settled = sceneFor({ standings: { selfRank: 2, topDiff: 30000, lastDiff: 30000 } });
  assert.ok(!headings(settled).includes("状況判断"));
});

test("dora in hand raises the value axis, and at most three axes are returned", () => {
  const scene = sceneFor({
    position: { turnPhase: "終盤", isLastKyoku: true },
    standings: { selfRank: 3, topDiff: 3000, lastDiff: 1000 },
    verifiedTileCounts: { dora: { omote: 2, aka: 1, total: 3 } },
    table: { kyotakuSticks: 2, players: [
      { relation: "self", riichiAccepted: false, calls: [] },
      { relation: "対面", riichiAccepted: true, calls: [] }
    ] },
    ukeire: { bestShanten: 1, candidates: [
      { tile: "7s", isMortalTop: true, isActual: false, shantenAfter: 1, ukeire: 40, keepsShanten: true },
      { tile: "5p", isMortalTop: false, isActual: true, shantenAfter: 1, ukeire: 10, keepsShanten: true }
    ] }
  });
  const result = decisionAxes(scene);
  assert.ok(result.length <= 3, "観点は最大3つ");
  assert.ok(result.length >= 1);
  assert.equal(new Set(result.map(axis => axis.heading)).size, result.length, "見出しは重複しない");
});

test("decisionAxes always returns at least one axis", () => {
  const bare = sceneFor();
  assert.ok(decisionAxes(bare).length >= 1);
  assert.ok(decisionAxes({}).length >= 0);
});

test("turnPhase labels junme as early, mid or late game", () => {
  assert.equal(turnPhase(1), "序盤");
  assert.equal(turnPhase(6), "序盤");
  assert.equal(turnPhase(7), "中盤");
  assert.equal(turnPhase(12), "中盤");
  assert.equal(turnPhase(13), "終盤");
  assert.equal(turnPhase(18), "終盤");
  assert.equal(turnPhase(0), null);
  assert.equal(turnPhase(null), null);
});

test("player 1 can be East with 26000 points without reading the upper player's score", () => {
  const perspective = verifiedPerspective(1, "E", [
    { playerId: 0, seatWind: "N" },
    { playerId: 1, seatWind: "E" },
    { playerId: 2, seatWind: "S" },
    { playerId: 3, seatWind: "W" }
  ], [24000, 26000, 25000, 25000]);
  assert.equal(perspective.selfPlayerId, 1);
  assert.equal(perspective.selfSeatWind, "E");
  assert.equal(perspective.selfScore, 26000);
  assert.equal(perspective.players.find(player => player.relationCode === "kamicha").score, 24000);
});

import assert from "node:assert/strict";
import test from "node:test";
import { applyDeltas, basicPoints, buildScoreSimulation, calculateHandPoints, rankScores } from "./score-simulator.mjs";

test("basic points apply standard limit hands", () => {
  assert.deepEqual(basicPoints(1, 30), { base: 240, limit: null });
  assert.deepEqual(basicPoints(4, 40), { base: 2000, limit: "満貫" });
  assert.deepEqual(basicPoints(6, 30), { base: 3000, limit: "跳満" });
  assert.deepEqual(basicPoints(13, 30), { base: 8000, limit: "数え役満" });
  assert.equal(basicPoints(2, null), null);
});

test("ron points include dealer, honba and kyotaku correctly", () => {
  const child = calculateHandPoints({ han: 3, fu: 40, dealer: false, tsumo: false });
  assert.equal(child.handPoints, 5200);
  const dealer = calculateHandPoints({ han: 3, fu: 40, dealer: true, tsumo: false, honba: 2, kyotaku: 1 });
  assert.equal(dealer.handPoints, 7700);
  assert.equal(dealer.payment, 8300);
  assert.equal(dealer.winnerGain, 9300);
});

test("tsumo payments split between dealer and children", () => {
  const childMangan = calculateHandPoints({ han: 5, fu: 30, dealer: false, tsumo: true, honba: 1 });
  assert.deepEqual(childMangan.payments, { dealer: 4100, child: 2100 });
  assert.equal(childMangan.winnerGain, 8300);
  const dealerMangan = calculateHandPoints({ han: 5, fu: 30, dealer: true, tsumo: true });
  assert.deepEqual(dealerMangan.payments, { each: 4000 });
  assert.equal(dealerMangan.winnerGain, 12000);
});

test("score deltas calculate tied ranks deterministically", () => {
  const result = applyDeltas([25000, 26000, 24000, 25000], [-3900, 3900, 0, 0], 0);
  assert.deepEqual(result.afterScores, [21100, 29900, 24000, 25000]);
  assert.equal(result.selfRank, 4);
  assert.deepEqual(rankScores([30000, 30000, 25000, 15000]).map(item => item.rank), [1, 1, 3, 4]);
});

test("simulation keeps hypothetical scores separate from the actual result", () => {
  const scene = {
    playerId: 0, scores: [25000, 25000, 25000, 25000], position: { honba: 1 },
    table: { kyotakuSticks: 1, players: [{ playerId: 0 }, { playerId: 1 }, { playerId: 2 }, { playerId: 3 }] },
    verifiedPerspective: { players: [{ playerId: 1, relation: "下家" }] },
    pushFold: { opponents: [{ playerId: 1, score: 100, evidence: "下家がリーチ済み" }] },
    roundOutcome: { events: [{ type: "hora", actor: 2, target: 0, deltas: [-8000, 0, 8000, 0] }], scoresAfter: [17000, 25000, 33000, 25000] }
  };
  const result = buildScoreSimulation(scene);
  assert.equal(result.assumedOpponent.relation, "下家");
  assert.equal(result.selfRon[0].selfDelta, 5200, "3900 + 1本場 + 供託1000");
  assert.equal(result.dealIn[0].selfDelta, -4200, "放銃者は3900 + 1本場を支払う");
  assert.equal(result.actual.label, "自分の放銃");
  assert.equal(result.actual.afterScore, 17000);
  assert.equal(result.actual.afterRank, 4);
});

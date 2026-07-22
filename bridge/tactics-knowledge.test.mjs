import assert from "node:assert/strict";
import test from "node:test";
import { buildTacticsGuidance, noRyanmenEvidence, TACTICS_SOURCES } from "./tactics-knowledge.mjs";

function scene({ expectedShanten = 1, actualShanten = 1, expectedUkeire = 16, actualUkeire = 10, threat = false } = {}) {
  return {
    position: { junme: 6 }, shanten: 1,
    expected: { type: "dahai", pai: "7p" }, actual: { type: "dahai", pai: "9m" },
    ukeire: { candidates: [
      { tile: "7p", isMortalTop: true, shantenAfter: expectedShanten, ukeire: expectedUkeire, ukeireTiles: ["3m×4", "6m×4"] },
      { tile: "9m", isActual: true, shantenAfter: actualShanten, ukeire: actualUkeire, ukeireTiles: ["3m×4"] }
    ] },
    table: { visibleCounts: {}, players: [] },
    pushFold: {
      opponents: threat ? [{ level: "critical", callCount: 0 }] : [{ level: "low", callCount: 0 }],
      tileDanger: { expected: { score: 20, evidence: ["下家に対してスジ"] }, actual: { score: 70, evidence: ["下家に通っていない"] } }
    }
  };
}

test("source ledger contains every efficiency and defense article", () => {
  assert.equal(TACTICS_SOURCES.length, 15);
  assert.equal(new Set(TACTICS_SOURCES.map(source => source.id)).size, 15);
  assert.ok(TACTICS_SOURCES.every(source => source.url.startsWith("https://teriyaki-mahjong.com/")));
});

test("same-shanten candidates get an exact ukeire comparison", () => {
  const guidance = buildTacticsGuidance(scene());
  const comparison = guidance.matched.find(item => item.id === "compare-ukeire");
  assert.match(comparison.reason, /16枚、実打10枚で6枚差/);
  assert.ok(guidance.matched.some(item => item.id === "no-threat-speed"));
});

test("shanten regression outranks raw ukeire", () => {
  const guidance = buildTacticsGuidance(scene({ actualShanten: 2, actualUkeire: 30 }));
  assert.equal(guidance.matched[0].id, "keep-shanten");
});

test("threat adds defense rules without claiming a probability", () => {
  const guidance = buildTacticsGuidance(scene({ expectedShanten: 2, actualShanten: 2, threat: true }));
  assert.ok(guidance.matched.some(item => item.id === "safer-candidate"));
  assert.ok(guidance.matched.some(item => item.id === "distant-hand-fold"));
  assert.ok(guidance.matched.some(item => item.id === "suji-limit"));
  assert.doesNotMatch(JSON.stringify(guidance), /放銃率\d|聴牌率\d/);
});

test("four-tile walls only reject all ryanmen structures", () => {
  assert.equal(noRyanmenEvidence("5p", { "3p": 4 }), null);
  const blocked = noRyanmenEvidence("5p", { "3p": 4, "7p": 4 });
  assert.deepEqual(blocked.walls, ["3p", "7p"]);
  assert.match(blocked.reason, /両面待ちは否定/);
  assert.equal(noRyanmenEvidence("1s", { "3s": 4 }).tile, "1s");
});

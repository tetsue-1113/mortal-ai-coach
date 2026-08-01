import assert from "node:assert/strict";
import test from "node:test";
import { assessDecision } from "./decision-assessment.mjs";

function scene(overrides = {}) {
  return {
    actual: { type: "dahai", pai: "N" }, expected: { type: "dahai", pai: "W" },
    context: { roundWind: "E", seatWind: "E" }, metrics: { loss: 0.44, expectedQ: -0.12, actualQ: -0.56 },
    alternatives: [],
    ukeire: { candidates: [
      { tile: "W", isMortalTop: true, shantenAfter: 4, ukeire: 30 },
      { tile: "N", isActual: true, shantenAfter: 4, ukeire: 30 }
    ] },
    pushFold: { tileDanger: { expected: { score: 20 }, actual: { score: 20 } } },
    ...overrides
  };
}

test("matching actions are classified as match", () => {
  assert.equal(assessDecision(scene({ actual: { type: "dahai", pai: "W" } })).verdict, "match");
});

test("model-only preference is uncertain when observable discard facts are equivalent", () => {
  const result = assessDecision(scene());
  assert.equal(result.verdict, "uncertain");
  assert.equal(result.modelOnlyPreference, true);
});

test("different tile value classes are not treated as equivalent", () => {
  const result = assessDecision(scene({ actual: { type: "dahai", pai: "F" } }));
  assert.equal(result.verdict, "major");
});

test("even a one-tile ukeire difference remains an explainable difference", () => {
  const changed = scene();
  changed.ukeire.candidates[1].ukeire = 29;
  assert.equal(assessDecision(changed).verdict, "major");
});

test("partial alternative metrics are retained in the ranked view", () => {
  const result = assessDecision(scene({ alternatives: [
    { action: { type: "dahai", pai: "9m" }, q: -0.2, probability: null },
    { action: { type: "dahai", pai: "8m" }, q: null, probability: 0.1 }
  ] }));
  assert.equal(result.candidates.length, 4);
  assert.ok(result.candidates.some(candidate => candidate.action.pai === "9m" && candidate.q === -0.2));
  assert.ok(result.candidates.some(candidate => candidate.action.pai === "8m" && candidate.probability === 0.1));
});

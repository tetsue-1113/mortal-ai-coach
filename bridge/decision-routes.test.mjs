import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionRoutes } from "./decision-routes.mjs";

test("routes keep actual and Mortal top and add a defensive contrast", () => {
  const scene = {
    position: { junme: 10 }, table: { visibleCounts: {}, players: [
      { playerId: 0, relation: "self", discards: [], calls: [] },
      { playerId: 1, relation: "shimocha", riichiAccepted: true,
        discards: [{ tile: "8m" }], calls: [], safety: { genbutsu: ["8m"], suji: ["5m"] } }
    ] },
    decisionAssessment: { candidates: [
      { action: { type: "dahai", pai: "2s" }, q: 0.5, qDeltaFromTop: 0, isMortalTop: true, isActual: false },
      { action: { type: "dahai", pai: "5m" }, q: 0.45, qDeltaFromTop: 0.05, isMortalTop: false, isActual: true },
      { action: { type: "dahai", pai: "8m" }, q: 0.4, qDeltaFromTop: 0.1, isMortalTop: false, isActual: false }
    ] },
    ukeire: { candidates: [
      { tile: "2s", shantenAfter: 1, ukeire: 16, ukeireTiles: [] },
      { tile: "5m", shantenAfter: 1, ukeire: 12, ukeireTiles: [] },
      { tile: "8m", shantenAfter: 2, ukeire: 25, ukeireTiles: [] }
    ] }
  };
  const routes = buildDecisionRoutes(scene);
  assert.equal(routes.length, 3);
  assert.ok(routes.some(route => route.isActual));
  assert.ok(routes.some(route => route.isMortalTop));
  assert.equal(routes.find(route => route.tile === "8m").route, "守備");
  assert.equal(routes.find(route => route.tile === "2s").route, "最速");
});

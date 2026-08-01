import assert from "node:assert/strict";
import test from "node:test";
import { buildCase, classifyScene, sceneTags, selectRows } from "./generate-evaluation-set.mjs";

function scene(overrides = {}) {
  return {
    actual: { type: "dahai", pai: "1m" },
    expected: { type: "dahai", pai: "2m" },
    position: { isLastKyoku: false },
    context: { dealer: false },
    flags: { callDecision: false, furiten: false },
    metrics: { loss: 0.1 },
    shanten: 1,
    pushFold: { opponents: [] },
    tacticsGuidance: { matched: [] },
    ...overrides
  };
}

test("classification gives strategic decisions priority over generic discard groups", () => {
  assert.equal(classifyScene(scene({ actual: { type: "reach" } })), "riichi");
  assert.equal(classifyScene(scene({ flags: { callDecision: true } })), "calls");
  assert.equal(classifyScene(scene({ position: { isLastKyoku: true } })), "placement");
});

test("threatening discard scenes are defense and calm mismatches are efficiency", () => {
  assert.equal(classifyScene(scene({
    pushFold: { opponents: [{ level: "high", callCount: 0 }] }
  })), "defense");
  assert.equal(classifyScene(scene()), "efficiency");
});

test("matching actions form the control group", () => {
  assert.equal(classifyScene(scene({
    actual: { type: "dahai", pai: "2m" },
    expected: { type: "dahai", pai: "2m" },
    metrics: { loss: 0 }
  })), "control");
});

test("selection prefers existing baselines and is stable", () => {
  const rows = ["a", "b", "c"].map((id, index) => ({
    originalSceneId: id,
    source: {},
    scene: scene(),
    baseline: index === 1 ? { reason: "existing", lesson: "" } : null
  }));
  const quotas = { efficiency: 2 };
  const first = selectRows(rows, quotas, "seed");
  const second = selectRows(rows, quotas, "seed");
  assert.equal(first[0].originalSceneId, "b");
  assert.deepEqual(first.map(item => item.originalSceneId), second.map(item => item.originalSceneId));
});

test("default-sized category selection balances severity bands", () => {
  const severities = [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `major-${index}`, loss: 0.1 })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `clear-${index}`, loss: 0.04 })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `minor-${index}`, loss: 0.01 }))
  ];
  const rows = severities.map(item => ({
    originalSceneId: item.id,
    source: {},
    scene: scene({ metrics: { loss: item.loss } }),
    baseline: null
  }));
  const picked = selectRows(rows, { efficiency: 10 }, "seed", {
    efficiency: { major: 4, clear: 3, minor: 3, match: 0 }
  });
  assert.deepEqual(
    ["major", "clear", "minor"].map(level => picked.filter(row => row.originalSceneId.startsWith(level)).length),
    [4, 3, 3]
  );
});

test("built cases replace source identifiers and start unreviewed", () => {
  const source = { sceneId: "private-scene", reportId: "private-report", roundOutcome: { events: [] }, hand: ["1m"] };
  const normalized = scene({ tacticsGuidance: { matched: [{ id: "compare-ukeire" }] } });
  const value = buildCase({
    source,
    scene: normalized,
    category: "efficiency",
    baseline: null
  }, 0);
  assert.equal(value.caseId, "eval-v1-001");
  assert.equal(value.input.sceneId, value.caseId);
  assert.equal(value.input.reportId, "evaluation");
  assert.equal("roundOutcome" in value.input, false);
  assert.equal(value.reference.status, "unreviewed");
  assert.equal(value.input.shanten, normalized.shanten);
  assert.ok(value.tags.includes("rule:compare-ukeire"));
});

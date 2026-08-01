function actionKey(action) {
  return JSON.stringify({ type: action?.type || null, pai: action?.pai || null, consumed: action?.consumed || [] });
}

function sameAction(left, right) {
  return actionKey(left) === actionKey(right);
}

function qVerdict(loss) {
  if (!Number.isFinite(loss) || loss < 0.01) return "equivalent";
  if (loss < 0.03) return "minor";
  if (loss < 0.08) return "clear";
  return "major";
}

function tileClass(tile, context) {
  if (/^5[mps]r$/.test(tile || "")) return "red-five";
  if (["P", "F", "C"].includes(tile)) return "yakuhai";
  if (tile === context?.roundWind || tile === context?.seatWind) return "yakuhai";
  if (["E", "S", "W", "N"].includes(tile)) return "guest-wind";
  return "numbered";
}

function rankedCandidates(scene) {
  const byAction = new Map();
  const add = (action, q, probability, flags = {}) => {
    if (!action) return;
    const key = actionKey(action);
    const current = byAction.get(key) || { action, q: null, probability: null, isActual: false, isMortalTop: false };
    if (Number.isFinite(q)) current.q = Number(q);
    if (Number.isFinite(probability)) current.probability = Number(probability);
    current.isActual ||= !!flags.isActual;
    current.isMortalTop ||= !!flags.isMortalTop;
    byAction.set(key, current);
  };
  for (const alternative of scene?.alternatives || []) add(alternative.action, alternative.q, alternative.probability);
  add(scene?.expected, scene?.metrics?.expectedQ, null, { isMortalTop: true });
  add(scene?.actual, scene?.metrics?.actualQ, null, { isActual: true, isMortalTop: sameAction(scene?.actual, scene?.expected) });
  const values = [...byAction.values()].sort((left, right) => {
    if (Number.isFinite(left.q) && Number.isFinite(right.q)) return right.q - left.q;
    if (Number.isFinite(left.q)) return -1;
    if (Number.isFinite(right.q)) return 1;
    return Number(right.isMortalTop) - Number(left.isMortalTop);
  });
  const topQ = values.find(candidate => Number.isFinite(candidate.q))?.q ?? null;
  return values.map((candidate, index) => ({
    ...candidate, rank: index + 1,
    qDeltaFromTop: Number.isFinite(topQ) && Number.isFinite(candidate.q) ? Math.max(0, topQ - candidate.q) : null
  }));
}

function observableEquivalence(scene) {
  if (scene?.actual?.type !== "dahai" || scene?.expected?.type !== "dahai") return false;
  const actual = scene?.ukeire?.candidates?.find(candidate => candidate.isActual);
  const expected = scene?.ukeire?.candidates?.find(candidate => candidate.isMortalTop);
  if (!actual || !expected || actual.shantenAfter !== expected.shantenAfter || actual.ukeire !== expected.ukeire) return false;
  if (tileClass(scene.actual.pai, scene.context) !== tileClass(scene.expected.pai, scene.context)) return false;
  const actualDanger = scene?.pushFold?.tileDanger?.actual;
  const expectedDanger = scene?.pushFold?.tileDanger?.expected;
  if (Number.isFinite(actualDanger?.score) && Number.isFinite(expectedDanger?.score)
      && Math.abs(actualDanger.score - expectedDanger.score) > 5) return false;
  return true;
}

export function assessDecision(scene) {
  const candidates = rankedCandidates(scene);
  if (sameAction(scene?.actual, scene?.expected)) {
    return { verdict: "match", qDelta: 0, confidence: "high", observableEquivalent: true,
      modelOnlyPreference: false, candidates, reason: "実打とMortal推奨が一致" };
  }
  const loss = Number.isFinite(Number(scene?.metrics?.loss)) ? Math.abs(Number(scene.metrics.loss))
    : Number.isFinite(Number(scene?.metrics?.expectedQ)) && Number.isFinite(Number(scene?.metrics?.actualQ))
      ? Math.max(0, Number(scene.metrics.expectedQ) - Number(scene.metrics.actualQ)) : null;
  const equivalent = observableEquivalence(scene);
  const rawVerdict = qVerdict(loss);
  if (equivalent && ["clear", "major"].includes(rawVerdict)) {
    return { verdict: "uncertain", qDelta: loss, confidence: "low", observableEquivalent: true,
      modelOnlyPreference: true, candidates,
      reason: "計算できるシャンテン・受け入れ・牌価値区分・現在危険度はほぼ同じだが、MortalのQ値だけに差がある" };
  }
  return { verdict: rawVerdict, qDelta: loss, confidence: Number.isFinite(loss) ? "medium" : "low",
    observableEquivalent: equivalent, modelOnlyPreference: false, candidates,
    reason: Number.isFinite(loss) ? "Mortalの候補評価差と計算済み局面差から分類" : "候補評価値が不足しているため差を断定しない" };
}

import { estimateOpponentThreat, estimateTileDanger } from "./push-fold.mjs";

const key = action => JSON.stringify({ type: action?.type || null, pai: action?.pai || null, consumed: action?.consumed || [] });

function candidateFacts(scene, candidate, opponents) {
  const ukeire = scene?.ukeire?.candidates?.find(item => item.tile === candidate?.action?.pai) || null;
  const danger = estimateTileDanger(candidate?.action?.pai, opponents, scene?.table?.visibleCounts);
  return { ...candidate, tile: candidate?.action?.pai || null, shantenAfter: ukeire?.shantenAfter ?? null,
    ukeire: ukeire?.ukeire ?? null, ukeireTiles: ukeire?.ukeireTiles || [], danger };
}

function attackOrder(left, right) {
  const leftShanten = Number.isFinite(left.shantenAfter) ? left.shantenAfter : 99;
  const rightShanten = Number.isFinite(right.shantenAfter) ? right.shantenAfter : 99;
  return leftShanten - rightShanten || (right.ukeire ?? -1) - (left.ukeire ?? -1)
    || (right.q ?? -Infinity) - (left.q ?? -Infinity);
}

export function buildDecisionRoutes(scene) {
  const players = (scene?.table?.players || []).filter(player => player.relation !== "self");
  const opponents = players.map(player => ({ player, threat: estimateOpponentThreat(player, scene?.position?.junme) }));
  const candidates = (scene?.decisionAssessment?.candidates || [])
    .filter(candidate => candidate?.action?.type === "dahai" && candidate.action.pai)
    .map(candidate => candidateFacts(scene, candidate, opponents));
  if (!candidates.length) return [];

  const attack = [...candidates].sort(attackOrder)[0];
  const hasThreat = opponents.some(opponent => opponent.threat.score >= 25 || opponent.player.riichiAccepted);
  const defence = hasThreat ? [...candidates].sort((left, right) => left.danger.score - right.danger.score || attackOrder(left, right))[0] : null;
  const expected = candidates.find(candidate => candidate.isMortalTop) || null;
  const actual = candidates.find(candidate => candidate.isActual) || null;

  const selected = [];
  const add = candidate => {
    if (candidate && !selected.some(item => key(item.action) === key(candidate.action))) selected.push(candidate);
  };
  add(expected);
  add(actual);
  add(defence);
  add(attack);
  for (const candidate of candidates) add(candidate);

  return selected.slice(0, 3).map(candidate => {
    const route = key(candidate.action) === key(attack.action) ? "最速"
      : defence && key(candidate.action) === key(defence.action) ? "守備" : "中間";
    return {
      route, action: candidate.action, tile: candidate.tile,
      isActual: candidate.isActual, isMortalTop: candidate.isMortalTop,
      shantenAfter: candidate.shantenAfter, ukeire: candidate.ukeire, ukeireTiles: candidate.ukeireTiles,
      danger: candidate.danger, q: candidate.q, qDeltaFromTop: candidate.qDeltaFromTop,
      probability: candidate.probability,
      note: route === "最速" ? "シャンテンを優先し、同じなら受け入れを最大化"
        : route === "守備" ? "明確な攻撃者に対する現在危険度を最小化" : "Mortal推奨・実打を含む中間候補"
    };
  });
}

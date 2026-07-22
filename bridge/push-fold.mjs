const RELATION_LABELS = {
  shimocha: "下家",
  toimen: "対面",
  kamicha: "上家"
};

const OPEN_CALLS = new Set(["chi", "pon", "daiminkan", "kakan", "kan"]);

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function numberedTile(tile) {
  const match = /^([1-9])([mps])$/.exec(String(tile || "").replace(/^5([mps])r$/, "5$1"));
  return match ? { number: Number(match[1]), suit: match[2] } : null;
}

function relationLabel(player) {
  return RELATION_LABELS[player?.relation] || `他家${Number(player?.playerId) + 1}`;
}

function openCalls(player) {
  return (player?.calls || []).filter(call => OPEN_CALLS.has(call?.type));
}

/**
 * リーチ以外は公開情報からの補助推定。和了率・放銃率ではない。
 * 副露後の手出しが増えるほど手牌が整っている可能性を高く置く。
 */
export function estimateOpponentThreat(player, junme) {
  if (player?.riichiAccepted) {
    return { score: 100, level: "critical", label: "リーチ", evidence: `${relationLabel(player)}がリーチ済み` };
  }
  const calls = openCalls(player);
  const callCount = calls.length;
  const discards = player?.discards || [];
  const lastCallAt = callCount ? Number(calls.at(-1)?.atDiscardCount) : null;
  const afterCall = Number.isFinite(lastCallAt) ? discards.slice(lastCallAt) : [];
  const tedashiAfterCall = afterCall.filter(discard => !discard.tsumogiri).length;
  const turn = Number.isFinite(Number(junme)) ? Number(junme) : discards.length;

  let score;
  if (callCount === 0) score = 4 + Math.max(0, turn - 6) * 2;
  else if (callCount === 1) score = 18 + turn * 1.8 + tedashiAfterCall * 4;
  else if (callCount === 2) score = 34 + turn * 2 + tedashiAfterCall * 5;
  else score = 55 + turn * 2 + tedashiAfterCall * 4;
  score = clamp(score, 0, player?.riichiAccepted ? 100 : 92);

  const level = score >= 70 ? "high" : score >= 40 ? "watch" : "low";
  const details = callCount
    ? `${relationLabel(player)}は${callCount}副露${tedashiAfterCall ? `、副露後に手出し${tedashiAfterCall}回` : ""}`
    : `${relationLabel(player)}は門前・リーチなし`;
  return { score, level, label: level === "high" ? "高警戒" : level === "watch" ? "要警戒" : "低警戒", evidence: details, callCount, tedashiAfterCall };
}

function riskAgainst(tile, player, threatScore, visibleCounts) {
  const canonical = String(tile || "").replace(/^5([mps])r$/, "5$1");
  if (!canonical) return { score: 0, label: "—", evidence: "打牌候補なし" };
  if (player?.safety?.genbutsu?.includes(canonical)) {
    return { score: 0, label: "現", evidence: `${relationLabel(player)}の現物` };
  }

  const visible = Number(visibleCounts?.[canonical]) || 0;
  const numbered = numberedTile(canonical);
  let factor = 1;
  let evidence = `${relationLabel(player)}に通っていない`;
  if (!numbered) {
    if (visible >= 4) { factor = 0; evidence = `${canonical}は自牌を含め4枚見え`; }
    else if (visible === 3) { factor = 0.25; evidence = `${canonical}は自牌を含め3枚見え`; }
    else if (visible === 2) { factor = 0.48; evidence = `${canonical}は自牌を含め2枚見え`; }
    else { factor = 0.72; evidence = `${canonical}は現物ではない`; }
  } else if (player?.safety?.suji?.includes(canonical)) {
    factor = 0.45;
    evidence = `${relationLabel(player)}に対してスジ（単騎・双碰等は残る）`;
  } else if (numbered.number === 1 || numbered.number === 9) {
    factor = 0.78;
    evidence = `${relationLabel(player)}に通っていない端牌`;
  }
  return { score: clamp(threatScore * factor), label: "", evidence };
}

export function estimateTileDanger(tile, opponents, visibleCounts) {
  const targets = (opponents || []).filter(opponent => opponent.threat.score >= 25 || opponent.player.riichiAccepted || openCalls(opponent.player).length >= 2);
  if (!targets.length) return { tile, score: 0, label: "—", evidence: ["明確な攻撃者なし"] };
  const risks = targets.map(opponent => ({
    ...riskAgainst(tile, opponent.player, opponent.threat.score, visibleCounts),
    playerId: opponent.player.playerId
  }));
  const score = Math.max(...risks.map(risk => risk.score));
  const allGenbutsu = risks.every(risk => risk.label === "現");
  const label = allGenbutsu ? "現" : score <= 15 ? "安" : score <= 45 ? "中" : "危";
  return { tile, score, label, evidence: risks.sort((a, b) => b.score - a.score).slice(0, 2).map(risk => risk.evidence) };
}

function attackScore(scene, candidate) {
  const shanten = Number.isFinite(Number(candidate?.shantenAfter)) ? Number(candidate.shantenAfter) : Number(scene?.shanten);
  const base = shanten <= 0 ? 84 : shanten === 1 ? 64 : shanten === 2 ? 43 : shanten === 3 ? 27 : 15;
  const ukeire = Number(candidate?.ukeire) || 0;
  const dora = Number(scene?.verifiedTileCounts?.dora?.total) || 0;
  let score = base + Math.min(16, ukeire / 2.5) + Math.min(15, dora * 5) + (scene?.context?.dealer ? 5 : 0);
  if (scene?.flags?.furiten) score -= 10;
  if (scene?.position?.turnPhase === "終盤" && shanten >= 2) score -= 8;
  if (scene?.position?.isLastKyoku && Number(scene?.standings?.selfRank) >= 3) score += 8;
  return clamp(score);
}

function decisionFor(delta, hasThreat) {
  if (!hasThreat) return { code: "push", label: "押し", confidence: "medium" };
  if (delta >= 25) return { code: "push", label: "押し", confidence: "high" };
  if (delta >= 8) return { code: "lean_push", label: "やや押し", confidence: "medium" };
  if (delta > -8) return { code: "neutral", label: "比較保留", confidence: "low" };
  if (delta > -25) return { code: "lean_fold", label: "ややオリ", confidence: "medium" };
  return { code: "fold", label: "オリ", confidence: "high" };
}

/** 公開情報だけから作る説明可能な押し引き補助判定。数学的な期待値ではない。 */
export function computePushFold(scene) {
  const otherPlayers = (scene?.table?.players || []).filter(player => player.relation !== "self");
  const opponents = otherPlayers.map(player => ({ player, threat: estimateOpponentThreat(player, scene?.position?.junme) }));
  const strongest = opponents.sort((a, b) => b.threat.score - a.threat.score)[0] || null;
  const expectedTile = scene?.expected?.type === "dahai" ? scene.expected.pai : null;
  const actualTile = scene?.actual?.type === "dahai" ? scene.actual.pai : null;
  const expectedCandidate = scene?.ukeire?.candidates?.find(candidate => candidate.isMortalTop) || null;
  const actualCandidate = scene?.ukeire?.candidates?.find(candidate => candidate.isActual) || null;
  const expectedDanger = estimateTileDanger(expectedTile, opponents, scene?.table?.visibleCounts);
  const actualDanger = estimateTileDanger(actualTile, opponents, scene?.table?.visibleCounts);
  const attack = attackScore(scene, expectedCandidate);
  const hasThreat = !!strongest && (strongest.threat.score >= 25 || strongest.player.riichiAccepted || openCalls(strongest.player).length >= 2);
  let defence = hasThreat ? strongest.threat.score * 0.45 + expectedDanger.score * 0.35 : 0;
  if (scene?.position?.isLastKyoku && Number(scene?.standings?.selfRank) === 1) defence += 12;
  defence = clamp(defence);
  const delta = attack - defence;
  const decision = decisionFor(delta, hasThreat);

  const evidence = [];
  const shanten = Number.isFinite(Number(expectedCandidate?.shantenAfter)) ? Number(expectedCandidate.shantenAfter) : Number(scene?.shanten);
  if (Number.isFinite(shanten)) {
    evidence.push({ axis: "attack", text: `推奨打牌後は${shanten === 0 ? "テンパイ" : `${shanten}シャンテン`}${Number.isFinite(Number(expectedCandidate?.ukeire)) ? `、受け入れ${expectedCandidate.ukeire}枚` : ""}` });
  }
  const dora = Number(scene?.verifiedTileCounts?.dora?.total) || 0;
  if (dora) evidence.push({ axis: "attack", text: `手牌にドラが計${dora}枚` });
  if (hasThreat) evidence.push({ axis: "defence", text: strongest.threat.evidence });
  if (expectedTile && hasThreat) evidence.push({ axis: "defence", text: `${expectedTile}：${expectedDanger.evidence[0]}` });
  if (scene?.position?.isLastKyoku && scene?.standings) {
    evidence.push({ axis: "situation", text: Number(scene.standings.selfRank) === 1 ? "オーラスのトップ目" : `オーラスの${scene.standings.selfRank}着目` });
  }

  return {
    ...decision,
    attackScore: attack,
    defenceScore: defence,
    scoreDelta: delta,
    threatLevel: strongest?.threat?.level || "low",
    opponents: opponents.map(({ player, threat }) => ({ playerId: player.playerId, relation: player.relation, ...threat })),
    tileDanger: { expected: expectedDanger, actual: actualDanger },
    evidence: evidence.slice(0, 4),
    note: "公開情報による補助判定。放銃率・局収支・期待値そのものではありません。"
  };
}

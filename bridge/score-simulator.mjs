function ceil100(value) {
  return Math.ceil(value / 100) * 100;
}

function clampInteger(value, min = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.round(number)) : 0;
}

/** 翻・符から基本点を計算する。数え役満は13翻以上を役満として扱う。 */
export function basicPoints(han, fu, yakuman = 0) {
  const y = clampInteger(yakuman);
  if (y > 0) return { base: 8000 * y, limit: y === 1 ? "役満" : `${y}倍役満` };
  const h = clampInteger(han);
  const rawFu = Number(fu);
  if (h <= 0 || !Number.isFinite(rawFu) || rawFu < 20) return null;
  const f = Math.round(rawFu);
  if (h >= 13) return { base: 8000, limit: "数え役満" };
  if (h >= 11) return { base: 6000, limit: "三倍満" };
  if (h >= 8) return { base: 4000, limit: "倍満" };
  if (h >= 6) return { base: 3000, limit: "跳満" };
  const uncapped = f * (2 ** (h + 2));
  if (h >= 5 || uncapped >= 2000) return { base: 2000, limit: "満貫" };
  return { base: uncapped, limit: null };
}

/** 標準的な4人リーチ麻雀のロン／ツモ支払いを計算する。 */
export function calculateHandPoints({ han, fu, yakuman = 0, dealer = false, tsumo = false, honba = 0, kyotaku = 0 }) {
  const basic = basicPoints(han, fu, yakuman);
  if (!basic) return null;
  const h = clampInteger(honba);
  const sticks = clampInteger(kyotaku);
  if (!tsumo) {
    const handPoints = ceil100(basic.base * (dealer ? 6 : 4));
    const payment = handPoints + h * 300;
    return { ...basic, han: clampInteger(han), fu: clampInteger(fu), dealer: !!dealer, tsumo: false,
      handPoints, payment, winnerGain: payment + sticks * 1000, honbaBonus: h * 300, kyotakuBonus: sticks * 1000 };
  }
  if (dealer) {
    const each = ceil100(basic.base * 2) + h * 100;
    return { ...basic, han: clampInteger(han), fu: clampInteger(fu), dealer: true, tsumo: true,
      payments: { each }, handPoints: each * 3 - h * 300, winnerGain: each * 3 + sticks * 1000,
      honbaBonus: h * 300, kyotakuBonus: sticks * 1000 };
  }
  const child = ceil100(basic.base) + h * 100;
  const dealerPayment = ceil100(basic.base * 2) + h * 100;
  return { ...basic, han: clampInteger(han), fu: clampInteger(fu), dealer: false, tsumo: true,
    payments: { dealer: dealerPayment, child }, handPoints: dealerPayment + child * 2 - h * 300,
    winnerGain: dealerPayment + child * 2 + sticks * 1000, honbaBonus: h * 300, kyotakuBonus: sticks * 1000 };
}

export function rankScores(scores) {
  if (!Array.isArray(scores) || scores.length !== 4 || scores.some(score => !Number.isFinite(Number(score)))) return null;
  const sorted = scores.map((score, playerId) => ({ playerId, score: Number(score) })).sort((a, b) => b.score - a.score || a.playerId - b.playerId);
  sorted.forEach((entry, index) => { entry.rank = index === 0 ? 1 : entry.score === sorted[index - 1].score ? sorted[index - 1].rank : index + 1; });
  return sorted;
}

export function applyDeltas(scores, deltas, selfPlayerId) {
  if (!Array.isArray(scores) || !Array.isArray(deltas) || scores.length !== 4 || deltas.length !== 4) return null;
  const afterScores = scores.map((score, index) => Number(score) + Number(deltas[index]));
  if (afterScores.some(score => !Number.isFinite(score))) return null;
  const ranking = rankScores(afterScores);
  const self = ranking?.find(player => player.playerId === selfPlayerId);
  return { deltas: deltas.map(Number), afterScores, ranking, selfScore: afterScores[selfPlayerId], selfRank: self?.rank || null };
}

function relationLabel(scene, playerId) {
  const player = scene?.verifiedPerspective?.players?.find(item => item.playerId === playerId);
  return player?.relation || `他家${playerId + 1}`;
}

function scenario(scene, winner, loser, handPoints, kind) {
  const honba = clampInteger(scene?.position?.honba);
  const kyotaku = clampInteger(scene?.table?.kyotakuSticks);
  const payment = handPoints + honba * 300;
  const deltas = [0, 0, 0, 0];
  deltas[winner] += payment + kyotaku * 1000;
  deltas[loser] -= payment;
  const transition = applyDeltas(scene.scores, deltas, scene.playerId);
  return {
    kind, handPoints, honbaBonus: honba * 300, kyotakuBonus: kyotaku * 1000,
    payment, winner, loser, opponent: relationLabel(scene, winner === scene.playerId ? loser : winner),
    selfDelta: deltas[scene.playerId], afterScore: transition?.selfScore ?? null, afterRank: transition?.selfRank ?? null
  };
}

function actualOutcome(scene) {
  const events = scene?.roundOutcome?.events || [];
  const scoresAfter = scene?.roundOutcome?.scoresAfter;
  if (!events.length) return null;
  const totalDeltas = [0, 0, 0, 0];
  for (const event of events) {
    if (Array.isArray(event.deltas) && event.deltas.length === 4) event.deltas.forEach((value, index) => { totalDeltas[index] += Number(value) || 0; });
  }
  let label = "流局";
  const hora = events.filter(event => event.type === "hora");
  if (hora.length) {
    if (hora.some(event => event.actor === scene.playerId)) label = hora.some(event => event.target === scene.playerId) ? "自分のツモ和了" : "自分のロン和了";
    else if (hora.some(event => event.target === scene.playerId)) label = "自分の放銃";
    else label = "他家の和了（横移動）";
  }
  // end_statusのdeltasはリーチ棒支出を含まない場合がある。次局開始点が無い最終局では
  // 開始点からの正確な増減・着順を断定しない。
  const after = Array.isArray(scoresAfter) && scoresAfter.length === 4
    ? { afterScores: scoresAfter.map(Number), ranking: rankScores(scoresAfter), selfScore: Number(scoresAfter[scene.playerId]) }
    : null;
  return {
    label, events: events.map(event => ({ type: event.type, actor: event.actor, target: event.target, deltas: event.deltas })),
    selfDelta: after?.selfScore !== undefined && Number.isFinite(Number(scene.scores?.[scene.playerId]))
      ? after.selfScore - Number(scene.scores[scene.playerId]) : null,
    afterScore: after?.selfScore ?? null,
    afterRank: after?.ranking?.find(player => player.playerId === scene.playerId)?.rank || after?.selfRank || null,
    source: Array.isArray(scoresAfter) ? "next_round_scores" : "result_only"
  };
}

/** 点棒が不明な相手手牌を捏造せず、固定打点ごとの着順遷移を並べる。 */
export function buildScoreSimulation(scene) {
  const ranking = rankScores(scene?.scores);
  if (!ranking || !Number.isInteger(scene?.playerId)) return null;
  const self = scene.playerId;
  const strongest = [...(scene?.pushFold?.opponents || [])].sort((a, b) => b.score - a.score)[0];
  const opponentIds = (scene?.table?.players || []).filter(player => player.playerId !== self).map(player => player.playerId);
  const target = Number.isInteger(strongest?.playerId) ? strongest.playerId : opponentIds[0];
  if (!Number.isInteger(target)) return null;
  const current = ranking.find(player => player.playerId === self);
  return {
    current: { score: Number(scene.scores[self]), rank: current?.rank || null },
    assumedOpponent: { playerId: target, relation: relationLabel(scene, target), basis: strongest?.evidence || "他家の代表シナリオ" },
    selfRon: [3900, 8000, 12000].map(points => scenario(scene, self, target, points, "self_ron")),
    dealIn: [3900, 8000, 12000].map(points => scenario(scene, target, self, points, "deal_in")),
    actual: actualOutcome(scene),
    note: "相手の手牌・翻符が不明なため、放銃とロン和了は固定打点別の条件計算です。確率や期待値ではありません。"
  };
}

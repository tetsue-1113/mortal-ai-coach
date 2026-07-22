function canonicalTile(value) {
  const tile = String(value || "");
  return /^(?:[1-9][mps]r?|[ESWNPFC])$/.test(tile) ? tile.replace(/^5([mps])r$/, "5$1") : null;
}

function countTiles(values) {
  const counts = {};
  for (const value of Array.isArray(values) ? values : []) {
    const tile = canonicalTile(value);
    if (tile) counts[tile] = (counts[tile] || 0) + 1;
  }
  return counts;
}

const WIND_ORDER = ["E", "S", "W", "N"];
const DRAGON_ORDER = ["P", "F", "C"];

function doraTile(indicator) {
  const numbered = /^([1-9])([mps])$/.exec(indicator || "");
  if (numbered) {
    const next = Number(numbered[1]) === 9 ? 1 : Number(numbered[1]) + 1;
    return `${next}${numbered[2]}`;
  }
  const windIndex = WIND_ORDER.indexOf(indicator);
  if (windIndex >= 0) return WIND_ORDER[(windIndex + 1) % WIND_ORDER.length];
  const dragonIndex = DRAGON_ORDER.indexOf(indicator);
  if (dragonIndex >= 0) return DRAGON_ORDER[(dragonIndex + 1) % DRAGON_ORDER.length];
  return null;
}

export function verifiedTileCounts(hand, doraIndicators) {
  const handCounts = countTiles(hand);
  let omoteDoraCount = 0;
  for (const raw of Array.isArray(doraIndicators) ? doraIndicators : []) {
    const dora = doraTile(canonicalTile(raw));
    if (dora && handCounts[dora]) omoteDoraCount += handCounts[dora];
  }
  const akaDoraCount = (Array.isArray(hand) ? hand : []).filter(value => /^5[mps]r$/.test(String(value || ""))).length;
  return {
    hand: handCounts,
    doraIndicators: countTiles(doraIndicators),
    dora: { omote: omoteDoraCount, aka: akaDoraCount, total: omoteDoraCount + akaDoraCount }
  };
}

export function verifiedPerspective(playerId, seatWind, players, scores = []) {
  const selfPlayerId = Number.isInteger(playerId) && playerId >= 0 && playerId <= 3 ? playerId : null;
  const relations = { self: "自分", shimocha: "下家", toimen: "対面", kamicha: "上家" };
  const relationCodes = ["self", "shimocha", "toimen", "kamicha"];
  const seats = Array.isArray(players) ? players.map(player => {
    const currentPlayerId = Number.isInteger(player?.playerId) ? player.playerId : null;
    const relationCode = currentPlayerId !== null && selfPlayerId !== null
      ? relationCodes[(currentPlayerId - selfPlayerId + 4) % 4]
      : null;
    return {
      playerId: currentPlayerId,
      relation: relations[relationCode] || null,
      relationCode,
      seatWind: canonicalTile(player?.seatWind),
      score: scores?.[currentPlayerId] !== null && scores?.[currentPlayerId] !== undefined && Number.isFinite(Number(scores[currentPlayerId]))
        ? Number(scores[currentPlayerId]) : null
    };
  }).filter(player => player.playerId !== null && player.relationCode) : [];
  return {
    selfPlayerId,
    selfSeatWind: canonicalTile(seatWind),
    selfScore: selfPlayerId !== null && scores?.[selfPlayerId] !== null && scores?.[selfPlayerId] !== undefined
      && Number.isFinite(Number(scores[selfPlayerId])) ? Number(scores[selfPlayerId]) : null,
    selfRelation: "自分",
    players: seats
  };
}

const SUJI_PARTNERS = { 1: [4], 2: [5], 3: [6], 4: [1, 7], 5: [2, 8], 6: [3, 9], 7: [4], 8: [5], 9: [6] };

function numberedTile(tile) {
  const match = /^([1-9])([mps])$/.exec(tile || "");
  return match ? { number: Number(match[1]), suit: match[2] } : null;
}

export function computeSafety(discardTiles) {
  const genbutsu = new Set();
  for (const raw of Array.isArray(discardTiles) ? discardTiles : []) {
    const tile = canonicalTile(raw);
    if (tile) genbutsu.add(tile);
  }
  const suji = new Set();
  for (const tile of genbutsu) {
    const kind = numberedTile(tile);
    if (!kind) continue;
    for (const partnerNumber of SUJI_PARTNERS[kind.number] || []) {
      suji.add(`${partnerNumber}${kind.suit}`);
    }
  }
  for (const tile of genbutsu) suji.delete(tile);
  return { genbutsu: [...genbutsu], suji: [...suji] };
}

export function computeVisibleCounts(tileGroups) {
  const counts = {};
  for (const group of Array.isArray(tileGroups) ? tileGroups : []) {
    for (const raw of Array.isArray(group) ? group : []) {
      const tile = canonicalTile(raw);
      if (tile) counts[tile] = (counts[tile] || 0) + 1;
    }
  }
  return counts;
}

/**
 * その局面が何によって決まったのかを数値から判定し、解説すべき観点を選ぶ。
 * 4観点を毎回並べるのをやめ、差がついた軸だけを説明させるために使う。
 */
export function decisionAxes(scene) {
  const axes = [];
  const add = (id, heading, weight, note) => axes.push({ id, heading, weight, note });

  const candidates = scene?.ukeire?.candidates || [];
  const comparable = candidates.filter(candidate => candidate.keepsShanten);
  const actual = candidates.find(candidate => candidate.isActual);
  const expected = candidates.find(candidate => candidate.isMortalTop);

  // 牌効率：シャンテンが落ちる、または受け入れ枚数に差がある。
  if (actual && expected) {
    if (actual.shantenAfter > expected.shantenAfter) {
      add("structure", "手牌構造面", 100,
        `実打はシャンテンが${actual.shantenAfter}、推奨は${expected.shantenAfter}で、実打だけ手が後退する`);
    } else {
      const gap = expected.ukeire - actual.ukeire;
      const summary = `受け入れ枚数は実打が${actual.ukeire}枚、推奨が${expected.ukeire}枚`;
      if (gap >= 8) add("structure", "手牌構造面", 70 + Math.min(20, gap), `${summary}で${gap}枚の差がある`);
      else if (Math.abs(gap) < 4) add("structure", "手牌構造面", 25, `${summary}でほぼ互角`);
      else add("structure", "手牌構造面", 45, `${summary}で差がある`);
    }
  } else if (comparable.length >= 2) {
    add("structure", "手牌構造面", 40, "候補ごとに受け入れが異なる");
  }

  // 安全性：リーチ者や明らかな攻撃姿勢の他家がいるか、終盤か。
  const riichi = (scene?.table?.players || []).filter(player => player.riichiAccepted && player.relation !== "self");
  const pushing = (scene?.table?.players || []).filter(player => player.relation !== "self" && (player.calls || []).length >= 2);
  if (riichi.length) {
    add("safety", "安全性", 95, `${riichi.length}人がリーチ済みで放銃リスクが判断に直結する`);
  } else if (pushing.length) {
    add("safety", "安全性", 55, `${pushing.length}人が2副露以上で警戒が要る`);
  } else if (scene?.position?.turnPhase === "終盤") {
    add("safety", "安全性", 45, "終盤で無警戒には切れない");
  }

  // 打点：ドラ・赤・供託など、和了時の収入に関わる材料があるか。
  const dora = scene?.verifiedTileCounts?.dora;
  const doraTotal = Number(dora?.total) || 0;
  if (doraTotal >= 2) add("value", "手役・打点面", 65, `手牌にドラが${doraTotal}枚あり打点が育つ`);
  else if (doraTotal === 1) add("value", "手役・打点面", 40, "手牌にドラが1枚ある");
  if (Number(scene?.table?.kyotakuSticks) > 0) {
    const existing = axes.find(axis => axis.id === "value");
    if (existing) existing.weight += 10;
    else add("value", "手役・打点面", 35, "供託があり和了の価値が上がっている");
  }

  // 状況判断：オーラス、着順が動く点差、終盤など、局面外の事情が効くか。
  const standings = scene?.standings;
  if (scene?.position?.isLastKyoku === true) {
    add("situation", "状況判断", 90, "オーラスで着順が確定する");
  } else if (standings) {
    const close = standings.topDiff > 0 && standings.topDiff <= 8000;
    const nearLast = standings.lastDiff >= 0 && standings.lastDiff <= 8000 && standings.selfRank >= 3;
    if (nearLast) add("situation", "状況判断", 60, `ラス目と${standings.lastDiff}点差で着順が動きやすい`);
    else if (close) add("situation", "状況判断", 50, `トップと${standings.topDiff}点差で捲る余地がある`);
  }

  axes.sort((a, b) => b.weight - a.weight);
  // 重みの低い観点まで並べると毎回4つ出てしまうため、上位3つ・かつ一定以上に絞る。
  const selected = axes.filter(axis => axis.weight >= 40).slice(0, 3);
  const result = selected.length ? selected : axes.slice(0, 1);
  // 副露判断など受け入れを計算できない局面では何も立たないことがある。
  if (!result.length) {
    result.push({ id: "structure", heading: "手牌構造面", note: "この選択で手牌の形がどう変わるか" });
  }
  return result.map(({ id, heading, note }) => ({ id, heading, note }));
}

export function turnPhase(junme) {
  const value = Number(junme);
  if (!Number.isFinite(value) || value < 1) return null;
  if (value <= 6) return "序盤";
  if (value <= 12) return "中盤";
  return "終盤";
}

export function computeStandings(scores, selfPlayerId) {
  const valid = Array.isArray(scores) && scores.length === 4
    && scores.every(score => score !== null && score !== undefined && Number.isFinite(Number(score)));
  if (!valid || !Number.isInteger(selfPlayerId) || selfPlayerId < 0 || selfPlayerId > 3) return null;
  const numeric = scores.map(Number);
  const ranked = numeric
    .map((score, playerId) => ({ playerId, score }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach((entry, index) => {
    entry.rank = index === 0 ? 1 : (entry.score === ranked[index - 1].score ? ranked[index - 1].rank : index + 1);
  });
  const byPlayer = {};
  ranked.forEach(entry => { byPlayer[entry.playerId] = entry; });
  const selfEntry = byPlayer[selfPlayerId];
  const topScore = ranked[0].score;
  const lastScore = ranked[ranked.length - 1].score;
  return {
    selfRank: selfEntry.rank,
    isTopTied: ranked.filter(entry => entry.rank === 1).length > 1,
    topDiff: topScore - selfEntry.score,
    lastDiff: selfEntry.score - lastScore,
    players: [0, 1, 2, 3].map(playerId => ({
      playerId,
      rank: byPlayer[playerId].rank,
      diffFromSelf: byPlayer[playerId].score - selfEntry.score
    }))
  };
}

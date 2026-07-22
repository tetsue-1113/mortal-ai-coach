// 日本式リーチ麻雀のシャンテン数と受け入れ枚数を計算する。
// Mortalの元JSONには受け入れ枚数が無いため、手牌から自前で求める。

const SUITS = { m: 0, p: 9, s: 18 };
const HONORS = { E: 27, S: 28, W: 29, N: 30, P: 31, F: 32, C: 33 };
const TILE_KINDS = 34;
const TERMINALS_HONORS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/** "5mr" は "5m" と同じ牌種として扱う。 */
export function tileIndex(tile) {
  const value = String(tile || "").replace(/^([1-9][mps])r$/, "$1");
  const numbered = /^([1-9])([mps])$/.exec(value);
  if (numbered) return SUITS[numbered[2]] + Number(numbered[1]) - 1;
  return Object.prototype.hasOwnProperty.call(HONORS, value) ? HONORS[value] : null;
}

export function tileName(index) {
  if (!Number.isInteger(index) || index < 0 || index >= TILE_KINDS) return null;
  if (index >= 27) return Object.keys(HONORS)[index - 27];
  const suit = ["m", "p", "s"][Math.floor(index / 9)];
  return `${(index % 9) + 1}${suit}`;
}

export function toCounts(tiles) {
  const counts = new Array(TILE_KINDS).fill(0);
  for (const tile of Array.isArray(tiles) ? tiles : []) {
    const index = tileIndex(tile);
    if (index !== null) counts[index] += 1;
  }
  return counts;
}

/**
 * 面子・搭子の取り方を全探索し、標準形のシャンテン数を返す。
 * shanten = 8 - 2*面子 - 搭子（面子+搭子は5個まで、雀頭が無い5ブロックは1足す）
 */
function standardShanten(counts, calledMelds) {
  const work = counts.slice();
  let best = 8;

  const evaluate = (sets, partials, pairs) => {
    let blocks = sets + calledMelds;
    let taken = partials + pairs;
    // 面子と搭子は合わせて5ブロックまでしか手牌に入らない。
    if (blocks + taken > 5) taken = Math.max(0, 5 - blocks);
    let shanten = 8 - 2 * blocks - taken;
    // 5ブロック揃っていて雀頭が無い形は、雀頭を作る1手が余分にかかる。
    if (blocks + taken === 5 && pairs === 0) shanten += 1;
    if (shanten < best) best = shanten;
  };

  const walk = (index, sets, partials, pairs) => {
    if (8 - 2 * (sets + calledMelds) - (partials + pairs) >= best && sets + partials + pairs > 0) {
      // これ以上ブロックを増やしても更新できない見込みなら打ち切らず、評価だけ先に済ませる。
      evaluate(sets, partials, pairs);
    }
    while (index < TILE_KINDS && work[index] === 0) index += 1;
    if (index >= TILE_KINDS) { evaluate(sets, partials, pairs); return; }

    const isNumbered = index < 27;
    const rank = index % 9;

    if (work[index] >= 3) {
      work[index] -= 3; walk(index, sets + 1, partials, pairs); work[index] += 3;
    }
    if (isNumbered && rank <= 6 && work[index + 1] > 0 && work[index + 2] > 0) {
      work[index] -= 1; work[index + 1] -= 1; work[index + 2] -= 1;
      walk(index, sets + 1, partials, pairs);
      work[index] += 1; work[index + 1] += 1; work[index + 2] += 1;
    }
    if (work[index] >= 2) {
      work[index] -= 2; walk(index, sets, partials, pairs + 1); work[index] += 2;
    }
    if (isNumbered && rank <= 7 && work[index + 1] > 0) {
      work[index] -= 1; work[index + 1] -= 1;
      walk(index, sets, partials + 1, pairs);
      work[index] += 1; work[index + 1] += 1;
    }
    if (isNumbered && rank <= 6 && work[index + 2] > 0) {
      work[index] -= 1; work[index + 2] -= 1;
      walk(index, sets, partials + 1, pairs);
      work[index] += 1; work[index + 2] += 1;
    }
    // この牌を孤立牌として捨て置く枝。
    work[index] -= 1;
    walk(index, sets, partials, pairs);
    work[index] += 1;
  };

  walk(0, 0, 0, 0);
  return best;
}

/** 七対子。副露していない手牌でのみ成立する。 */
function chiitoitsuShanten(counts) {
  let pairs = 0, kinds = 0;
  for (const count of counts) {
    if (count > 0) kinds += 1;
    if (count >= 2) pairs += 1;
  }
  // 4枚使いは対子1組ぶんしか使えないため、種類が7未満なら足りない分だけ余分にかかる。
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** 国士無双。副露していない手牌でのみ成立する。 */
function kokushiShanten(counts) {
  let kinds = 0, hasPair = false;
  for (const index of TERMINALS_HONORS) {
    if (counts[index] > 0) kinds += 1;
    if (counts[index] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/**
 * 手牌のシャンテン数。副露がある場合は標準形のみで判定する。
 * 和了形は -1、テンパイは 0。
 */
export function shantenOf(counts, calledMelds = 0) {
  const standard = standardShanten(counts, calledMelds);
  if (calledMelds > 0) return standard;
  return Math.min(standard, chiitoitsuShanten(counts), kokushiShanten(counts));
}

function totalTiles(counts) {
  return counts.reduce((sum, count) => sum + count, 0);
}

/**
 * 打牌後の受け入れを求める。
 * visibleCounts には自分の手牌・全員の河・副露・ドラ表示牌の見えている枚数を渡す。
 * 残り枚数は 4 - 見えている枚数 で、山と他家の手牌に残っている枚数の上限を表す。
 */
export function ukeireAfterDiscard(handTiles, discardTile, calledMelds = 0, visibleCounts = {}) {
  const counts = toCounts(handTiles);
  const discardIndex = tileIndex(discardTile);
  if (discardIndex === null || counts[discardIndex] === 0) return null;
  counts[discardIndex] -= 1;
  // 打牌後は 13枚（副露1つにつき3枚少ない）でなければ受け入れを定義できない。
  if (totalTiles(counts) !== 13 - calledMelds * 3) return null;

  const current = shantenOf(counts, calledMelds);
  const tiles = [];
  let total = 0;
  for (let index = 0; index < TILE_KINDS; index += 1) {
    if (counts[index] >= 4) continue;
    counts[index] += 1;
    const next = shantenOf(counts, calledMelds);
    counts[index] -= 1;
    if (next >= current) continue;
    const name = tileName(index);
    // visibleCounts は自分の手牌ぶんも含む想定だが、渡されなくても
    // 手元の枚数だけは必ず差し引けるよう大きい方を採用する。
    const seen = Math.max(counts[index], Number(visibleCounts[name]) || 0);
    const remaining = Math.max(0, 4 - seen);
    if (remaining === 0) continue;
    tiles.push({ tile: name, remaining });
    total += remaining;
  }
  return { shanten: current, count: total, tiles };
}

/** 打牌候補ごとの受け入れをまとめる。同じ牌は1回だけ計算する。 */
export function ukeireForCandidates(handTiles, candidateTiles, calledMelds = 0, visibleCounts = {}) {
  const result = {};
  for (const tile of new Set((Array.isArray(candidateTiles) ? candidateTiles : []).filter(Boolean))) {
    const ukeire = ukeireAfterDiscard(handTiles, tile, calledMelds, visibleCounts);
    if (ukeire) result[String(tile).replace(/^([1-9][mps])r$/, "$1")] = ukeire;
  }
  return result;
}

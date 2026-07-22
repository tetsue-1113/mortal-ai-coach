const canonicalTile = value => String(value || "").replace(/^5([mps])r$/, "5$1");

/**
 * てりやき麻雀教室の牌効率11記事・守備4記事から、本文を転載せずに
 * 「結論・適用条件・例外」だけを実装用に要約した出典台帳。
 */
export const TACTICS_SOURCES = Object.freeze([
  ["efficiency-overlap", "麻雀の二度受けとは？牌効率で弱い理由と判断基準を解説", "https://teriyaki-mahjong.com/haikouritsu-nidouke/"],
  ["efficiency-ukeire", "麻雀の受け入れ枚数とは？最速聴牌のための3ステップ", "https://teriyaki-mahjong.com/haikouritsu-ukeire-maisuu/"],
  ["efficiency-five-block", "麻雀の牌効率における5ブロック理論とは？", "https://teriyaki-mahjong.com/haikouritsu-five-block/"],
  ["efficiency-standard", "麻雀の牌効率の定石とは？", "https://teriyaki-mahjong.com/haikouritsu-jouseki/"],
  ["efficiency-context", "“牌効率は意味ない”は本当？", "https://teriyaki-mahjong.com/haikouritsu-imi-nai/"],
  ["efficiency-study", "牌効率の勉強は何切る問題と実戦だけではNG！", "https://teriyaki-mahjong.com/%e3%80%90%e5%a4%a9%e9%b3%b38%e6%ae%b5%e3%81%ab%e3%81%aa%e3%82%8c%e3%81%9f%e7%b0%a1%e5%8d%98%e3%81%aa%e7%89%8c%e5%8a%b9%e7%8e%87%e3%80%91%e7%89%8c%e5%8a%b9%e7%8e%87%e3%81%ae%e7%b7%b4%e7%bf%92%e3%83%bb/"],
  ["efficiency-guide", "麻雀の牌効率とは？定石・勉強法・おすすめ本まで解説", "https://teriyaki-mahjong.com/haikouritsu/"],
  ["efficiency-kanchan", "麻雀のカンチャン待ちの強さ・変化と戦術", "https://teriyaki-mahjong.com/%e9%ba%bb%e9%9b%80%e3%81%ae%e3%82%ab%e3%83%b3%e3%83%81%e3%83%a3%e3%83%b3%e5%be%85%e3%81%a1%e3%81%ae%e5%bc%b7%e3%81%95%e3%83%bb%e5%a4%89%e5%8c%96%e3%81%a8%e6%88%a6%e8%a1%93%e3%82%92%e5%88%86%e3%81%8b/"],
  ["efficiency-ryanmen", "麻雀の両面待ちを完全解説", "https://teriyaki-mahjong.com/%e9%ba%bb%e9%9b%80%e3%81%ae%e4%b8%a1%e9%9d%a2%e3%83%aa%e3%83%a3%e3%83%b3%e3%83%a1%e3%83%b3%e5%be%85%e3%81%a1%e3%82%92%e5%ae%8c%e5%85%a8%e8%a7%a3%e8%aa%ac%ef%bc%81%e5%92%8c%e4%ba%86%e7%8e%87%e3%81%a8/"],
  ["efficiency-penchan", "麻雀のペンチャン待ちとは？", "https://teriyaki-mahjong.com/%e9%ba%bb%e9%9b%80%e3%81%ae%e3%83%9a%e3%83%b3%e3%83%81%e3%83%a3%e3%83%b3%e5%be%85%e3%81%a1%e3%81%a8%e3%81%af%ef%bc%9f%e4%b8%a1%e9%9d%a2%e3%83%bb%e3%82%ab%e3%83%b3%e3%83%81%e3%83%a3%e3%83%b3%e6%af%94/"],
  ["efficiency-multiwait", "麻雀の多面待ちの覚え方", "https://teriyaki-mahjong.com/%e9%ba%bb%e9%9b%80%e3%81%ae%e5%a4%9a%e9%9d%a2%e5%be%85%e3%81%a1%e3%81%ae%e8%a6%9a%e3%81%88%e6%96%b9%ef%bc%81%e3%82%b9%e3%83%83%e3%81%a8%e7%90%86%e8%a7%a3%e3%81%a7%e3%81%8d%e3%82%8b%e3%82%88%e3%81%86/"],
  ["defense-guide", "勝つための麻雀の守備の完全ガイド", "https://teriyaki-mahjong.com/%e9%ba%bb%e9%9b%80%e3%81%ae%e5%ae%88%e5%82%99%e3%81%a7%e5%a4%b1%e7%82%b9%e3%82%92%e6%b8%9b%e3%82%89%e3%81%99%ef%bc%81%e5%ae%88%e5%82%99%e3%81%ae%e5%9f%ba%e6%9c%ac%e3%82%84%e3%81%8a%e3%81%99%e3%81%99/"],
  ["defense-genbutsu", "麻雀の現物とは？安全牌選択術", "https://teriyaki-mahjong.com/%e9%ba%bb%e9%9b%80%e3%81%ae%e7%8f%be%e7%89%a9%e3%81%a8%e3%81%af%ef%bc%9f%e5%ae%89%e5%85%a8%e7%89%8c%e9%81%b8%e6%8a%9e%e8%a1%93%e3%81%a8%e5%ae%88%e5%82%99%e5%8a%9b%e3%82%a2%e3%83%83%e3%83%97%e5%ae%9f/"],
  ["defense-river", "麻雀の河読み徹底完全マスター講座", "https://teriyaki-mahjong.com/%e9%ba%bb%e9%9b%80%e3%81%ae%e6%b2%b3%e8%aa%ad%e3%81%bf%e5%be%b9%e5%ba%95%e5%ae%8c%e5%85%a8%e3%83%9e%e3%82%b9%e3%82%bf%e3%83%bc%e8%ac%9b%e5%ba%a7%e3%80%80%e5%8d%b1%e9%99%ba%e7%89%8c%e5%9b%9e%e9%81%bf/"],
  ["defense-fold", "麻雀の『降りるとは』やさしく解説", "https://teriyaki-mahjong.com/%e9%ba%bb%e9%9b%80%e3%81%ae%e3%80%8c%e9%99%8d%e3%82%8a%e3%82%8b%e3%81%a8%e3%81%af%e3%80%8d%e3%82%84%e3%81%95%e3%81%97%e3%81%8f%e8%a7%a3%e8%aa%ac%ef%bc%81%e5%ae%89%e5%85%a8%e3%81%ab%e5%8b%9d%e3%81%a4/"],
].map(([id, title, url]) => Object.freeze({ id, title, url })));

const sourceTitle = id => TACTICS_SOURCES.find(source => source.id === id)?.title || id;

function candidate(scene, kind) {
  return scene?.ukeire?.candidates?.find(item => kind === "actual" ? item.isActual : item.isMortalTop) || null;
}

function rule(id, category, conclusion, reason, sourceIds, confidence = "high") {
  return { id, category, conclusion, reason, confidence, sources: sourceIds.map(sourceTitle) };
}

/**
 * 数牌が両面待ちに当たるために必要な2枚組を、見えている4枚壁が壊しているか調べる。
 * 「両面を否定」するだけで、単騎・双碰・嵌張等の安全は保証しない。
 */
export function noRyanmenEvidence(tile, visibleCounts = {}) {
  const match = /^([1-9])([mps])$/.exec(canonicalTile(tile));
  if (!match) return null;
  const number = Number(match[1]), suit = match[2];
  const shapes = [];
  if (number >= 3) shapes.push([number - 2, number - 1]);
  if (number <= 7) shapes.push([number + 1, number + 2]);
  const blocked = shapes.map(shape => shape.some(value => Number(visibleCounts[`${value}${suit}`]) >= 4));
  if (!blocked.length || !blocked.every(Boolean)) return null;
  const walls = [...new Set(shapes.flat().filter(value => Number(visibleCounts[`${value}${suit}`]) >= 4).map(value => `${value}${suit}`))];
  return { tile: canonicalTile(tile), walls, reason: `${walls.join("・")}が4枚見えで、${canonicalTile(tile)}の両面待ちは否定される` };
}

export function buildTacticsGuidance(scene) {
  const expected = candidate(scene, "expected");
  const actual = candidate(scene, "actual");
  const matched = [];

  if (expected && actual) {
    if (expected.shantenAfter < actual.shantenAfter) {
      matched.push(rule("keep-shanten", "牌効率", "受け入れ枚数より先にシャンテン維持を優先", `推奨は${expected.shantenAfter}シャンテン、実打は${actual.shantenAfter}シャンテンになる`, ["efficiency-ukeire", "efficiency-guide"]));
    } else if (expected.shantenAfter === actual.shantenAfter && expected.ukeire > actual.ukeire) {
      matched.push(rule("compare-ukeire", "牌効率", "同じシャンテンなら見えている牌を差し引いた受け入れを比較", `推奨${expected.ukeire}枚、実打${actual.ukeire}枚で${expected.ukeire - actual.ukeire}枚差`, ["efficiency-ukeire", "efficiency-standard"]));
    } else if (expected.shantenAfter === actual.shantenAfter) {
      matched.push(rule("beyond-ukeire", "牌効率", "受け入れが近い候補は最終形・打点・安全度まで比較", `両候補とも${expected.shantenAfter}シャンテンで、受け入れだけでは推奨理由を断定しない`, ["efficiency-context", "efficiency-overlap", "efficiency-five-block"], "medium"));
    }
  }

  if (expected?.shantenAfter === 0) {
    const types = expected.ukeireTiles?.length || 0;
    matched.push(rule("tenpai-wait", "牌効率", "テンパイ時は待ちの種類と場に残る枚数を確認", `推奨後はテンパイ、待ち候補は${types}種類・残り${expected.ukeire}枚`, ["efficiency-ryanmen", "efficiency-kanchan", "efficiency-penchan", "efficiency-multiwait"]));
  }

  const hasThreat = scene?.pushFold?.opponents?.some(item => item.level === "critical" || item.level === "high" || item.callCount >= 2);
  if (hasThreat) {
    const danger = scene.pushFold?.tileDanger || {};
    if (danger.expected?.score < danger.actual?.score) {
      matched.push(rule("safer-candidate", "守備", "攻撃者ごとの現物を最優先し、次に相対的に安全な候補を比較", `推奨牌は実打より公開情報上の危険材料が少ない`, ["defense-genbutsu", "defense-guide"]));
    }
    const shanten = expected?.shantenAfter ?? scene?.shanten;
    if (Number(shanten) >= 2) {
      matched.push(rule("distant-hand-fold", "守備", "攻撃を受けた2シャンテン以上は、打点条件がなければオリを強く検討", `推奨後も${shanten}シャンテンで、相手の攻撃が確認できる`, ["defense-fold", "defense-guide"]));
    }
    const wall = noRyanmenEvidence(scene?.expected?.pai, scene?.table?.visibleCounts);
    if (wall) {
      matched.push(rule("visible-wall", "守備", "4枚壁は両面待ちだけを否定し、完全安牌とは扱わない", wall.reason, ["defense-river", "defense-guide"], "medium"));
    }
    if (danger.expected?.evidence?.some(text => text.includes("スジ"))) {
      matched.push(rule("suji-limit", "守備", "スジは両面を減らす材料で、単騎・双碰・嵌張は残る", danger.expected.evidence[0], ["defense-river", "defense-guide"], "medium"));
    }
  } else {
    matched.push(rule("no-threat-speed", "牌効率", "明確な攻撃者がいない間は速度と将来の好形を主軸にする", `${scene?.position?.junme ?? "序盤"}巡目時点で明確なリーチ・高警戒の仕掛けなし`, ["efficiency-standard", "efficiency-guide", "defense-guide"], "medium"));
  }

  return {
    version: "teriyaki-2026-07-22",
    sourceCount: TACTICS_SOURCES.length,
    matched: matched.slice(0, 6),
    limitations: [
      "Mortalの選択と計算済み局面値を正本とし、記事の定石だけで最善打を上書きしない",
      "河読み・スジ・壁は候補の相対比較に使い、待ちや放銃率を断定しない",
      "二度受け・5ブロック・待ち形は、形を計算できない局面では推測して断定しない"
    ]
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { shantenOf, toCounts, tileIndex, tileName, ukeireAfterDiscard, ukeireForCandidates } from "./shanten.mjs";

const shanten = (tiles, melds = 0) => shantenOf(toCounts(tiles), melds);

test("tile index round-trips and folds red fives", () => {
  assert.equal(tileIndex("1m"), 0);
  assert.equal(tileIndex("9s"), 26);
  assert.equal(tileIndex("E"), 27);
  assert.equal(tileIndex("C"), 33);
  assert.equal(tileIndex("5mr"), tileIndex("5m"));
  assert.equal(tileIndex("10m"), null);
  assert.equal(tileName(0), "1m");
  assert.equal(tileName(26), "9s");
  assert.equal(tileName(27), "E");
});

test("a completed hand is -1 and a tenpai hand is 0", () => {
  // 123m456m789m123s + 東東 は和了形。
  assert.equal(shanten(["1m","2m","3m","4m","5m","6m","7m","8m","9m","1s","2s","3s","E","E"]), -1);
  // 同じ手から東を1枚欠くと単騎テンパイ。
  assert.equal(shanten(["1m","2m","3m","4m","5m","6m","7m","8m","9m","1s","2s","3s","E"]), 0);
});

test("seven pairs and thirteen orphans are recognised", () => {
  const chiitoi = ["1m","1m","3m","3m","5m","5m","7p","7p","9p","9p","2s","2s","E"];
  assert.equal(shanten(chiitoi), 0);
  // 13種1枚ずつはどれを引いても和了のテンパイ。
  const kokushi = ["1m","9m","1p","9p","1s","9s","E","S","W","N","P","F","C"];
  assert.equal(shanten(kokushi), 0);
  // 1種欠けて対子がある形もテンパイ（欠けた1種を待つ）。
  const kokushiMissingOne = ["1m","9m","1p","9p","1s","9s","E","S","W","N","P","F","F"];
  assert.equal(shanten(kokushiMissingOne), 0);
  // 13種＋どれか1枚重なった14枚が和了形。
  const kokushiComplete = ["1m","9m","1p","9p","1s","9s","E","S","W","N","P","F","C","C"];
  assert.equal(shanten(kokushiComplete), -1);
});

test("seven pairs and thirteen orphans are unavailable once the hand is open", () => {
  const chiitoi = ["1m","1m","3m","3m","5m","5m","7p","7p","9p","9p"];
  // 副露1つぶん（3枚）を除いた10枚。七対子は使えないので標準形で判定される。
  assert.ok(shanten(chiitoi, 1) > 0);
});

test("shanten decreases as the hand fills in", () => {
  const oneShanten = ["1m","2m","3m","4m","5m","6m","7m","8m","1s","2s","3s","E","E","9p"];
  assert.equal(shanten(oneShanten), 0);
  const twoShanten = ["1m","2m","3m","4m","5m","7m","9m","1s","2s","3s","E","E","5p","9p"];
  assert.equal(shanten(twoShanten), 1);
});

test("called melds are counted as completed sets", () => {
  // ポン2つ（6枚ぶん）＋ 123m + 45p + 東東 の8枚でテンパイ。
  const tiles = ["1m","2m","3m","4p","5p","E","E"];
  assert.equal(shanten(tiles, 2), 0);
});

test("ukeire lists the tiles that advance the hand and how many remain", () => {
  // 打9p後は 12345678m 123s 東東 の13枚。12345678mは3m・6m・9mの三面待ち。
  const hand = ["1m","2m","3m","4m","5m","6m","7m","8m","1s","2s","3s","E","E","9p"];
  const result = ukeireAfterDiscard(hand, "9p", 0, {});
  assert.equal(result.shanten, 0);
  const accepted = result.tiles.map(item => item.tile).sort();
  assert.deepEqual(accepted, ["3m", "6m", "9m"]);
  // 手牌に無い9mは4枚、3mは手牌に1枚あるので残り3枚。
  assert.equal(result.tiles.find(item => item.tile === "9m").remaining, 4);
  assert.equal(result.tiles.find(item => item.tile === "3m").remaining, 3);
  // 東を重ねても4面子1雀頭にならないため受け入れには入らない。
  assert.ok(!accepted.includes("E"));
  assert.equal(result.count, result.tiles.reduce((sum, item) => sum + item.remaining, 0));
});

test("tiles already visible on the table are subtracted from the count", () => {
  const hand = ["1m","2m","3m","4m","5m","6m","7m","8m","1s","2s","3s","E","E","9p"];
  const withoutWall = ukeireAfterDiscard(hand, "9p", 0, {});
  // 9mが4枚見え切っていれば受け入れから外れ、3mも残り1枚まで減る。
  const withWall = ukeireAfterDiscard(hand, "9p", 0, { "9m": 4, "3m": 3 });
  assert.ok(withoutWall.count > withWall.count);
  assert.ok(!withWall.tiles.some(item => item.tile === "9m"));
  assert.equal(withWall.tiles.find(item => item.tile === "3m").remaining, 1);
});

test("a discard that is not in the hand yields no result", () => {
  const hand = ["1m","2m","3m","4m","5m","6m","7m","8m","1s","2s","3s","E","E","9p"];
  assert.equal(ukeireAfterDiscard(hand, "5s", 0, {}), null);
});

test("candidate ukeire compares discards and folds red fives to one entry", () => {
  const hand = ["1m","2m","2m","5m","6m","7m","2p","3p","5p","7p","3s","4s","7s","E"];
  const result = ukeireForCandidates(hand, ["7s", "5p", "5p"], 0, {});
  assert.ok(result["7s"], "7s切りの受け入れが計算される");
  assert.ok(result["5p"], "5p切りの受け入れが計算される");
  assert.equal(Object.keys(result).length, 2, "同じ牌は1件にまとまる");
  for (const entry of Object.values(result)) {
    assert.ok(Number.isInteger(entry.count) && entry.count >= 0);
    assert.ok(Array.isArray(entry.tiles));
  }
});

test("reviewed complex hands use the current drawn hand for shanten", () => {
  assert.equal(shanten(["2m","3m","3m","3m","6m","6m","3p","4p","4p","4p","4p","6p","5s","6s"]), 1);
  assert.equal(shanten(["2m","5m","8m","9m","1p","3p","8p","3s","7s","9s","N","P","P","F"]), 4);
});

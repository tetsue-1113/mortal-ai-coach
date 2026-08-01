# Evaluation set

AI麻雀コーチの解説精度を、同じ局面で継続的に比較するための評価セットです。

## 基本方針

- 元のSQLiteは読み取り専用で開き、変更しません。
- レポートID、元の局面ID、質問履歴、保存日時は出力しません。
- 手牌や河など、解説に必要な麻雀局面データだけを残します。
- 実データから生成したセットは `evaluation/private/` に置き、Gitへ追加しません。
- 公開可能な評価セットを作る場合は、全局面を人間が確認してから別ファイルへ移します。

## 50局面の構成

| 分類 | 件数 | 主な対象 |
| --- | ---: | --- |
| 牌効率 | 10 | 明確な脅威がない打牌不一致 |
| 守備・押し引き | 10 | リーチや高警戒の仕掛けがある打牌判断 |
| リーチ判断 | 8 | 実打またはMortal推奨がリーチ |
| 鳴き判断 | 8 | チー・ポン・カン、または鳴かない判断 |
| 着順判断 | 6 | オーラスの意思決定 |
| 一致局面 | 8 | 実打とMortalが一致する対照群 |

分類は重複させず、上から `リーチ → 鳴き → 着順 → 守備 → 牌効率 → 一致` の優先順で割り当てます。

## 生成

Node.js 22.13以上で実行します。

```sh
node evaluation/generate-evaluation-set.mjs \
  --db "/path/to/mahjong-coach.sqlite3" \
  --out evaluation/private/evaluation-set-v1.jsonl \
  --summary evaluation/private/evaluation-set-v1.summary.json
```

同じDBとseedからは同じ50局面が選ばれます。既存解説がある局面を優先し、同条件内はseed付きハッシュで決定します。
各分類の中でも、Mortalとの差が大きい局面だけに偏らないよう `major`、`clear`、`minor`、`match` を可能な範囲で割り当てます。

## レビュー方法

JSONLは1行1局面です。最初は `reference.status` が `unreviewed` になっています。

レビューは次の2段階に分けます。

1. `learner-reviewed`: 学習者が、納得できない点・自分の仮説・知りたい判断基準を記録
2. `expert-reviewed`: 計算済み事実、Mortal評価、信頼できる戦術根拠で仮説を検証し、正解条件を確定

学習者の意見は、そのまま正解データへ昇格させません。誤りがある場合は理由と反例を示し、上級者を目指すための説明へ直します。

人間が局面を確認し、次を記入します。

- `mustMention`: 解説に必ず含める判断材料
- `mustNotClaim`: 断定してはいけない内容
- `idealReason`: 期待する理由説明
- `idealLesson`: 次回に再利用できる判断基準
- `reviewerNotes`: 採点時の補足

最終採点は `expert-reviewed` になった後で、次の4項目を各0〜2点で行います。

1. `factualCorrectness`: 手牌・河・点棒などの事実誤認がない
2. `decisionRelevance`: Mortalとの差を生んだ重要な判断材料を扱っている
3. `uncertaintyDiscipline`: 未計算の待ち・打点・確率を断定しない
4. `coachingValue`: 次の類似局面で使える具体的な基準になっている

満点は1局面8点です。平均点だけでなく、重大な事実誤認がある局面数も別に集計します。

## ファイル形式

各行は `evaluation/evaluation-case.schema.json` に従います。

- `caseId`: 評価セット内だけで使う匿名ID
- `category` / `tags`: 抽出時の分類
- `input`: AI麻雀コーチへ再投入できる匿名化済み局面
- `baseline`: SQLiteに既存解説があれば、その理由・教訓だけを保存
- `reference`: 人間が作る正解条件
- `scores`: 変更前後の採点欄

質問履歴は評価セットへ含めません。

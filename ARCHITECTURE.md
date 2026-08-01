# Mortal AI Coach Architecture

## 方針

Chrome拡張をView境界、Node.jsローカルサーバーをアプリケーション境界とします。Mortal固有のDOM／JSON構造は拡張のPage Adapterで吸収し、麻雀判断・AI・保存はNode側へ閉じ込めます。

```mermaid
flowchart LR
  M["Mortal report / DOM"] --> A["MortalPageAdapter"]
  A --> V["Side-panel View"]
  V --> C["BridgeClient"]
  C --> SW["Chrome Service Worker"]
  SW --> H["HTTP /api/v1"]
  H --> APP["Application Services"]
  APP --> D["Mahjong Domain"]
  APP --> P["AI Provider Gateway"]
  APP --> R["Scene Repository"]
  P --> CLI["Codex CLI / Claude CLI"]
  R --> DB["SQLite"]
```

## Node.jsの依存方向

```text
bridge/server.mjs                 composition root
  ├─ bridge/http/                 HTTP controller / versioned routes
  ├─ bridge/application/          use cases and input normalization
  ├─ bridge/*.mjs                 mahjong domain calculations
  └─ bridge/infrastructure/       CLI providers and SQLite repository
```

- HTTP層はChromeやMortalのDOMを知りません。
- Application層はCLIコマンドやSQLite APIを直接呼びません。
- Infrastructure層は、Provider GatewayとRepositoryの契約を実装します。
- `server.mjs` は具象実装を組み立てるだけで、麻雀計算を持ちません。

## 局面解析シーケンス

```mermaid
sequenceDiagram
  participant U as User
  participant V as Chrome View
  participant A as MortalPageAdapter
  participant B as BridgeClient / SW
  participant H as Node HTTP
  participant S as SceneService
  participant P as CLI Provider

  U->>V: 「この局面を解析」
  V->>A: 現在局面を読み取り
  A-->>V: Scene DTO
  V->>B: analyze(scene, provider)
  B->>H: POST /api/v1/analyses/scene
  H->>S: validate + normalize + calculate
  S-->>H: prompt + deterministic facts
  H->>P: run(prompt, output schema)
  P-->>H: status / result / error
  H-->>B: NDJSON events
  B-->>V: stream events
  V-->>U: 構造化された解説UI
```

## DB保存シーケンス

DBへはレポート閲覧時に自動保存せず、利用者が「DBに保存」を押した半荘だけ保存します。

```mermaid
sequenceDiagram
  participant U as User
  participant V as Chrome View
  participant H as Node HTTP
  participant R as RecordService
  participant DB as SQLite Repository

  U->>V: 「DBに保存」
  V->>H: POST /api/v1/records/scenes
  H->>R: validate records
  R->>DB: upsert by scene_id
  DB-->>R: saved count
  R-->>V: DB status
  V-->>U: 「DB保存済み」
```

## API互換性

- 現行契約: `1.0`
- 現行サーバー: `0.14.0`
- v1ルートは `bridge/contracts/api.mjs` が正本です。
- NDJSONイベントは `bridge/contracts/stream-event.schema.json` で定義します。
- 旧ルートはv1へ変換するだけで、新しい実装を二重に持ちません。

## 変更時のルール

1. MortalのHTMLやレポート形式への追従はPage Adapterへ置く。
2. 受け入れ・危険度・押し引き・点棒計算はNodeのDomain/Applicationへ置く。
3. AIモデル追加はProvider Gatewayの実装を増やし、ViewへCLI固有処理を書かない。
4. 保存先変更はRepository実装を差し替え、Applicationの保存ユースケースを変えない。
5. APIを破壊変更する場合は `/api/v2` を追加し、v1を同時に維持する。

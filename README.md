# Discord 麻雀成績管理 Bot

Discord サーバー内の麻雀対局を記録し、成績・イロレーティング・各種ランキングを管理する Bot です。

**Cloudflare Workers + D1 による完全サーバーレス構成**で、Discord の Interactions Endpoint (Webhook) 方式を採用しているため常駐プロセスが不要。通常のサーバー規模なら **Cloudflare 無料枠 (10 万リクエスト/日) 内で運用費 0 円**で動きます。

## 機能

| コマンド | 内容 |
|---|---|
| `/対局登録` | 四麻/三麻を選択 → 対局者をクリックで選択 → 素点を入力ボックスに入力して登録。直後の取消ボタン付き |
| `/成績 [user]` | レート・対局数・平均順位・平均素点・順位率 (四麻/三麻別) |
| `/ランキング` | レートランキング。メニューで**月間対局数**・**月間最高素点**・**トップ率**に切替、ボタンで四麻/三麻切替 |
| `/履歴 [user]` | 直近 10 局の結果表示 |
| `/ヘルプ` | 使い方の表示 |
| `/パネル設置` | ボタンで操作できる常設パネルをチャンネルに設置 (要サーバー管理権限)。ピン留め推奨 |

- **レーティング**: 初期値 1500 のイロレーティング (同卓者全員とのペアワイズ比較、K=32)。四麻と三麻は別レートで管理
- **着順判定**: 素点の高い順 (同点は同順位)
- **素点バリデーション**: 合計が四麻 100,000 点 / 三麻 105,000 点 (25,000 持ち / 35,000 持ち想定) と一致するかチェック
- **月間集計**: 日本時間 (JST) の暦月で集計
- **捏造対策**: 対局の登録は対局者本人のみ可能。結果メッセージに登録者名を表示し、取消も対局者本人か登録者に限定
- **常設パネル**: `/パネル設置` で設置したメッセージのボタンから、コマンドなしで対局登録・成績・ランキング・履歴を操作可能 (成績等の応答は押した本人にのみ表示)
- 複数サーバーに導入してもデータはサーバーごとに独立

## セットアップ手順

### 1. Discord アプリケーションの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) で **New Application**
2. **General Information** から以下を控える
   - `Application ID`
   - `Public Key`
3. **Bot** タブで **Reset Token** → `Bot Token` を控える (コマンド登録にのみ使用)

### 2. Cloudflare 側の準備

```powershell
npm install
npx wrangler login

# D1 データベースを作成し、出力された database_id を wrangler.toml に貼り付ける
npx wrangler d1 create mahjong

# wrangler.toml の DISCORD_PUBLIC_KEY も自分の Public Key に書き換える

# スキーマを適用
npm run db:init

# デプロイ (URL が表示される: https://discord-mahjong.<yourname>.workers.dev)
npm run deploy
```

### 3. Discord との接続

1. Developer Portal の **General Information > Interactions Endpoint URL** にデプロイした Worker の URL を設定して保存 (自動で疎通確認されます)
2. スラッシュコマンドを登録:

```powershell
$env:DISCORD_APP_ID = "<Application ID>"
$env:DISCORD_BOT_TOKEN = "<Bot Token>"
$env:GUILD_ID = "<サーバーID>"   # 省略可。指定すると即時反映
npm run register
```

3. Bot をサーバーに招待。**OAuth2 > URL Generator** で scope に `applications.commands` (と `bot`) をチェックして生成された URL を開く

これで `/対局登録` などのコマンドが使えるようになります。

## 運用メモ

- **コスト**: Workers 無料枠 10 万リクエスト/日、D1 無料枠 500 万行読取/日・5GB。1 日数百局の記録でも余裕で無料枠内
- **取消**: 誤登録は結果メッセージの 🗑️ ボタンで取消可能。レート整合性のため「そのモードの最新の対局」のみ取消できます (対局者本人か登録者のみ)
- **素点合計のルール変更**: 持ち点ルールが異なる場合は [src/handlers.ts](src/handlers.ts) の `EXPECTED_TOTAL` を変更してください
- **開発時**: `npm run dev` + `npm run db:init:local` でローカル実行できます (Discord からの疎通には [cloudflared 等のトンネル](https://developers.cloudflare.com/workers/development-testing/) が必要)

## 構成

```
src/
  index.ts     エントリポイント (署名検証 + ルーティング)
  handlers.ts  コマンド・ボタン・モーダルの処理と表示
  db.ts        D1 (SQLite) クエリ
  elo.ts       イロレーティング計算
  verify.ts    Ed25519 署名検証 (WebCrypto)
  types.ts     Discord API の最小型定義
scripts/
  register-commands.mjs  スラッシュコマンド登録スクリプト
schema.sql     D1 スキーマ
```

# manybot 使い方ガイド

`Koan0717/manybot` は Discord サーバー運営用の多機能 Bot です。discord.py 製の Bot 本体と、Next.js 製の管理ダッシュボードで構成されています。

## 構成

| パス | 内容 |
|---|---|
| `bot.py` | Bot本体（起動スクリプト） |
| `cogs/` | 機能モジュール一式（後述） |
| `database.py` | PostgreSQL（asyncpg）へのDB接続処理 |
| `config.py` | ロール名・チャンネルID・部屋料金などの初期設定 |
| `helpers.py` | 共通ヘルパー関数 |
| `keep_alive.py` | Flaskによる簡易ヘルスチェックサーバー（Replit等でのスリープ防止用） |
| `card_generator.py` | ランクカードなどの画像生成 |
| `dashboard/` | Next.js製の管理画面（ロール・チャンネル設定などをWebから編集） |

### cogs（機能）一覧
`admin`, `economy`（通貨）, `leveling`（レベル）, `rooms`（部屋作成）, `gambling`（賭博）, `interview`（面接）, `evaluation`（評価）, `utility`, `points`, `ipc`, `logging_cog`（ログ）, `ranking`, `reaction_roles`（リアクションロール）, `shop`（ショップ）, `tickets`（チケット）, `self_intro_roles`（自己紹介ロール）

---

## 1. Bot本体のセットアップ

### 必要環境
- Python 3.10以上を推奨
- PostgreSQL データベース（asyncpg を使用）

### 手順

```bash
# 依存パッケージのインストール
pip install -r requirements.txt
```

プロジェクト直下に `.env` ファイルを作成し、以下を設定します。

```env
DISCORD_BOT_TOKEN=あなたのBotトークン
DATABASE_URL=postgresql://ユーザー名:パスワード@ホスト:ポート/DB名
# 任意（省略時はデフォルト値が使われます）
ANONYMOUS_SALT=任意の文字列
SYNC_GUILD_ID=同期対象のサーバーID
PORT=8080
```

起動:

```bash
python bot.py
```

`.env` に `DISCORD_BOT_TOKEN` が無いと `Error: DISCORD_BOT_TOKEN is not set in .env` と表示され起動しません。

### 初回のスラッシュコマンド同期

Bot導入後、Discordサーバー内で管理者権限を持つユーザーが以下のコマンドを実行すると、スラッシュコマンドがそのサーバーに反映されます。

- `!sync_guild` — スラッシュコマンドを現在のサーバー限定で即時同期
- `!clear_sync` — 重複登録されたコマンドを削除して再同期

### 設定のカスタマイズ

`config.py` にはロール名・チャンネルIDなどの初期値（プレースホルダー）が定義されています。実運用の前に、自分のサーバーに合わせて書き換えるか、ダッシュボードから設定するのが基本の流れです（多くの設定値はDB経由で動的に変更可能な `DEFAULT_SETTINGS` に集約されています）。

---

## 2. 管理ダッシュボードのセットアップ（任意）

`dashboard/` フォルダはNext.js製で、ロールやチャンネルなどの設定をWeb画面から行うためのものです。

```bash
cd dashboard
npm install
```

`dashboard/.env.local` を作成し、以下を設定します。

```env
DATABASE_URL=postgresql://ユーザー名:パスワード@ホスト:ポート/DB名
DISCORD_BOT_TOKEN=Bot本体と同じトークン
BOT_TOKEN=（同上、コード内で参照名が2種類あるため両方設定推奨）
NEXT_PUBLIC_DISCORD_CLIENT_ID=DiscordアプリケーションのクライアントID
DISCORD_CLIENT_SECRET=Discordアプリケーションの Client Secret（「Discordでログイン」に必須。サーバー側だけで使用）
DASHBOARD_USERNAME=ダッシュボードログイン用ユーザー名
DASHBOARD_PASSWORD=ダッシュボードログイン用パスワード
JWT_SECRET=任意のランダムな秘密文字列
```

開発モードで起動:

```bash
npm run dev
```

本番ビルド:

```bash
npm run build
npm start
```

### Discordアクティビティ（メンバー向け画面）

ログイン画面には 2 つのボタンがあります。

| ボタン | 対象 | 内容 |
|---|---|---|
| Discordでログイン | サーバーのメンバー | Discordで認証 → サーバーを選択 → プロフィール（通貨・レベル）／送金／役職 |
| 専用ログイン | 管理者・運営 | 従来どおりの ID / パスワード（管理ダッシュボード） |

「Discordでログイン」は **Discordアクティビティの中** と **通常のブラウザ** のどちらからでも使えます。

- **アクティビティから開いた場合**: ログイン画面を開くと自動で Discord の許可画面が表示され、開いた本人のDiscordアカウントでログインします（ログアウト直後は自動では始まらないので、専用ログインも選べます）
- **ブラウザから開いた場合**: ボタンを押すと Discord の認可ページへ移動し、許可すると `/login/discord-callback` に戻ってログインが完了します

一度ログインすると、**ログアウトボタンを押すまでログインしたまま**です（メンバー画面を開くたびにセッションの期限が延び、30日間まったく開かなかった場合だけ再ログインが必要になります）。

Discord Developer Portal で次を設定してください。

1. アプリケーションの **Activities** を有効化する
2. **Activities → URL Mappings** で `/` をダッシュボードの公開ホストに向ける
3. **OAuth2** で Client Secret を取得し、`DISCORD_CLIENT_SECRET` に設定する（設定後は再デプロイ／再起動が必要）
4. **OAuth2 → Redirects** に `https://<ダッシュボードの公開ホスト>/login/discord-callback` を追加して保存する（ブラウザからのログインの戻り先。アクティビティ内の認可にも Redirect が1つ以上登録されている必要があります）

ダッシュボードがプロキシの裏にあるなどで、ブラウザから見えるURLとずれる場合は、`DISCORD_REDIRECT_URI` に上で登録したURLをそのまま設定してください（未設定なら、開いているページのオリジン + `/login/discord-callback` を使います）。

クライアントID は `DISCORD_BOT_TOKEN` から自動取得されるので、この機能のために `NEXT_PUBLIC_DISCORD_CLIENT_ID` を追加する必要はありません（設定してあればそちらを優先します）。

**送金のログと履歴**
- アクティビティ・Webからの送金は、ダッシュボードの「ログ通知設定」→「アクティビティ・Webからの送金」で選んだチャンネルに送信されます（未設定・OFFの場合は「経済システム・通貨変動」のチャンネルに送信）
- 送金は `/pay` も含めて `transfer_logs` テーブルに記録され、メンバー画面の「送金」タブに自分の直近20件（送った・受け取った）が表示されます。記録が始まるのはこの機能の導入後の送金からです

選択できるのは「Botが参加していて、本人も参加しているサーバー」だけです。表示・送金の対象はサーバー側で本人確認したDiscord IDで固定され、他人のデータには触れません。送金は `/pay` と同じ通貨ログに記録され、サーバー側で `/pay` をOFFにしている場合はWebからも送金できません。

**Botへの送金**は、ダッシュボードの「経済・レベリング設定」にある「Botへの送金を許可する」で サーバーごとに ON/OFF できます（デフォルトはON、設定キーは `ALLOW_PAY_TO_BOT`）。OFFにすると `/pay` でもアクティビティの送金でも、Botを送金先にできません。

---

## 3. 動作の仕組み（要点）

- Bot起動時、`bot.py` の `setup_hook` で上記の cogs が順番に読み込まれます。
- VC（ボイスチャンネル）入退室に応じて経験値やコインを付与する処理が `on_voice_state_update` にまとまっています。
- 部屋（VCなど）の自動作成トリガーは `auto_vc_triggers` / `auto_vc_configs` で管理され、現状は `config.py` や Bot内部の辞書で設定します。
- `keep_alive.py` はFlaskで簡易Webサーバーを立て、Replitなどの常時稼働環境でスリープを防ぐためのものです（VPSやDocker常駐運用なら必須ではありません）。

---

## 4. 注意点

- リポジトリに `README.md` が同梱されていなかったため、このガイドはソースコード（`bot.py`, `database.py`, `config.py`, `dashboard/package.json` など）を確認して作成したものです。実際の設定項目名や挙動の詳細は、随時コードを参照して確認してください。
- `config.py` 内の `【仮】〇〇ロール名` のようなプレースホルダーは、実運用前に必ず自分のサーバーの実際のロール名／IDに置き換える必要があります。

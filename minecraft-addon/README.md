# マイクラ連携アドオン「ManyBot Bridge」／マイクラサーバー運用ガイド

ManyBot と連携するマイクラ統合版のアドオン **「ManyBot Bridge」** と、それを動かす **マイクラサーバー（BDS）** の導入・運用ガイドです。

> Discord Bot・管理ダッシュボードについては [../bot/README.md](../bot/README.md) を見てください。

| このフォルダ（`minecraft-addon/`） | 中身 |
|---|---|
| `ManyBotBridge/` | アドオン本体（ビヘイビアパック） |
| `bds-config/` | BDS の `config/default/` に置く設定ファイルのひな形 |
| `README.md` | このガイド |

- 対応: マイクラ統合版（Bedrock）の **Bedrock Dedicated Server（BDS）** のみ。Realms・ローカルワールドでは動きません

---

## 目次

1. [全体の構成](#1-全体の構成)
2. [VPS の準備](#2-vps-の準備)
3. [マイクラサーバー（BDS）の設定](#3-マイクラサーバーbdsの設定)
4. [アドオン「ManyBot Bridge」の導入](#4-アドオンmanybot-bridgeの導入)
5. [pm2 でまとめて常駐させる](#5-pm2-でまとめて常駐させる)
6. [ダッシュボードの設定](#6-ダッシュボードの設定)
7. [ゲーム内コマンド](#7-ゲーム内コマンド)
8. [ゲーム内の動作](#8-ゲーム内の動作)
9. [アップデート手順](#9-アップデート手順)
10. [困ったとき](#10-困ったとき)
11. [ダッシュボード側のAPI（参考）](#11-ダッシュボード側のapi参考)

---

## 1. 全体の構成

```
[ VPS ]                                   [ Vercel ]
  ├─ ManyBot（Discord Bot, pm2）            └─ ManyBot ダッシュボード
  └─ BDS（マイクラサーバー, pm2）                 ・マイクラ連携の設定
        │                                         ・アドオン用API（/api/minecraft/*）
        └─ アドオン ManyBot Bridge ── HTTPS ──→  ↑
                                          [ PostgreSQL（Supabase） ]
                                             └─ 鯖内通貨（users.balance）をBotと共有
```

- マイクラ内の通貨は、Discord サーバーの通貨（ManyBot の所持金）と**同じもの**です。マイクラで稼いだ分は Discord の `/pay` や Webアクティビティ（カジノ・ショップ・ガチャ）でも使えます
- アドオンは 60 秒ごとにダッシュボードへ通信（ハートビート）し、接続状況・オンラインのプレイヤーを送ります

---

## 2. VPS の準備

| 項目 | 目安 |
|---|---|
| OS | Ubuntu 22.04 / 24.04（BDS の Linux 版が動くもの） |
| メモリ | 4GB 以上推奨（BDS 1〜2GB ＋ ManyBot 数百MB） |
| ポート | **UDP 19132**（IPv4）・**UDP 19133**（IPv6）を開ける |

```bash
sudo apt update && sudo apt install -y unzip curl python3 python3-venv
# Node.js（pm2 用）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2
# ファイアウォール（ufw を使っている場合）
sudo ufw allow 19132/udp && sudo ufw allow 19133/udp
```

フォルダ構成の例（pm2 の設定ファイルはこの置き場所を既定にしています）:

```
~/manybot          ← git clone https://github.com/Koan0717/manybot（Bot は bot/、アドオンは minecraft-addon/）
~/bedrock-server   ← BDS を展開
```

---

## 3. マイクラサーバー（BDS）の設定

### 3-1. BDS を展開

[公式ダウンロードページ](https://www.minecraft.net/download/server/bedrock) から Linux 版を取得して展開します。

```bash
mkdir -p ~/bedrock-server && cd ~/bedrock-server
unzip ~/bedrock-server-*.zip
chmod +x bedrock_server
LD_LIBRARY_PATH=. ./bedrock_server   # 一度起動してワールドを作成 → stop で止める
```

> アドオンは **BDS 1.21.90 以降**（`@minecraft/server` 2.0.0）を前提にしています。

### 3-2. server.properties（主な項目）

| 項目 | 例 | 説明 |
|---|---|---|
| `server-name` | `My Server` | サーバー一覧に出る名前 |
| `gamemode` | `survival` | |
| `difficulty` | `normal` | |
| `max-players` | `20` | |
| `online-mode` | `true` | Xbox アカウント認証（ON 推奨） |
| `server-port` / `server-portv6` | `19132` / `19133` | 開けたポートと合わせる |
| `level-name` | `Bedrock level` | ワールドのフォルダ名（`worlds/` の下） |
| `allow-cheats` | `true` | OP のコマンド（/tp など）を使うなら ON |

### 3-3. ベータAPI を ON にする

アドオンが HTTP 通信に使う `@minecraft/server-net`・設定読み込みの `@minecraft/server-admin` はベータ機能です。ワールドで **ベータAPI（Beta APIs）** の実験的機能を ON にしてください。

- 手元のマイクラでワールドを作るときに「実験的機能 → ベータAPI」を ON にしてから、そのワールドフォルダを BDS の `worlds/` にコピーするのが確実です

---

## 4. アドオン「ManyBot Bridge」の導入

### 4-1. APIキーを発行

ダッシュボード → サーバーを選択 → サイドバー「**マイクラ連携の設定**」→「**APIキー・導入**」で APIキーを発行します（キーは発行時にしか表示されません）。

### 4-2. ビヘイビアパックを入れる

```bash
cp -r ~/manybot/minecraft-addon/ManyBotBridge ~/bedrock-server/behavior_packs/
```

ワールドの `worlds/<ワールド名>/world_behavior_packs.json` に追加します（ファイルが無ければ作成）。

```json
[{ "pack_id": "d91cb417-01f0-4a66-a43e-625da22e3c33", "version": [1, 3, 2] }]
```

> `version` は `ManyBotBridge/manifest.json` の `header.version` と同じにしてください。

### 4-3. 設定ファイル（`config/default/`）

`~/manybot/minecraft-addon/bds-config/` の3ファイルを `~/bedrock-server/config/default/` に置き、中身を書き換えます。

```bash
mkdir -p ~/bedrock-server/config/default
cp ~/manybot/minecraft-addon/bds-config/*.json ~/bedrock-server/config/default/
```

| ファイル | 内容 |
|---|---|
| `permissions.json` | `@minecraft/server-net`・`@minecraft/server-admin` などの利用を許可（そのままでOK） |
| `variables.json` | `manybot_url`: ダッシュボードのURL（例 `https://xxx.vercel.app`、最後の `/` なし）<br>`manybot_server_name`: ダッシュボードに表示するサーバー名 |
| `secrets.json` | `manybot_api_key`: 4-1 で発行したAPIキー（`mbmc_...`） |

```json
// variables.json
{ "manybot_url": "https://xxx.vercel.app", "manybot_server_name": "My Server" }
// secrets.json
{ "manybot_api_key": "mbmc_xxxxxxxxxxxxxxxx" }
```

### 4-4. 起動して確認

BDS を再起動し、ダッシュボードの「**接続状況**」で次を確認します。

- サーバー連携: **接続中**
- アドオン: **v1.3.2（最新）**

BDS のログに `[ManyBot] Bridge v1.3.2 started (https://...)` と出ていれば読み込めています。

---

## 5. pm2 でまとめて常駐させる

リポジトリ直下の `ecosystem.config.js` で、**ManyBot と BDS** をまとめて動かせます。

```bash
cd ~/manybot
pm2 start ecosystem.config.js     # まとめて起動（フォルダが無いものは起動しない）
pm2 save                          # 今の状態を保存
pm2 startup                       # 表示されたコマンドを実行 → VPS 再起動後も自動起動
```

| アプリ名 | 中身 | 備考 |
|---|---|---|
| `manybot` | `~/manybot/bot/bot.py`（`bot/` で起動） | `PORT=8080` |
| `bds` | `~/bedrock-server/bedrock_server` | `LD_LIBRARY_PATH=.`、停止時は30秒待つ |

- 置き場所が違うときは環境変数で指定: `BDS_DIR=/path/to/bds pm2 start ecosystem.config.js`
- ManyBot のフォルダに `venv`（または `.venv`）があれば、その Python を使います

よく使うコマンド:

```bash
pm2 ls                 # 状態の一覧
pm2 logs bds           # マイクラのログ
pm2 restart manybot    # Bot だけ再起動
pm2 stop bds           # マイクラを止める
```

### BDS のコンソールについて

pm2 で動かしている BDS には、コンソールからコマンド（`op "名前"`・`stop` など）を打ち込めません。
コンソールをよく使う場合は、**BDS だけ tmux / screen で動かし、Bot は pm2** という分け方がおすすめです。

```bash
pm2 delete bds
tmux new -s bds
cd ~/bedrock-server && LD_LIBRARY_PATH=. ./bedrock_server
# Ctrl+B → D で抜ける。戻るときは tmux attach -t bds
```

> `pm2 stop bds` で止めたときに、終了前のワールド保存がきちんと行われるかは未確認です。大事なワールドは定期的にバックアップしてください（`worlds/` フォルダをコピー）。

---

## 6. ダッシュボードの設定

サイドバーの「**マイクラ連携の設定**」グループ:

| 項目 | 設定できること |
|---|---|
| 接続状況 | サーバー連携・アドオン・入退出ログ・通貨連携の状態、オンラインのプレイヤー、直近の参加・退出 |
| APIキー・導入 | マイクラ連携の ON/OFF、APIキーの発行 |
| ログ送信設定 | **ワールド参加・退出ログ**のチャンネル（テスト送信あり）、マイクラ内取引ログのチャンネル |
| ロビー設定 | 情報端末の「ロビーへテレポート」の行き先（X・Y・Z、ディメンション） |
| 通貨・取引設定 | ゲーム内送金・サーバーに即売り・マーケットの ON/OFF、即売りの値段（アイテムID・表示名・1個の値段）、出品中一覧、直近の取引 |
| マイクラメンバー一覧 | マイクラ名と Discord アカウントの紐付け確認、ロール・運営・OP の状態、最終ログイン、未連携のプレイヤー |

トップ画面の「**マイクラシステム**」を選ぶと、全サーバーの接続状況をまとめて見られます。

**OP 権限**: 「基本・評価設定」の「**運営管理者ロール**」を持つメンバーが連携すると、マイクラ側で OP が付きます。

---

## 7. ゲーム内コマンド

すべて誰でも使えます。名前に空白があるプレイヤーは `"..."` で囲んでください。

| コマンド | 内容 |
|---|---|
| `/manybot:terminal` | 専用アイテム「**情報端末**」をもらう（旧名 `/manybot:shopitem` も使える） |
| `/manybot:menu` | 情報端末のメニューを開く |
| `/manybot:profile` | プロフィールを表示 |
| `/manybot:lobby` | ロビーにテレポート（戦闘中は不可） |
| `/manybot:link` | Discord と連携するための6桁コードを表示 |
| `/manybot:balance` | 所持金（Discord サーバーと共通の通貨）を表示 |
| `/manybot:pay <プレイヤー名> <金額>` | 連携済みのプレイヤーに送金 |
| `/manybot:shop` | ショップのメニュー（売却・買取・自分の出品・サーバーに即売り） |
| `/manybot:shopsell` | **売却**：アイテムを出品する |
| `/manybot:shopbuy` | **買取**：出品しているプレイヤーを選んで買う |
| `/manybot:sell [個数]` | 手に持ったアイテムをサーバーに即売り（個数省略で全部） |

コマンドブロック・他のアドオンからの残高の増減（クエスト報酬・独自ショップなど）:

```
/scriptevent manybot:adjust {"player":"Steve","amount":100,"reason":"クエスト報酬"}
```

`amount` が負なら支払い。残高が足りなければ失敗し、マイナスにはなりません。

---

## 8. ゲーム内の動作

### Discord との連携

1. ゲーム内で `/manybot:link`（または情報端末 → プロフィール →「Discordと連携する」）
2. チャットに 6桁のコードが出る（**10分間有効**）
3. Webのメンバー画面（Discord アクティビティ / ダッシュボードのメンバー画面）→ **プロフィール → マイクラ連携** にコードを入力
4. 連携完了。以後、マイクラ内の所持金 ＝ Discord サーバーの所持金

### 参加・退出

- 参加すると、ダッシュボードで設定したチャンネルに「🟢 ○○ がワールドに参加しました」（退出は 🔴）を送信。連携済みなら Discord アカウントも表示
- 連携済みなら「おかえりなさい！ 所持金: ○○」、未連携なら連携の案内がチャットに出る

### 情報端末

`/manybot:terminal` でもらえるコンパス型のアイテム。死んでもなくならず、売買の対象にもなりません。

| 操作 | 機種 |
|---|---|
| 右クリック | PC |
| 画面を長押し | スマホ・タブレット |
| 使用ボタン | Switch・PS・Xbox など |

使うとメニューが開きます。

- **プロフィール**: マイクラ名・Discord 名・所持金・テキスト/ボイスのレベル・出品数・権限（運営/メンバー）・ロール・連携日
- **ショップ**: 下の「ショップ」へ
- **ロビーへテレポート**: ロビー設定の座標へ移動（ロビーを設定したときだけ表示）

### ロビーへのテレポートと戦闘

直近 **15秒以内** に次のことがあると、テレポートできません。チャットに「**戦闘中はテレポートできません。15秒後にまたお試しください。**」と出ます。

- プレイヤー・モブを攻撃した／攻撃された（弓などの飛び道具も含む）
- 落下・溶岩・炎・溺れるなど、原因を問わずダメージを受けた

### ショップ

| メニュー | 内容 |
|---|---|
| **売却**（出品） | 持っているアイテムを選び、何個・1個いくらで売るかを入力 → 確認画面で「出品する」。アイテムはお店に預けられ、そのまま「自分の出品」を表示 |
| **買取**（購入） | 出品しているプレイヤーの名前一覧 → プレイヤーを選ぶと、出品が「アイコン・名前・1個の値段・在庫」で並ぶ → 個数を入力 → 確認画面（合計・購入後の所持金）で購入 |
| **自分の出品** | いま何を・何個・いくらで売っているか。選ぶと取り下げられ、売れ残りが戻る |
| **サーバーに即売り** | ダッシュボードで決めた値段で、サーバーがすぐ買い取る（値段を設定したときだけ表示） |

- 代金は鯖内通貨で出品者に直接入ります（**出品者がオフラインでも入ります**）。出品者がオンラインならチャットに通知
- 出品は 1人 **20件** まで
- 出品できないもの: 名前を付けたもの・エンチャント付き・耐久が減ったもの・ポーション・シュルカーボックスなど中身を持つもの
- 買ったアイテムがインベントリに入りきらないときは足元に落ちます
- 売却・出品に失敗したときは、預けたアイテムを返却します

### OP 権限（運営）

- 「運営管理者ロール」を持つメンバーとして連携しているプレイヤーには、約1分以内に OP が付きます（「運営ロールを確認したので、OP権限を付与しました」）
- ロールは、連携したとき・ワールドに参加したとき・プロフィールを開いたとき・ダッシュボードの「マイクラメンバー一覧」を開いたときに Discord から取り直します
- ロールが外れる・Discord サーバーを抜けると、アドオンが付けた OP は外れます（手動で `/op` した人はそのまま）
- BDS のバージョンによってはスクリプトから OP を変更できません。そのときはメンバー一覧に「**OP 自動付与できず**」と出るので、BDS のコンソールで `op "プレイヤー名"` を実行してください

---

## 9. アップデート手順

```bash
cd ~/manybot && git pull
rm -rf ~/bedrock-server/behavior_packs/ManyBotBridge
cp -r ~/manybot/minecraft-addon/ManyBotBridge ~/bedrock-server/behavior_packs/
# world_behavior_packs.json の version を manifest.json に合わせる
pm2 restart manybot bds
```

ダッシュボードの「接続状況」→「アドオン」が「最新」になっていれば完了です。古いままだと「更新あり」と表示されます。

> アドオンを改修してバージョンを上げたときは、`ManyBotBridge/manifest.json` の `version`・`scripts/main.js` の `ADDON_VERSION` に加えて、`dashboard/src/lib/minecraft.ts` の `LATEST_ADDON_VERSION` も同じ値にしてください（ダッシュボードの「最新／更新あり」の判定に使います）。

---

## 10. 困ったとき

| 症状 | 確認すること |
|---|---|
| 接続状況が「未接続」「オフライン」 | `variables.json` の URL・`secrets.json` の APIキー、`permissions.json` に `@minecraft/server-net` があるか、ベータAPI が ON か。BDS のログに `[ManyBot]` の警告が出ていないか |
| `APIキーが無効です` | キーを再発行したら `secrets.json` も書き換えて BDS を再起動 |
| アドオンが読み込まれない | BDS のバージョン（1.21.90 以降）、`world_behavior_packs.json` の `pack_id`・`version` |
| 入退出ログが届かない | ダッシュボードの「ログ送信設定」でチャンネルを選び「テスト送信」。Bot にそのチャンネルの送信権限があるか |
| OP が付かない | マイクラメンバー一覧の OP 欄。「OP 自動付与できず」ならコンソールで `op "名前"` |

---

## 11. ダッシュボード側のAPI（参考）

アドオンは `X-ManyBot-Key: <APIキー>` ヘッダーを付けて次のAPIを呼びます。

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/api/minecraft/heartbeat` | 生存通知・オンラインのプレイヤー。設定（通貨名・即売りの値段・ロビー・OPを付ける人）を返す |
| POST | `/api/minecraft/events` | `{ type: "join" \| "leave", player }` 入退出ログ |
| POST | `/api/minecraft/link` | 連携コードの発行 |
| GET | `/api/minecraft/balance?player=` | 残高 |
| POST | `/api/minecraft/pay` | `{ from, to, amount }` 送金 |
| POST | `/api/minecraft/sell` | `{ player, item, count }` サーバーに即売り（価格はサーバー側の設定のみ） |
| POST | `/api/minecraft/adjust` | `{ player, amount, reason }` 残高の増減 |
| GET | `/api/minecraft/market[?seller=]` | 出品の一覧（全部 / その人の） |
| POST | `/api/minecraft/market/list` | `{ player, item, name_key, quantity, unit_price }` 出品 |
| POST | `/api/minecraft/market/buy` | `{ player, listing_id, quantity, unit_price }` 購入（代金の支払いと在庫の減少を同時に行う） |
| POST | `/api/minecraft/market/cancel` | `{ player, listing_id }` 取り下げ（売れ残りを返す） |
| GET | `/api/minecraft/profile?player=` | 情報端末のプロフィール（Discord名・ロール・所持金・レベル） |
| POST | `/api/minecraft/op` | `{ player, status }` OP の付与・解除の結果を報告 |

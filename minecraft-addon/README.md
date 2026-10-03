# ManyBot Bridge（マイクラ統合版アドオン）

ManyBot のダッシュボードと、マイクラ統合版の **Bedrock Dedicated Server（BDS）** をつなぐビヘイビアパックです。

- ダッシュボードの「マイクラ連携の設定」に **接続状況**（サーバー・アドオン）とオンラインのプレイヤーを表示
- ワールドへの **参加・退出ログ** を、ダッシュボードで設定した Discord チャンネルに送信
- マイクラ内の通貨 ＝ Discord サーバーの通貨（ManyBot の所持金）。マイクラで稼いだ分は Discord の `/pay` や Webアクティビティでも使えます

> HTTP 通信に `@minecraft/server-net` を使うため、**BDS でのみ動作します**（Realms・ローカルワールドでは動きません）。

## 導入手順

1. ダッシュボード → サーバーを選択 → サイドバー「マイクラ連携の設定」→「APIキー・導入」で **APIキーを発行** します（キーは発行時にしか表示されません）
2. `ManyBotBridge/` フォルダを BDS の `behavior_packs/` にコピーし、ワールドの `world_behavior_packs.json` に追加します
   ```json
   [{ "pack_id": "d91cb417-01f0-4a66-a43e-625da22e3c33", "version": [1, 1, 0] }]
   ```
3. ワールドの実験的機能で **ベータAPI** をONにします（`server-net` / `server-admin` はベータモジュールのため）
4. `bds-config/` の3ファイルを BDS の `config/default/` に置き、中身を書き換えます
   - `permissions.json` … `@minecraft/server-net` と `@minecraft/server-admin` を許可
   - `variables.json` … `manybot_url` にダッシュボードのURL（例 `https://xxx.vercel.app`）
   - `secrets.json` … `manybot_api_key` に発行したAPIキー
5. BDS を再起動。ダッシュボードの「サーバー連携」が **接続中** になれば完了です（60秒ごとに通信します）

> BDS のバージョンによって `@minecraft/server` のバージョンが合わず読み込めない場合は、`manifest.json` の `dependencies` をそのBDSが対応するバージョンに合わせてください。

## ゲーム内コマンド

| コマンド | 内容 |
|---|---|
| `/manybot:link` | Discord と連携する6桁のコードを表示。メンバー画面「プロフィール → マイクラ連携」に入力 |
| `/manybot:balance` | 所持金（Discordサーバーと共通）を表示 |
| `/manybot:pay <プレイヤー名> <金額>` | 連携済みプレイヤーに送金（名前に空白があるときは `"..."` で囲む） |
| `/manybot:sell [個数]` | 手に持ったアイテムを、ダッシュボードで設定した価格で売却 |
| `/manybot:shop` | ショップ画面を開く（売りたいアイテムと個数を選んで売却） |
| `/manybot:shopitem` | ショップを開く専用アイテム「ショップ端末」をもらう |

### ショップ端末

`/manybot:shopitem` でもらえる「ManyBot ショップ端末」を使うと、ショップ画面が開きます。

- PC：右クリック
- スマホ・タブレット：画面を長押し
- Switch・PS・Xbox など：使用ボタン

ショップには、ダッシュボードの「通貨・取引設定」で登録したアイテムが並びます（持っているものが上）。アイテムを選び、個数（1 / 16 / 64 / 全部）を選ぶと売却されます。インベントリの複数の枠にあっても、まとめて売れます。売却に失敗したときはアイテムを返却します。
ショップ端末は死んでもなくならず、端末そのものは売却の対象になりません。

コマンドブロックや他のアドオンからは、次のように残高を増減できます（ショップ・クエスト報酬など）。

```
/scriptevent manybot:adjust {"player":"Steve","amount":100,"reason":"クエスト報酬"}
```

`amount` が負なら支払い（残高が足りなければ失敗し、マイナスにはなりません）。

## ダッシュボード側のAPI（参考）

アドオンは `X-ManyBot-Key: <APIキー>` ヘッダーを付けて次のAPIを呼びます。

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/api/minecraft/heartbeat` | 生存通知・オンラインのプレイヤー。設定（通貨名・売却価格）を返す |
| POST | `/api/minecraft/events` | `{ type: "join" \| "leave", player }` 入退出ログ |
| POST | `/api/minecraft/link` | 連携コードの発行 |
| GET | `/api/minecraft/balance?player=` | 残高 |
| POST | `/api/minecraft/pay` | `{ from, to, amount }` 送金 |
| POST | `/api/minecraft/sell` | `{ player, item, count }` 売却（価格はサーバー側の設定のみ） |
| POST | `/api/minecraft/adjust` | `{ player, amount, reason }` 残高の増減 |

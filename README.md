# manybot

Discord サーバー運営用の多機能 Bot「ManyBot」と、その管理ダッシュボード、マイクラ（統合版）連携アドオンをまとめたリポジトリです。

## フォルダ構成

| フォルダ | 中身 | 動かす場所 | 説明書 |
|---|---|---|---|
| [`bot/`](bot/) | **Discord Bot**（discord.py。通貨・レベル・部屋・ショップ・カジノなど） | VPS など（pm2） | [bot/README.md](bot/README.md) |
| [`dashboard/`](dashboard/) | **管理ダッシュボード**（Next.js。設定画面・メンバー画面・マイクラ用API） | Vercel など | [bot/README.md](bot/README.md) の「管理ダッシュボード」 |
| [`minecraft-addon/`](minecraft-addon/) | **マイクラのアドオン**「ManyBot Bridge」と BDS 用の設定ファイル | マイクラサーバー（BDS） | [minecraft-addon/README.md](minecraft-addon/README.md) |
| `ecosystem.config.js` | pm2 の設定（Bot とマイクラサーバーをまとめて常駐） | VPS | 下の「pm2」 |

```
[ VPS ]                                   [ Vercel ]
  ├─ bot/（Discord Bot, pm2）               └─ dashboard/（管理ダッシュボード・マイクラ用API）
  └─ BDS（マイクラサーバー, pm2）                         ↑ HTTPS
        └─ minecraft-addon/ManyBotBridge ─────────────────┘
                                          [ PostgreSQL ] ← Bot・ダッシュボードで共有（鯖内通貨＝マイクラ内通貨）
```

## pm2（Bot とマイクラサーバーを常駐）

```bash
npm install -g pm2
pm2 start ecosystem.config.js        # Bot（bot/ で起動）とマイクラサーバー（~/bedrock-server）を起動
pm2 save && pm2 startup              # VPS 再起動後も自動で起動
```

- 置き場所は環境変数で変更可: `MANYBOT_DIR`（このリポジトリ）・`BDS_DIR`（既定 `~/bedrock-server`）。フォルダが無いものは起動しません
- `--only manybot` / `--only bds` で個別に起動できます

## 以前の構成から更新するとき（VPS）

Bot のファイルはリポジトリ直下から `bot/` に移りました。`git pull` したあと、VPS 上にある次のもの（git では管理していないファイル）を `bot/` に移してください。

```bash
cd ~/manybot && git pull
mv .env bot/ 2>/dev/null; mv events.json bot/ 2>/dev/null; mv assets bot/ 2>/dev/null
pm2 delete manybot 2>/dev/null; pm2 start ecosystem.config.js --only manybot && pm2 save
```

- Bot は `bot/` の中で起動します（`cd bot && python bot.py`）。直下で `python bot.py` は使えなくなりました
- `venv` はリポジトリ直下に置いたままで大丈夫です（移動すると壊れます。pm2 の設定は直下の `venv` も使います）
- Render などで動かしている場合は、ルートディレクトリ（Root Directory）を `bot` にするか、起動コマンドを `cd bot && python bot.py` に変えてください
- ダッシュボード（`dashboard/`）とマイクラ側の手順は変わりません

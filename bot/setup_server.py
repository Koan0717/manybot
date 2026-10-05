"""ターミナルから Bot としてログインし、サーバー構築テンプレートをそのまま実行する。

使い方（bot/ で実行）:
    python setup_server.py <サーバーID>              # 零の天月鯖を構築
    python setup_server.py <サーバーID> --dry-run    # 作るものを表示するだけ
    python setup_server.py <サーバーID> --no-settings  # Bot 設定（DB）には書き込まない

DISCORD_BOT_TOKEN（必須）と DATABASE_URL（設定に反映する場合）は .env か環境変数から読む。
"""
import argparse
import asyncio
import os

import discord
from dotenv import load_dotenv

import server_template

load_dotenv()


def main():
    parser = argparse.ArgumentParser(description="サーバー構築テンプレートを実行する")
    parser.add_argument("guild_id", type=int)
    parser.add_argument("--template", default="zero_tengetsu", choices=list(server_template.TEMPLATES))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-settings", action="store_true")
    args = parser.parse_args()

    tpl = server_template.TEMPLATES[args.template]
    print(f"テンプレート: {tpl['name']}（{server_template.plan_summary(tpl)}）")
    if args.dry_run:
        print("ロール:", " / ".join(r["name"] for r in tpl["roles"]))
        for cat in tpl["categories"]:
            print(f"{cat['name']}: " + " / ".join(c["name"] for c in cat["channels"]))
        return

    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN が設定されていません")
    apply_settings = not args.no_settings and bool(os.getenv("DATABASE_URL"))
    if not args.no_settings and not apply_settings:
        print("DATABASE_URL が無いので Bot 設定への反映はスキップします")

    client = discord.Client(intents=discord.Intents.default())

    @client.event
    async def on_ready():
        try:
            guild = client.get_guild(args.guild_id)
            if guild is None:
                print(f"サーバー {args.guild_id} が見つかりません（Bot が参加しているか確認してください）")
                return
            print(f"ログイン: {client.user} / 対象サーバー: {guild.name}")
            if apply_settings:
                import database
                client.bot_settings = await database.load_settings()
                client.auto_vc_triggers = set(await database.get_auto_vc_triggers())
            result = await server_template.build(client, guild, tpl, apply_settings, progress=_print)
            print(f"ロール: 新規 {len(result['created_roles'])} / 既存 {len(result['reused_roles'])}")
            print(f"カテゴリー・チャンネル: 新規 {len(result['created_channels'])} / 既存 {len(result['reused_channels'])}")
            if apply_settings:
                print(f"Bot 設定: {len(result['settings'])} 項目に反映（稼働中の Bot は再起動で読み込み直されます）")
            for e in result["errors"]:
                print("⚠️", e)
        finally:
            await client.close()

    client.run(token, log_handler=None)


async def _print(msg):
    print(msg)


if __name__ == "__main__":
    main()

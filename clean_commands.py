import requests, os, time
from dotenv import load_dotenv
load_dotenv()
token = os.getenv('DISCORD_BOT_TOKEN')
import base64
bot_id = base64.b64decode((token.split('.')[0] + '==').encode()).decode()
headers = {'Authorization': f'Bot {token}'}
res = requests.get(f'https://discord.com/api/v10/applications/{bot_id}/commands', headers=headers).json()
for cmd in res:
    print(f"Deleting {cmd['name']} ({cmd['id']})...")
    d_res = requests.delete(f'https://discord.com/api/v10/applications/{bot_id}/commands/{cmd["id"]}', headers=headers)
    if d_res.status_code != 204:
        print(f'Failed to delete {cmd["name"]}: {d_res.status_code} {d_res.text}')
    time.sleep(3)

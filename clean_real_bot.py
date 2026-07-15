import requests, time, base64

token = 'MTUyNTE5NDI4OTEwMDA5OTY1NA.GIDMTT.K4YglKENWq8uPpdrETv7ON_d1h3hgq2k-kRwQw'
bot_id = base64.b64decode((token.split('.')[0] + '==').encode()).decode()
headers = {'Authorization': f'Bot {token}'}

print(f'Fetching commands for bot {bot_id}...')
res = requests.get(f'https://discord.com/api/v10/applications/{bot_id}/commands', headers=headers)
if res.status_code != 200:
    print('Failed to fetch:', res.status_code, res.text)
else:
    commands = res.json()
    print(f'Found {len(commands)} global commands.')
    for cmd in commands:
        print(f"Deleting {cmd['name']} ({cmd['id']})...")
        d_res = requests.delete(f'https://discord.com/api/v10/applications/{bot_id}/commands/{cmd["id"]}', headers=headers)
        if d_res.status_code != 204:
            print(f'Failed to delete {cmd["name"]}: {d_res.status_code} {d_res.text}')
        time.sleep(2)
    print('Done clearing global commands!')

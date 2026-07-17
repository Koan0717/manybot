import requests, json, os
token='MTUwMjY5NTU1NTk3MTY3ODM3OA.GjDBhU.xzadL0lnD50U76VHeoFDnriak-WxEHFeUXJ7Fs'
headers = {'Authorization': f'Bot {token}'}
res = requests.get('https://discord.com/api/v10/guilds/1505398772828471357/roles', headers=headers)
if res.status_code == 200:
    roles = res.json()
    found = [r for r in roles if str(r['id']) == '1505617158808539208']
    if found:
        print('ROLE FOUND:', found[0]['name'])
    else:
        print('ROLE NOT FOUND IN GUILD')
else:
    print('Failed to fetch roles:', res.status_code, res.text)

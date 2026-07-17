import requests, json, os
token='MTUwMjY5NTU1NTk3MTY3ODM3OA.GjDBhU.xzadL0lnD50U76VHeoFDnriak-WxEHFeUXJ7Fs'
headers = {'Authorization': f'Bot {token}'}
print('forum 1:', requests.get('https://discord.com/api/v10/channels/1515107983712063649', headers=headers).status_code)
print('intro 1:', requests.get('https://discord.com/api/v10/channels/1508919854617460787', headers=headers).status_code)

import sqlite3
conn = sqlite3.connect('economy.db')
cursor = conn.cursor()
cursor.execute("SELECT * FROM bot_settings WHERE setting_key = 'ROOM_PRICES'")
for row in cursor.fetchall():
    print(row)

import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def fix_db():
    try:
        conn = await asyncpg.connect(os.environ['DATABASE_URL'])
        print("Connected.")
        
        # Delete duplicates
        await conn.execute('''
            DELETE FROM log_settings a USING log_settings b 
            WHERE a.guild_id = b.guild_id 
              AND a.log_type = b.log_type 
              AND a.ctid < b.ctid
        ''')
        print("Duplicates removed.")
        
        # Add primary key
        await conn.execute('ALTER TABLE log_settings ADD PRIMARY KEY (guild_id, log_type)')
        print("Primary key added successfully!")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if 'conn' in locals():
            await conn.close()

asyncio.run(fix_db())

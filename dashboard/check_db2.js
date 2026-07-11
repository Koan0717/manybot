const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.nxvdvrebqjrzxcxfrpun:Kakijun06100717@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
client.connect().then(async () => {
  try {
    await client.query("ALTER TABLE bot_settings ADD COLUMN guild_id BIGINT DEFAULT 1502700570396590100");
    console.log("Added guild_id column");
    await client.query("ALTER TABLE bot_settings DROP CONSTRAINT bot_settings_pkey");
    console.log("Dropped old primary key");
    await client.query("ALTER TABLE bot_settings ADD PRIMARY KEY (guild_id, setting_key)");
    console.log("Added new primary key");
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
});

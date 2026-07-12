const { Client } = require('pg');

async function migrateDB(url, defaultGuildId) {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  console.log('Connected to', url.split('@')[1]);
  
  try {
    await client.query(`ALTER TABLE level_coin_rewards ADD COLUMN IF NOT EXISTS guild_id BIGINT DEFAULT ${defaultGuildId}`);
    console.log(`Added guild_id to level_coin_rewards`);
    
    // Update PK for level_role_rewards
    try {
      await client.query(`ALTER TABLE level_role_rewards DROP CONSTRAINT level_role_rewards_pkey CASCADE`);
    } catch(e) {}
    try {
      await client.query(`ALTER TABLE level_role_rewards ADD PRIMARY KEY (guild_id, level_type, level, role_id)`);
      console.log(`Updated PK for level_role_rewards`);
    } catch(e) { console.log(e.message) }

    // Update PK for level_coin_rewards
    try {
      await client.query(`ALTER TABLE level_coin_rewards DROP CONSTRAINT level_coin_rewards_pkey CASCADE`);
    } catch(e) {}
    try {
      await client.query(`ALTER TABLE level_coin_rewards ADD PRIMARY KEY (guild_id, level_type, level)`);
      console.log(`Updated PK for level_coin_rewards`);
    } catch(e) { console.log(e.message) }
    
  } catch (e) {
    console.error(`Error migrating:`, e.message);
  }
  
  await client.end();
}

async function run() {
  await migrateDB('postgresql://postgres.nxvdvrebqjrzxcxfrpun:Kakijun06100717@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres', '1502700570396590100');
  await migrateDB('postgresql://postgres.gjbckzsshcstzhojikhs:Kakijun06100717!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres', '1505398772828471357');
}

run();

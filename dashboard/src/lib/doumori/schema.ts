import type { Pool, PoolClient } from 'pg';

/**
 * どう森BOTのテーブルを作成する（無ければ）。
 * サーバー専用DBを新しく登録した直後でも、ダッシュボードから設定できるようにするため。
 */
export async function initDoumoriSchema(pool: Pool) {
  // どう森BOT本体（doumori リポジトリ src/database/db.js の initDoumoriSchema）と同じ内容

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    // 1. どうぶつの森Bot専用ユーザーデータ
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_users (
        guild_id BIGINT,
        user_id BIGINT,
        tickets INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 0,
        vc_total_seconds INTEGER DEFAULT 0,
        vc_unclaimed_seconds INTEGER DEFAULT 0,
        chat_message_count INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
    `);

    // 2. インベントリ (道具所持数)
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_inventory (
        guild_id BIGINT,
        user_id BIGINT,
        item_id TEXT,
        quantity INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id, item_id)
      );
    `);

    // 3. 図鑑コレクション
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_collection (
        guild_id BIGINT,
        user_id BIGINT,
        category TEXT,
        creature_id TEXT,
        count INTEGER DEFAULT 1,
        has_shiny BOOLEAN DEFAULT FALSE,
        first_caught_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, user_id, category, creature_id)
      );
    `);

    // 4. マイルポイント＆ランクテーブル
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_miles (
        guild_id BIGINT,
        user_id BIGINT,
        miles INTEGER DEFAULT 0,
        rank_level INTEGER DEFAULT 1,
        mission_count INTEGER DEFAULT 0,
        total_mission_count INTEGER DEFAULT 0,
        last_diy_at TIMESTAMP,
        PRIMARY KEY (guild_id, user_id)
      );
    `);

    // 既存テーブルへのカラム追加（安全なマイグレーション）
    await client.query("ALTER TABLE doumori_miles ADD COLUMN IF NOT EXISTS mission_count INTEGER DEFAULT 0").catch(() => {});
    await client.query("ALTER TABLE doumori_miles ADD COLUMN IF NOT EXISTS total_mission_count INTEGER DEFAULT 0").catch(() => {});
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS doumori_miles_uidx ON doumori_miles (guild_id, user_id)").catch(() => {});

    // 5. デイリーミッションテーブル (1日3枠対応)
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_daily_missions (
        guild_id BIGINT,
        user_id BIGINT,
        date_key TEXT,
        mission_slot INTEGER DEFAULT 1,
        mission_id INTEGER,
        mission_title TEXT,
        mission_desc TEXT,
        reward_miles INTEGER DEFAULT 100,
        status TEXT DEFAULT 'pending',
        proof_url TEXT
      );
    `);

    // 既存テーブルへのカラム追加（安全なマイグレーション）
    await client.query("ALTER TABLE doumori_daily_missions ADD COLUMN IF NOT EXISTS mission_slot INTEGER DEFAULT 1").catch(() => {});
    await client.query("ALTER TABLE doumori_daily_missions ADD COLUMN IF NOT EXISTS mission_id INTEGER").catch(() => {});
    await client.query("ALTER TABLE doumori_daily_missions ADD COLUMN IF NOT EXISTS mission_title TEXT").catch(() => {});
    
    // 古い主キー制約 (guild_id, user_id, date_key) を削除して3枠同日保存を可能にする
    try {
      await client.query("ALTER TABLE doumori_daily_missions DROP CONSTRAINT IF EXISTS doumori_daily_missions_pkey");
    } catch (e) {}

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS doumori_daily_missions_slot_uidx
      ON doumori_daily_missions (guild_id, user_id, date_key, mission_slot);
    `).catch(() => {});

    // 6. ミッションマスターテーブル (ダッシュボード用ミッション管理)
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_missions_master (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT DEFAULT 0,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        target_rank INTEGER DEFAULT 0,
        reward_miles INTEGER DEFAULT 100,
        is_active BOOLEAN DEFAULT TRUE,
        times_assigned INTEGER DEFAULT 0,
        times_completed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. 階級・ランクマスターテーブル (ダッシュボード用ランク設定)
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_ranks_master (
        level INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        required_miles INTEGER NOT NULL,
        color TEXT NOT NULL,
        role_name TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 初期ランクデータの投入 (未存在時のみ)
    const initialRanks = [
      { level: 1, name: "🌱 新規住人", requiredMiles: 0, color: "#A8E6CF", roleName: "新規住人" },
      { level: 2, name: "🏠 住人", requiredMiles: 4000, color: "#3498DB", roleName: "住人" },
      { level: 3, name: "☕ 常連住人", requiredMiles: 15000, color: "#E67E22", roleName: "常連住人" },
      { level: 4, name: "🌟 人気住人", requiredMiles: 45000, color: "#FFD700", roleName: "人気住人" },
    ];
    for (const r of initialRanks) {
      await client.query(
        `INSERT INTO doumori_ranks_master (level, name, required_miles, color, role_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (level) DO NOTHING`,
        [r.level, r.name, r.requiredMiles, r.color, r.roleName]
      ).catch(() => {});
    }

    // 初期ミッションマスターの投入 (未存在時のみ)
    const mCheck = await client.query("SELECT COUNT(*) FROM doumori_missions_master");
    if (parseInt(mCheck.rows[0].count, 10) === 0) {
      const defaultMissions = [
        { title: "VC交流", desc: "VCに通算30分以上参加する", rank: 0, miles: 100 },
        { title: "雑談あいさつ", desc: "雑談チャンネルであいさつや会話を3回以上送信する", rank: 0, miles: 100 },
        { title: "魚釣り挑戦", desc: "`/釣り` で魚を1匹以上釣り上げる", rank: 0, miles: 100 },
        { title: "虫捕り挑戦", desc: "`/虫捕り` で虫を1匹以上捕まえる", rank: 0, miles: 100 },
        { title: "ショップ利用", desc: "`/ショップ` または `/両替` を1回利用する", rank: 0, miles: 100 },
        { title: "生き物売却", desc: "`/売却` で重複した生き物を売却してベルにする", rank: 0, miles: 100 },
        { title: "VC長時間滞在", desc: "VCに通算1時間以上参加してメンバーと交流する", rank: 0, miles: 100 },
        { title: "レア生き物捕獲", desc: "レア度RARE以上の生き物を1匹捕獲する", rank: 0, miles: 100 },
        { title: "図鑑チェック", desc: "`/魚図鑑` または `/虫図鑑` を確認してコレクションを広げる", rank: 0, miles: 100 },
        { title: "イベント参加", desc: "DIY作業台イベントや鯖内イベントに参加・告知する", rank: 0, miles: 100 },
      ];
      for (const m of defaultMissions) {
        await client.query(
          `INSERT INTO doumori_missions_master (title, description, target_rank, reward_miles, is_active)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [m.title, m.desc, m.rank, m.miles]
        ).catch(() => {});
      }
    }

    // 8. ミッション承認・処理履歴ログテーブル
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_mission_logs (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT,
        user_id BIGINT,
        staff_id BIGINT,
        mission_desc TEXT,
        reward_miles INTEGER DEFAULT 100,
        mission_count INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 9. マイル手動付与・没収ログテーブル (管理者用)
    await client.query(`
      CREATE TABLE IF NOT EXISTS doumori_mile_logs (
        id SERIAL PRIMARY KEY,
        guild_id BIGINT,
        user_id BIGINT,
        admin_id BIGINT,
        amount INTEGER,
        action TEXT,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 10. どうぶつの森Bot 設定テーブル
      CREATE TABLE IF NOT EXISTS doumori_settings (
        guild_id BIGINT,
        setting_key TEXT,
        setting_value TEXT,
        PRIMARY KEY (guild_id, setting_key)
      );
    `);

    
  } finally {
    if (client) client.release();
  }
}

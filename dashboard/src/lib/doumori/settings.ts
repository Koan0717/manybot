export const DEFAULT_SETTINGS: Record<string, any> = {
  // 1. 浮上・チケット獲得システム
  ticket_required_minutes: 60,
  ticket_chat_activity_seconds: 60,
  ticket_chat_cooldown_seconds: 60,
  ticket_notify_enabled: true,
  ticket_notify_destination: 'last_channel', // 'dm' | 'channel' | 'last_channel'
  ticket_notify_channel_id: '',
  ticket_notify_message:
    '🎉 **【浮上特典】** {user} さんがアクティビティを達成し、**図鑑チケット ×{tickets}** を獲得しました！（所持数: {total}枚）',

  // 2. ショップ＆両替
  miles_per_ticket: 100,
  fishing_rod_price: 1,
  bug_net_price: 1,

  // 3. 採集
  shiny_chance_percent: 0.5,

  // 4. 図鑑
  book_page_size: 10,

  // 5. 限定コンプリートロール付与
  fish_completion_role_name: '🎣 金のつりざお',
  fish_completion_role_color: '#FFD700',
  bug_completion_role_name: '🦋 金の虫取り網',
  bug_completion_role_color: '#FFD700',

  // 6. 鯖内通貨 (ベル) 生き物売却
  sell_price_common: 100,
  sell_price_uncommon: 300,
  sell_price_rare: 800,
  sell_price_super_rare: 2500,
  sell_price_legendary: 10000,
  sell_price_shiny_multiplier: 5,

  // 7. ミッション報告
  mission_report_channel_id: '',
  daily_mission_slot_count: 3,

  // 8. 総合操作パネル
  panel_channel_id: '',
  panel_title: '🍃 どうぶつの森林 - 総合操作パネル',
  panel_color: '#2ECC71',
};

export const DEFAULT_RANKS = [
  { level: 1, name: '🌱 新規住人', required_miles: 0, color: '#A8E6CF', role_name: '新規住人' },
  { level: 2, name: '🏠 住人', required_miles: 4000, color: '#3498DB', role_name: '住人' },
  { level: 3, name: '☕ 常連住人', required_miles: 15000, color: '#E67E22', role_name: '常連住人' },
  { level: 4, name: '🌟 人気住人', required_miles: 45000, color: '#FFD700', role_name: '人気住人' },
];

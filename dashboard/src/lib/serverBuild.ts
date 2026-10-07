/**
 * サーバー作成（/dashboard/[guild_id]/server-build）で作る基盤のカテゴリー。
 * 中身（チャンネル・見える範囲）は Bot 側の bot/server_template.py（_custom_categories）で決める。
 * id と requires は CUSTOM_CATEGORY_REQUIRES と合わせること。
 */
export interface ServerBuildCategory {
  id: string;
  label: string;
  description: string;
  /** どれか1つのロール名が入っているときだけ作る（空なら常に作る） */
  requires: string[];
}

const EVALUATORS = ['EVALUATOR_ROLE_IDS', 'EVALUATOR_TIER2_ROLE_IDS', 'EVALUATOR_TIER3_ROLE_IDS', 'EVALUATOR_MENTION_ROLE_IDS'];

export const SERVER_BUILD_CATEGORIES: ServerBuildCategory[] = [
  { id: 'info', label: '📢 案内', description: 'ようこそ・ルール・お知らせ（入界待機者ロールがあれば入界手続きも）', requires: [] },
  { id: 'interview', label: '🚪 面接', description: '面接待合室・面接室VC', requires: ['INTERVIEWER_ROLE_IDS', 'PENDING_MEMBER_ROLE_ID'] },
  { id: 'evaluation', label: '📋 評価', description: '評価の流れ・自己紹介・評価雑談・評価VC（評価カテゴリー・自己紹介チャンネルに設定）', requires: [...EVALUATORS, 'NEW_MEMBER_ROLE_IDS'] },
  { id: 'community', label: '💬 交流', description: '雑談・画像・コマンド・通話募集・レベルアップ・雑談VC・VC作成', requires: [] },
  { id: 'support', label: '🎫 窓口', description: 'お問い合わせ・匿名チャット（スタンプ・司祭ロールがあれば依頼・告解も）', requires: [] },
  { id: 'entertainment', label: '🎲 娯楽', description: 'カジノ・ショップ・ガチャ・ボードゲーム・ゲームVC作成', requires: [] },
  { id: 'eval_room', label: '⚖️ 評価員室', description: '評価員だけが見られる会議・記録', requires: EVALUATORS },
  { id: 'failed', label: '⛓️ 再評価', description: '評価落ち専用の案内・再評価申請', requires: ['DOWNGRADE_ROLE_ID'] },
  { id: 'violator', label: '🚫 違反者', description: '違反者専用の案内・反省文・異議申し立て', requires: ['GAMBLE_VIOLATOR_ROLE_IDS'] },
  { id: 'staff', label: '🛡️ 運営', description: '運営連絡・運営メモ・運営会議VC', requires: [] },
  { id: 'logs', label: '📂 ログ', description: '入退室・メッセージ・VC・通貨などのログ（送信先が未設定のものだけ登録）', requires: [] },
];

/** 「おすすめの名前を入れる」で入れるロール名 */
export const SUGGESTED_ROLE_NAMES: Record<string, string> = {
  ADMIN_ROLE_IDS: '🛡️ 運営',
  EVALUATOR_TIER3_ROLE_IDS: '⚖️ 上級評価員',
  EVALUATOR_TIER2_ROLE_IDS: '⚖️ 中級評価員',
  EVALUATOR_ROLE_IDS: '📋 評価員',
  INTERVIEWER_ROLE_IDS: '🚪 面接官',
  MAIN_MEMBER_ROLE_IDS: '✦ 本メンバー',
  SUB_MEMBER_ROLE_IDS: '✧ 準メンバー',
  NEW_MEMBER_ROLE_IDS: '🔰 仮メンバー',
  PENDING_MEMBER_ROLE_ID: '🌫️ 入界待機',
  DOWNGRADE_ROLE_ID: '⛓️ 評価落ち',
  GAMBLE_VIOLATOR_ROLE_IDS: '🚫 違反者',
};

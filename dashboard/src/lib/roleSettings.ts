/**
 * 基本・評価設定の「すべてのロール設定」の項目（Bot 設定のキーと表示名）。
 * サーバー作成（/dashboard/[guild_id]/server-build）でも、この設定名ごとにロール名を入力してロールを作る。
 */
export interface RoleSetting {
  key: string;
  label: string;
  multiple: boolean;
}

export const ROLE_SETTINGS: RoleSetting[] = [
  { key: 'NEW_MEMBER_ROLE_IDS', label: '仮（新規）メンバーロール', multiple: true },
  { key: 'DOWNGRADE_ROLE_ID', label: '評価落ちロール', multiple: false },
  { key: 'PENDING_MEMBER_ROLE_ID', label: '入界待機者ロール', multiple: false },
  { key: 'EMBLEM_MANAGER_ROLE_ID', label: 'スタンプ統括ロール', multiple: false },
  { key: 'EMBLEM_MASTER_ROLE_IDS', label: 'スタンプ従業員ロール', multiple: true },
  { key: 'CONFESSION_PRIEST_ROLE_ID', label: '告解司祭ロール', multiple: false },
  { key: 'PRIEST_ROLE_ID', label: '司祭ロール', multiple: false },
  { key: 'ADMIN_ROLE_IDS', label: '運営管理者ロール', multiple: true },
  { key: 'INTERVIEWER_ROLE_IDS', label: '面接官ロール', multiple: true },
  { key: 'EVALUATOR_ROLE_IDS', label: '初級評価員ロール', multiple: true },
  { key: 'EVALUATOR_TIER2_ROLE_IDS', label: '中級評価員ロール', multiple: true },
  { key: 'EVALUATOR_TIER3_ROLE_IDS', label: '上級評価員ロール', multiple: true },
  { key: 'EVALUATOR_MENTION_ROLE_IDS', label: '評価員メンション用ロール', multiple: true },
  { key: 'FREE_INN_ROLE_IDS', label: '無料宿ロール', multiple: true },
  { key: 'MAIN_SUB_MEMBER_ROLE_IDS', label: '本・準メンバーロール', multiple: true },
  // メンバー画面「役職」タブの昇格のお祝い（本メン・準メンを区別する）に使う
  { key: 'MAIN_MEMBER_ROLE_IDS', label: '本メンバーロール', multiple: true },
  { key: 'SUB_MEMBER_ROLE_IDS', label: '準メンバーロール', multiple: true },
  { key: 'EVENT_MANAGER_ROLE_IDS', label: 'イベンター統括ロール', multiple: true },
  { key: 'GAMBLE_EMPLOYEE_ROLE_IDS', label: '賭博従業員ロール', multiple: true },
  { key: 'GAMBLE_MANAGER_ROLE_IDS', label: '賭博統括ロール', multiple: true },
  { key: 'SHOP_EMPLOYEE_ROLE_ID', label: 'ショップ従業員ロール', multiple: false },
  { key: 'SHOP_MANAGER_ROLE_ID', label: 'ショップ統括ロール', multiple: false },
  { key: 'MINUS_TARGET_ROLE_IDS', label: '通貨マイナス落ち対象ロール', multiple: true },
  { key: 'BANKER_ROLE_IDS', label: '銀行員ロール', multiple: true },
  { key: 'GAMBLE_VIOLATOR_ROLE_IDS', label: '違反者ロール', multiple: true },
  { key: 'MALE_ROLE_ID', label: '男性ロール (通話募集枠:青)', multiple: false },
  { key: 'FEMALE_ROLE_ID', label: '女性ロール (通話募集枠:ピンク)', multiple: false },
];

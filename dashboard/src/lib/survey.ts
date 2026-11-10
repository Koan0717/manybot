/** surveys テーブルの行をダッシュボード向けの JSON に変換する */
export const toSurveyJson = (row: any, responseCount = 0) => ({
  id: row.id,
  title: row.title || '',
  description: row.description || '',
  questions: Array.isArray(row.questions) ? row.questions : [],
  is_anonymous: row.is_anonymous === true,
  allow_edit: row.allow_edit !== false,
  is_open: row.is_open !== false,
  closes_at: row.closes_at ? new Date(row.closes_at).toISOString() : null,
  button_label: row.button_label || '回答する',
  channel_id: row.channel_id ? String(row.channel_id) : null,
  message_id: row.message_id ? String(row.message_id) : null,
  created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  response_count: responseCount,
});

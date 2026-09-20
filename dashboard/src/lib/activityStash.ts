/**
 * Discordアクティビティの起動パラメータ(frame_id / instance_id / platform 等)の退避。
 *
 * Discord SDK は「今のURL」の ?frame_id=… を読んで初期化する。ところが起動URLに付くこのパラメータは、
 * 画面遷移（Next.js の router.push、ログアウト、リダイレクトなど）で簡単に消える。
 * そこで、どのページが最初に読み込まれても、その時点のURLにパラメータがあれば退避しておき、
 * ログイン画面でSDKを初期化する直前にURLへ戻す（lib/memberClient.ts の restoreActivityParams）。
 */
export const ACTIVITY_QUERY_KEY = 'discord_activity_query';
// sessionStorage が使えない環境の予備。window.name は同じタブの遷移をまたいで残る
export const WINDOW_NAME_PREFIX = '__discord_activity_query=';
// 上の2つが使えない環境の最後の予備。古い frame_id を後日使い回さないよう、短時間だけ有効にする
export const BACKUP_KEY = 'discord_activity_query_backup';
export const BACKUP_TTL_MS = 5 * 60 * 1000;
// ログイン画面へのリダイレクトで付くものは退避しない
export const TRANSIENT_PARAMS = ['redirect', 'session_token'];

/**
 * ブラウザで最初に実行されるインラインスクリプト（<head> とミドルウェアのHTMLに埋め込む）。
 * 上の定数と同じキー・同じ形式で書く。
 */
export const ACTIVITY_STASH_SCRIPT = `(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    if (!params.get('frame_id')) return;
    ${JSON.stringify(TRANSIENT_PARAMS)}.forEach(function (key) { params.delete(key); });
    var value = '?' + params.toString();
    try { sessionStorage.setItem(${JSON.stringify(ACTIVITY_QUERY_KEY)}, value); } catch (e) {}
    try { window.name = ${JSON.stringify(WINDOW_NAME_PREFIX)} + value; } catch (e) {}
    try { localStorage.setItem(${JSON.stringify(BACKUP_KEY)}, JSON.stringify({ q: value, t: Date.now() })); } catch (e) {}
  } catch (e) {}
})();`;

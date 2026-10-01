'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Loader2, LogOut, Server, Settings, User } from 'lucide-react';
import { MemberState, clearMemberState, getActivityContext, guildIconUrl, keepMemberSessionAlive, loadMemberState, markLoggedOut, memberFetch } from '@/lib/memberClient';

export default function MemberHome() {
  const router = useRouter();
  const [state, setState] = useState<MemberState | null>(null);
  // 運営管理者ロールの確認中のサーバー / 「プロフィール・管理ダッシュボード」を選ばせているサーバー
  const [checking, setChecking] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [adminCache, setAdminCache] = useState<Record<string, boolean>>({});
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const s = loadMemberState();
    if (!s) {
      router.replace(`/login${window.location.search}`);
      return;
    }
    setState(s);
    keepMemberSessionAlive();
    // アクティビティで開いたとき: 招待の「アクティビティで参加」から来たならその対局へ、
    // サーバーの通話で開いたならそのサーバーの画面へそのまま進む
    const ctx = getActivityContext();
    if (!ctx) return;
    // 自動で進むのはアクティビティを開いた最初の1回だけ（「別のサーバーを選ぶ」で戻ってきたときは進まない）
    try {
      if (sessionStorage.getItem('member_activity_autonav')) return;
      sessionStorage.setItem('member_activity_autonav', '1');
    } catch {}
    let cancelled = false;
    (async () => {
      const ids = s.guilds.map((g) => g.id);
      const order = ctx.guildId && ids.includes(ctx.guildId) ? [ctx.guildId, ...ids.filter((id) => id !== ctx.guildId)] : ids;
      for (const gid of order.slice(0, 10)) {
        try {
          const res = await memberFetch(`/api/member/guilds/${gid}/boardgames/join`);
          const data = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (data?.game_id) {
            router.replace(`/member/${gid}?game=${encodeURIComponent(data.game_id)}`);
            return;
          }
        } catch {}
      }
      if (!cancelled && ctx.guildId && ids.includes(ctx.guildId)) router.replace(`/member/${ctx.guildId}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // サーバーを選んだら、そのサーバーの運営管理者ロールを持っているか確かめる。
  // 持っていればプロフィールと管理ダッシュボードの2つのボタンを出し、持っていなければそのままプロフィールへ
  const selectGuild = async (guildId: string) => {
    if (checking || entering) return;
    setError('');
    if (choosing === guildId) {
      setChoosing(null);
      return;
    }
    let isAdmin = adminCache[guildId];
    if (isAdmin === undefined) {
      setChecking(guildId);
      try {
        const res = await memberFetch(`/api/member/guilds/${guildId}/admin`);
        const data = await res.json().catch(() => ({}));
        isAdmin = res.ok && data.is_admin === true;
        if (res.ok) setAdminCache((prev) => ({ ...prev, [guildId]: isAdmin }));
      } catch {
        isAdmin = false;
      } finally {
        setChecking(null);
      }
    }
    if (isAdmin) setChoosing(guildId);
    else router.push(`/member/${guildId}`);
  };

  // 管理ダッシュボードへ（そのサーバーだけのサブアドミンとして入る）
  const enterDashboard = async (guildId: string) => {
    setError('');
    setEntering(true);
    try {
      const res = await memberFetch(`/api/member/guilds/${guildId}/admin`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        setError(data.error || '管理ダッシュボードに入れませんでした');
        setEntering(false);
        return;
      }
      try {
        localStorage.setItem('dashboard_session', data.token);
      } catch {}
      // Cookie が使えない環境でも入れるよう、専用ログインと同じくトークンをURLでも渡す
      const url = new URL(data.redirect || `/dashboard/${guildId}`, window.location.href);
      url.searchParams.set('session_token', data.token);
      window.location.href = url.pathname + url.search;
    } catch {
      setError('管理ダッシュボードに入れませんでした');
      setEntering(false);
    }
  };

  const logout = () => {
    clearMemberState();
    markLoggedOut();
    router.replace(`/login${window.location.search}`);
  };

  if (!state) {
    return <main className="min-h-screen bg-zinc-950" />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center gap-3 mb-8">
          <img src={state.user.avatar_url} alt="" className="w-11 h-11 rounded-full ring-2 ring-zinc-800" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">Discordでログイン中</div>
            <div className="font-bold truncate">{state.user.name}</div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg px-3 py-2 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> ログアウト
          </button>
        </header>

        <h1 className="text-xl font-bold mb-1">サーバーを選択</h1>
        <p className="text-sm text-zinc-500 mb-5">
          選んだサーバーでのプロフィール・送金・役職を表示します。運営の方は管理ダッシュボードにも入れます。
        </p>

        {error && (
          <div className="bg-red-950/60 border border-red-800/60 text-red-300 px-4 py-3 rounded-xl text-sm mb-4">{error}</div>
        )}

        {state.guilds.length === 0 ? (
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8 text-center text-zinc-500 text-sm">
            <Server className="w-8 h-8 mx-auto mb-3 text-zinc-600" />
            Manybotが参加していて、あなたも参加しているサーバーが見つかりませんでした。
          </div>
        ) : (
          <div className="grid gap-3">
            {state.guilds.map((guild) => {
              const icon = guildIconUrl(guild);
              const open = choosing === guild.id;
              return (
                <div key={guild.id} className={`bg-zinc-900/80 border rounded-2xl transition-all ${open ? 'border-red-800/60' : 'border-zinc-800 hover:border-red-800/60'}`}>
                <button
                  onClick={() => selectGuild(guild.id)}
                  disabled={!!checking || entering}
                  className="group w-full flex items-center gap-4 hover:bg-zinc-900 rounded-2xl p-4 text-left transition-all"
                >
                  {icon ? (
                    <img src={icon} alt="" className="w-12 h-12 rounded-full ring-2 ring-zinc-800 flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-lg font-bold flex-shrink-0">
                      {guild.name.charAt(0)}
                    </div>
                  )}
                  <span className="flex-1 min-w-0 font-semibold truncate">{guild.name}</span>
                  {checking === guild.id ? (
                    <Loader2 className="w-4 h-4 text-zinc-500 animate-spin flex-shrink-0" />
                  ) : (
                    <ChevronRight className={`w-4 h-4 text-zinc-600 group-hover:text-red-400 transition-all flex-shrink-0 ${open ? 'rotate-90' : 'group-hover:translate-x-0.5'}`} />
                  )}
                </button>
                {open && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-4 pb-4">
                    <button
                      onClick={() => router.push(`/member/${guild.id}`)}
                      disabled={entering}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 transition-colors"
                    >
                      <User className="w-4 h-4" /> プロフィール
                    </button>
                    <button
                      onClick={() => enterDashboard(guild.id)}
                      disabled={entering}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 transition-colors"
                    >
                      {entering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />} 管理ダッシュボード
                    </button>
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Coins, Crown, Dices, History, Loader2, Search, Send, ShoppingBag, User, X } from 'lucide-react';
import Casino, { CasinoInfo } from './Casino';
import Shop, { ShopInfo } from './Shop';
import { guildIconUrl, isDiscordActivity, keepMemberSessionAlive, loadMemberState, memberFetch } from '@/lib/memberClient';

interface LevelStat { level: number; xp: number; next_xp: number }
interface Profile {
  guild: { id: string; name: string; icon: string | null };
  member: { id: string; display_name: string; avatar_url: string; joined_at: string | null };
  currency_name: string;
  allow_bot_transfer: boolean;
  stats: { balance: number; event_points: number; tc: LevelStat; vc: LevelStat };
  roles: MemberRole[];
  role_settings?: { new: RoleTag[]; sub: RoleTag[]; main: RoleTag[] };
}
type RoleKind = 'new' | 'sub' | 'main' | 'downgrade' | 'violator';
interface MemberRole {
  id: string;
  name: string;
  color: string | null;
  /** 付与日（分からないときは null） */
  granted_at: string | null;
  kind: RoleKind | null;
  /** ショップで購入して付いたロールなら、その商品名 */
  shop_item: string | null;
}

/** YY/MM/DD（日本時間） */
const fmtShortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: '2-digit', month: '2-digit', day: '2-digit' });

interface RoleTag { id: string; name: string; color: string | null }
type RoleSettings = { new: RoleTag[]; sub: RoleTag[]; main: RoleTag[] };

/** Discord のロールメンションのような「@ロール名」 */
function RoleMention({ role }: { role: RoleTag }) {
  const color = role.color ?? '#a1a1aa';
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 mx-0.5 font-semibold whitespace-nowrap align-baseline"
      style={{ color, backgroundColor: `${color}26` }}
    >
      @{role.name}
    </span>
  );
}

/** 「@研修生」。基本・評価設定で未設定なら「未設定」 */
function RoleGroup({ tags }: { tags: RoleTag[] }) {
  if (!tags.length) return <span>未設定</span>;
  return (
    <span>
      {tags.map((t) => (
        <RoleMention key={t.id} role={t} />
      ))}
    </span>
  );
}

/**
 * 持っているロールを1枚ずつ枠で出す。
 * 準メン・本メン＝黄色（お祝い）／評価落ち＝赤（励まし）／違反者＝赤（反省）／
 * ショップで購入＝オレンジ／それ以外＝青
 */
function RoleCard({ role: r, settings }: { role: MemberRole; settings: RoleSettings }) {
  const date = r.granted_at ? fmtShortDate(r.granted_at) : '付与日不明';
  const me = <RoleMention role={r} />;
  const frame = (border: string, bg: string, sub: React.ReactNode, subColor: string, title: React.ReactNode, titleColor: string, body?: React.ReactNode) => (
    <div className={`border-2 ${border} ${bg} rounded-2xl p-4`}>
      <div className={`text-xs ${subColor} flex flex-wrap items-center gap-x-2 gap-y-1`}>
        <span>{date}</span>
        {sub}
      </div>
      <div className={`font-bold mt-1.5 leading-relaxed ${titleColor}`}>{title}</div>
      {body && <p className="text-sm mt-1.5 leading-relaxed opacity-90">{body}</p>}
    </div>
  );

  if (r.kind === 'main' || r.kind === 'sub') {
    const main = r.kind === 'main';
    return frame(
      'border-amber-400/90', 'bg-amber-950/30 text-amber-100',
      <span>
        <RoleGroup tags={main ? settings.sub : settings.new} />
        {' → '}
        <RoleGroup tags={[r]} />
      </span>,
      'text-amber-300/90',
      <>🍾 {me} に昇格！おめでとう🍾‼️</>, 'text-amber-200',
      main ? (
        <>ついに {me} の仲間入りです🎉 これまでの頑張りが実を結びました。これからもよろしくお願いします！</>
      ) : (
        <>
          {settings.new.length ? <><RoleGroup tags={settings.new} /> からの</> : ''}昇格、本当におめでとうございます🎉
          {settings.main.length ? <> この調子で <RoleGroup tags={settings.main} /> を目指していきましょう！</> : ' この調子で頑張っていきましょう！'}
        </>
      )
    );
  }
  if (r.kind === 'downgrade') {
    return frame(
      'border-red-600/80', 'bg-red-950/30 text-red-100', null, 'text-red-300/80',
      <>{me} のロールが付与されました…</>, 'text-red-200',
      <>でも、ここで終わりじゃありません。次がある！💪<br />今回の経験は必ず次につながります。焦らず、またここから一緒に頑張っていきましょう！</>
    );
  }
  if (r.kind === 'violator') {
    return frame(
      'border-red-600/80', 'bg-red-950/30 text-red-100', null, 'text-red-300/80',
      <>{me} のロールが付与されました</>, 'text-red-200',
      <>ルール違反があったため、このロールが付与されています。ちゃんと反省してね🙏<br />サーバーのルールをもう一度確認して、次から気をつけましょう。</>
    );
  }
  if (r.shop_item) {
    return frame(
      'border-orange-500/80', 'bg-orange-950/30 text-orange-100', null, 'text-orange-300/80',
      <>🛒 ショップで「{r.shop_item}」を購入したため {me} のロールを付与しました！</>, 'text-orange-200'
    );
  }
  return frame('border-sky-500/70', 'bg-sky-950/30 text-sky-100', null, 'text-sky-300/80', <>{me} のロールが付与されました！</>, 'text-sky-200');
}

interface TransferRecord {
  id: string;
  direction: 'sent' | 'received';
  counterpart: { id: string; display_name: string };
  amount: number;
  source: string;
  created_at: string;
}
interface Candidate { id: string; display_name: string; username: string; avatar_url: string; is_bot: boolean }

const BotBadge = () => (
  <span className="text-[10px] font-bold bg-[#5865F2] text-white rounded px-1.5 py-0.5 flex-shrink-0">BOT</span>
);

type Tab = 'profile' | 'transfer' | 'casino' | 'shop' | 'roles';
const TABS: { key: Tab; label: string; icon: typeof User }[] = [
  { key: 'profile', label: 'プロフィール', icon: User },
  { key: 'transfer', label: '送金', icon: Send },
  { key: 'casino', label: 'カジノ', icon: Dices },
  { key: 'shop', label: 'ショップ', icon: ShoppingBag },
  { key: 'roles', label: '役職', icon: Crown },
];

const fmt = (n: number) => n.toLocaleString('ja-JP');

function LevelBar({ label, stat }: { label: string; stat: LevelStat }) {
  const pct = Math.min(100, Math.max(0, (stat.xp / stat.next_xp) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm text-zinc-400">{label}</span>
        <span className="font-bold">Lv.{stat.level}</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-red-600 to-rose-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-zinc-500 mt-1 text-right">
        {fmt(stat.xp)} / {fmt(stat.next_xp)} XP
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { pay: '/pay', activity: 'アクティビティ', web: 'Web' };

/** 自分が関わった送金の直近20件。reloadKey が変わるたび（送金した直後など）に取り直す */
function TransferHistory({ guildId, currency, reloadKey }: { guildId: string; currency: string; reloadKey: number }) {
  const [items, setItems] = useState<TransferRecord[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await memberFetch(`/api/member/guilds/${guildId}/transfers`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(data.error || '送金履歴を取得できませんでした');
        else {
          setError('');
          setItems(data.transfers ?? []);
        }
      } catch {
        if (!cancelled) setError('サーバーに接続できませんでした');
      }
    })();
    return () => { cancelled = true; };
  }, [guildId, reloadKey]);

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm text-zinc-400 mb-3">
        <History className="w-4 h-4" /> 直近の送金（20件）
      </div>
      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : items === null ? (
        <div className="py-4 flex justify-center text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500">まだ送金の記録はありません</p>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {items.map((t) => {
            const sent = t.direction === 'sent';
            return (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    sent ? 'bg-red-950/60 text-red-400' : 'bg-emerald-950/60 text-emerald-400'
                  }`}
                >
                  {sent ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">
                    <span className="font-semibold">{t.counterpart.display_name}</span>
                    <span className="text-zinc-500">{sent ? ' へ送金' : ' から受け取り'}</span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {new Date(t.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {' ・ '}
                    {SOURCE_LABEL[t.source] ?? t.source}
                  </div>
                </div>
                <div className={`text-sm font-bold whitespace-nowrap ${sent ? 'text-red-400' : 'text-emerald-400'}`}>
                  {sent ? '−' : '+'}{fmt(t.amount)} <span className="text-xs font-normal text-zinc-500">{currency}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TransferPanel({
  guildId,
  profile,
  onBalanceChange,
}: {
  guildId: string;
  profile: Profile;
  onBalanceChange: (balance: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [recipient, setRecipient] = useState<Candidate | null>(null);
  const [amountText, setAmountText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const currency = profile.currency_name;
  const amount = Number(amountText);
  const amountValid = Number.isInteger(amount) && amount >= 1 && amount <= profile.stats.balance;

  useEffect(() => {
    const q = query.trim();
    if (!q || recipient) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await memberFetch(`/api/member/guilds/${guildId}/members?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setResults(res.ok ? data.members ?? [] : []);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, recipient, guildId]);

  const send = async () => {
    if (!recipient || !amountValid) return;
    setSending(true);
    try {
      const res = await memberFetch(`/api/member/guilds/${guildId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient.id, amount, via: isDiscordActivity() ? 'activity' : 'web' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        toast.error(data.error || '送金に失敗しました');
        return;
      }
      toast.success(`${data.to.display_name} に ${fmt(data.amount)} ${data.currency_name} を送金しました`);
      onBalanceChange(data.balance);
      setHistoryKey((k) => k + 1);
      setRecipient(null);
      setAmountText('');
      setQuery('');
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5">
        <div className="text-sm text-zinc-500">送金できる残高</div>
        <div className="text-3xl font-bold mt-1">
          {fmt(profile.stats.balance)} <span className="text-base font-normal text-zinc-400">{currency}</span>
        </div>
      </div>

      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div>
          <label className="block text-sm text-zinc-400 mb-2">送金先</label>
          {recipient ? (
            <div className="flex items-center gap-3 bg-zinc-800/60 border border-zinc-700 rounded-xl p-3">
              <img src={recipient.avatar_url} alt="" className="w-9 h-9 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate flex items-center gap-2">
                  <span className="truncate">{recipient.display_name}</span>
                  {recipient.is_bot && <BotBadge />}
                </div>
                <div className="text-xs text-zinc-500 truncate">@{recipient.username}</div>
              </div>
              <button
                onClick={() => { setRecipient(null); setConfirming(false); }}
                className="text-zinc-500 hover:text-white p-1"
                aria-label="送金先を変更"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ユーザー名で検索"
                className="w-full pl-9 pr-3 py-3 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />
              {(searching || results.length > 0 || query.trim()) && (
                <div className="mt-2 bg-zinc-800/60 border border-zinc-700/60 rounded-xl overflow-hidden">
                  {searching ? (
                    <div className="p-3 text-sm text-zinc-500 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> 検索中...
                    </div>
                  ) : results.length === 0 ? (
                    <div className="p-3 text-sm text-zinc-500">該当するメンバーがいません</div>
                  ) : (
                    results.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setRecipient(c)}
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-zinc-700/50 transition-colors"
                      >
                        <img src={c.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                        <span className="font-medium truncate">{c.display_name}</span>
                        {c.is_bot && <BotBadge />}
                        <span className="text-xs text-zinc-500 truncate">@{c.username}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          {!profile.allow_bot_transfer && (
            <p className="text-xs text-zinc-500 mt-2">このサーバーではBotへの送金はできません。</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-2">金額</label>
          <div className="flex items-center gap-2">
            <input
              value={amountText}
              onChange={(e) => { setAmountText(e.target.value.replace(/[^\d]/g, '')); setConfirming(false); }}
              inputMode="numeric"
              placeholder="0"
              className="flex-1 px-3 py-3 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
            <span className="text-zinc-400 text-sm">{currency}</span>
          </div>
          {amountText && !amountValid && (
            <p className="text-xs text-red-400 mt-1.5">
              1〜{fmt(profile.stats.balance)} の整数で入力してください
            </p>
          )}
        </div>

        {confirming && recipient ? (
          <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4 space-y-3">
            <p className="text-sm">
              <b>{recipient.display_name}</b> に <b>{fmt(amount)} {currency}</b> を送金します。よろしいですか？
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={sending}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm font-semibold"
              >
                キャンセル
              </button>
              <button
                onClick={send}
                disabled={sending}
                className="flex-1 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-60 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
              >
                {sending && <Loader2 className="w-4 h-4 animate-spin" />}
                送金する
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={!recipient || !amountValid}
            className="w-full py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed rounded-xl font-semibold flex items-center justify-center gap-2 transition-all"
          >
            <Send className="w-4 h-4" /> 確認へ進む
          </button>
        )}
      </div>

      <TransferHistory guildId={guildId} currency={currency} reloadKey={historyKey} />
    </div>
  );
}

export default function MemberGuildPage() {
  const router = useRouter();
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const [tab, setTab] = useState<Tab>('profile');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  // Webアクティビティ設定でONのゲームが1つも無ければ「カジノ」タブは出さない
  const [casino, setCasino] = useState<CasinoInfo | null>(null);
  // Webアクティビティ設定でショップがOFFなら「ショップ」タブは出さない
  const [shop, setShop] = useState<ShopInfo | null>(null);

  // サーバーを切り替えたときに前のサーバーの表示が残らないよう、guildId ごとに取り直す
  useEffect(() => {
    if (!loadMemberState()) {
      router.replace(`/login${window.location.search}`);
      return;
    }
    keepMemberSessionAlive();
    let cancelled = false;
    setProfile(null);
    setCasino(null);
    setShop(null);
    setError('');
    (async () => {
      try {
        const res = await memberFetch(`/api/member/guilds/${guildId}/shop`);
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data?.enabled) setShop(data);
      } catch {}
    })();
    setTab('profile');
    (async () => {
      try {
        const res = await memberFetch(`/api/member/guilds/${guildId}/casino`);
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data?.games?.length) setCasino(data);
      } catch {}
    })();
    (async () => {
      try {
        const res = await memberFetch(`/api/member/guilds/${guildId}/profile`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(data.error || 'プロフィールを取得できませんでした');
        else setProfile(data);
      } catch {
        if (!cancelled) setError('サーバーに接続できませんでした');
      }
    })();
    return () => { cancelled = true; };
  }, [guildId, router]);

  // ブラウザの保存データはサーバーの描画では読めないので、表示後に読む（描画中に読むと表示が食い違う）
  const [cachedGuild, setCachedGuild] = useState<{ id: string; name: string; icon: string | null } | undefined>();
  useEffect(() => {
    setCachedGuild(loadMemberState()?.guilds.find((g) => g.id === guildId));
  }, [guildId]);
  const guildName = profile?.guild.name ?? cachedGuild?.name ?? '';
  const icon = profile ? guildIconUrl(profile.guild) : cachedGuild ? guildIconUrl(cachedGuild) : null;

  const visibleTabs = TABS.filter((t) => (t.key !== 'casino' || casino) && (t.key !== 'shop' || shop));

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => router.push('/member')}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white mb-5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> 別のサーバーを選ぶ
        </button>

        <header className="flex items-center gap-3 mb-6">
          {icon ? (
            <img src={icon} alt="" className="w-12 h-12 rounded-full ring-2 ring-zinc-800" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center font-bold">
              {guildName.charAt(0)}
            </div>
          )}
          <h1 className="text-xl font-bold truncate">{guildName || '読み込み中...'}</h1>
        </header>

        <nav
          className="grid gap-2 mb-6"
          style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
        >
          {visibleTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-sm font-semibold border transition-all whitespace-nowrap ${
                tab === key
                  ? 'bg-red-600/20 border-red-700/60 text-white'
                  : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </nav>

        {error ? (
          <div className="bg-red-950/50 border border-red-900/60 text-red-200 rounded-2xl p-5 text-sm">{error}</div>
        ) : !profile ? (
          <div className="py-16 flex justify-center text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : tab === 'profile' ? (
          <div className="space-y-4">
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 flex items-center gap-4">
              <img src={profile.member.avatar_url} alt="" className="w-16 h-16 rounded-full ring-2 ring-zinc-800" />
              <div className="min-w-0">
                <div className="text-lg font-bold truncate">{profile.member.display_name}</div>
                {profile.member.joined_at && (
                  <div className="text-xs text-zinc-500">
                    参加日 {new Date(profile.member.joined_at).toLocaleDateString('ja-JP')}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Coins className="w-4 h-4" /> 所持金
              </div>
              <div className="text-3xl font-bold mt-1">
                {fmt(profile.stats.balance)} <span className="text-base font-normal text-zinc-400">{profile.currency_name}</span>
              </div>
              {profile.stats.event_points > 0 && (
                <div className="text-sm text-zinc-500 mt-2">イベントポイント: {fmt(profile.stats.event_points)}</div>
              )}
            </div>

            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-5">
              <LevelBar label="テキストレベル" stat={profile.stats.tc} />
              <LevelBar label="ボイスレベル" stat={profile.stats.vc} />
            </div>
          </div>
        ) : tab === 'transfer' ? (
          <TransferPanel
            guildId={guildId}
            profile={profile}
            onBalanceChange={(balance) => {
              setProfile((p) => (p ? { ...p, stats: { ...p.stats, balance } } : p));
              setCasino((c) => (c ? { ...c, status: { ...c.status, balance } } : c));
            }}
          />
        ) : tab === 'shop' && shop ? (
          <Shop
            guildId={guildId}
            info={shop}
            balance={profile.stats.balance}
            onBought={(balance, evaluationPeriod) => {
              setProfile((p) => (p ? { ...p, stats: { ...p.stats, balance } } : p));
              setCasino((c) => (c ? { ...c, status: { ...c.status, balance } } : c));
              // 延長したら表示中の終了予定日も更新する（仮メン以外には元々表示していない）
              if (evaluationPeriod) setShop((sh) => (sh?.evaluation_period ? { ...sh, evaluation_period: evaluationPeriod } : sh));
            }}
          />
        ) : tab === 'casino' && casino ? (
          <Casino
            key={guildId}
            guildId={guildId}
            info={casino}
            onPlayed={({ balance, plays_today, bet_delta }) => {
              setCasino((c) =>
                c
                  ? {
                      ...c,
                      status: {
                        balance,
                        plays_today: plays_today ?? c.status.plays_today,
                        bet_today: c.status.bet_today + (bet_delta ?? 0),
                      },
                    }
                  : c
              );
              setProfile((p) => (p ? { ...p, stats: { ...p.stats, balance } } : p));
            }}
          />
        ) : (
          <div className="space-y-3">
            {/* 今持っている役職（前と同じ一覧） */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5">
              <div className="text-sm text-zinc-500 mb-3">このサーバーでの役職（{profile.roles.length}）</div>
              {profile.roles.length === 0 ? (
                <p className="text-sm text-zinc-500">役職はありません</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {profile.roles.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-2 bg-zinc-800/70 border border-zinc-700/60 rounded-full px-3 py-1.5 text-sm"
                    >
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color ?? '#71717a' }} />
                      {r.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* その下に、付与日つきのメッセージ（新しく付いた順、付与日不明は最後） */}
            {profile.roles.length > 0 && (
              <>
                <div className="text-sm text-zinc-500 pt-2">付与された日</div>
                {[...profile.roles]
                  .sort((a, b) => (b.granted_at ?? '').localeCompare(a.granted_at ?? ''))
                  .map((r) => (
                    <RoleCard key={r.id} role={r} settings={profile.role_settings ?? { new: [], sub: [], main: [] }} />
                  ))}
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

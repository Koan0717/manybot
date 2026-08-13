import type { LucideIcon } from 'lucide-react';
import HealthBadge from './HealthBadge';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** Short uppercase system readout shown above the title, e.g. "System // Module Configuration" */
  eyebrow?: string;
  /** Accent color tone, matches the mecha HUD palette used across the dashboard */
  tone?: 'red' | 'cyan' | 'amber';
  /** 指定すると、リアルタイム動作確認バッジ(HealthBadge)をタイトル横に表示する */
  guildId?: string;
  /** /api/guilds/[guild_id]/health のレスポンスキー (例: 'vc-triggers') */
  healthKey?: string;
}

const TONE_STYLES = {
  red: {
    eyebrow: 'text-red-500/80',
    led: 'bg-red-500 text-red-500',
    iconBg: 'bg-red-600/15',
    iconBorder: 'border-red-700/50',
    iconText: 'text-red-400',
  },
  cyan: {
    eyebrow: 'text-cyan-300/80',
    led: 'bg-cyan-400 text-cyan-400',
    iconBg: 'bg-cyan-600/15',
    iconBorder: 'border-cyan-700/50',
    iconText: 'text-cyan-300',
  },
  amber: {
    eyebrow: 'text-amber-300/80',
    led: 'bg-amber-400 text-amber-400',
    iconBg: 'bg-amber-600/15',
    iconBorder: 'border-amber-700/50',
    iconText: 'text-amber-300',
  },
} as const;

/**
 * Shared "mechanical HUD" style page header used across the dashboard.
 * Mirrors the visual language established on the database settings screen:
 * a small system-readout eyebrow line with a pulsing LED, followed by a
 * chamfered icon chip and an Orbitron-styled title.
 */
export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  eyebrow = 'System // Module Configuration',
  tone = 'red',
  guildId,
  healthKey,
}: PageHeaderProps) {
  const t = TONE_STYLES[tone];
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-2">
        <span className={`mecha-led w-2 h-2 rounded-full flex-shrink-0 ${t.led}`}></span>
        <span className={`font-tech text-[11px] tracking-[0.25em] uppercase ${t.eyebrow}`}>
          {eyebrow}
        </span>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <div
          className={`w-11 h-11 mecha-clip-sm ${t.iconBg} border ${t.iconBorder} flex items-center justify-center flex-shrink-0`}
        >
          <Icon className={`w-5 h-5 ${t.iconText}`} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h1 className="font-mecha text-2xl md:text-3xl font-black text-white tracking-tight truncate">{title}</h1>
          {subtitle && <p className="font-tech text-xs text-zinc-500 mt-1">{subtitle}</p>}
        </div>
        {guildId && healthKey && (
          <div className="ml-auto">
            <HealthBadge guildId={guildId} featureKey={healthKey} />
          </div>
        )}
      </div>
    </div>
  );
}

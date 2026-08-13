'use client';

import { useState } from 'react';
import {
  X,
  Bot,
  Key,
  GitBranch,
  Webhook,
  Database,
  Loader2,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';

interface AddBotModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface RegisteredBot {
  bot_id: string;
  bot_name: string;
  github_repo: string | null;
  webhook_secret: string;
}

export default function AddBotModal({ isOpen, onClose, onSuccess }: AddBotModalProps) {
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    bot_name: '',
    token: '',
    github_repo: '',
    render_deploy_hook_url: '',
    database_url: '',
  });

  const [registeredBot, setRegisteredBot] = useState<RegisteredBot | null>(null);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.bot_name.trim() || !formData.token.trim()) {
      setError('Bot名とトークンは必須です');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_name: formData.bot_name.trim(),
          token: formData.token.trim(),
          github_repo: formData.github_repo.trim() || undefined,
          render_deploy_hook_url: formData.render_deploy_hook_url.trim() || undefined,
          database_url: formData.database_url.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '登録に失敗しました');
        return;
      }
      setRegisteredBot(data);
      setStep('success');
      onSuccess();
    } catch (e: any) {
      setError(e.message || '通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {}
  };

  const handleClose = () => {
    setStep('form');
    setError('');
    setFormData({ bot_name: '', token: '', github_repo: '', render_deploy_hook_url: '', database_url: '' });
    setRegisteredBot(null);
    onClose();
  };

  const webhookUrl = registeredBot
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/github/${registeredBot.bot_id}`
    : '';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg mecha-clip bg-neutral-900 border border-zinc-700 shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center border border-violet-500/30">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-tech text-[10px] text-violet-400 tracking-widest uppercase">
                Bot Registry // Add New
              </div>
              <h2 className="font-mecha text-base font-bold text-white">別のBotを追加</h2>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'form' ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Bot名 */}
            <div>
              <label className="font-tech text-xs text-zinc-400 flex items-center gap-1.5 mb-1.5">
                <Bot className="w-3.5 h-3.5" /> Bot名 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.bot_name}
                onChange={(e) => handleChange('bot_name', e.target.value)}
                placeholder="例: 多様化Bot (サブ)"
                className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 font-tech transition-colors"
                required
              />
            </div>

            {/* Botトークン */}
            <div>
              <label className="font-tech text-xs text-zinc-400 flex items-center gap-1.5 mb-1.5">
                <Key className="w-3.5 h-3.5" /> Botトークン <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                value={formData.token}
                onChange={(e) => handleChange('token', e.target.value)}
                placeholder="Discord Developer Portal のトークン"
                className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 font-tech transition-colors"
                required
              />
              <p className="font-tech text-[11px] text-zinc-600 mt-1">
                トークンはAES-256で暗号化されDBに保存されます（実際にはDBカラムで保護）
              </p>
            </div>

            {/* GitHubリポジトリ */}
            <div>
              <label className="font-tech text-xs text-zinc-400 flex items-center gap-1.5 mb-1.5">
                <GitBranch className="w-3.5 h-3.5" /> GitHubリポジトリ
                <span className="text-zinc-600 text-[10px]">(任意)</span>
              </label>
              <input
                type="text"
                value={formData.github_repo}
                onChange={(e) => handleChange('github_repo', e.target.value)}
                placeholder="例: username/repo-name"
                className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 font-tech transition-colors"
              />
            </div>

            {/* Render Deploy Hook */}
            <div>
              <label className="font-tech text-xs text-zinc-400 flex items-center gap-1.5 mb-1.5">
                <Webhook className="w-3.5 h-3.5" /> Render Deploy Hook URL
                <span className="text-zinc-600 text-[10px]">(任意)</span>
              </label>
              <input
                type="url"
                value={formData.render_deploy_hook_url}
                onChange={(e) => handleChange('render_deploy_hook_url', e.target.value)}
                placeholder="https://api.render.com/deploy/srv-..."
                className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 font-tech transition-colors"
              />
              <p className="font-tech text-[11px] text-zinc-600 mt-1">
                設定するとGitHub pushイベント受信時に自動でデプロイがトリガーされます
              </p>
            </div>

            {/* 専用DB URL */}
            <div>
              <label className="font-tech text-xs text-zinc-400 flex items-center gap-1.5 mb-1.5">
                <Database className="w-3.5 h-3.5" /> 専用DB URL
                <span className="text-zinc-600 text-[10px]">(任意)</span>
              </label>
              <input
                type="url"
                value={formData.database_url}
                onChange={(e) => handleChange('database_url', e.target.value)}
                placeholder="postgresql://..."
                className="w-full bg-black/40 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 font-tech transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300 font-tech">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 font-tech text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-4 py-2.5 rounded-lg border border-zinc-700 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 font-mecha font-bold text-sm bg-gradient-to-r from-violet-600 to-violet-800 hover:from-violet-500 hover:to-violet-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg border border-violet-500/30 transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> 登録中...
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4" /> Botを登録
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* 登録成功画面 */
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3 text-green-400">
              <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
              <div>
                <div className="font-mecha font-bold text-white">「{registeredBot?.bot_name}」を登録しました！</div>
                <div className="font-tech text-xs text-zinc-400 mt-0.5">
                  Bot ID: <span className="text-zinc-200 font-mono">{registeredBot?.bot_id}</span>
                </div>
              </div>
            </div>

            {registeredBot?.github_repo && (
              <div className="bg-black/40 border border-zinc-800 rounded-lg p-4 space-y-3">
                <h3 className="font-mecha text-sm font-bold text-white flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-violet-400" />
                  GitHub Webhook の設定
                </h3>
                <p className="font-tech text-xs text-zinc-400">
                  GitHubリポジトリの Settings → Webhooks に以下を登録してください。
                </p>

                <div>
                  <div className="font-tech text-[10px] text-zinc-500 mb-1.5">Payload URL</div>
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                    <span className="font-mono text-xs text-cyan-300 truncate flex-1">{webhookUrl}</span>
                    <button
                      onClick={() => copyToClipboard(webhookUrl, 'url')}
                      className="flex-shrink-0 text-zinc-500 hover:text-white transition-colors"
                      title="コピー"
                    >
                      {copiedField === 'url' ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="font-tech text-[10px] text-zinc-500 mb-1.5">Secret</div>
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                    <span className="font-mono text-xs text-amber-300 truncate flex-1">
                      {registeredBot?.webhook_secret}
                    </span>
                    <button
                      onClick={() => copyToClipboard(registeredBot?.webhook_secret || '', 'secret')}
                      className="flex-shrink-0 text-zinc-500 hover:text-white transition-colors"
                      title="コピー"
                    >
                      {copiedField === 'secret' ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-tech text-zinc-400">
                  <span>Content type: <code className="text-zinc-200">application/json</code></span>
                  <span>・</span>
                  <span>Events: <code className="text-zinc-200">Just the push event</code></span>
                </div>

                <a
                  href={`https://github.com/${registeredBot?.github_repo}/settings/hooks/new`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-tech text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  GitHubのWebhook設定ページを開く
                </a>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleClose}
                className="flex-1 font-mecha font-bold text-sm bg-gradient-to-r from-violet-600 to-violet-800 hover:from-violet-500 hover:to-violet-700 text-white px-4 py-2.5 rounded-lg border border-violet-500/30 transition-all"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';
import ChannelSelect from '@/components/ChannelSelect';
import RoleSelect from '@/components/RoleSelect';

interface NgRule {
  id?: number;
  name: string;
  keywords: string[];
  target_category_ids: string[];
  target_channel_ids: string[];
  exempt_role_ids: string[];
  enabled: boolean;
}

const emptyForm = {
  name: '',
  keywordsText: '',
  target_category_ids: [] as string[],
  target_channel_ids: [] as string[],
  exempt_role_ids: [] as string[],
  enabled: true,
};

function parseKeywords(text: string): string[] {
  return Array.from(new Set(text.split('\n').map(k => k.trim()).filter(k => k.length > 0)));
}

export default function NgWordRules({ guildId, channels, roles }: { guildId: string; channels: any[]; roles: any[] }) {
  const [rules, setRules] = useState<NgRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<NgRule | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/antigrief/ng-rules`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setRules(data);
        else setError(data?.error || 'NGワードルールの取得に失敗しました');
      })
      .catch(() => setError('NGワードルールの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [guildId]);

  const textChannels = channels.filter(c => c.type === 0 || c.type === 2 || c.type === 5 || c.type === 15); // Text, Voice, Announcement, Forum
  const categories = channels.filter(c => c.type === 4);
  const assignableRoles = roles.filter(r => r.id !== guildId);

  const post = async (body: any) => {
    const res = await fetch(`/api/guilds/${guildId}/antigrief/ng-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || '不明なエラー');
    return data;
  };

  const openModal = (rule: NgRule | null = null) => {
    setEditingRule(rule);
    setFormData(rule ? {
      name: rule.name,
      keywordsText: rule.keywords.join('\n'),
      target_category_ids: rule.target_category_ids,
      target_channel_ids: rule.target_channel_ids,
      exempt_role_ids: rule.exempt_role_ids,
      enabled: rule.enabled,
    } : { ...emptyForm, name: `NGワードルール${rules.length + 1}` });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRule(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = parseKeywords(formData.keywordsText);
    if (!formData.name.trim()) {
      toast.error('ルール名を入力してください');
      return;
    }
    if (keywords.length === 0) {
      toast.error('NGキーワードを1つ以上入力してください');
      return;
    }
    setSaving(true);
    try {
      const data = await post({
        action: 'save',
        rule: {
          id: editingRule?.id,
          name: formData.name.trim(),
          keywords,
          target_category_ids: formData.target_category_ids,
          target_channel_ids: formData.target_channel_ids,
          exempt_role_ids: formData.exempt_role_ids,
          enabled: formData.enabled,
        },
      });
      setRules(prev => editingRule
        ? prev.map(r => r.id === data.rule.id ? data.rule : r)
        : [...prev, data.rule]);
      toast.success('NGワードルールを保存しました');
      closeModal();
    } catch (err: any) {
      toast.error(`保存に失敗しました: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule: NgRule) => {
    if (!confirm(`NGワードルール「${rule.name}」を削除しますか？`)) return;
    try {
      await post({ action: 'delete', id: rule.id });
      setRules(prev => prev.filter(r => r.id !== rule.id));
      toast.success('削除しました');
    } catch (err: any) {
      toast.error(`削除に失敗しました: ${err.message}`);
    }
  };

  const handleToggle = async (rule: NgRule) => {
    try {
      const data = await post({ action: 'toggle', id: rule.id, enabled: !rule.enabled });
      setRules(prev => prev.map(r => r.id === rule.id ? data.rule : r));
    } catch (err: any) {
      toast.error(`切り替えに失敗しました: ${err.message}`);
    }
  };

  const nameOf = (list: any[], id: string) => list.find(x => x.id === id)?.name || id;

  return (
    <div className="mecha-clip mecha-grid-bg bg-neutral-900/80 border border-zinc-800/80 p-6 shadow-xl">
      <div className="flex justify-between items-center gap-4 flex-wrap mb-4 border-b border-zinc-700 pb-2">
        <h2 className="text-xl font-bold text-white">NGワードルール</h2>
        <button
          type="button"
          onClick={() => openModal()}
          className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-4 py-2 rounded-lg font-bold shadow-lg shadow-red-900/20 transition-all hover:-translate-y-0.5"
        >
          ＋ ルールを新規作成
        </button>
      </div>
      <p className="text-sm text-zinc-400 mb-6">
        キーワードを含む発言を削除し、<strong>1時間タイムアウト</strong>します（全角/半角・大文字/小文字は区別しません）。
        ルールごとに監視対象と免除ロールを設定でき、上のスパム検知の設定とは別に判定されます。
        ルールは作成・編集した時点で保存されます。
      </p>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-center py-8">読み込み中...</p>
      ) : rules.length === 0 ? (
        <p className="text-zinc-500 text-center py-8">設定されているNGワードルールはありません。</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rules.map(rule => (
            <div
              key={rule.id}
              className={`bg-zinc-900 border rounded-lg p-5 transition-colors ${rule.enabled ? 'border-zinc-700 hover:border-zinc-500' : 'border-zinc-800 opacity-60'}`}
            >
              <div className="flex justify-between items-start gap-2 mb-3">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <h3 className="text-lg font-bold text-white break-all">{rule.name}</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded border font-bold ${rule.enabled ? 'bg-green-900/40 text-green-300 border-green-800' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                    {rule.enabled ? '有効' : '無効'}
                  </span>
                </div>
                <div className="space-x-2 flex-shrink-0">
                  <button type="button" onClick={() => handleToggle(rule)} className="text-zinc-300 hover:text-white text-sm">
                    {rule.enabled ? '無効化' : '有効化'}
                  </button>
                  <button type="button" onClick={() => openModal(rule)} className="text-blue-400 hover:text-blue-300 text-sm">編集</button>
                  <button type="button" onClick={() => handleDelete(rule)} className="text-red-500 hover:text-red-400 text-sm">削除</button>
                </div>
              </div>

              <div className="bg-zinc-800 p-3 rounded mb-3 border border-zinc-700/50">
                <p className="text-xs text-zinc-400 mb-2">NGキーワード（{rule.keywords.length}件）</p>
                <div className="flex flex-wrap gap-1.5">
                  {rule.keywords.slice(0, 20).map(k => (
                    <span key={k} className="text-xs px-2 py-0.5 rounded bg-red-900/40 text-red-200 border border-red-800/60 break-all">{k}</span>
                  ))}
                  {rule.keywords.length > 20 && (
                    <span className="text-xs text-zinc-500">他 {rule.keywords.length - 20} 件</span>
                  )}
                </div>
              </div>

              <div className="text-xs text-zinc-500 space-y-1">
                <p>
                  監視対象:{' '}
                  {rule.target_category_ids.length === 0 && rule.target_channel_ids.length === 0 ? (
                    <span className="text-zinc-300">すべてのチャンネル</span>
                  ) : (
                    <span className="text-zinc-300">
                      {[
                        ...rule.target_category_ids.map(id => `📁${nameOf(categories, id)}`),
                        ...rule.target_channel_ids.map(id => `#${nameOf(textChannels, id)}`),
                      ].join('、')}
                    </span>
                  )}
                </p>
                <p>
                  免除ロール:{' '}
                  <span className="text-zinc-300">
                    {rule.exempt_role_ids.length === 0 ? 'なし' : rule.exempt_role_ids.map(id => `@${nameOf(assignableRoles, id)}`).join('、')}
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* モーダルは clip-path の枠に閉じ込められないよう body 直下に描画する */}
      {mounted && isModalOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleSubmit} className="p-6">
              <h2 className="text-2xl font-bold text-white mb-6 border-b border-zinc-800 pb-2 font-mecha">
                {editingRule ? 'NGワードルールを編集' : 'NGワードルールを新規作成'}
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">ルール名 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={formData.name}
                    maxLength={100}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500"
                    placeholder="例: 暴言対策"
                  />
                  <p className="text-xs text-zinc-500 mt-1">タイムアウトの理由やログに表示されます。</p>
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">
                    NGキーワード（1行に1つ） <span className="text-red-500">*</span>
                    <span className="ml-2 text-xs text-zinc-500">{parseKeywords(formData.keywordsText).length}件</span>
                  </label>
                  <textarea
                    value={formData.keywordsText}
                    onChange={e => setFormData({ ...formData, keywordsText: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-500 h-36"
                    placeholder={'例:\n荒らしワード1\n荒らしワード2'}
                  />
                </div>

                <div className="border border-zinc-700 rounded-lg p-4 space-y-4">
                  <div>
                    <p className="text-sm text-zinc-300 font-bold">監視対象</p>
                    <p className="text-xs text-zinc-500">カテゴリー・チャンネルとも未指定の場合は、すべてのチャンネルが対象になります。</p>
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">対象カテゴリー</label>
                    <ChannelSelect
                      label="対象カテゴリー"
                      placeholder="カテゴリーを選択..."
                      value={formData.target_category_ids}
                      onChange={(ids) => setFormData({ ...formData, target_category_ids: ids })}
                      channels={categories}
                      multiple={true}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">対象チャンネル</label>
                    <ChannelSelect
                      label="対象チャンネル"
                      placeholder="チャンネルを選択..."
                      value={formData.target_channel_ids}
                      onChange={(ids) => setFormData({ ...formData, target_channel_ids: ids })}
                      channels={textChannels}
                      multiple={true}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-1">免除ロール</label>
                  <RoleSelect
                    label="免除ロール"
                    placeholder="免除ロールを選択..."
                    value={formData.exempt_role_ids}
                    onChange={(ids) => setFormData({ ...formData, exempt_role_ids: ids })}
                    roles={assignableRoles}
                    multiple={true}
                  />
                  <p className="text-xs text-zinc-500 mt-1">このロールを持つユーザーは、このルールでは検知されません。</p>
                </div>

                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={e => setFormData({ ...formData, enabled: e.target.checked })}
                    className="accent-red-600"
                  />
                  このルールを有効にする
                </label>
              </div>

              <div className="mt-8 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="bg-zinc-700 hover:bg-zinc-600 text-white px-5 py-2 rounded font-bold transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="mecha-btn-sheen font-mecha bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-50 text-white px-6 py-2 rounded font-bold shadow-lg transition-colors"
                >
                  {saving ? '保存中...' : 'ルールを保存'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

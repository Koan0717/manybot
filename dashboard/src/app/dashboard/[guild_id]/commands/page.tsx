'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';

type CommandSetting = {
  command_name: string;
  description: string;
  category: string;
  is_enabled: boolean;
};

export default function CommandsPage({ params }: { params: { guild_id: string } }) {
  const [commands, setCommands] = useState<CommandSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCommands();
  }, [params.guild_id]);

  const fetchCommands = async () => {
    try {
      const res = await fetch(`/api/guilds/${params.guild_id}/commands`);
      if (!res.ok) throw new Error('コマンド一覧の取得に失敗しました');
      const data = await res.json();
      setCommands(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleCommand = async (commandName: string, currentEnabled: boolean) => {
    const newEnabled = !currentEnabled;
    
    // Optimistic update
    setCommands(prev => 
      prev.map(cmd => 
        cmd.command_name === commandName ? { ...cmd, is_enabled: newEnabled } : cmd
      )
    );

    try {
      const res = await fetch(`/api/guilds/${params.guild_id}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command_name: commandName, is_enabled: newEnabled })
      });
      if (!res.ok) throw new Error('更新失敗');
    } catch (err) {
      // Revert on error
      setCommands(prev => 
        prev.map(cmd => 
          cmd.command_name === commandName ? { ...cmd, is_enabled: currentEnabled } : cmd
        )
      );
      toast.error('設定の保存に失敗しました');
    }
  };

  if (loading) return <div className="text-white p-8">読み込み中...</div>;
  if (error) return <div className="text-red-500 p-8">{error}</div>;

  // Group commands by category
  const groupedCommands = commands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, CommandSetting[]>);

  // Translate category names nicely
  const categoryTranslations: Record<string, string> = {
    "AdminCog": "サーバー管理",
    "EconomyCog": "経済・お金",
    "LevelingCog": "レベル・経験値",
    "RoomsCog": "自動生成VC・部屋",
    "GamblingCog": "ギャンブル",
    "InterviewCog": "面接",
    "EvaluationCog": "評価・自己紹介",
    "UtilityCog": "ユーティリティ・イベント",
    "PointsCog": "ポイント",
    "DashboardLauncherCog": "ダッシュボード",
    "IPCCog": "システム",
    "LoggingCog": "ログ",
    "RankingCog": "ランキング",
    "ReactionRolesCog": "パネル・ロール",
    "ShopCog": "ショップ",
    "TicketsCog": "チケット",
    "General": "その他"
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      <div className="flex justify-between items-center bg-zinc-900/50 p-6 rounded-2xl border border-white/10 backdrop-blur-sm">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-emerald-400">
            コマンド設定
          </h1>
          <p className="text-zinc-400 mt-2">
            各サーバーごとのコマンドのON/OFFを切り替えます。OFFにされたコマンドは使用時にブロックされます。<br/>
            ※ 予測変換から完全に非表示にするには、Discord本体の「サーバー設定 ＞ 連携サービス」から設定してください。
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {Object.keys(groupedCommands).sort().map(category => (
          <motion.div 
            key={category}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-neutral-800 rounded-lg p-6 shadow-xl border border-neutral-700"
          >
            <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">
              {categoryTranslations[category] || category}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groupedCommands[category].map(cmd => (
                <div key={cmd.command_name} className="flex items-center justify-between bg-zinc-900 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
                  <div className="pr-4">
                    <div className="font-bold text-teal-400 text-lg mb-1">
                      /{cmd.command_name.replace(' ', ' ')}
                    </div>
                    <div className="text-xs text-zinc-400 leading-relaxed">
                      {cmd.description}
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => toggleCommand(cmd.command_name, cmd.is_enabled)}
                      className={`${
                        cmd.is_enabled ? 'bg-teal-500' : 'bg-gray-600'
                      } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none`}
                    >
                      <span
                        className={`${
                          cmd.is_enabled ? 'translate-x-6' : 'translate-x-1'
                        } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
        {commands.length === 0 && (
          <div className="text-zinc-400 text-center py-12">
            コマンドが見つかりません。Botを起動してデータを同期させてください。
          </div>
        )}
      </div>
    </div>
  );
}

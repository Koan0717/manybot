'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Gamepad2, Send } from 'lucide-react';
import Card from '@/components/doumori/Card';

interface Channel {
  id: string;
  name: string;
  type: number;
}

export default function PanelPage() {
  const { guild_id: guildId } = useParams<{ guild_id: string }>();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('🍃 どうぶつの森林 - 総合操作パネル');
  const [color, setColor] = useState('#2ECC71');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/guilds/${guildId}/doumori/settings`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setChannels((data.channels || []).filter((c: Channel) => c.type === 0 || c.type === 5));
        if (data.settings?.panel_title) setTitle(data.settings.panel_title);
        if (data.settings?.panel_color) setColor(data.settings.panel_color);
        if (data.settings?.panel_channel_id) setChannelId(data.settings.panel_channel_id);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSend = async () => {
    if (!channelId) {
      toast.error('送信先チャンネルを選択してください');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/doumori/panel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, panel_title: title, panel_color: color }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.error || '送信に失敗しました');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-20 space-y-6">
      <div>
        <h1 className="text-2xl font-black text-leaf-900 flex items-center gap-2">
          <Gamepad2 className="w-6 h-6 text-leaf-500" />
          総合操作パネル送信
        </h1>
        <p className="text-sm text-leaf-500 mt-1">採集・図鑑・マイル確認などが1つのパネルからワンタップで使えるボタン付きメッセージを送信します。</p>
      </div>

      <Card title="送信設定">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-leaf-600 block mb-1">送信先チャンネル</label>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              disabled={loading}
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">-- チャンネルを選択 --</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  # {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">パネルタイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-leaf-50 border border-leaf-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-leaf-600 block mb-1">テーマカラー</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-12 h-9 bg-transparent cursor-pointer border border-leaf-200 rounded"
            />
          </div>
        </div>
        <button
          onClick={handleSend}
          disabled={sending || loading}
          className="mt-5 w-full bg-leaf-600 hover:bg-leaf-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
        >
          <Send className="w-4 h-4" />
          {sending ? '送信中...' : 'チャンネルに送信する'}
        </button>
      </Card>
    </div>
  );
}

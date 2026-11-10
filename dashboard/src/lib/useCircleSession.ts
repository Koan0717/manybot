'use client';

import { useEffect, useState } from 'react';

export interface CircleSession {
  loaded: boolean;
  /** サークル用サーバーの一般メンバー（自分の報告書だけ編集・送信・削除できる） */
  isMember: boolean;
  /** Discordログインから入った人（戻る先はメンバー画面） */
  fromDiscord: boolean;
  discordId: string | null;
}

/** サークル用ダッシュボードを開いている人のセッション情報 */
export function useCircleSession(): CircleSession {
  const [s, setS] = useState<CircleSession>({ loaded: false, isMember: false, fromDiscord: false, discordId: null });
  useEffect(() => {
    fetch('/api/auth/check', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const u = d?.user || {};
        setS({
          loaded: true,
          isMember: u.role === 'circle',
          fromDiscord: !!u.discord_id,
          discordId: u.discord_id ? String(u.discord_id) : null,
        });
      })
      .catch(() => setS((prev) => ({ ...prev, loaded: true })));
  }, []);
  return s;
}

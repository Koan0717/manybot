import { NextResponse } from 'next/server';
import { masterPool } from '@/lib/db';

export async function GET() {
  // --- Supabase (DB) 接続確認 ---
  let supabase: { ok: boolean; latencyMs?: number; error?: string } = { ok: false };
  try {
    const start = Date.now();
    await masterPool.query('SELECT 1');
    supabase = { ok: true, latencyMs: Date.now() - start };
  } catch (e: any) {
    supabase = { ok: false, error: e?.message || String(e) };
  }

  // --- Render (Bot本体) 接続確認 ---
  // RENDER_BOT_HEALTH_URL (例: https://manybot.onrender.com) を設定すると、
  // Bot本体の keep_alive エンドポイント(Flask) に到達できるか確認する。
  let render: { ok: boolean; latencyMs?: number; error?: string; configured: boolean } = {
    ok: false,
    configured: false,
  };
  const healthUrl = process.env.RENDER_BOT_HEALTH_URL;
  if (healthUrl) {
    render.configured = true;
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(healthUrl, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeout);
      render.ok = res.ok;
      render.latencyMs = Date.now() - start;
      if (!res.ok) render.error = `HTTP ${res.status}`;
    } catch (e: any) {
      render.ok = false;
      render.error = e?.name === 'AbortError' ? 'タイムアウト' : (e?.message || String(e));
    }
  }

  // --- Bot招待用のアプリケーションID(client_id)を取得 ---
  // NEXT_PUBLIC_DISCORD_CLIENT_ID を別途設定する必要が無いよう、
  // 既に設定済みの DISCORD_BOT_TOKEN から Discord API 経由で取得する。
  let clientId: string | null = null;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (botToken) {
    try {
      const res = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
        headers: { Authorization: `Bot ${botToken}` },
        next: { revalidate: 3600 },
      });
      if (res.ok) {
        const app = await res.json();
        clientId = app.id;
      }
    } catch {
      // 取得失敗時は null のまま(フロント側でエラー表示)
    }
  }

  return NextResponse.json({ supabase, render, clientId });
}

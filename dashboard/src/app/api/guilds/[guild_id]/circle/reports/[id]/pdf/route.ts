import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureCircleSchema } from '@/lib/circle';

export const dynamic = 'force-dynamic';

/** 添付 PDF のダウンロード */
export async function GET(request: Request, { params }: { params: { guild_id: string; id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const res = await pool.query(
      'SELECT pdf_name, pdf_data FROM circle_reports WHERE id = $1 AND guild_id = $2',
      [Number(params.id), guildId]
    );
    const row = res.rows[0];
    if (!row?.pdf_data) return NextResponse.json({ error: 'PDFがありません' }, { status: 404 });
    const name = row.pdf_name || 'report.pdf';
    return new NextResponse(new Uint8Array(row.pdf_data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: any) {
    console.error('Circle report PDF GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

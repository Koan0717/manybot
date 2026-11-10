import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  ensureCircleSchema, toCircleReportJson, REPORT_COLUMNS,
  MAX_PDF_BYTES, MAX_TITLE, MAX_CONTENT, isPdf, cleanPdfName,
} from '@/lib/circle';
import { canManageReport, getRequestSession } from '@/lib/circleAuth';

export const dynamic = 'force-dynamic';

/** サークル進捗状況のレポート一覧（新しい順） */
export async function GET(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);
    const res = await pool.query(
      `SELECT ${REPORT_COLUMNS} FROM circle_reports WHERE guild_id = $1 ORDER BY id DESC`,
      [guildId]
    );
    return NextResponse.json(res.rows.map(toCircleReportJson));
  } catch (error: any) {
    console.error('Circle reports GET error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * レポートの作成（id なし）・更新（id あり）。multipart/form-data で受け取る。
 * fields: id?, title, content, remove_pdf ('1'), pdf (File)
 */
export async function POST(request: Request, { params }: { params: { guild_id: string } }) {
  try {
    const guildId = params.guild_id;
    const pool = await getPool(guildId);
    await ensureCircleSchema(pool);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'フォームを読み取れませんでした（PDFが大きすぎる可能性があります）' }, { status: 400 });
    }

    const title = String(form.get('title') || '').trim().slice(0, MAX_TITLE);
    if (!title) return NextResponse.json({ error: '題名を入力してください' }, { status: 400 });
    const content = String(form.get('content') || '').replace(/\r\n/g, '\n');
    if (content.length > MAX_CONTENT) {
      return NextResponse.json({ error: `内容は${MAX_CONTENT}文字以内にしてください` }, { status: 400 });
    }
    const id = Number(form.get('id')) || null;
    const removePdf = form.get('remove_pdf') === '1';

    let pdf: { name: string; size: number; data: Buffer } | null = null;
    const file = form.get('pdf');
    if (file && typeof file === 'object' && 'arrayBuffer' in file && (file as File).size > 0) {
      const f = file as File;
      if (f.size > MAX_PDF_BYTES) {
        return NextResponse.json({ error: `PDFは${MAX_PDF_BYTES / 1024 / 1024}MBまでです` }, { status: 400 });
      }
      const data = Buffer.from(await f.arrayBuffer());
      if (!isPdf(data)) return NextResponse.json({ error: 'PDFファイルを選んでください' }, { status: 400 });
      pdf = { name: cleanPdfName(f.name), size: data.length, data };
    }

    const session = await getRequestSession(request);
    let row: any;
    if (id) {
      const owner = await pool.query('SELECT author_id FROM circle_reports WHERE id = $1 AND guild_id = $2', [id, guildId]);
      if (owner.rows.length === 0) return NextResponse.json({ error: 'レポートが見つかりません' }, { status: 404 });
      if (!canManageReport(session, owner.rows[0].author_id)) {
        return NextResponse.json({ error: '自分が書いた報告書だけ編集できます' }, { status: 403 });
      }
      // PDF: 新しいファイルがあれば差し替え、削除指定なら消す、どちらでもなければそのまま
      const res = await pool.query(
        `UPDATE circle_reports SET
           title = $3, content = $4,
           pdf_name = CASE WHEN $5::boolean THEN $6::text WHEN $7::boolean THEN NULL ELSE pdf_name END,
           pdf_size = CASE WHEN $5::boolean THEN $8::int WHEN $7::boolean THEN NULL ELSE pdf_size END,
           pdf_data = CASE WHEN $5::boolean THEN $9::bytea WHEN $7::boolean THEN NULL ELSE pdf_data END,
           updated_at = NOW()
         WHERE id = $1 AND guild_id = $2
         RETURNING ${REPORT_COLUMNS}`,
        [id, guildId, title, content, !!pdf, pdf?.name ?? null, removePdf && !pdf, pdf?.size ?? null, pdf?.data ?? null]
      );
      if (res.rows.length === 0) return NextResponse.json({ error: 'レポートが見つかりません' }, { status: 404 });
      row = res.rows[0];
    } else {
      const res = await pool.query(
        `INSERT INTO circle_reports (guild_id, title, content, pdf_name, pdf_size, pdf_data, author_id, author_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${REPORT_COLUMNS}`,
        [
          guildId, title, content, pdf?.name ?? null, pdf?.size ?? null, pdf?.data ?? null,
          // Discordログインから入った人は作成者として記録する（専用アカウントの管理者は記録しない）
          session?.discord_id ?? null, session?.discord_id ? session.username : null,
        ]
      );
      row = res.rows[0];
    }
    return NextResponse.json({ success: true, report: toCircleReportJson(row) });
  } catch (error: any) {
    console.error('Circle reports POST error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

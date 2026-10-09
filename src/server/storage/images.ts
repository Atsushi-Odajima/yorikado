import 'server-only';
import sharp from 'sharp';
import { sha256Hex } from '@/domain/identity/crypto';
import { MAX_IMAGE_BYTES, MAX_LONG_EDGE, sniffImage } from '@/domain/requests/attachments';
import { adminDb, rpc } from '@/server/db/supabase';
import { AppError } from '@/server/errors';

interface Row {
  id: string;
  tenant_id: string;
  created_by: string;
  object_path: string;
  scan_status: string;
}

/**
 * Decode, verify and re-encode an uploaded image from quarantine. Metadata
 * (EXIF incl. GPS) is dropped by re-encoding. Only after this succeeds does
 * the attachment become downloadable by anyone other than the uploader.
 */
export async function processImage(input: Buffer): Promise<{ data: Buffer; format: 'jpeg' | 'png' | 'webp'; width: number; height: number }> {
  if (input.byteLength > MAX_IMAGE_BYTES) throw new AppError('VALIDATION', '写真は1枚10MBまでです');
  const sniffed = sniffImage(input);
  if (!sniffed) throw new AppError('UNSUPPORTED', '画像として読み取れませんでした。JPEG・PNG・WebPの写真を選んでください');
  let img = sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 });
  const meta = await img.metadata().catch(() => null);
  if (!meta || meta.format !== sniffed) throw new AppError('UNSUPPORTED', '画像として読み取れませんでした');
  img = img.rotate().resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true });
  const out =
    sniffed === 'jpeg' ? img.jpeg({ quality: 85, mozjpeg: true }) : sniffed === 'png' ? img.png({ compressionLevel: 9 }) : img.webp({ quality: 85 });
  const { data, info } = await out.toBuffer({ resolveWithObject: true }).catch(() => {
    throw new AppError('UNSUPPORTED', '画像を処理できませんでした');
  });
  return { data, format: sniffed, width: info.width, height: info.height };
}

export async function finalizeImage(id: string, actorId: string) {
  const admin = adminDb();
  const { data: row } = await admin.from('attachments').select('id, tenant_id, created_by, object_path, scan_status').eq('id', id).maybeSingle<Row>();
  if (!row || row.created_by !== actorId) throw new AppError('NOT_FOUND');
  if (row.scan_status !== 'pending') {
    return { id, status: row.scan_status };
  }
  const file = await admin.storage.from('attachments').download(row.object_path);
  if (file.error || !file.data) throw new AppError('VALIDATION', '写真がまだ届いていません。もう一度送信してください');
  const input = Buffer.from(await file.data.arrayBuffer());
  try {
    const img = await processImage(input);
    const cleanPath = `clean/${row.tenant_id}/${id}.${img.format === 'jpeg' ? 'jpg' : img.format}`;
    const up = await admin.storage.from('attachments').upload(cleanPath, img.data, { contentType: `image/${img.format}`, upsert: true });
    if (up.error) throw new AppError('SERVICE_UNAVAILABLE');
    await admin.storage.from('attachments').remove([row.object_path]);
    return rpc(admin, 'svc_attachment_finalize', {
      p_id: id,
      p_actor: actorId,
      p_ok: true,
      p_object_path: cleanPath,
      p_mime: `image/${img.format}`,
      p_size: img.data.byteLength,
      p_sha256: sha256Hex(img.data),
      p_width: img.width,
      p_height: img.height,
      p_reason: null,
    });
  } catch (e) {
    await admin.storage.from('attachments').remove([row.object_path]);
    await rpc(admin, 'svc_attachment_finalize', {
      p_id: id,
      p_actor: actorId,
      p_ok: false,
      p_object_path: row.object_path,
      p_mime: null,
      p_size: null,
      p_sha256: null,
      p_width: null,
      p_height: null,
      p_reason: e instanceof AppError ? e.message : 'decode failed',
    });
    if (e instanceof AppError) throw e;
    throw new AppError('UNSUPPORTED', '画像を処理できませんでした');
  }
}

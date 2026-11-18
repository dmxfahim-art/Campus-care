import { GridFSBucket, ObjectId } from 'mongodb';
import { Readable } from 'node:stream';
import { getDb } from './db';

const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const maxImageBytes = 5 * 1024 * 1024;

export async function saveImage(file: File): Promise<ObjectId> {
  if (!allowed.has(file.type) || file.size > maxImageBytes || file.size === 0) throw new Error('Invalid image');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const png = header.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png || file.type === 'image/webp' && webp)) throw new Error('Invalid image');
  const bucket = new GridFSBucket(await getDb(), { bucketName: 'complaintImages' });
  const stream = bucket.openUploadStream(file.name.slice(0, 120), { metadata: { contentType: file.type } });
  await new Promise<void>((resolve, reject) => { Readable.fromWeb(file.stream() as any).pipe(stream).on('finish', resolve).on('error', reject); });
  return stream.id as ObjectId;
}

export async function loadImage(id: ObjectId) {
  const db = await getDb();
  const file = await db.collection('complaintImages.files').findOne({ _id: id });
  if (!file) return null;
  return { stream: new GridFSBucket(db, { bucketName: 'complaintImages' }).openDownloadStream(id), contentType: String((file.metadata as any)?.contentType || 'application/octet-stream') };
}

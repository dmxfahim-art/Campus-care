import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { ObjectId } from 'mongodb';
import { getDb } from './db';

const scrypt = promisify(scryptCallback);
const cookieName = 'campuscare_session';
const duration = 60 * 60 * 24 * 7;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64) as Buffer).toString('hex');
  return `${salt}:${hash}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex || hex.length !== 128) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function publicUser(user: any) { return { id: String(user._id), name: user.name, studentId: user.studentId, email: user.email, role: user.role, departmentId: user.departmentId || null, active: user.active !== false }; }
export async function createSession(c: Context, userId: ObjectId) {
  const token = randomBytes(32).toString('hex');
  const db = await getDb();
  await db.collection('sessions').insertOne({ tokenHash: digest(token), userId, expiresAt: new Date(Date.now() + duration * 1000) });
  setCookie(c, cookieName, token, { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: duration });
}
export async function currentUser(c: Context) {
  const token = getCookie(c, cookieName);
  if (!token) return null;
  const db = await getDb();
  const session = await db.collection('sessions').findOne({ tokenHash: digest(token), expiresAt: { $gt: new Date() } });
  return session ? db.collection('users').findOne({ _id: session.userId as ObjectId, active: { $ne: false } }) : null;
}
export async function destroySession(c: Context) {
  const token = getCookie(c, cookieName);
  if (token) await (await getDb()).collection('sessions').deleteOne({ tokenHash: digest(token) });
  deleteCookie(c, cookieName, { path: '/' });
}

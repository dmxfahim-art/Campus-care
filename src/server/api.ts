import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { Readable } from 'node:stream';
import { getDb } from './db';
import { createSession, currentUser, destroySession, hashPassword, publicUser, verifyPassword } from './security';
import { loadImage, maxImageBytes, saveImage } from './images';

export const api = new Hono().basePath('/api');
const statuses = ['Submitted', 'In Progress', 'Resolved'] as const;
const registerSchema = z.object({ name: z.string().trim().min(2).max(100), studentId: z.string().trim().min(2).max(40), email: z.email().transform(x => x.toLowerCase()), password: z.string().min(8).max(128) });
const complaintSchema = z.object({ title: z.string().trim().min(3).max(160), description: z.string().trim().min(10).max(5000), category: z.string().trim().min(2).max(60), location: z.string().trim().min(2).max(200) });
const parseId = (id: string) => ObjectId.isValid(id) ? new ObjectId(id) : null;
const invalid = (c: any, errors: any) => c.json({ error: 'Invalid input', details: errors.flatten() }, 400);
const serializeComplaint = (doc: any) => ({ id: String(doc._id), displayId: doc.displayId, title: doc.title, description: doc.description, category: doc.category, location: doc.location, imageUrl: doc.imageId ? `/api/complaints/${doc._id}/image` : null, status: doc.status, departmentId: doc.departmentId || null, createdAt: doc.createdAt, updatedAt: doc.updatedAt, timeline: (doc.timeline || []).map(({ by, userId, studentId, ...event }: any) => event), feedback: doc.feedback || null });
async function notifyTeam(db: Awaited<ReturnType<typeof getDb>>, query: Record<string, unknown>, text: string, extra: Record<string, unknown> = {}) {
  const users = await db.collection('users').find({ ...query, active: { $ne: false } }, { projection: { _id: 1 } }).toArray();
  if (users.length) await db.collection('notifications').insertMany(users.map(user => ({ userId: user._id, text, read: false, createdAt: new Date(), ...extra })));
}

api.onError((error, c) => { console.error(error); return c.json({ error: 'Internal server error' }, 500); });
api.use('*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && new URL(origin).origin !== new URL(c.req.url).origin) return c.json({ error: 'Forbidden origin' }, 403);
  }
  await next();
});
api.get('/health', c => c.json({ status: 'ok', databaseConfigured: Boolean(process.env.MONGODB_URI) }));
api.post('/auth/register', async c => {
  const body = registerSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return invalid(c, body.error);
  const db = await getDb();
  try {
    const { password, ...fields } = body.data;
    const result = await db.collection('users').insertOne({ ...fields, passwordHash: await hashPassword(password), role: 'student', createdAt: new Date() });
    await createSession(c, result.insertedId);
    return c.json({ user: publicUser({ _id: result.insertedId, ...fields, role: 'student' }) }, 201);
  } catch (error: any) { if (error?.code === 11000) return c.json({ error: 'Email or student ID already exists' }, 409); throw error; }
});
api.post('/auth/login', async c => {
  const body = z.object({ email: z.email(), password: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return invalid(c, body.error);
  const user = await (await getDb()).collection('users').findOne({ email: body.data.email.toLowerCase() });
  if (!user || user.active === false || !await verifyPassword(body.data.password, String(user.passwordHash))) return c.json({ error: 'Invalid credentials' }, 401);
  await createSession(c, user._id);
  return c.json({ user: publicUser(user) });
});
api.get('/auth/me', async c => { const user = await currentUser(c); return user ? c.json({ user: publicUser(user) }) : c.json({ error: 'Unauthorized' }, 401); });
api.post('/auth/logout', async c => { await destroySession(c); return c.json({ ok: true }); });

api.use('/*', async (c, next) => { const user = await currentUser(c); if (!user) return c.json({ error: 'Unauthorized' }, 401); c.set('user' as never, user); await next(); });
const getUser = (c: any): any => c.get('user');
api.patch('/auth/me', async c => {
  const user = getUser(c);
  const body = z.object({ name: z.string().trim().min(2).max(100), studentId: z.string().trim().min(2).max(40), email: z.email().transform(x => x.toLowerCase()) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return invalid(c, body.error);
  try {
    const db = await getDb();
    await db.collection('users').updateOne({ _id: user._id }, { $set: body.data });
    return c.json({ user: publicUser({ ...user, ...body.data }) });
  } catch (error: any) { if (error?.code === 11000) return c.json({ error: 'Email or student ID already exists' }, 409); throw error; }
});
api.patch('/auth/password', async c => {
  const user = getUser(c);
  const body = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(128) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return invalid(c, body.error);
  if (!await verifyPassword(body.data.currentPassword, String(user.passwordHash))) return c.json({ error: 'Current password is incorrect' }, 403);
  const db = await getDb();
  await db.collection('users').updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(body.data.newPassword) } });
  await db.collection('sessions').deleteMany({ userId: user._id });
  await destroySession(c);
  return c.json({ ok: true });
});
api.get('/departments', async c => { const items = await (await getDb()).collection('departments').find({}, { projection: { _id: 0, code: 1, name: 1 } }).toArray(); return c.json({ items }); });
api.get('/categories', async c => { const items = await (await getDb()).collection('categories').find({}, { projection: { _id: 0, code: 1, name: 1 } }).sort({ name: 1 }).toArray(); return c.json({ items }); });
api.post('/categories', async c => {
  const user = getUser(c); if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  const body = z.object({ code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, 'Category code must be alphanumeric'), name: z.string().trim().min(2).max(100) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return invalid(c, body.error);
  const db = await getDb();
  try {
    await db.collection('categories').insertOne({ code: body.data.code, name: body.data.name, createdAt: new Date() });
    await db.collection('departments').updateOne({ code: body.data.code }, { $setOnInsert: { code: body.data.code, name: body.data.name } }, { upsert: true });
    return c.json({ category: body.data }, 201);
  } catch (error: any) {
    if (error?.code === 11000) return c.json({ error: 'Category code already exists' }, 409);
    throw error;
  }
});
api.patch('/categories/:code', async c => {
  const user = getUser(c); if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  const targetCode = c.req.param('code');
  const body = z.object({
    code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, 'Category code must be alphanumeric').optional(),
    name: z.string().trim().min(2).max(100)
  }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return invalid(c, body.error);

  const db = await getDb();
  const existing = await db.collection('categories').findOne({ code: targetCode });
  if (!existing) return c.json({ error: 'Category not found' }, 404);

  const newCode = body.data.code || targetCode;
  if (newCode !== targetCode) {
    const conflict = await db.collection('categories').findOne({ code: newCode });
    if (conflict) return c.json({ error: 'Category code already exists' }, 409);
  }

  const newName = body.data.name;
  await db.collection('categories').updateOne(
    { code: targetCode },
    { $set: { code: newCode, name: newName, updatedAt: new Date() } }
  );

  if (newCode !== targetCode) {
    await db.collection('departments').updateOne(
      { code: targetCode },
      { $set: { code: newCode, name: newName } },
      { upsert: true }
    );
    await db.collection('complaints').updateMany(
      { category: targetCode },
      { $set: { category: newCode } }
    );
    await db.collection('users').updateMany(
      { departmentId: targetCode },
      { $set: { departmentId: newCode } }
    );
  } else {
    await db.collection('departments').updateOne(
      { code: targetCode },
      { $set: { name: newName } },
      { upsert: true }
    );
  }

  return c.json({ category: { code: newCode, name: newName } });
});
api.get('/staff', async c => { if (getUser(c).role !== 'admin') return c.json({ error: 'Forbidden' }, 403); const docs = await (await getDb()).collection('users').find({ role: { $in: ['staff', 'admin'] } }).sort({ name: 1 }).toArray(); return c.json({ items: docs.map(publicUser) }); });
api.post('/staff', async c => {
  const admin = getUser(c); if (admin.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  const body = registerSchema.extend({ role: z.enum(['staff', 'admin']), departmentId: z.string().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return invalid(c, body.error);
  const db = await getDb();
  if (body.data.role === 'staff' && !body.data.departmentId) return c.json({ error: 'Department required' }, 400);
  if (body.data.departmentId && !await db.collection('departments').findOne({ code: body.data.departmentId })) return c.json({ error: 'Unknown department' }, 400);
  const { password, ...fields } = body.data;
  try { const result = await db.collection('users').insertOne({ ...fields, passwordHash: await hashPassword(password), createdAt: new Date() }); return c.json({ user: publicUser({ _id: result.insertedId, ...fields }) }, 201); }
  catch (error: any) { if (error?.code === 11000) return c.json({ error: 'Email or student ID already exists' }, 409); throw error; }
});
api.patch('/staff/:id', async c => {
  const admin = getUser(c); if (admin.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  const id = parseId(c.req.param('id')); if (!id) return c.json({ error: 'Not found' }, 404);
  const body = z.object({ role: z.enum(['staff', 'admin']), departmentId: z.string().nullable().optional(), active: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return invalid(c, body.error);
  if (admin._id.equals(id) && (body.data.role !== 'admin' || !body.data.active)) return c.json({ error: 'You cannot disable your own admin access' }, 409);
  const db = await getDb(), target = await db.collection('users').findOne({ _id: id, role: { $in: ['staff', 'admin'] } });
  if (!target) return c.json({ error: 'Not found' }, 404);
  if (String(target.email || '').toLowerCase() === 'admin@gmail.com') return c.json({ error: 'Super admin account (admin@gmail.com) cannot be modified' }, 403);
  if (body.data.role === 'staff' && !body.data.departmentId) return c.json({ error: 'Department required' }, 400);
  if (body.data.departmentId && !await db.collection('departments').findOne({ code: body.data.departmentId })) return c.json({ error: 'Unknown department' }, 400);
  const updated = { role: body.data.role, departmentId: body.data.role === 'staff' ? body.data.departmentId : null, active: body.data.active };
  await db.collection('users').updateOne({ _id: id }, { $set: updated });
  if (!updated.active) await db.collection('sessions').deleteMany({ userId: id });
  return c.json({ user: publicUser({ ...target, ...updated }) });
});
api.get('/complaints', async c => {
  const user = getUser(c), db = await getDb(), query: any = user.role === 'student' ? { studentId: user._id } : user.role === 'staff' ? { departmentId: user.departmentId } : {};
  const status = c.req.query('status'), category = c.req.query('category');
  if (status && statuses.includes(status as any)) query.status = status;
  if (category) query.category = category;
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const docs = await db.collection('complaints').find(query).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).toArray();
  return c.json({ items: docs.map(serializeComplaint), total: await db.collection('complaints').countDocuments(query), page });
});
api.post('/complaints', async c => {
  const user = getUser(c); if (user.role !== 'student') return c.json({ error: 'Forbidden' }, 403);
  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('multipart/form-data') && Number(c.req.header('content-length') || 0) > maxImageBytes + 20_000) return c.json({ error: 'Upload too large' }, 413);
  let input: any, image: File | undefined;
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    input = Object.fromEntries(['title', 'description', 'category', 'location'].map(key => [key, form.get(key)]));
    const item = form.get('image'); if (item instanceof File && item.size) image = item;
  } else input = await c.req.json().catch(() => null);
  const data = complaintSchema.safeParse(input); if (!data.success) return invalid(c, data.error);
  const db = await getDb();
  const validCategory = await db.collection('categories').findOne({ code: data.data.category });
  if (!validCategory && !['IT', 'Classroom', 'Transport', 'Facilities'].includes(data.data.category)) return c.json({ error: 'Unknown category' }, 400);
  if (image && image.size > maxImageBytes) return c.json({ error: 'Upload too large' }, 413);
  let imageId: ObjectId | undefined;
  try { if (image) imageId = await saveImage(image); } catch { return c.json({ error: 'Invalid image' }, 400); }
  const now = new Date(), displayId = `CC-${now.getTime().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const doc = { ...data.data, displayId, imageId, studentId: user._id, status: 'Submitted', departmentId: null, createdAt: now, updatedAt: now, timeline: [{ status: 'Submitted', at: now, by: user._id }] };
  const result = await db.collection('complaints').insertOne(doc);
  await notifyTeam(db, { role: 'admin' }, `New complaint ${displayId} submitted`, { complaintId: result.insertedId });
  return c.json({ complaint: serializeComplaint({ _id: result.insertedId, ...doc }) }, 201);
});
api.get('/complaints/:id/image', async c => {
  const id = parseId(c.req.param('id')); if (!id) return c.json({ error: 'Not found' }, 404);
  const user = getUser(c), doc = await (await getDb()).collection('complaints').findOne({ _id: id });
  if (!doc || !doc.imageId || user.role === 'student' && !doc.studentId.equals(user._id) || user.role === 'staff' && String(doc.departmentId) !== String(user.departmentId)) return c.json({ error: 'Not found' }, 404);
  const image = await loadImage(doc.imageId); if (!image) return c.json({ error: 'Not found' }, 404);
  return new Response(Readable.toWeb(image.stream) as ReadableStream, { headers: { 'Content-Type': image.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
api.get('/complaints/:id', async c => {
  const id = parseId(c.req.param('id')); if (!id) return c.json({ error: 'Not found' }, 404);
  const user = getUser(c), doc = await (await getDb()).collection('complaints').findOne({ _id: id });
  if (!doc || user.role === 'student' && !doc.studentId.equals(user._id) || user.role === 'staff' && String(doc.departmentId) !== String(user.departmentId)) return c.json({ error: 'Not found' }, 404);
  return c.json({ complaint: serializeComplaint(doc) });
});
api.patch('/complaints/:id/status', async c => {
  const user = getUser(c); if (user.role === 'student') return c.json({ error: 'Forbidden' }, 403);
  const id = parseId(c.req.param('id')); if (!id) return c.json({ error: 'Not found' }, 404);
  const body = z.object({ status: z.enum(statuses), note: z.string().max(1000).optional() }).safeParse(await c.req.json().catch(() => null)); if (!body.success) return invalid(c, body.error);
  const db = await getDb(), doc = await db.collection('complaints').findOne({ _id: id });
  if (!doc || user.role === 'staff' && String(doc.departmentId) !== String(user.departmentId)) return c.json({ error: 'Not found' }, 404);
  if (doc.status === body.data.status) return c.json({ complaint: serializeComplaint(doc) });
  const now = new Date(), event = { status: body.data.status, note: body.data.note || '', at: now, by: user._id };
  await db.collection('complaints').updateOne({ _id: id }, { $set: { status: body.data.status, updatedAt: now }, $push: { timeline: event } } as any);
  await db.collection('notifications').insertOne({ userId: doc.studentId, complaintId: id, text: `${doc.displayId} changed to ${body.data.status}`, read: false, createdAt: now });
  if (user.role === 'staff') await notifyTeam(db, { role: 'admin' }, `${doc.displayId} changed to ${body.data.status}`, { complaintId: id });
  return c.json({ complaint: serializeComplaint({ ...doc, status: body.data.status, updatedAt: now, timeline: [...doc.timeline, event] }) });
});
api.patch('/complaints/:id/assign', async c => {
  const user = getUser(c); if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  const id = parseId(c.req.param('id'));
  const body = z.object({ departmentId: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!id) return c.json({ error: 'Not found' }, 404); if (!body.success) return invalid(c, body.error);
  const db = await getDb(), doc = await db.collection('complaints').findOne({ _id: id }); if (!doc) return c.json({ error: 'Not found' }, 404);
  const department = await db.collection('departments').findOne({ code: body.data.departmentId }); if (!department) return c.json({ error: 'Unknown department' }, 400);
  const now = new Date(); await db.collection('complaints').updateOne({ _id: id }, { $set: { departmentId: department.code, updatedAt: now }, $push: { timeline: { action: 'Assigned', departmentId: department.code, at: now, by: user._id } } } as any);
  await db.collection('notifications').insertOne({ userId: doc.studentId, complaintId: id, text: `${doc.displayId} assigned to ${department.name}`, read: false, createdAt: now });
  if (doc.departmentId !== department.code) await notifyTeam(db, { role: 'staff', departmentId: department.code }, `${doc.displayId} assigned to your department`, { complaintId: id });
  return c.json({ ok: true });
});
api.post('/complaints/:id/feedback', async c => {
  const user = getUser(c), id = parseId(c.req.param('id')); if (!id) return c.json({ error: 'Not found' }, 404);
  const body = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(1000) }).safeParse(await c.req.json().catch(() => null)); if (!body.success) return invalid(c, body.error);
  const db = await getDb(); const result = await db.collection('complaints').updateOne({ _id: id, studentId: user._id, status: 'Resolved', feedback: { $exists: false } }, { $set: { feedback: body.data } });
  return result.matchedCount ? c.json({ ok: true }) : c.json({ error: 'Complaint is unavailable for feedback' }, 409);
});
api.get('/notifications', async c => { const docs = await (await getDb()).collection('notifications').find({ userId: getUser(c)._id }).sort({ createdAt: -1 }).limit(100).toArray(); return c.json({ items: docs.map(n => ({ id: String(n._id), complaintId: n.complaintId ? String(n.complaintId) : null, text: n.text, read: n.read, createdAt: n.createdAt })) }); });
api.patch('/notifications/read-all', async c => { await (await getDb()).collection('notifications').updateMany({ userId: getUser(c)._id, read: false }, { $set: { read: true } }); return c.json({ ok: true }); });
api.patch('/notifications/:id/read', async c => { const id = parseId(c.req.param('id')); if (!id) return c.json({ error: 'Not found' }, 404); const body = z.object({ read: z.boolean() }).safeParse(await c.req.json().catch(() => null)); if (!body.success) return invalid(c, body.error); const result = await (await getDb()).collection('notifications').updateOne({ _id: id, userId: getUser(c)._id }, { $set: { read: body.data.read } }); return result.matchedCount ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404); });
api.get('/dashboard/summary', async c => { const user = getUser(c), query: any = user.role === 'student' ? { studentId: user._id } : user.role === 'staff' ? { departmentId: user.departmentId } : {}; const docs = await (await getDb()).collection('complaints').find(query, { projection: { status: 1, category: 1, departmentId: 1 } }).toArray(); const count = (key: string) => docs.reduce((result: Record<string, number>, item: any) => { const value = String(item[key] || 'Unassigned'); result[value] = (result[value] || 0) + 1; return result; }, {}); return c.json({ total: docs.length, submitted: docs.filter(x => x.status === 'Submitted').length, inProgress: docs.filter(x => x.status === 'In Progress').length, resolved: docs.filter(x => x.status === 'Resolved').length, byCategory: count('category'), byDepartment: count('departmentId') }); });

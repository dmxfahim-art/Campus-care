import { t as __exportAll } from "./rolldown-runtime_782esTHO.mjs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { z } from "zod";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
// src/server/db.ts
var client;
var connection;
function getDb() {
	if (!connection) {
		const uri = process.env.MONGODB_URI;
		if (!uri) throw new Error("MONGODB_URI is required");
		client = new MongoClient(uri, { maxPoolSize: 10 });
		connection = client.connect().then(async () => {
			const db = client.db(process.env.MONGODB_DB || "campuscare");
			await Promise.all([
				db.collection("users").createIndex({ email: 1 }, { unique: true }),
				db.collection("users").createIndex({ studentId: 1 }, { unique: true }),
				db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
				db.collection("complaints").createIndex({ displayId: 1 }, { unique: true }),
				db.collection("complaints").createIndex({
					studentId: 1,
					createdAt: -1
				}),
				db.collection("notifications").createIndex({
					userId: 1,
					createdAt: -1
				}),
				db.collection("departments").createIndex({ code: 1 }, { unique: true })
			]);
			for (const [code, name] of [
				["IT", "IT Department"],
				["Classroom", "Classroom Services"],
				["Transport", "Transport Office"],
				["Facilities", "Facilities Department"]
			]) await db.collection("departments").updateOne({ code }, { $setOnInsert: {
				code,
				name
			} }, { upsert: true });
			return db;
		}).catch((error) => {
			connection = void 0;
			throw error;
		});
	}
	return connection;
}
// src/server/security.ts
var scrypt$1 = promisify(scrypt);
var cookieName = "campuscare_session";
var duration = 604800;
async function hashPassword(password) {
	const salt = randomBytes(16).toString("hex");
	return `${salt}:${(await scrypt$1(password, salt, 64)).toString("hex")}`;
}
async function verifyPassword(password, stored) {
	const [salt, hex] = stored.split(":");
	if (!salt || !hex || hex.length !== 128) return false;
	const actual = await scrypt$1(password, salt, 64);
	return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}
var digest = (value) => createHash("sha256").update(value).digest("hex");
function publicUser(user) {
	return {
		id: String(user._id),
		name: user.name,
		studentId: user.studentId,
		email: user.email,
		role: user.role,
		departmentId: user.departmentId || null
	};
}
async function createSession(c, userId) {
	const token = randomBytes(32).toString("hex");
	await (await getDb()).collection("sessions").insertOne({
		tokenHash: digest(token),
		userId,
		expiresAt: new Date(Date.now() + duration * 1e3)
	});
	setCookie(c, cookieName, token, {
		httpOnly: true,
		secure: new URL(c.req.url).protocol === "https:",
		sameSite: "Lax",
		path: "/",
		maxAge: duration
	});
}
async function currentUser(c) {
	const token = getCookie(c, cookieName);
	if (!token) return null;
	const db = await getDb();
	const session = await db.collection("sessions").findOne({
		tokenHash: digest(token),
		expiresAt: { $gt: /* @__PURE__ */ new Date() }
	});
	return session ? db.collection("users").findOne({ _id: session.userId }) : null;
}
async function destroySession(c) {
	const token = getCookie(c, cookieName);
	if (token) await (await getDb()).collection("sessions").deleteOne({ tokenHash: digest(token) });
	deleteCookie(c, cookieName, { path: "/" });
}
// src/server/images.ts
var allowed = /* @__PURE__ */ new Set([
	"image/jpeg",
	"image/png",
	"image/webp"
]);
async function saveImage(file) {
	if (!allowed.has(file.type) || file.size > 5242880 || file.size === 0) throw new Error("Invalid image");
	const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
	const png = header.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
	const webp = String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
	if (!(file.type === "image/jpeg" && jpeg || file.type === "image/png" && png || file.type === "image/webp" && webp)) throw new Error("Invalid image");
	const stream = new GridFSBucket(await getDb(), { bucketName: "complaintImages" }).openUploadStream(file.name.slice(0, 120), { metadata: { contentType: file.type } });
	await new Promise((resolve, reject) => {
		Readable.fromWeb(file.stream()).pipe(stream).on("finish", resolve).on("error", reject);
	});
	return stream.id;
}
async function loadImage(id) {
	const db = await getDb();
	const file = await db.collection("complaintImages.files").findOne({ _id: id });
	if (!file) return null;
	return {
		stream: new GridFSBucket(db, { bucketName: "complaintImages" }).openDownloadStream(id),
		contentType: String(file.metadata?.contentType || "application/octet-stream")
	};
}
// src/server/api.ts
var api = new Hono().basePath("/api");
var categories = [
	"IT",
	"Classroom",
	"Transport",
	"Facilities"
];
var statuses = [
	"Submitted",
	"In Progress",
	"Resolved"
];
var registerSchema = z.object({
	name: z.string().trim().min(2).max(100),
	studentId: z.string().trim().min(2).max(40),
	email: z.email().transform((x) => x.toLowerCase()),
	password: z.string().min(8).max(128)
});
var complaintSchema = z.object({
	title: z.string().trim().min(3).max(160),
	description: z.string().trim().min(10).max(5e3),
	category: z.enum(categories),
	location: z.string().trim().min(2).max(200)
});
var parseId = (id) => ObjectId.isValid(id) ? new ObjectId(id) : null;
var invalid = (c, errors) => c.json({
	error: "Invalid input",
	details: errors.flatten()
}, 400);
var serializeComplaint = (doc) => ({
	id: String(doc._id),
	displayId: doc.displayId,
	title: doc.title,
	description: doc.description,
	category: doc.category,
	location: doc.location,
	imageUrl: doc.imageId ? `/api/complaints/${doc._id}/image` : null,
	status: doc.status,
	departmentId: doc.departmentId || null,
	studentId: String(doc.studentId),
	createdAt: doc.createdAt,
	updatedAt: doc.updatedAt,
	timeline: doc.timeline || [],
	feedback: doc.feedback || null
});
api.onError((error, c) => {
	console.error(error);
	return c.json({ error: "Internal server error" }, 500);
});
api.use("*", async (c, next) => {
	if (![
		"GET",
		"HEAD",
		"OPTIONS"
	].includes(c.req.method)) {
		const origin = c.req.header("origin");
		if (origin && new URL(origin).origin !== new URL(c.req.url).origin) return c.json({ error: "Forbidden origin" }, 403);
	}
	await next();
});
api.get("/health", (c) => c.json({ status: "ok" }));
api.post("/auth/register", async (c) => {
	const body = registerSchema.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	const db = await getDb();
	try {
		const { password, ...fields } = body.data;
		const result = await db.collection("users").insertOne({
			...fields,
			passwordHash: await hashPassword(password),
			role: "student",
			createdAt: /* @__PURE__ */ new Date()
		});
		await createSession(c, result.insertedId);
		return c.json({ user: publicUser({
			_id: result.insertedId,
			...fields,
			role: "student"
		}) }, 201);
	} catch (error) {
		if (error?.code === 11e3) return c.json({ error: "Email or student ID already exists" }, 409);
		throw error;
	}
});
api.post("/auth/login", async (c) => {
	const body = z.object({
		email: z.email(),
		password: z.string()
	}).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	const user = await (await getDb()).collection("users").findOne({ email: body.data.email.toLowerCase() });
	if (!user || !await verifyPassword(body.data.password, String(user.passwordHash))) return c.json({ error: "Invalid credentials" }, 401);
	await createSession(c, user._id);
	return c.json({ user: publicUser(user) });
});
api.get("/auth/me", async (c) => {
	const user = await currentUser(c);
	return user ? c.json({ user: publicUser(user) }) : c.json({ error: "Unauthorized" }, 401);
});
api.post("/auth/logout", async (c) => {
	await destroySession(c);
	return c.json({ ok: true });
});
api.use("/*", async (c, next) => {
	const user = await currentUser(c);
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	c.set("user", user);
	await next();
});
var getUser = (c) => c.get("user");
api.patch("/auth/me", async (c) => {
	const user = getUser(c);
	const body = z.object({
		name: z.string().trim().min(2).max(100),
		studentId: z.string().trim().min(2).max(40),
		email: z.email().transform((x) => x.toLowerCase())
	}).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	try {
		await (await getDb()).collection("users").updateOne({ _id: user._id }, { $set: body.data });
		return c.json({ user: publicUser({
			...user,
			...body.data
		}) });
	} catch (error) {
		if (error?.code === 11e3) return c.json({ error: "Email or student ID already exists" }, 409);
		throw error;
	}
});
api.patch("/auth/password", async (c) => {
	const user = getUser(c);
	const body = z.object({
		currentPassword: z.string(),
		newPassword: z.string().min(8).max(128)
	}).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	if (!await verifyPassword(body.data.currentPassword, String(user.passwordHash))) return c.json({ error: "Current password is incorrect" }, 403);
	const db = await getDb();
	await db.collection("users").updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(body.data.newPassword) } });
	await db.collection("sessions").deleteMany({ userId: user._id });
	await destroySession(c);
	return c.json({ ok: true });
});
api.get("/departments", async (c) => {
	const items = await (await getDb()).collection("departments").find({}, { projection: {
		_id: 0,
		code: 1,
		name: 1
	} }).toArray();
	return c.json({ items });
});
api.get("/staff", async (c) => {
	if (getUser(c).role !== "admin") return c.json({ error: "Forbidden" }, 403);
	const docs = await (await getDb()).collection("users").find({ role: { $in: ["staff", "admin"] } }).sort({ name: 1 }).toArray();
	return c.json({ items: docs.map(publicUser) });
});
api.post("/staff", async (c) => {
	if (getUser(c).role !== "admin") return c.json({ error: "Forbidden" }, 403);
	const body = registerSchema.extend({
		role: z.enum(["staff", "admin"]),
		departmentId: z.string().optional()
	}).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	const db = await getDb();
	if (body.data.role === "staff" && !body.data.departmentId) return c.json({ error: "Department required" }, 400);
	if (body.data.departmentId && !await db.collection("departments").findOne({ code: body.data.departmentId })) return c.json({ error: "Unknown department" }, 400);
	const { password, ...fields } = body.data;
	try {
		const result = await db.collection("users").insertOne({
			...fields,
			passwordHash: await hashPassword(password),
			createdAt: /* @__PURE__ */ new Date()
		});
		return c.json({ user: publicUser({
			_id: result.insertedId,
			...fields
		}) }, 201);
	} catch (error) {
		if (error?.code === 11e3) return c.json({ error: "Email or student ID already exists" }, 409);
		throw error;
	}
});
api.get("/complaints", async (c) => {
	const user = getUser(c), db = await getDb(), query = user.role === "student" ? { studentId: user._id } : user.role === "staff" ? { departmentId: user.departmentId } : {};
	const status = c.req.query("status"), category = c.req.query("category");
	if (status && statuses.includes(status)) query.status = status;
	if (category && categories.includes(category)) query.category = category;
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const docs = await db.collection("complaints").find(query).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).toArray();
	return c.json({
		items: docs.map(serializeComplaint),
		total: await db.collection("complaints").countDocuments(query),
		page
	});
});
api.post("/complaints", async (c) => {
	const user = getUser(c);
	if (user.role !== "student") return c.json({ error: "Forbidden" }, 403);
	const contentType = c.req.header("content-type") || "";
	if (contentType.includes("multipart/form-data") && Number(c.req.header("content-length") || 0) > 5262880) return c.json({ error: "Upload too large" }, 413);
	let input, image;
	if (contentType.includes("multipart/form-data")) {
		const form = await c.req.formData();
		input = Object.fromEntries([
			"title",
			"description",
			"category",
			"location"
		].map((key) => [key, form.get(key)]));
		const item = form.get("image");
		if (item instanceof File && item.size) image = item;
	} else input = await c.req.json().catch(() => null);
	const data = complaintSchema.safeParse(input);
	if (!data.success) return invalid(c, data.error);
	if (image && image.size > 5242880) return c.json({ error: "Upload too large" }, 413);
	let imageId;
	try {
		if (image) imageId = await saveImage(image);
	} catch {
		return c.json({ error: "Invalid image" }, 400);
	}
	const db = await getDb(), now = /* @__PURE__ */ new Date(), displayId = `CC-${now.getTime().toString(36).toUpperCase()}`;
	const doc = {
		...data.data,
		displayId,
		imageId,
		studentId: user._id,
		status: "Submitted",
		departmentId: null,
		createdAt: now,
		updatedAt: now,
		timeline: [{
			status: "Submitted",
			at: now,
			by: user._id
		}]
	};
	const result = await db.collection("complaints").insertOne(doc);
	return c.json({ complaint: serializeComplaint({
		_id: result.insertedId,
		...doc
	}) }, 201);
});
api.get("/complaints/:id/image", async (c) => {
	const id = parseId(c.req.param("id"));
	if (!id) return c.json({ error: "Not found" }, 404);
	const user = getUser(c), doc = await (await getDb()).collection("complaints").findOne({ _id: id });
	if (!doc || !doc.imageId || user.role === "student" && !doc.studentId.equals(user._id) || user.role === "staff" && String(doc.departmentId) !== String(user.departmentId)) return c.json({ error: "Not found" }, 404);
	const image = await loadImage(doc.imageId);
	if (!image) return c.json({ error: "Not found" }, 404);
	return new Response(Readable.toWeb(image.stream), { headers: {
		"Content-Type": image.contentType,
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff"
	} });
});
api.get("/complaints/:id", async (c) => {
	const id = parseId(c.req.param("id"));
	if (!id) return c.json({ error: "Not found" }, 404);
	const user = getUser(c), doc = await (await getDb()).collection("complaints").findOne({ _id: id });
	if (!doc || user.role === "student" && !doc.studentId.equals(user._id) || user.role === "staff" && String(doc.departmentId) !== String(user.departmentId)) return c.json({ error: "Not found" }, 404);
	return c.json({ complaint: serializeComplaint(doc) });
});
api.patch("/complaints/:id/status", async (c) => {
	const user = getUser(c);
	if (user.role === "student") return c.json({ error: "Forbidden" }, 403);
	const id = parseId(c.req.param("id"));
	if (!id) return c.json({ error: "Not found" }, 404);
	const body = z.object({
		status: z.enum(statuses),
		note: z.string().max(1e3).optional()
	}).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	const db = await getDb(), doc = await db.collection("complaints").findOne({ _id: id });
	if (!doc || user.role === "staff" && String(doc.departmentId) !== String(user.departmentId)) return c.json({ error: "Not found" }, 404);
	if (doc.status === body.data.status) return c.json({ complaint: serializeComplaint(doc) });
	const now = /* @__PURE__ */ new Date(), event = {
		status: body.data.status,
		note: body.data.note || "",
		at: now,
		by: user._id
	};
	await db.collection("complaints").updateOne({ _id: id }, {
		$set: {
			status: body.data.status,
			updatedAt: now
		},
		$push: { timeline: event }
	});
	await db.collection("notifications").insertOne({
		userId: doc.studentId,
		complaintId: id,
		text: `${doc.displayId} changed to ${body.data.status}`,
		read: false,
		createdAt: now
	});
	return c.json({ complaint: serializeComplaint({
		...doc,
		status: body.data.status,
		updatedAt: now,
		timeline: [...doc.timeline, event]
	}) });
});
api.patch("/complaints/:id/assign", async (c) => {
	const user = getUser(c);
	if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
	const id = parseId(c.req.param("id"));
	const body = z.object({ departmentId: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
	if (!id) return c.json({ error: "Not found" }, 404);
	if (!body.success) return invalid(c, body.error);
	const db = await getDb(), doc = await db.collection("complaints").findOne({ _id: id });
	if (!doc) return c.json({ error: "Not found" }, 404);
	const department = await db.collection("departments").findOne({ code: body.data.departmentId });
	if (!department) return c.json({ error: "Unknown department" }, 400);
	const now = /* @__PURE__ */ new Date();
	await db.collection("complaints").updateOne({ _id: id }, {
		$set: {
			departmentId: department.code,
			updatedAt: now
		},
		$push: { timeline: {
			action: "Assigned",
			departmentId: department.code,
			at: now,
			by: user._id
		} }
	});
	await db.collection("notifications").insertOne({
		userId: doc.studentId,
		complaintId: id,
		text: `${doc.displayId} assigned to ${department.name}`,
		read: false,
		createdAt: now
	});
	return c.json({ ok: true });
});
api.post("/complaints/:id/feedback", async (c) => {
	const user = getUser(c), id = parseId(c.req.param("id"));
	if (!id) return c.json({ error: "Not found" }, 404);
	const body = z.object({
		rating: z.number().int().min(1).max(5),
		comment: z.string().max(1e3)
	}).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	return (await (await getDb()).collection("complaints").updateOne({
		_id: id,
		studentId: user._id,
		status: "Resolved",
		feedback: { $exists: false }
	}, { $set: { feedback: body.data } })).matchedCount ? c.json({ ok: true }) : c.json({ error: "Complaint is unavailable for feedback" }, 409);
});
api.get("/notifications", async (c) => {
	const docs = await (await getDb()).collection("notifications").find({ userId: getUser(c)._id }).sort({ createdAt: -1 }).limit(100).toArray();
	return c.json({ items: docs.map((n) => ({
		id: String(n._id),
		complaintId: n.complaintId ? String(n.complaintId) : null,
		text: n.text,
		read: n.read,
		createdAt: n.createdAt
	})) });
});
api.patch("/notifications/read-all", async (c) => {
	await (await getDb()).collection("notifications").updateMany({
		userId: getUser(c)._id,
		read: false
	}, { $set: { read: true } });
	return c.json({ ok: true });
});
api.patch("/notifications/:id/read", async (c) => {
	const id = parseId(c.req.param("id"));
	if (!id) return c.json({ error: "Not found" }, 404);
	const body = z.object({ read: z.boolean() }).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	return (await (await getDb()).collection("notifications").updateOne({
		_id: id,
		userId: getUser(c)._id
	}, { $set: { read: body.data.read } })).matchedCount ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404);
});
api.get("/dashboard/summary", async (c) => {
	const user = getUser(c), query = user.role === "student" ? { studentId: user._id } : user.role === "staff" ? { departmentId: user.departmentId } : {};
	const docs = await (await getDb()).collection("complaints").find(query, { projection: {
		status: 1,
		category: 1,
		departmentId: 1
	} }).toArray();
	const count = (key) => docs.reduce((result, item) => {
		const value = String(item[key] || "Unassigned");
		result[value] = (result[value] || 0) + 1;
		return result;
	}, {});
	return c.json({
		total: docs.length,
		submitted: docs.filter((x) => x.status === "Submitted").length,
		inProgress: docs.filter((x) => x.status === "In Progress").length,
		resolved: docs.filter((x) => x.status === "Resolved").length,
		byCategory: count("category"),
		byDepartment: count("departmentId")
	});
});
api.post("/support", async (c) => {
	const body = z.object({
		subject: z.string().trim().min(3).max(160),
		message: z.string().trim().min(10).max(5e3)
	}).safeParse(await c.req.json().catch(() => null));
	if (!body.success) return invalid(c, body.error);
	const result = await (await getDb()).collection("supportRequests").insertOne({
		...body.data,
		userId: getUser(c)._id,
		status: "Open",
		createdAt: /* @__PURE__ */ new Date()
	});
	return c.json({ id: String(result.insertedId) }, 201);
});
api.get("/support", async (c) => {
	const docs = await (await getDb()).collection("supportRequests").find({ userId: getUser(c)._id }).sort({ createdAt: -1 }).toArray();
	return c.json({ items: docs.map((x) => ({
		id: String(x._id),
		subject: x.subject,
		message: x.message,
		status: x.status,
		createdAt: x.createdAt
	})) });
});
// src/pages/api/[...path].ts
var ____path__exports = /* @__PURE__ */ __exportAll({
	DELETE: () => DELETE,
	GET: () => GET,
	PATCH: () => PATCH,
	POST: () => POST,
	PUT: () => PUT,
	prerender: () => false
});
var handle = ({ request }) => api.fetch(request);
var GET = handle;
var POST = handle;
var PATCH = handle;
var PUT = handle;
var DELETE = handle;
// \0virtual:astro:page:src/pages/api/[...path]@_@ts
var page = () => ____path__exports;
export { page };

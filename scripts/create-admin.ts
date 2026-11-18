import { getDb } from '../src/server/db';
import { hashPassword } from '../src/server/security';

const [name, studentId, email, password] = process.argv.slice(2);
if (!name || !studentId || !email || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- "Full Name" ADMIN-ID email@example.com strong-password');
  process.exit(1);
}
const db = await getDb();
try {
  await db.collection('users').insertOne({ name, studentId, email: email.toLowerCase(), passwordHash: await hashPassword(password), role: 'admin', createdAt: new Date() });
  console.log('Admin account created.');
} catch (error: any) {
  if (error?.code === 11000) console.error('Email or ID already exists.');
  else console.error(error);
  process.exitCode = 1;
}
process.exit();

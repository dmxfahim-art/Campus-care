import 'dotenv/config';
import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | undefined;
let connection: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  if (!connection) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is required');
    client = new MongoClient(uri, { maxPoolSize: 10 });
    connection = client.connect().then(async () => {
      const db = client!.db(process.env.MONGODB_DB || 'campuscare');
      await Promise.all([
        db.collection('users').createIndex({ email: 1 }, { unique: true }),
        db.collection('users').createIndex({ studentId: 1 }, { unique: true }),
        db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
        db.collection('complaints').createIndex({ displayId: 1 }, { unique: true }),
        db.collection('complaints').createIndex({ studentId: 1, createdAt: -1 }),
        db.collection('notifications').createIndex({ userId: 1, createdAt: -1 }),
        db.collection('departments').createIndex({ code: 1 }, { unique: true }),
        db.collection('categories').createIndex({ code: 1 }, { unique: true }),
      ]);
      for (const [code, name] of [['IT', 'IT Department'], ['Classroom', 'Classroom Services'], ['Transport', 'Transport Office'], ['Facilities', 'Facilities Department']]) {
        await db.collection('departments').updateOne({ code }, { $setOnInsert: { code, name } }, { upsert: true });
      }
      for (const [code, name] of [['IT', 'IT & Wi-Fi'], ['Classroom', 'Classroom & Labs'], ['Transport', 'Transport & Shuttle'], ['Facilities', 'Facilities & Maintenance']]) {
        await db.collection('categories').updateOne({ code }, { $setOnInsert: { code, name } }, { upsert: true });
      }
      return db;
    }).catch((error) => { connection = undefined; throw error; });
  }
  return connection;
}

export async function closeDb() {
  if (client) await client.close();
  client = undefined;
  connection = undefined;
}

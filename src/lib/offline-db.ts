import { getPosDatabase, type PosSession } from './pos-database';
import type { UserSession } from './api';

export type OfflineSession = PosSession;

export async function hasLocalPosDatabase(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases !== 'function') return true;
  try {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name?.includes('pointe-pos'));
  } catch {
    return true;
  }
}

export async function saveOfflineSession(token: string, user: UserSession): Promise<PosSession | null> {
  try {
    const db = await getPosDatabase();
    if (!db) return null;
    const existing = await db.sessions.findOne().exec();
    if (existing) await existing.remove();
    const doc: PosSession = {
      id: user.id,
      token,
      user,
      createdAt: new Date().toISOString(),
    };
    await db.sessions.insert(doc);
    return doc;
  } catch (err) {
    console.warn('Failed to persist session to RxDB:', err);
    return null;
  }
}

export async function getOfflineSession(): Promise<PosSession | null> {
  try {
    if (!(await hasLocalPosDatabase())) return null;
    const db = await getPosDatabase();
    if (!db) return null;
    const doc = await db.sessions.findOne().exec();
    return doc ? (doc.toJSON() as PosSession) : null;
  } catch (err) {
    console.warn('Failed to read session from RxDB:', err);
    return null;
  }
}

export async function clearOfflineSession(): Promise<void> {
  try {
    if (!(await hasLocalPosDatabase())) return;
    const db = await getPosDatabase();
    if (!db) return;
    const doc = await db.sessions.findOne().exec();
    if (doc) await doc.remove();
  } catch (err) {
    console.warn('Failed to clear session from RxDB:', err);
  }
}

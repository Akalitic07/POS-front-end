import { replicateRxCollection } from 'rxdb/plugins/replication';
import type { RxDatabase, WithDeleted } from 'rxdb';
import { getConnectionStatus } from './connection-status';

const API_URL = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export type SyncCheckpoint = { id: string; updatedAt: string };

type AnyReplicationState = ReturnType<typeof replicateRxCollection<any, SyncCheckpoint>>;
let activeReplications: AnyReplicationState[] = [];

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('pointe-session');
    if (!raw) return null;
    return JSON.parse(raw).token || null;
  } catch {
    return null;
  }
}

async function syncPull(collection: string, checkpoint: SyncCheckpoint | undefined, batchSize: number) {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${API_URL}/api/sync/${collection}/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ checkpoint: checkpoint || null, limit: batchSize }),
  });

  if (!res.ok) throw new Error(`Sync pull failed: ${res.status}`);
  const data = await res.json();
  return {
    documents: (data.documents || []) as WithDeleted<any>[],
    checkpoint: (data.checkpoint || checkpoint || undefined) as SyncCheckpoint | undefined,
  };
}

async function syncPush(collection: string, changeRows: any[]) {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${API_URL}/api/sync/${collection}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ changeRows }),
  });

  if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
  const data = await res.json();
  return (data.conflicts || []) as WithDeleted<any>[];
}

export function startSync(db: RxDatabase, tenantId: string): void {
  stopSync();

  const collectionsToSync = ['products', 'inventory', 'transactions'] as const;

  for (const collectionName of collectionsToSync) {
    const collection = (db as any)[collectionName];
    if (!collection) continue;

    const replicationState = replicateRxCollection<any, SyncCheckpoint>({
      collection,
      replicationIdentifier: `pointe-${collectionName}-${tenantId}`,
      deletedField: '_deleted',
      pull: {
        handler: async (lastCheckpoint: SyncCheckpoint | undefined, batchSize: number) => {
          return syncPull(collectionName, lastCheckpoint, batchSize);
        },
        batchSize: 100,
      },
      push: {
        handler: async (changeRows) => {
          const apiRows = changeRows.map(row => ({
            newDocumentState: row.newDocumentState,
            assumedMasterState: row.assumedMasterState || null,
          }));
          return syncPush(collectionName, apiRows);
        },
        batchSize: 50,
      },
      live: true,
      retryTime: 5000,
      autoStart: true,
    });

    replicationState.error$.subscribe((err: any) => {
      console.warn(`[sync:${collectionName}] error:`, err?.message || err);
    });

    activeReplications.push(replicationState);
  }

  console.log(`[sync] Started replication for ${collectionsToSync.length} collections (tenant: ${tenantId})`);
}

export function stopSync(): void {
  for (const rep of activeReplications) {
    try {
      rep.cancel();
    } catch {}
  }
  activeReplications = [];
  console.log('[sync] All replications stopped');
}

export function getSyncStatus(): { collection: string; active: boolean; error: string | null }[] {
  return activeReplications.map(rep => ({
    collection: rep.collection.name,
    active: !rep.isStopped(),
    error: null,
  }));
}

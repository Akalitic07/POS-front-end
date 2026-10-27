import { getPosDatabase, type PosOutboxItem } from './pos-database';
import { getConnectionStatus, onConnectionChange } from './connection-status';

const API_URL = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const OUTBOX_STORAGE_KEY = 'pointe-offline-outbox';

// Helper to get local storage outbox
function getLocalOutbox(): PosOutboxItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Helper to save local storage outbox
function saveLocalOutbox(items: PosOutboxItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('[outbox] failed to save to localStorage:', err);
  }
}

// Queue an offline action (Product, Transaction, or Return)
export async function queueOfflineAction(
  tenantId: string,
  operatorId: string,
  actionType: "create_product" | "create_transaction" | "return_transaction",
  payload: any
): Promise<PosOutboxItem> {
  const item: PosOutboxItem = {
    id: `OUTBOX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tenantId,
    operatorId,
    actionType,
    payload,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
  };

  // 1. Save synchronously to localStorage (Guarantees survival through power cuts & immediate reload)
  const current = getLocalOutbox();
  current.push(item);
  saveLocalOutbox(current);

  // 2. Also save to RxDB outbox collection if available
  try {
    const db = await getPosDatabase();
    if (db && (db as any).outbox) {
      await (db as any).outbox.insert(item);
    }
  } catch (err) {
    console.warn('[outbox] rxdb queue warning:', err);
  }

  console.log(`[outbox] Queued offline action: ${actionType} (ID: ${item.id})`);
  return item;
}

// Get count of pending actions waiting to sync
export function getPendingOutboxCount(tenantId?: string): number {
  const items = getLocalOutbox();
  if (!tenantId) return items.length;
  return items.filter(i => i.tenantId === tenantId).length;
}

// Get IDs of items currently queued in the outbox to protect them during reconciliation
export function getPendingOutboxIds(tenantId?: string): { productIds: Set<string>; inventoryIds: Set<string> } {
  const items = getLocalOutbox();
  const filtered = tenantId ? items.filter(i => i.tenantId === tenantId) : items;
  const productIds = new Set<string>();
  const inventoryIds = new Set<string>();

  for (const item of filtered) {
    if (item.actionType === 'create_product' && item.payload) {
      if (item.payload.product?.id) productIds.add(String(item.payload.product.id));
      if (item.payload.inventory?.id) inventoryIds.add(String(item.payload.inventory.id));
      if (item.payload.inventory?.productId) {
        inventoryIds.add(String(item.payload.inventory.productId));
        productIds.add(String(item.payload.inventory.productId));
      }
    }
  }

  return { productIds, inventoryIds };
}

// Calculate pending net stock adjustments for all items currently queued in outbox
export function getPendingOutboxStockDeltas(tenantId?: string): {
  byProductId: Record<string, number>;
  byProductName: Record<string, number>;
} {
  const items = getLocalOutbox();
  const filtered = tenantId ? items.filter(i => i.tenantId === tenantId) : items;
  const byProductId: Record<string, number> = {};
  const byProductName: Record<string, number> = {};

  for (const item of filtered) {
    if (item.actionType === 'create_transaction' && Array.isArray(item.payload?.items)) {
      // Sales reduce stock
      for (const cartItem of item.payload.items) {
        const qty = Number(cartItem.quantity) || 0;
        if (cartItem.productId) {
          byProductId[cartItem.productId] = (byProductId[cartItem.productId] || 0) - qty;
        }
        if (cartItem.productName) {
          const nameKey = String(cartItem.productName).trim().toLowerCase();
          byProductName[nameKey] = (byProductName[nameKey] || 0) - qty;
        }
      }
    } else if (item.actionType === 'return_transaction' && Array.isArray(item.payload?.items)) {
      // Returns increase stock
      for (const retItem of item.payload.items) {
        const qty = Number(retItem.quantity) || 0;
        if (retItem.productId) {
          byProductId[retItem.productId] = (byProductId[retItem.productId] || 0) + qty;
        }
        if (retItem.productName) {
          const nameKey = String(retItem.productName).trim().toLowerCase();
          byProductName[nameKey] = (byProductName[nameKey] || 0) + qty;
        }
      }
    } else if (item.actionType === 'create_product' && item.payload?.inventory) {
      // Restocks with mode === 'add' increase stock
      if (item.payload.inventory.mode === 'add') {
        const qty = Number(item.payload.inventory.stockQty) || 0;
        if (item.payload.inventory.productId) {
          byProductId[item.payload.inventory.productId] = (byProductId[item.payload.inventory.productId] || 0) + qty;
        }
        if (item.payload.inventory.productName) {
          const nameKey = String(item.payload.inventory.productName).trim().toLowerCase();
          byProductName[nameKey] = (byProductName[nameKey] || 0) + qty;
        }
      }
    }
  }

  return { byProductId, byProductName };
}

let isFlushing = false;

// Flush and sync all queued outbox actions to the backend API
export async function flushOutbox(token: string): Promise<{ success: number; failed: number }> {
  if (!token || isFlushing || !getConnectionStatus()) {
    return { success: 0, failed: 0 };
  }

  isFlushing = true;
  let items = getLocalOutbox();
  if (items.length === 0) {
    isFlushing = false;
    return { success: 0, failed: 0 };
  }

  let successCount = 0;
  let failedCount = 0;
  const remainingItems: PosOutboxItem[] = [];

  for (const item of items) {
    try {
      if (item.actionType === 'create_product') {
        const { product, inventory } = item.payload;
        if (product) {
          const res = await fetch(`${API_URL}/api/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(product),
          });
          if (!res.ok && res.status !== 409) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `Product sync failed (${res.status})`);
          }
        }
        if (inventory) {
          const res = await fetch(`${API_URL}/api/inventory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(inventory),
          });
          if (!res.ok && res.status !== 409) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `Inventory sync failed (${res.status})`);
          }
        }
      } else if (item.actionType === 'create_transaction') {
        const res = await fetch(`${API_URL}/api/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(item.payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          // If already exists on server, treat as success
          if (res.status !== 409 && !errData.message?.includes('already exists')) {
            throw new Error(errData.message || `Transaction sync failed (${res.status})`);
          }
        }
      } else if (item.actionType === 'return_transaction') {
        const { transactionId, items: returnItems, returnReason } = item.payload;
        await fetch(`${API_URL}/api/transactions/${transactionId}/return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ items: returnItems, returnReason }),
        });
      }

      // Action completed successfully
      successCount++;

      // Clean up from RxDB outbox
      try {
        const db = await getPosDatabase();
        if (db && (db as any).outbox) {
          const doc = await (db as any).outbox.findOne({ selector: { id: item.id } }).exec();
          if (doc) await doc.remove();
        }
      } catch {}

    } catch (err: any) {
      console.warn(`[outbox] Failed to sync item ${item.id} (${item.actionType}):`, err?.message || err);
      failedCount++;
      item.retryCount = (item.retryCount || 0) + 1;
      remainingItems.push(item);
      // If network failure, stop further processing in this run
      if (!getConnectionStatus()) break;
    }
  }

  saveLocalOutbox(remainingItems);
  isFlushing = false;

  if (successCount > 0) {
    console.log(`[outbox] Successfully flushed ${successCount} queued action(s) to DynamoDB.`);
  }
  return { success: successCount, failed: failedCount };
}

// Global auto-sync watcher
let autoSyncStarted = false;
let autoSyncInterval: ReturnType<typeof setInterval> | null = null;

export function startOutboxAutoSync(): void {
  if (typeof window === 'undefined' || autoSyncStarted) return;
  autoSyncStarted = true;

  const getSessionToken = () => {
    try {
      const raw = localStorage.getItem('pointe-session');
      return raw ? JSON.parse(raw).token : null;
    } catch {
      return null;
    }
  };

  // 1. Listen for connection restoration
  onConnectionChange((online) => {
    if (online) {
      const token = getSessionToken();
      if (token) {
        flushOutbox(token).catch(() => {});
      }
    }
  });

  // 2. Periodic background drain if online
  if (autoSyncInterval) clearInterval(autoSyncInterval);
  autoSyncInterval = setInterval(() => {
    if (getConnectionStatus()) {
      const token = getSessionToken();
      if (token && getPendingOutboxCount() > 0) {
        flushOutbox(token).catch(() => {});
      }
    }
  }, 10000);

  // Initial attempt
  const token = getSessionToken();
  if (token && getConnectionStatus()) {
    flushOutbox(token).catch(() => {});
  }
}


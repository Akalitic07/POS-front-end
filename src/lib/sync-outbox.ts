import { getPosDatabase, type PosOutboxItem } from './pos-database';
import { getConnectionStatus, onConnectionChange } from './connection-status';
import { isAppSyncConfigured, graphqlRequest } from './appsync-client';
import { getStoredSession } from './api';

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

  // 3. Dispatch an event for reactive UI badge updates
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pointe-outbox-changed', { detail: { count: current.length } }));
  }

  return item;
}

// Get the count of pending outbox items for UI sync badges
export function getPendingOutboxCount(tenantId?: string): number {
  const items = getLocalOutbox();
  if (!tenantId) return items.length;
  return items.filter(i => i.tenantId === tenantId).length;
}

// Get Sets of pending IDs in outbox to overlay onto UI
export function getPendingOutboxIds(tenantId?: string): {
  productIds: Set<string>;
  inventoryIds: Set<string>;
  transactionIds: Set<string>;
} {
  const items = getLocalOutbox();
  const filtered = tenantId ? items.filter(i => i.tenantId === tenantId) : items;
  const productIds = new Set<string>();
  const inventoryIds = new Set<string>();
  const transactionIds = new Set<string>();

  for (const item of filtered) {
    if (item.actionType === 'create_product') {
      if (item.payload?.product?.id) productIds.add(String(item.payload.product.id));
      if (item.payload?.inventory?.id) inventoryIds.add(String(item.payload.inventory.id));
      if (item.payload?.inventory?.productId) inventoryIds.add(String(item.payload.inventory.productId));
    } else if (item.actionType === 'create_transaction') {
      if (item.payload?.id) transactionIds.add(String(item.payload.id));
    } else if (item.actionType === 'return_transaction') {
      if (item.payload?.transactionId) transactionIds.add(String(item.payload.transactionId));
    }
  }

  return { productIds, inventoryIds, transactionIds };
}

// Calculate the net offline delta for each product from pending outbox items
export function getPendingStockDeltas(tenantId: string): {
  byProductId: Record<string, number>;
  byProductName: Record<string, number>;
} {
  const items = getLocalOutbox();
  const filtered = items.filter(i => i.tenantId === tenantId);

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

export const getPendingOutboxStockDeltas = getPendingStockDeltas;

let isFlushing = false;

// Flush and sync all queued outbox actions to the backend API (Cloud AppSync or Local REST)
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

        if (isAppSyncConfigured()) {
          if (product) {
            await graphqlRequest(
              `mutation OutboxCreateProduct($input: CreateProductInput!) {
                createProduct(input: $input) { id }
              }`,
              { input: product },
              token
            );
          }
          if (inventory) {
            await graphqlRequest(
              `mutation OutboxCreateInventory($productId: String!, $productName: String, $stockQty: Float!, $lowStockThreshold: Float, $unit: String, $mode: String) {
                createInventoryItem(productId: $productId, productName: $productName, stockQty: $stockQty, lowStockThreshold: $lowStockThreshold, unit: $unit, mode: $mode) { id }
              }`,
              inventory,
              token
            );
          }
        } else {
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
        }
      } else if (item.actionType === 'create_transaction') {
        if (isAppSyncConfigured()) {
          try {
            await graphqlRequest(
              `mutation OutboxCreateTransaction($input: CreateTransactionInput!) {
                createTransaction(input: $input) { id }
              }`,
              { input: item.payload },
              token
            );
          } catch (gqlErr: any) {
            const msg = gqlErr?.message || '';
            // If the transaction was already created by another node or previous partial flush, treat as success
            if (!msg.includes('already exists') && !msg.includes('ConditionalCheckFailed')) {
              throw gqlErr;
            }
          }
        } else {
          const res = await fetch(`${API_URL}/api/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(item.payload),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            if (res.status !== 409 && !errData.message?.includes('already exists')) {
              throw new Error(errData.message || `Transaction sync failed (${res.status})`);
            }
          }
        }
      } else if (item.actionType === 'return_transaction') {
        const { transactionId, items: returnItems, returnReason } = item.payload;
        if (isAppSyncConfigured()) {
          await graphqlRequest(
            `mutation OutboxProcessReturn($input: ProcessReturnInput!) {
              processReturn(input: $input) { success }
            }`,
            { input: { transactionId, items: returnItems, returnReason } },
            token
          );
        } else {
          await fetch(`${API_URL}/api/transactions/${transactionId}/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ items: returnItems, returnReason }),
          });
        }
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
      break; // Pause remaining flushes until network stabilizes
    }
  }

  // Update outbox storage with items that failed and need subsequent retry
  saveLocalOutbox(remainingItems);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pointe-outbox-changed', { detail: { count: remainingItems.length } }));
  }

  isFlushing = false;
  return { success: successCount, failed: failedCount };
}

// Auto-flush listener: initiates drain whenever connection transitions from offline to online
export function startOutboxAutoSync(getToken?: () => string | null): () => void {
  const unsubscribe = onConnectionChange((online) => {
    if (online) {
      const token = getToken ? getToken() : (getStoredSession()?.token || null);
      if (token) {
        console.log('[outbox] Cloud connection detected, draining offline queue...');
        void flushOutbox(token);
      }
    }
  });

  return unsubscribe;
}

export const startOutboxAutoFlush = startOutboxAutoSync;

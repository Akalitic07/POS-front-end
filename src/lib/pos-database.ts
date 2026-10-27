import { createRxDatabase, removeRxDatabase, RxDatabase, RxCollection } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import type { UserSession } from './api';

export interface PosProduct {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  description: string;
  imageUrl: string;
  isActive: boolean;
  updatedAt: string;
  _deleted: boolean;
}

export interface PosInventory {
  id: string;
  tenantId: string;
  productId: string;
  productName: string;
  stockQty: number;
  lowStockThreshold: number;
  unit: string;
  updatedAt: string;
  _deleted: boolean;
}

export interface PosTransactionItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  returnedQuantity?: number;
}

export interface PosReturnedItemEntry {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  refundAmount: number;
  returnedAt: string;
}

export interface PosTransaction {
  id: string;
  tenantId: string;
  operatorId: string;
  operatorName: string;
  items: PosTransactionItem[];
  subtotal: number;
  discount?: {
    type: "percent" | "fixed";
    value: number;
    amount: number;
  } | null;
  tax: number;
  total: number;
  refundAmount?: number | null;
  netTotal?: number | null;
  paymentMethod: string;
  cashGiven?: number | null;
  changeDue?: number | null;
  status: string;
  receiptNumber: string;
  returnedAt?: string | null;
  returnReason?: string | null;
  returnedItems?: PosReturnedItemEntry[];
  createdAt: string;
  updatedAt: string;
  _deleted: boolean;
}

export interface PosCartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PosCart {
  id: string;
  tenantId: string;
  operatorId: string;
  items: PosCartItem[];
  updatedAt: string;
}

export interface PosSession {
  id: string;
  token: string;
  user: UserSession;
  createdAt: string;
}

export interface PosOutboxItem {
  id: string;
  tenantId: string;
  operatorId: string;
  actionType: "create_product" | "create_transaction" | "return_transaction";
  payload: any;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  retryCount: number;
}

let dbPromise: Promise<RxDatabase | null> | null = null;

export async function getPosDatabase(): Promise<RxDatabase | null> {
  if (typeof window === 'undefined') return null;

  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await createRxDatabase({
          name: 'pointe-pos',
          storage: getRxStorageDexie()
        });

        await db.addCollections({
          sessions: {
            schema: {
              title: "session",
              version: 0,
              primaryKey: "id",
              type: "object",
              properties: {
                id: { type: "string", maxLength: 128 },
                token: { type: "string" },
                user: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    email: { type: "string" },
                    role: { type: "string" },
                    tenantId: { type: "string" },
                    tenantName: { type: "string" }
                  },
                  required: ["id", "name", "role"]
                },
                createdAt: { type: "string" }
              },
              required: ["id", "token", "user", "createdAt"]
            }
          },
          products: {
            schema: {
              title: "product",
              version: 0,
              primaryKey: "id",
              type: "object",
              properties: {
                id: { type: "string", maxLength: 128 },
                tenantId: { type: "string", maxLength: 128 },
                name: { type: "string" },
                sku: { type: "string" },
                category: { type: "string" },
                price: { type: "number" },
                description: { type: "string" },
                imageUrl: { type: "string" },
                isActive: { type: "boolean" },
                updatedAt: { type: "string", maxLength: 64 },
                _deleted: { type: "boolean" }
              },
              required: ["id", "tenantId", "name", "price", "updatedAt", "_deleted"],
              indexes: [["tenantId"], ["updatedAt"]]
            }
          },
          inventory: {
            schema: {
              title: "inventory",
              version: 0,
              primaryKey: "id",
              type: "object",
              properties: {
                id: { type: "string", maxLength: 128 },
                tenantId: { type: "string", maxLength: 128 },
                productId: { type: "string", maxLength: 128 },
                productName: { type: "string" },
                stockQty: { type: "number" },
                lowStockThreshold: { type: "number" },
                unit: { type: "string" },
                updatedAt: { type: "string", maxLength: 64 },
                _deleted: { type: "boolean" }
              },
              required: ["id", "tenantId", "productId", "stockQty", "updatedAt", "_deleted"],
              indexes: [["tenantId"], ["updatedAt"]]
            }
          },
          transactions: {
            schema: {
              title: "transaction",
              version: 0,
              primaryKey: "id",
              type: "object",
              properties: {
                id: { type: "string", maxLength: 128 },
                tenantId: { type: "string", maxLength: 128 },
                operatorId: { type: "string" },
                operatorName: { type: "string" },
                items: {
                  type: "array",
                  items: { type: "object" }
                },
                subtotal: { type: "number" },
                discount: { type: ["object", "null"] },
                tax: { type: "number" },
                total: { type: "number" },
                paymentMethod: { type: "string" },
                cashGiven: { type: ["number", "null"] },
                changeDue: { type: ["number", "null"] },
                status: { type: "string" },
                receiptNumber: { type: "string", maxLength: 128 },
                refundAmount: { type: ["number", "null"] },
                netTotal: { type: ["number", "null"] },
                returnedAt: { type: ["string", "null"] },
                returnReason: { type: ["string", "null"] },
                returnedItems: {
                  type: "array",
                  items: { type: "object" }
                },
                createdAt: { type: "string" },
                updatedAt: { type: "string", maxLength: 64 },
                _deleted: { type: "boolean" }
              },
              required: ["id", "tenantId", "operatorId", "items", "total", "receiptNumber", "updatedAt", "_deleted"],
              indexes: [["tenantId"], ["updatedAt"], ["receiptNumber"]]
            }
          },
          cart: {
            schema: {
              title: "cart",
              version: 0,
              primaryKey: "id",
              type: "object",
              properties: {
                id: { type: "string", maxLength: 128 },
                tenantId: { type: "string", maxLength: 128 },
                operatorId: { type: "string" },
                items: {
                  type: "array",
                  items: { type: "object" }
                },
                updatedAt: { type: "string", maxLength: 64 }
              },
              required: ["id", "tenantId", "items", "updatedAt"]
            }
          },
          outbox: {
            schema: {
              title: "outbox",
              version: 0,
              primaryKey: "id",
              type: "object",
              properties: {
                id: { type: "string", maxLength: 128 },
                tenantId: { type: "string", maxLength: 128 },
                operatorId: { type: "string" },
                actionType: { type: "string", maxLength: 64 },
                payload: { type: "object" },
                createdAt: { type: "string" },
                status: { type: "string", maxLength: 32 },
                retryCount: { type: "number" }
              },
              required: ["id", "tenantId", "actionType", "payload", "createdAt", "status"]
            }
          }
        });
        return db;
      } catch (err) {
        console.warn("Could not initialise RxDB database, attempting recreation:", err);
        try {
          await removeRxDatabase('pointe-pos', getRxStorageDexie());
          dbPromise = null;
          return getPosDatabase();
        } catch (removeErr) {
          console.error("Failed to remove RxDB database:", removeErr);
          return null;
        }
      }
    })();
  }
  return dbPromise;
}

export async function destroyPosDatabase(): Promise<void> {
  const db = await getPosDatabase();
  if (db) {
    try {
      await db.close();
    } catch (e) {
      console.warn("Error closing DB:", e);
    }
  }
  dbPromise = null;
}

"use client";

import { useEffect, useState, useCallback, useMemo, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePosDatabase } from "@/context/DatabaseContext";
import { postJson, getJson } from "@/lib/api";
import { DashboardHeader } from "@/components/ui/DashboardHeader";
import { StatCard } from "@/components/ui/StatCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { Sidebar } from "@/components/layout/Sidebar";
import { Modal } from "@/components/ui/Modal";
import { getPosDatabase, type PosProduct, type PosInventory, type PosTransaction, type PosCartItem, type PosTransactionItem } from "@/lib/pos-database";
import { queueOfflineAction, flushOutbox, getPendingOutboxCount, getPendingOutboxIds, getPendingOutboxStockDeltas } from "@/lib/sync-outbox";

function OperatorDashboardContent() {
  const { user, token, loading } = useAuth();
  const { db, isOnline, dbReady } = usePosDatabase();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Navigation tab: counter register vs sales history vs exchange/returns (synced with ?tab= query param)
  const urlTab = searchParams.get("tab") === "returns" ? "returns" : searchParams.get("tab") === "sales" ? "sales" : "register";
  const [operatorTab, setOperatorTab] = useState<"register" | "sales" | "returns">(urlTab);

  useEffect(() => {
    const currentParam = searchParams.get("tab");
    if (currentParam === "returns") {
      setOperatorTab("returns");
    } else if (currentParam === "sales") {
      setOperatorTab("sales");
    } else if (currentParam === "register") {
      setOperatorTab("register");
    }
  }, [searchParams]);

  const switchOperatorTab = (tab: "register" | "sales" | "returns") => {
    setOperatorTab(tab);
    router.replace(`/dashboard/operator?tab=${tab}`, { scroll: false });
  };

  // State
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [transactions, setTransactions] = useState<PosTransaction[]>([]);
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [cartNotice, setCartNotice] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Payment & Discount State
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("card");
  const [cashGiven, setCashGiven] = useState<string>("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [showDiscountInput, setShowDiscountInput] = useState(false);

  // Return Items & Refunds State (Supports item-level partial quantity returns, e.g. buy 3 units, return 1 unit)
  const [returnRcpSearch, setReturnRcpSearch] = useState("");
  const [searchedReturnTxn, setSearchedReturnTxn] = useState<PosTransaction | null>(null);
  const [returnSearchError, setReturnSearchError] = useState("");
  const [returnSuccessMsg, setReturnSuccessMsg] = useState("");
  const [returnReason, setReturnReason] = useState("Customer requested return/refund");
  const [processingReturn, setProcessingReturn] = useState(false);

  // Return quantities selected per item index: { [itemIdx]: quantityToReturn }
  const [returnItemQuantities, setReturnItemQuantities] = useState<Record<number, number>>({});

  // Initialize return quantities when receipt is loaded (defaults to eligible units)
  useEffect(() => {
    if (searchedReturnTxn?.items) {
      const initial: Record<number, number> = {};
      searchedReturnTxn.items.forEach((it, idx) => {
        const alreadyReturned = Number(it.returnedQuantity) || 0;
        const maxReturnable = Math.max(0, it.quantity - alreadyReturned);
        initial[idx] = maxReturnable;
      });
      setReturnItemQuantities(initial);
    } else {
      setReturnItemQuantities({});
    }
  }, [searchedReturnTxn]);

  const [processingSale, setProcessingSale] = useState(false);
  const [completedTxn, setCompletedTxn] = useState<PosTransaction | null>(null);
  const [lastCompletedSale, setLastCompletedSale] = useState<PosTransaction | null>(null);
  
  // Sales History Tab Filters
  const [salesSearch, setSalesSearch] = useState("");
  const [salesFilterStatus, setSalesFilterStatus] = useState<"all" | "completed" | "returned" | "partially_returned">("all");
  const [salesScope, setSalesScope] = useState<"my_sales" | "store_sales">("my_sales");
  const [pendingOutboxCount, setPendingOutboxCount] = useState<number>(0);

  const updateOutboxStatus = useCallback(() => {
    setPendingOutboxCount(getPendingOutboxCount(user?.tenantId));
  }, [user?.tenantId]);

  useEffect(() => {
    updateOutboxStatus();
    const interval = setInterval(updateOutboxStatus, 4000);
    return () => clearInterval(interval);
  }, [updateOutboxStatus]);

  // Add Product to Inventory Modal State
  const [addProdModalOpen, setAddProdModalOpen] = useState(false);
  const [newProdName, setNewProdName] = useState("");
  const [newProdSku, setNewProdSku] = useState("");
  const [newProdCategory, setNewProdCategory] = useState("Beverages");
  const [newProdPrice, setNewProdPrice] = useState("");
  const [newProdStock, setNewProdStock] = useState("50");
  const [newProdLowStock, setNewProdLowStock] = useState("5");
  const [newProdUnit, setNewProdUnit] = useState("pcs");
  const [addingProd, setAddingProd] = useState(false);
  const [addProdError, setAddProdError] = useState("");

  // Quick Restock Modal State
  const [restockModalOpen, setRestockModalOpen] = useState(false);
  const [restockTargetProd, setRestockTargetProd] = useState<PosProduct | null>(null);
  const [restockUnitsToAdd, setRestockUnitsToAdd] = useState("20");
  const [restocking, setRestocking] = useState(false);
  const [restockError, setRestockError] = useState("");

  // Auth guard — Operator only
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "Operator") {
      router.replace("/dashboard");
      return;
    }
  }, [user, loading, router]);

  // ─── Dual-Layer Storage & Sanitization Helpers ──────────────────────────────
  const getCatalogCacheKey = (tenantId: string) => `pointe_offline_catalog_${tenantId}`;
  const getInventoryCacheKey = (tenantId: string) => `pointe_offline_inventory_${tenantId}`;

  const loadLocalCachedCatalog = (tenantId: string): { products: PosProduct[]; inventory: Record<string, number> } => {
    if (typeof window === "undefined" || !tenantId) return { products: [], inventory: {} };
    try {
      const rawProd = localStorage.getItem(getCatalogCacheKey(tenantId));
      const rawInv = localStorage.getItem(getInventoryCacheKey(tenantId));
      const products: PosProduct[] = rawProd ? JSON.parse(rawProd) : [];
      const inventory: Record<string, number> = rawInv ? JSON.parse(rawInv) : {};
      return { products, inventory };
    } catch (err) {
      console.warn("Failed to read catalog cache from localStorage:", err);
      return { products: [], inventory: {} };
    }
  };

  const saveLocalCachedCatalog = (tenantId: string, products: PosProduct[], inventory: Record<string, number>) => {
    if (typeof window === "undefined" || !tenantId) return;
    try {
      localStorage.setItem(getCatalogCacheKey(tenantId), JSON.stringify(products));
      localStorage.setItem(getInventoryCacheKey(tenantId), JSON.stringify(inventory));
    } catch (err) {
      console.warn("Failed to save catalog cache to localStorage:", err);
    }
  };

  const sanitizeProductDoc = (p: any, tenantId: string): PosProduct => {
    return {
      id: String(p.id || `PROD-${Date.now()}`),
      tenantId: String(p.tenantId || tenantId),
      name: String(p.name || "Product").trim(),
      sku: String(p.sku || "").trim(),
      category: String(p.category || "General").trim(),
      price: Number(p.price) || 0,
      description: String(p.description || "").trim(),
      imageUrl: String(p.imageUrl || "").trim(),
      isActive: p.isActive !== false,
      updatedAt: p.updatedAt ? String(p.updatedAt) : new Date().toISOString(),
      _deleted: Boolean(p._deleted),
    };
  };

  const sanitizeInventoryDoc = (i: any, tenantId: string): PosInventory => {
    const rawProdId = String(i.productId || i.id || "").replace(/^INV-/, "");
    return {
      id: String(i.id || `INV-${rawProdId}`),
      tenantId: String(i.tenantId || tenantId),
      productId: rawProdId,
      productName: String(i.productName || "").trim(),
      stockQty: Math.max(0, Number(i.stockQty) || 0),
      lowStockThreshold: Number(i.lowStockThreshold) || 5,
      unit: String(i.unit || "pcs").trim(),
      updatedAt: i.updatedAt ? String(i.updatedAt) : new Date().toISOString(),
      _deleted: Boolean(i._deleted),
    };
  };

  // Robust multi-key RxDB inventory updater/inserter
  const updateLocalRxDbStock = async (
    localDb: any,
    tenantId: string,
    productId: string,
    productName: string,
    qtyDelta: number,
    currentFallbackStock: number
  ) => {
    if (!localDb?.inventory) return;
    try {
      const now = new Date().toISOString();
      const allInvs = await localDb.inventory.find({ selector: { tenantId } }).exec();
      const normName = productName ? productName.trim().toLowerCase() : "";

      const matchingDocs = allInvs.filter((d: any) => {
        const dId = d.get("id");
        const dProdId = d.get("productId");
        const dName = d.get("productName")?.trim().toLowerCase();
        return (
          dId === `INV-${productId}` ||
          dId === productId ||
          dProdId === productId ||
          (normName && dName === normName)
        );
      });

      if (matchingDocs.length > 0) {
        for (const doc of matchingDocs) {
          const raw = doc.get("stockQty");
          const current = (typeof raw === "number" && !isNaN(raw)) ? raw : currentFallbackStock;
          const updated = Math.max(0, current + qtyDelta);
          await doc.patch({
            stockQty: updated,
            updatedAt: now,
          });
        }
      } else {
        const updated = Math.max(0, currentFallbackStock + qtyDelta);
        await localDb.inventory.insert(sanitizeInventoryDoc({
          id: `INV-${productId}`,
          tenantId,
          productId,
          productName,
          stockQty: updated,
          lowStockThreshold: 5,
          unit: "pcs",
          updatedAt: now,
          _deleted: false,
        }, tenantId));
      }
    } catch (err) {
      console.warn("Failed to update local RxDB stock:", err);
    }
  };

  // Synchronous mount hydration: Read from localStorage immediately so register has catalog & stock even before RxDB boots
  useEffect(() => {
    if (user?.tenantId) {
      const cached = loadLocalCachedCatalog(user.tenantId);
      if (cached.products.length > 0) {
        setProducts(cached.products);
        setInventory(cached.inventory);
      }
    }
  }, [user?.tenantId]);

  // Load products, inventory, and transactions from RxDB and/or Online API
  const refreshData = useCallback(async () => {
    const activeTenantId = user?.tenantId;
    if (!activeTenantId) return;

    let loadedProducts: PosProduct[] = [];
    let invMap: Record<string, number> = {};
    let localTxns: PosTransaction[] = [];

    // 0. Seed with durable synchronous local cache first to prevent any flicker or blank state
    const cached = loadLocalCachedCatalog(activeTenantId);
    if (cached.products.length > 0) {
      loadedProducts = [...cached.products];
      invMap = { ...cached.inventory };
    }

    // 1. Read from local RxDB if ready
    if (db) {
      try {
        const productDocs = await db.products
          .find({
            selector: {
              tenantId: activeTenantId,
            },
          })
          .exec();
        const validLocalProds = productDocs
          .map((doc: any) => doc.toJSON() as PosProduct)
          .filter((p: PosProduct) => !p._deleted);

        if (validLocalProds.length > 0) {
          const localMap = new Map(loadedProducts.map((p) => [p.id, p]));
          validLocalProds.forEach((p) => localMap.set(p.id, p));
          loadedProducts = Array.from(localMap.values());
        }

        const invDocs = await db.inventory
          .find({
            selector: {
              tenantId: activeTenantId,
            },
          })
          .exec();
        invDocs.forEach((doc: any) => {
          const item = doc.toJSON() as PosInventory;
          if (!item._deleted) {
            if (item.productId) invMap[item.productId] = item.stockQty;
            if (item.productName) invMap[item.productName.trim().toLowerCase()] = item.stockQty;
          }
        });

        const txnDocs = await db.transactions
          .find({
            selector: {
              tenantId: activeTenantId,
            },
          })
          .exec();
        localTxns = txnDocs
          .map((doc: any) => doc.toJSON() as PosTransaction)
          .filter((t: PosTransaction) => !t._deleted);
        localTxns.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setTransactions(localTxns);
      } catch (err) {
        console.warn("Failed to load POS data from RxDB:", err);
      }
    }

    // 2. Online Direct Fallback / Hydration:
    // When online, fetch fresh data directly from server to guarantee instant catalog display & sales history
    if (isOnline && token) {
      try {
        // If there are pending outbox actions, flush them FIRST so DynamoDB decrements atomically before we fetch!
        if (getPendingOutboxCount(activeTenantId) > 0) {
          await flushOutbox(token);
          updateOutboxStatus();
        }

        const [prodRes, invRes, txnRes] = await Promise.all([
          getJson<{ products: PosProduct[] }>("/api/products", token).catch(() => null),
          getJson<{ inventory: PosInventory[] }>("/api/inventory", token).catch(() => null),
          getJson<{ transactions: PosTransaction[] }>("/api/transactions", token).catch(() => null),
        ]);

        const { productIds: pendingProdIds, inventoryIds: pendingInvIds } = getPendingOutboxIds(activeTenantId);

        if (prodRes?.products) {
          const serverProducts = prodRes.products.map((p) => sanitizeProductDoc(p, activeTenantId));
          const onlineIds = new Set(serverProducts.map((p) => p.id));

          // Merge server products with local products that are pending in the outbox
          const mergedProductsMap = new Map<string, PosProduct>();
          serverProducts.forEach((p) => mergedProductsMap.set(p.id, p));
          loadedProducts.forEach((p) => {
            if (!mergedProductsMap.has(p.id) && pendingProdIds.has(p.id)) {
              mergedProductsMap.set(p.id, p);
            }
          });
          loadedProducts = Array.from(mergedProductsMap.values());

          if (db) {
            // Delete only if NOT in onlineIds AND NOT in pending outbox
            const localDocs = await db.products
              .find({ selector: { tenantId: activeTenantId } })
              .exec();
            for (const doc of localDocs) {
              if (!onlineIds.has(doc.id) && !pendingProdIds.has(doc.id)) {
                try {
                  await doc.patch({ _deleted: true, updatedAt: new Date().toISOString() });
                } catch {}
              }
            }
            // Upsert sanitized server products into RxDB
            for (const p of serverProducts) {
              try {
                const existing = await db.products.findOne({ selector: { id: p.id } }).exec();
                if (existing) await existing.patch(p);
                else await db.products.insert(p);
              } catch (rxErr) {
                console.warn("RxDB product upsert notice:", rxErr);
              }
            }
          }
        }

        if (invRes?.inventory) {
          const serverInvs = invRes.inventory.map((i) => sanitizeInventoryDoc(i, activeTenantId));
          const onlineInvIds = new Set(serverInvs.map((i) => i.id));

          serverInvs.forEach((item) => {
            if (item.productId) invMap[item.productId] = item.stockQty;
            if (item.productName) invMap[item.productName.trim().toLowerCase()] = item.stockQty;
          });

          // Overlay any STILL pending outbox deltas (sales, returns, restocks) onto server stock
          const pendingDeltas = getPendingOutboxStockDeltas(activeTenantId);
          Object.entries(pendingDeltas.byProductId).forEach(([prodId, delta]) => {
            if (invMap[prodId] !== undefined) {
              invMap[prodId] = Math.max(0, invMap[prodId] + delta);
            }
          });
          Object.entries(pendingDeltas.byProductName).forEach(([nameKey, delta]) => {
            if (invMap[nameKey] !== undefined) {
              invMap[nameKey] = Math.max(0, invMap[nameKey] + delta);
            }
          });

          if (db) {
            const localInvs = await db.inventory
              .find({ selector: { tenantId: activeTenantId } })
              .exec();
            for (const doc of localInvs) {
              const item = doc.toJSON() as PosInventory;
              if (!onlineInvIds.has(doc.id) && !pendingInvIds.has(doc.id) && !pendingInvIds.has(item.productId)) {
                try {
                  await doc.patch({ _deleted: true, updatedAt: new Date().toISOString() });
                } catch {}
              }
            }
            for (const i of serverInvs) {
              try {
                const adjustedQty =
                  invMap[i.productId] ??
                  (i.productName ? invMap[i.productName.trim().toLowerCase()] : undefined) ??
                  i.stockQty;
                const docToWrite = { ...i, stockQty: adjustedQty };
                const existing = await db.inventory.findOne({ selector: { id: i.id } }).exec();
                if (existing) await existing.patch(docToWrite);
                else await db.inventory.insert(docToWrite);
              } catch (rxErr) {
                console.warn("RxDB inventory upsert notice:", rxErr);
              }
            }
          }
        }

        if (txnRes?.transactions) {
          if (db) {
            for (const t of txnRes.transactions) {
              try {
                const existing = await db.transactions.findOne({ selector: { id: t.id } }).exec();
                if (existing) await existing.patch(t);
                else await db.transactions.insert(t);
              } catch {}
            }
          }
          const localOnly = localTxns.filter((lt: PosTransaction) => !txnRes.transactions.some((st) => st.id === lt.id));
          const allMerged = [...localOnly, ...txnRes.transactions];
          allMerged.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
          setTransactions(allMerged);
        }
      } catch (apiErr) {
        console.warn("Online catalog fetch notice:", apiErr);
      }
    }

    // Ensure all products have their stock mapped (match by ID or fallback by name)
    loadedProducts.forEach((p) => {
      if (invMap[p.id] === undefined && p.name) {
        const nameKey = p.name.trim().toLowerCase();
        if (invMap[nameKey] !== undefined) {
          invMap[p.id] = invMap[nameKey];
        }
      }
    });

    // Save final merged state to durable synchronous cache
    saveLocalCachedCatalog(activeTenantId, loadedProducts, invMap);

    setProducts(loadedProducts);
    setInventory(invMap);
  }, [db, user?.tenantId, isOnline, token]);

  // Initial load
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Periodic background poll to synchronize catalog updates & deletions from SubAdmin
  useEffect(() => {
    const timer = setInterval(() => {
      refreshData();
    }, 10000);
    return () => clearInterval(timer);
  }, [refreshData]);

  useEffect(() => {
    if (dbReady && db) {
      refreshData();

      // Subscribe to changes in collections for real-time reactivity
      const subProducts = db.products.$.subscribe(() => refreshData());
      const subInventory = db.inventory.$.subscribe(() => refreshData());
      const subTxns = db.transactions.$.subscribe(() => refreshData());

      return () => {
        subProducts.unsubscribe();
        subInventory.unsubscribe();
        subTxns.unsubscribe();
      };
    }
  }, [dbReady, db, refreshData]);

  const showNotice = (msg: string) => {
    setCartNotice(msg);
    setTimeout(() => setCartNotice(""), 4500);
  };

  // Cart operations
  const addToCart = (product: PosProduct) => {
    let currentStock = inventory[product.id];
    if (currentStock === undefined && product.name) {
      currentStock = inventory[product.name.trim().toLowerCase()];
    }
    const availableStock = currentStock ?? 0;
    const existing = cart.find((item) => item.productId === product.id);

    if (existing && existing.quantity >= availableStock) {
      showNotice(`Cannot add more than available stock (${availableStock} available)`);
      return;
    }
    if (!existing && availableStock <= 0) {
      showNotice("This item is currently out of stock. Tap +Stock to restock.");
      return;
    }

    if (existing) {
      setCart((prev) =>
        prev.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
                lineTotal: Number(((item.quantity + 1) * item.unitPrice).toFixed(2)),
              }
            : item
        )
      );
    } else {
      setCart((prev) => [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price,
          lineTotal: Number(product.price.toFixed(2)),
        },
      ]);
    }
    showNotice(`✓ Added 1x "${product.name}" to cart.`);
  };

  const updateCartQty = (productId: string, delta: number) => {
    const itemInCart = cart.find((item) => item.productId === productId);
    const nameKey = itemInCart?.productName?.trim().toLowerCase();
    const currentStock =
      inventory[productId] ??
      (nameKey ? inventory[nameKey] : undefined) ??
      0;
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.productId === productId) {
            const newQty = item.quantity + delta;
            if (newQty > currentStock) {
              showNotice(`Maximum stock reached (${currentStock} available)`);
              return item;
            }
            return newQty > 0
              ? {
                  ...item,
                  quantity: newQty,
                  lineTotal: Number((newQty * item.unitPrice).toFixed(2)),
                }
              : null;
          }
          return item;
        })
        .filter(Boolean) as PosCartItem[]
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setDiscountValue("");
    setCashGiven("");
    setShowDiscountInput(false);
  };

  // ─── Price & Discount Calculations ──────────────────────────────────────────
  const subtotal = Number(cart.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  
  let discountAmount = 0;
  const rawDiscountVal = parseFloat(discountValue) || 0;
  const numDiscountVal = Math.max(0, rawDiscountVal);
  if (numDiscountVal > 0 && subtotal > 0) {
    if (discountType === "percent") {
      const clampedPercent = Math.min(100, numDiscountVal);
      discountAmount = (subtotal * clampedPercent) / 100;
    } else {
      discountAmount = Math.min(subtotal, numDiscountVal);
    }
    discountAmount = Number(discountAmount.toFixed(2));
  }

  const discountedSubtotal = Math.max(0, Number((subtotal - discountAmount).toFixed(2)));
  const tax = 0; // Tax calculation removed from operator bill calculation
  const grandTotal = discountedSubtotal;

  // Cash payment calculation:
  // The operator MUST explicitly enter the cash given by the customer before completing the sale.
  // The price entered must NOT be less than grandTotal.
  const rawCashGiven = parseFloat(cashGiven);
  const hasCashEntered = cashGiven.trim() !== "" && !isNaN(rawCashGiven) && rawCashGiven > 0;
  const cashGivenAmount = hasCashEntered ? rawCashGiven : 0;
  const isCashSufficient = paymentMethod === "cash"
    ? (grandTotal === 0 || (hasCashEntered && cashGivenAmount >= grandTotal))
    : true;
  const changeDue = hasCashEntered && cashGivenAmount >= grandTotal
    ? Math.max(0, Number((cashGivenAmount - grandTotal).toFixed(2)))
    : 0;
  const cashShortfall = hasCashEntered && cashGivenAmount < grandTotal
    ? Number((grandTotal - cashGivenAmount).toFixed(2))
    : grandTotal;

  // ─── O(1) Fast Hash-Map for Receipt Lookup ──────────────────────────────────
  const receiptMap = useMemo(() => {
    const map = new Map<string, PosTransaction>();
    transactions.forEach((tx) => {
      if (tx.receiptNumber) {
        map.set(tx.receiptNumber.trim().toUpperCase(), tx);
      }
    });
    return map;
  }, [transactions]);

  // Handle Receipt Search (O(1) with smart query normalization)
  const handleSearchReceipt = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const raw = returnRcpSearch.trim();
    if (!raw) {
      setReturnSearchError("Please enter a receipt number (e.g. RCP-123456 or 123456).");
      setSearchedReturnTxn(null);
      return;
    }

    setReturnSearchError("");
    setReturnSuccessMsg("");

    const upper = raw.toUpperCase();
    const withRcp = upper.startsWith("RCP-") ? upper : `RCP-${upper}`;

    // 1. O(1) in-memory lookup
    let local = receiptMap.get(upper) || receiptMap.get(withRcp);
    if (!local) {
      local = transactions.find(
        (t) =>
          t.receiptNumber?.toUpperCase() === upper ||
          t.receiptNumber?.toUpperCase() === withRcp ||
          t.id?.toUpperCase() === upper
      );
    }

    if (local) {
      setSearchedReturnTxn(local);
      return;
    }

    // 2. Direct online API fallback
    if (isOnline && token) {
      const queriesToTry = [upper];
      if (withRcp !== upper) queriesToTry.push(withRcp);

      for (const q of queriesToTry) {
        try {
          const res = await getJson<{ transaction: PosTransaction }>(
            `/api/transactions/receipt/${encodeURIComponent(q)}`,
            token
          );
          if (res?.transaction) {
            setSearchedReturnTxn(res.transaction);
            return;
          }
        } catch {}
      }
    }

    setReturnSearchError(`No transaction found for "${raw}". Verify the number on the customer's slip.`);
    setSearchedReturnTxn(null);
  };

  // ─── Process Return / Refund (Supports partial item quantities) ──────────────
  const handleProcessReturn = async (txn: PosTransaction) => {
    if (!user?.tenantId) {
      showNotice("Session error: Missing tenant ID. Please log in again.");
      return;
    }
    if (txn.status === "returned") {
      showNotice("This transaction has already been fully refunded and returned.");
      return;
    }

    // Build the list of items with quantity > 0 selected for return
    const itemsToReturn = txn.items
      .map((it, idx) => {
        const qty = returnItemQuantities[idx] || 0;
        return qty > 0 ? { ...it, quantity: qty } : null;
      })
      .filter(Boolean) as (PosTransactionItem & { quantity: number })[];

    if (itemsToReturn.length === 0) {
      setReturnSearchError("Please select at least 1 unit of an item to return.");
      return;
    }

    setProcessingReturn(true);
    setReturnSearchError("");
    setReturnSuccessMsg("");

    try {
      const now = new Date().toISOString();

      const taxRatio = (txn.tax && txn.subtotal > 0) ? (txn.total / txn.subtotal) : 1;
      const calculatedRefund = itemsToReturn.reduce((s, it) => s + (it.quantity * it.unitPrice * taxRatio), 0);
      const priorRefund = Number(txn.refundAmount) || 0;
      const totalRefund = priorRefund + calculatedRefund;
      const newNetTotal = Math.max(0, (txn.total || 0) - totalRefund);
      const isFullyReturned = newNetTotal === 0 || (txn.items.every(it => {
        const returnedSoFar = (it.returnedQuantity || 0) + (itemsToReturn.find(r => r.productId === it.productId)?.quantity || 0);
        return returnedSoFar >= it.quantity;
      }));

      const updatedTxn: PosTransaction = {
        ...txn,
        status: isFullyReturned ? "returned" : "partial_return",
        refundAmount: totalRefund,
        netTotal: newNetTotal,
        returnedAt: now,
        returnReason,
        updatedAt: now,
      };

      // 1. OFFLINE DB FIRST: Update local RxDB IndexedDB & Local Storage Cache immediately
      try {
        const localDb = db || (await getPosDatabase().catch(() => null));
        if (localDb?.inventory) {
          for (const item of itemsToReturn) {
            const currentStock =
              inventory[item.productId] ??
              (item.productName ? inventory[item.productName.trim().toLowerCase()] : undefined) ??
              0;
            await updateLocalRxDbStock(
              localDb,
              user.tenantId,
              item.productId,
              item.productName,
              item.quantity,
              currentStock
            );
          }
        }

        if (localDb?.transactions) {
          const txnDoc = await localDb.transactions
            .findOne({
              selector: { id: txn.id },
            })
            .exec();

          if (txnDoc) {
            await txnDoc.patch({
              status: updatedTxn.status,
              refundAmount: updatedTxn.refundAmount,
              netTotal: updatedTxn.netTotal,
              returnedAt: now,
              returnReason,
              updatedAt: now,
            });
          }
        }
      } catch (rxErr) {
        console.warn("Local RxDB return update warning:", rxErr);
      }

      // 2. Immediately update in-memory React state (Zero-latency UI responsiveness)
      setInventory((prev) => {
        const next = { ...prev };
        for (const item of itemsToReturn) {
          if (next[item.productId] !== undefined) {
            next[item.productId] += item.quantity;
          }
          if (item.productName) {
            const nameKey = item.productName.trim().toLowerCase();
            if (next[nameKey] !== undefined) {
              next[nameKey] += item.quantity;
            }
          }
        }
        if (user?.tenantId) {
          const cached = loadLocalCachedCatalog(user.tenantId);
          saveLocalCachedCatalog(user.tenantId, cached.products, next);
        }
        return next;
      });

      const totalItemsRestocked = itemsToReturn.reduce((s, i) => s + i.quantity, 0);
      setTransactions((prev) =>
        prev.map((t) => (t.id === txn.id ? updatedTxn : t))
      );
      setSearchedReturnTxn(updatedTxn);

      setReturnSuccessMsg(
        `✓ Return processed for ${txn.receiptNumber}! Rs. ${calculatedRefund.toFixed(2)} refunded, and ${totalItemsRestocked} unit${totalItemsRestocked > 1 ? "s" : ""} restocked into inventory.`
      );
      showNotice(`Return processed: ${totalItemsRestocked} units restocked & Rs. ${calculatedRefund.toFixed(2)} refunded.`);

      // 3. ONLINE DB SECOND: Queue into Sync Outbox & Push to Backend DynamoDB in Background
      await queueOfflineAction(user.tenantId, user.id, "return_transaction", {
        transactionId: txn.id,
        items: itemsToReturn,
        returnReason,
      });
      updateOutboxStatus();

      // If online, immediately flush outbox in background so DynamoDB & HR/SubAdmin dashboards receive the update
      if (isOnline && token) {
        flushOutbox(token).then((res) => {
          updateOutboxStatus();
          if (res.success > 0) refreshData();
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error("Return error:", err);
      setReturnSearchError(`Return failed: ${err?.message || "Unknown error"}`);
    } finally {
      setProcessingReturn(false);
    }
  };

  // ─── Process Checkout Sale ──────────────────────────────────────────────────
  const handleCheckout = async () => {
    if (cart.length === 0) {
      showNotice("Cart is empty. Please select products before completing a sale.");
      return;
    }
    if (!user?.tenantId) {
      showNotice("Session error: Missing tenant ID. Please log in again.");
      return;
    }
    // Mandatory cash payment validation:
    // Operator MUST explicitly enter the cash given by customer, and it cannot be less than grandTotal.
    if (paymentMethod === "cash" && grandTotal > 0) {
      if (!hasCashEntered) {
        showNotice(`⚠️ Cash Payment Required: Please enter the cash received from customer before completing sale.`);
        return;
      }
      if (cashGivenAmount < grandTotal) {
        showNotice(`⚠️ Insufficient Cash: Customer handed Rs. ${cashGivenAmount.toFixed(2)}, but total bill is Rs. ${grandTotal.toFixed(2)}. Short by Rs. ${cashShortfall.toFixed(2)}.`);
        return;
      }
    }

    setProcessingSale(true);

    try {
      const now = new Date().toISOString();
      const txnId = `TXN-${Date.now()}`;
      const receiptNumber = `RCP-${Math.floor(100000 + Math.random() * 900000)}`;

      const discountPayload = discountAmount > 0 ? {
        type: discountType,
        value: discountType === "percent" ? Math.min(100, numDiscountVal) : Math.min(subtotal, numDiscountVal),
        amount: discountAmount,
      } : null;

      const recordedCashGiven = paymentMethod === "cash" ? cashGivenAmount : null;
      const recordedChangeDue = paymentMethod === "cash" ? changeDue : null;

      const newTxn: PosTransaction = {
        id: txnId,
        tenantId: user.tenantId,
        operatorId: user.id,
        operatorName: user.name || "Operator",
        items: [...cart],
        subtotal,
        discount: discountPayload,
        tax,
        total: grandTotal,
        paymentMethod,
        cashGiven: recordedCashGiven,
        changeDue: recordedChangeDue,
        status: "completed",
        receiptNumber,
        createdAt: now,
        updatedAt: now,
        _deleted: false,
      };

      // 1. OFFLINE DB FIRST: Commit directly to Permanent RxDB Store & Local Storage Cache immediately
      try {
        const localDb = db || (await getPosDatabase().catch(() => null));
        if (localDb?.transactions) {
          await localDb.transactions.insert(newTxn);
        }
        if (localDb?.inventory) {
          for (const item of cart) {
            const currentStock =
              inventory[item.productId] ??
              (item.productName ? inventory[item.productName.trim().toLowerCase()] : undefined) ??
              0;
            await updateLocalRxDbStock(
              localDb,
              user.tenantId,
              item.productId,
              item.productName,
              -item.quantity,
              currentStock
            );
          }
        }
      } catch (rxErr) {
        console.warn("Local RxDB transaction write notice:", rxErr);
      }

      // 2. Immediately update in-memory React state (Zero-latency UI updates) & durable local cache
      setInventory((prev) => {
        const next = { ...prev };
        for (const item of cart) {
          if (next[item.productId] !== undefined) {
            next[item.productId] = Math.max(0, next[item.productId] - item.quantity);
          }
          if (item.productName) {
            const nameKey = item.productName.trim().toLowerCase();
            if (next[nameKey] !== undefined) {
              next[nameKey] = Math.max(0, next[nameKey] - item.quantity);
            }
          }
        }
        if (user?.tenantId) {
          const cached = loadLocalCachedCatalog(user.tenantId);
          saveLocalCachedCatalog(user.tenantId, cached.products, next);
        }
        return next;
      });

      setTransactions((prev) => [newTxn, ...prev]);
      setLastCompletedSale(newTxn);

      // Clear cart and show receipt modal instantly with zero latency
      clearCart();
      setCompletedTxn(newTxn);
      showNotice(`✓ Sale #${receiptNumber} completed successfully (Rs. ${grandTotal.toFixed(2)})!`);

      // 3. ONLINE DB SECOND: Queue into Sync Outbox & Push to Backend DynamoDB in Background
      await queueOfflineAction(user.tenantId, user.id, "create_transaction", {
        id: newTxn.id,
        items: newTxn.items,
        subtotal: newTxn.subtotal,
        discount: newTxn.discount,
        tax: newTxn.tax,
        total: newTxn.total,
        paymentMethod: newTxn.paymentMethod,
        cashGiven: newTxn.cashGiven,
        changeDue: newTxn.changeDue,
        receiptNumber: newTxn.receiptNumber,
        createdAt: newTxn.createdAt,
      });
      updateOutboxStatus();

      // If online, immediately flush outbox in background so DynamoDB & HR/SubAdmin dashboards receive the update
      if (isOnline && token) {
        flushOutbox(token).then((res) => {
          updateOutboxStatus();
          if (res.success > 0) refreshData();
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error("Sale processing error:", err);
      showNotice(`Sale failed: ${err?.message || "Unknown error"}`);
    } finally {
      setProcessingSale(false);
    }
  };

  // Add product and inventory item to catalog & stock
  const handleAddProductSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.tenantId) {
      setAddProdError("Tenant session not found. Please log in again.");
      return;
    }
    setAddProdError("");
    const priceNum = parseFloat(newProdPrice);
    const stockNum = parseInt(newProdStock, 10);
    const lowStockNum = parseInt(newProdLowStock, 10);

    if (!newProdName.trim() || isNaN(priceNum) || priceNum <= 0) {
      setAddProdError("Please enter a valid product name and positive price.");
      return;
    }

    setAddingProd(true);
    try {
      const now = new Date().toISOString();
      const skuVal = newProdSku.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
      const categoryVal = newProdCategory.trim() || "General";
      const unitVal = newProdUnit.trim() || "pcs";
      const validStock = isNaN(stockNum) || stockNum < 0 ? 0 : stockNum;
      const validLowStock = isNaN(lowStockNum) || lowStockNum <= 0 ? 5 : lowStockNum;

      // Check if product already exists (by name or SKU)
      const existingProduct = products.find(
        (p) =>
          p.name.trim().toLowerCase() === newProdName.trim().toLowerCase() ||
          (newProdSku.trim() && p.sku.trim().toLowerCase() === newProdSku.trim().toLowerCase())
      );

      const targetProdId = existingProduct ? existingProduct.id : `PROD-${Date.now()}`;
      const targetInvId = `INV-${targetProdId}`;

      let currentQty = 0;
      if (existingProduct) {
        currentQty =
          inventory[existingProduct.id] ??
          (existingProduct.name ? inventory[existingProduct.name.trim().toLowerCase()] : undefined) ??
          0;
      }
      const newTotalStock = existingProduct ? currentQty + validStock : validStock;

      let savedProd: PosProduct = {
        id: targetProdId,
        tenantId: user.tenantId,
        name: newProdName.trim(),
        sku: skuVal,
        category: categoryVal,
        price: priceNum,
        description: "",
        imageUrl: "",
        isActive: true,
        updatedAt: now,
        _deleted: false,
      };

      let savedInv: PosInventory = {
        id: targetInvId,
        tenantId: user.tenantId,
        productId: targetProdId,
        productName: newProdName.trim(),
        stockQty: newTotalStock,
        lowStockThreshold: validLowStock,
        unit: unitVal,
        updatedAt: now,
        _deleted: false,
      };

      // 1. OFFLINE DB FIRST: Commit directly to Permanent RxDB Store & Local Storage Cache immediately
      try {
        const localDb = db || (await getPosDatabase().catch(() => null));
        if (localDb) {
          const existingDoc = await localDb.products.findOne({ selector: { id: savedProd.id } }).exec();
          if (existingDoc) {
            await existingDoc.patch(savedProd);
          } else {
            await localDb.products.insert(savedProd);
          }

          const existingInv = await localDb.inventory.findOne({
            selector: { tenantId: user.tenantId, productId: savedProd.id },
          }).exec();
          if (existingInv) {
            await existingInv.patch(savedInv);
          } else {
            await localDb.inventory.insert(savedInv);
          }
        }
      } catch (rxErr) {
        console.warn("Local RxDB storage notice:", rxErr);
      }

      // 2. Immediately update in-memory React state so card displays with 0ms latency & update durable local cache
      setProducts((prev) => {
        const idx = prev.findIndex(
          (p) =>
            p.id === savedProd.id ||
            p.name.trim().toLowerCase() === savedProd.name.trim().toLowerCase()
        );
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = savedProd;
          return copy;
        }
        return [savedProd, ...prev];
      });

      setInventory((prev) => ({
        ...prev,
        [savedProd.id]: savedInv.stockQty,
        [savedProd.name.trim().toLowerCase()]: savedInv.stockQty,
      }));

      if (user?.tenantId) {
        const currentCache = loadLocalCachedCatalog(user.tenantId);
        const idx = currentCache.products.findIndex(
          (p) =>
            p.id === savedProd.id ||
            p.name.trim().toLowerCase() === savedProd.name.trim().toLowerCase()
        );
        if (idx >= 0) {
          currentCache.products[idx] = savedProd;
        } else {
          currentCache.products.unshift(savedProd);
        }
        currentCache.inventory[savedProd.id] = savedInv.stockQty;
        if (savedProd.name) currentCache.inventory[savedProd.name.trim().toLowerCase()] = savedInv.stockQty;
        saveLocalCachedCatalog(user.tenantId, currentCache.products, currentCache.inventory);
      }

      if (existingProduct) {
        showNotice(
          `✓ Restocked "${savedProd.name}": Added +${validStock} ${unitVal} (Total: ${savedInv.stockQty})!`
        );
      } else {
        showNotice(
          `✓ Product "${savedProd.name}" added with ${savedInv.stockQty} ${unitVal} in stock!`
        );
      }

      // Reset form fields and close modal
      setAddProdModalOpen(false);
      setNewProdName("");
      setNewProdSku("");
      setNewProdPrice("");
      setNewProdStock("50");
      setNewProdLowStock("5");
      setNewProdUnit("pcs");

      // 3. ONLINE DB SECOND: Queue into Sync Outbox & Push to Backend DynamoDB in Background
      await queueOfflineAction(user.tenantId, user.id, "create_product", {
        product: {
          id: savedProd.id,
          name: savedProd.name,
          sku: savedProd.sku,
          category: savedProd.category,
          price: savedProd.price,
        },
        inventory: {
          id: savedInv.id,
          productId: savedProd.id,
          productName: savedProd.name,
          stockQty: validStock,
          lowStockThreshold: validLowStock,
          unit: unitVal,
          mode: existingProduct ? "add" : undefined,
        },
      });
      updateOutboxStatus();

      // If online, immediately flush outbox in background so DynamoDB & SubAdmin receive the update
      if (isOnline && token) {
        flushOutbox(token).then((res) => {
          updateOutboxStatus();
          if (res.success > 0) refreshData();
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error("Failed to add product:", err);
      setAddProdError(err?.message || "Failed to add product to inventory.");
    } finally {
      setAddingProd(false);
    }
  };

  // ─── Quick Restock Handlers ────────────────────────────────────────────────
  const handleOpenRestockModal = (prod: PosProduct, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRestockTargetProd(prod);
    setRestockUnitsToAdd("25");
    setRestockError("");
    setRestockModalOpen(true);
  };

  const handleRestockSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!restockTargetProd) return;
    if (!user?.tenantId) {
      setRestockError("Tenant session not found.");
      return;
    }
    const addCount = parseInt(restockUnitsToAdd, 10);
    if (isNaN(addCount) || addCount <= 0) {
      setRestockError("Please enter a positive quantity to restock.");
      return;
    }

    setRestocking(true);
    try {
      const now = new Date().toISOString();
      const currentStock =
        inventory[restockTargetProd.id] ??
        (restockTargetProd.name
          ? inventory[restockTargetProd.name.trim().toLowerCase()]
          : undefined) ??
        0;
      const newStock = currentStock + addCount;

      let savedInv: PosInventory = {
        id: `INV-${restockTargetProd.id}`,
        tenantId: user.tenantId,
        productId: restockTargetProd.id,
        productName: restockTargetProd.name,
        stockQty: newStock,
        lowStockThreshold: 5,
        unit: "pcs",
        updatedAt: now,
        _deleted: false,
      };

      // 1. OFFLINE DB FIRST: Commit directly to Permanent RxDB Store & Local Storage Cache immediately
      try {
        const localDb = db || (await getPosDatabase().catch(() => null));
        if (localDb?.inventory) {
          await updateLocalRxDbStock(
            localDb,
            user.tenantId,
            restockTargetProd.id,
            restockTargetProd.name,
            addCount,
            currentStock
          );
        }
      } catch (rxErr) {
        console.warn("RxDB restock notice:", rxErr);
      }

      // 2. Immediately update in-memory React state & durable local cache (Zero-latency UI updates)
      setInventory((prev) => ({
        ...prev,
        [restockTargetProd.id]: savedInv.stockQty,
        [restockTargetProd.name.trim().toLowerCase()]: savedInv.stockQty,
      }));

      if (user?.tenantId) {
        const currentCache = loadLocalCachedCatalog(user.tenantId);
        currentCache.inventory[restockTargetProd.id] = savedInv.stockQty;
        if (restockTargetProd.name) currentCache.inventory[restockTargetProd.name.trim().toLowerCase()] = savedInv.stockQty;
        saveLocalCachedCatalog(user.tenantId, currentCache.products, currentCache.inventory);
      }

      setRestockModalOpen(false);
      const targetName = restockTargetProd.name;
      setRestockTargetProd(null);
      showNotice(`✓ Restocked ${targetName}: Added +${addCount} units (Total: ${savedInv.stockQty})!`);

      // 3. ONLINE DB SECOND: Queue into Sync Outbox & Push to Backend DynamoDB in Background
      await queueOfflineAction(user.tenantId, user.id, "create_product", {
        product: {
          id: restockTargetProd.id,
          name: restockTargetProd.name,
          sku: restockTargetProd.sku,
          category: restockTargetProd.category,
          price: restockTargetProd.price,
        },
        inventory: {
          id: `INV-${restockTargetProd.id}`,
          productId: restockTargetProd.id,
          productName: restockTargetProd.name,
          stockQty: addCount,
          lowStockThreshold: 5,
          unit: "pcs",
          mode: "add",
        },
      });
      updateOutboxStatus();

      // If online, immediately flush outbox in background so DynamoDB & SubAdmin receive the update
      if (isOnline && token) {
        flushOutbox(token).then((res) => {
          updateOutboxStatus();
          if (res.success > 0) refreshData();
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error("Restock failed:", err);
      setRestockError(err?.message || "Failed to restock inventory.");
    } finally {
      setRestocking(false);
    }
  };

  // Categories list
  const categories = ["All", ...Array.from(new Set(products.map((p) => p.category).filter(Boolean)))];

  // Filtered products
  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // ─── KPI Calculations (Standard Day 12:00:00 AM - 11:59:59 PM, Cashier Register Scoped) ─
  const { startOfTodayMs, endOfTodayMs } = useMemo(() => {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
    return { startOfTodayMs: start, endOfTodayMs: end };
  }, []);

  const isToday = useCallback(
    (isoDate?: string | null) => {
      if (!isoDate) return false;
      const t = new Date(isoDate).getTime();
      return !isNaN(t) && t >= startOfTodayMs && t <= endOfTodayMs;
    },
    [startOfTodayMs, endOfTodayMs]
  );

  const isMyTransaction = useCallback(
    (t: PosTransaction) => {
      if (!user) return false;
      return t.operatorId === user.id || (user.name && t.operatorName === user.name);
    },
    [user]
  );

  // Individual operator's transactions for the standard day (12:00:00 AM - 11:59:59 PM)
  const myTodayTxns = useMemo(() => {
    return transactions.filter((t) => isMyTransaction(t) && isToday(t.createdAt));
  }, [transactions, isMyTransaction, isToday]);

  const myTodayCompletedTxns = useMemo(() => {
    return myTodayTxns.filter((t) => t.status === "completed" || t.status === "partially_returned");
  }, [myTodayTxns]);

  const myTodayReturnedTxns = useMemo(() => {
    return transactions.filter(
      (t) =>
        isMyTransaction(t) &&
        (isToday(t.returnedAt) || (isToday(t.createdAt) && t.status === "returned"))
    );
  }, [transactions, isMyTransaction, isToday]);

  // Net revenue for this operator's register today (total sales minus refunds)
  const todayRevenue = useMemo(() => {
    return myTodayCompletedTxns.reduce((sum, t) => {
      const gross = Number(t.total) || 0;
      const refund = Number(t.refundAmount) || 0;
      return sum + Math.max(0, gross - refund);
    }, 0);
  }, [myTodayCompletedTxns]);

  // Net units sold minus units returned for this operator
  const completedSoldUnits = useMemo(() => {
    return myTodayCompletedTxns.reduce(
      (sum, t) => sum + t.items.reduce((iSum, item) => iSum + (Number(item.quantity) || 0), 0),
      0
    );
  }, [myTodayCompletedTxns]);

  const returnedUnits = useMemo(() => {
    return myTodayReturnedTxns.reduce((sum, t) => {
      if (t.returnedItems && Array.isArray(t.returnedItems)) {
        return sum + t.returnedItems.reduce((rSum, it) => rSum + (Number(it.quantity) || 0), 0);
      }
      return (
        sum +
        t.items.reduce(
          (iSum, item) =>
            iSum + (Number(item.returnedQuantity) || (t.status === "returned" ? Number(item.quantity) || 0 : 0)),
          0
        )
      );
    }, 0);
  }, [myTodayReturnedTxns]);

  const netSales = Math.max(0, completedSoldUnits - returnedUnits);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#173c32] dark:text-[#f6f1ea] font-semibold">
        Loading POS register…
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f1ea] dark:bg-[#0d1512] p-4 text-[#1f2a25] dark:text-[#f6f1ea] lg:p-8 transition-colors duration-200">
      <div className="mx-auto max-w-7xl">
        <DashboardHeader
          title="POS Register"
          subtitle={`Counter checkout · ${user.tenantName ?? "Store Terminal"}`}
        />

        {/* Live Database & Network Status Banner */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-full ${
                isOnline ? "bg-green-500" : "bg-amber-500 animate-pulse"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-white" : "bg-amber-100"}`} />
            </span>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#5d665f] dark:text-[#a0ada5]">
                System Mode:
              </span>{" "}
              <strong className={isOnline ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
                {isOnline ? "Online — Real-Time DynamoDB Sync" : "Offline Mode — Storing to RxDB & Outbox"}
              </strong>
            </div>

            {pendingOutboxCount > 0 && (
              <div className="flex items-center gap-1.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 px-2.5 py-1 text-xs font-bold text-amber-900 dark:text-amber-200">
                <span>⚡</span>
                <span>{pendingOutboxCount} offline action{pendingOutboxCount > 1 ? "s" : ""} queued</span>
                {isOnline && token && (
                  <button
                    type="button"
                    onClick={async () => {
                      await flushOutbox(token);
                      updateOutboxStatus();
                      refreshData();
                    }}
                    className="ml-1.5 underline hover:text-black dark:hover:text-white"
                  >
                    Sync Now
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-[#5d665f] dark:text-[#a0ada5]">
            <span>Cashier: <strong className="text-[#173c32] dark:text-white">{user.name || "Operator"}</strong></span>
            <span>Local DB: <strong className="text-[#173c32] dark:text-white">RxDB Dexie</strong></span>
            <span>Remote DB: <strong className="text-[#173c32] dark:text-white">DynamoDB</strong></span>
            <span>Sync: <strong className={isOnline ? "text-green-600 dark:text-green-400" : "text-amber-600"}>{isOnline ? "Active" : "Queued"}</strong></span>
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          <Sidebar role="Operator" />

          <div className="min-w-0 flex-1 space-y-6">
            {/* KPI Stats (Standard 12:00:00 AM - 11:59:59 PM Cashier Sales) */}
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Today's Orders"
                value={myTodayCompletedTxns.length.toString()}
                accent="green"
                sub={`My Register (12am-12am) · ${myTodayCompletedTxns.length} completed ${myTodayReturnedTxns.length > 0 ? `(${myTodayReturnedTxns.length} returned)` : ""}`}
              />
              <StatCard
                label="Today's Revenue"
                value={`Rs. ${todayRevenue.toFixed(2)}`}
                accent="gold"
                sub="My Register net revenue (PKR)"
              />
              <StatCard
                label="Today's Sales"
                value={netSales.toString()}
                accent="blue"
                sub={`My Register (${completedSoldUnits} sold - ${returnedUnits} ret)`}
              />
              <StatCard
                label="Catalog Size"
                value={products.length.toString()}
                accent="slate"
                sub="Active products in DB"
              />
            </div>

            {/* Operator Main Subtabs: Register vs Sales History vs Exchange/Returns & Add Product Action */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ece4da] dark:border-white/10 pb-3">
              <div className="flex items-center gap-2 overflow-x-auto touch-scroll sm:justify-center">
                <button
                  type="button"
                  onClick={() => switchOperatorTab("register")}
                  className={`rounded-xl px-3.5 sm:px-4 py-2.5 text-xs font-bold transition flex items-center justify-center gap-2 min-h-[42px] touch-manipulation whitespace-nowrap ${
                    operatorTab === "register"
                      ? "bg-[#173c32] text-white shadow-sm"
                      : "bg-white dark:bg-[#14211c] text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da] dark:hover:bg-white/5"
                  }`}
                >
                  <span className="leading-none">🛒</span> Counter Register
                </button>
                <button
                  type="button"
                  onClick={() => switchOperatorTab("sales")}
                  className={`rounded-xl px-3.5 sm:px-4 py-2.5 text-xs font-bold transition flex items-center justify-center gap-2 min-h-[42px] touch-manipulation whitespace-nowrap ${
                    operatorTab === "sales"
                      ? "bg-[#173c32] text-white shadow-sm"
                      : "bg-white dark:bg-[#14211c] text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da] dark:hover:bg-white/5"
                  }`}
                >
                  <span className="leading-none">🧾</span> Completed Sales ({myTodayCompletedTxns.length})
                </button>
                <button
                  type="button"
                  onClick={() => switchOperatorTab("returns")}
                  className={`rounded-xl px-3.5 sm:px-4 py-2.5 text-xs font-bold transition flex items-center justify-center gap-2 min-h-[42px] touch-manipulation whitespace-nowrap ${
                    operatorTab === "returns"
                      ? "bg-[#173c32] text-white shadow-sm"
                      : "bg-white dark:bg-[#14211c] text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da] dark:hover:bg-white/5"
                  }`}
                >
                  <span className="leading-none">↺</span> Return Items
                </button>
              </div>

              {/* Add New Product / Item in Inventory button */}
              <button
                type="button"
                onClick={() => {
                  setAddProdError("");
                  setAddProdModalOpen(true);
                }}
                className="rounded-xl bg-[#173c32] dark:bg-[#215446] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#0f2d2b] flex items-center gap-1.5 shadow-sm touch-manipulation"
              >
                <span>➕</span> Add Product to Inventory
              </button>
            </div>

            {/* TAB 1: COUNTER REGISTER */}
            {operatorTab === "register" && (
              <div className="space-y-4">
                {/* Visual Banner Showing Completed Sale */}
                {lastCompletedSale && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/40 dark:to-green-950/40 border-2 border-emerald-500/40 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white text-base shadow-sm">
                        ✓
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm text-emerald-950 dark:text-emerald-100">
                            Sale Completed &amp; Registered: {lastCompletedSale.receiptNumber}
                          </span>
                          <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/60 px-2.5 py-0.5 text-[10px] font-black text-emerald-800 dark:text-emerald-200">
                            Rs. {lastCompletedSale.total.toFixed(2)}
                          </span>
                        </div>
                        <div className="text-xs text-emerald-800 dark:text-emerald-300 font-medium mt-0.5">
                          {lastCompletedSale.items.map((it) => `${it.productName} × ${it.quantity}`).join(", ")}
                          {lastCompletedSale.discount ? ` · Special Discount: -Rs. ${lastCompletedSale.discount.amount.toFixed(2)}` : ""}
                          {" · "}{lastCompletedSale.paymentMethod.toUpperCase()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCompletedTxn(lastCompletedSale)}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition flex items-center gap-1.5"
                      >
                        <span>🧾</span> View / Print Receipt
                      </button>
                      <button
                        type="button"
                        onClick={() => setLastCompletedSale(null)}
                        className="rounded-xl border border-emerald-300 dark:border-emerald-800 px-3 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30 transition"
                      >
                        ✕ Dismiss
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
                  {/* Product Catalog Column */}
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white dark:bg-[#14211c] p-4 border border-[#ece4da] dark:border-white/10">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search product or SKU…"
                      className="flex-1 min-w-[180px] rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 px-3 py-2 text-xs font-semibold placeholder:text-[#8d948f] focus:outline-none focus:ring-2 focus:ring-[#d7a35d]"
                    />

                    <div className="flex flex-wrap gap-1.5">
                      {categories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedCategory(cat)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                            selectedCategory === cat
                              ? "bg-[#173c32] text-white"
                              : "bg-[#faf8f4] dark:bg-black/20 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#eae3d8]"
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {products.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-[#d9d0c3] dark:border-white/10 bg-white dark:bg-[#14211c] p-10 text-center">
                      <p className="font-bold text-[#173c32] dark:text-white">Store catalog is empty</p>
                      <p className="mt-1 text-xs text-[#5d665f] dark:text-[#a0ada5]">
                        Add new products and inventory stock to start registering counter sales.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setAddProdError("");
                          setAddProdModalOpen(true);
                        }}
                        className="mt-4 rounded-xl bg-[#173c32] dark:bg-[#215446] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#0f2d2b]"
                      >
                        + Add New Product to Inventory
                      </button>
                    </div>
                  ) : filteredProducts.length === 0 ? (
                    <div className="rounded-2xl bg-white dark:bg-[#14211c] p-8 text-center text-sm text-[#5d665f]">
                      No products match your search.
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      {filteredProducts.map((prod) => {
                        const stock =
                          inventory[prod.id] ??
                          (prod.name ? inventory[prod.name.trim().toLowerCase()] : undefined) ??
                          0;
                        const isLow = stock > 0 && stock <= 10;
                        const isOut = stock <= 0;

                        return (
                          <div
                            key={prod.id}
                            onClick={() => (isOut ? handleOpenRestockModal(prod) : addToCart(prod))}
                            className={`group flex flex-col justify-between rounded-2xl border p-4 transition ${
                              isOut
                                ? "cursor-pointer border-red-200 bg-red-50/40 hover:border-red-300 dark:border-red-900/30 dark:bg-red-950/10"
                                : "cursor-pointer border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] hover:border-[#d7a35d] hover:shadow-md"
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="font-bold text-[#173c32] dark:text-white group-hover:text-[#d7a35d] transition">
                                  {prod.name}
                                </h3>
                                <span className="rounded-md bg-[#faf8f4] dark:bg-white/5 px-2 py-0.5 text-[10px] font-mono text-[#5d665f] dark:text-[#a0ada5]">
                                  {prod.sku}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-[#5d665f] dark:text-[#a0ada5] line-clamp-1">
                                {prod.category}
                              </p>
                            </div>

                            <div className="mt-4 flex items-center justify-between pt-2 border-t border-[#f0eae1] dark:border-white/5">
                              <span className="text-base font-extrabold text-[#173c32] dark:text-[#d7a35d]">
                                Rs. {prod.price.toFixed(2)}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    isOut
                                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                      : isLow
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                      : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                                  }`}
                                >
                                  {isOut ? "Out of Stock" : `${stock} in stock`}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => handleOpenRestockModal(prod, e)}
                                  title="Add stock to this product"
                                  className="rounded-lg bg-black/5 dark:bg-white/10 hover:bg-[#173c32] hover:text-white dark:hover:bg-[#215446] px-1.5 py-0.5 text-[10px] font-bold text-[#173c32] dark:text-white transition"
                                >
                                  +Stock
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Active Cart & Checkout Column */}
                <div id="cart-panel" className="rounded-3xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] p-6 shadow-sm flex flex-col justify-between scroll-mt-24">
                  <div>
                    <div className="flex items-center justify-between border-b border-[#ece4da] dark:border-white/10 pb-4">
                      <div>
                        <h2 className="text-lg font-black text-[#173c32] dark:text-white">Active Register Cart</h2>
                        <p className="text-xs text-[#5d665f] dark:text-[#a0ada5]">
                          {cart.length} unique {cart.length === 1 ? "item" : "items"}
                        </p>
                      </div>
                      {cart.length > 0 && (
                        <button
                          type="button"
                          onClick={clearCart}
                          className="text-xs font-bold text-red-600 dark:text-red-400 hover:underline"
                        >
                          Clear Cart
                        </button>
                      )}
                    </div>

                    {cartNotice && (
                      <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
                        {cartNotice}
                      </div>
                    )}

                    {/* Cart Items List */}
                    <div className="mt-4 max-h-[280px] overflow-y-auto space-y-3 pr-1">
                      {cart.length === 0 ? (
                        <div className="py-12 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
                          Cart is empty. Tap any product to start a sale.
                        </div>
                      ) : (
                        cart.map((item) => (
                          <div
                            key={item.productId}
                            className="flex items-center justify-between rounded-xl border border-[#f0eae1] dark:border-white/5 bg-[#faf8f4] dark:bg-black/20 p-3"
                          >
                            <div className="flex-1 min-w-0 pr-2">
                              <h4 className="font-bold text-xs text-[#173c32] dark:text-white truncate">
                                {item.productName}
                              </h4>
                              <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                                Rs. {item.unitPrice.toFixed(2)} each
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="flex items-center rounded-lg border border-[#d9d0c3] dark:border-white/10 bg-white dark:bg-black/30">
                                <button
                                  type="button"
                                  onClick={() => updateCartQty(item.productId, -1)}
                                  className="px-2 py-0.5 text-xs font-bold text-[#5d665f] hover:text-[#173c32] dark:hover:text-white"
                                >
                                  –
                                </button>
                                <span className="px-1 text-xs font-black text-[#173c32] dark:text-white">
                                  {item.quantity}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateCartQty(item.productId, 1)}
                                  className="px-2 py-0.5 text-xs font-bold text-[#5d665f] hover:text-[#173c32] dark:hover:text-white"
                                >
                                  +
                                </button>
                              </div>
                              <span className="w-14 text-right text-xs font-extrabold text-[#173c32] dark:text-white">
                                Rs. {item.lineTotal.toFixed(2)}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeFromCart(item.productId)}
                                className="text-xs text-red-500 hover:text-red-700 ml-1"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Special Discount & Totals Section */}
                  <div className="mt-4 border-t border-[#ece4da] dark:border-white/10 pt-3 space-y-3">
                    {/* Special Discount Accordion */}
                    <div className="rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#173c32] dark:text-white flex items-center gap-1.5">
                          <span>🏷️</span> Apply Special Discount
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowDiscountInput(!showDiscountInput)}
                          className="text-xs font-bold text-[#d7a35d] hover:underline"
                        >
                          {showDiscountInput ? "Hide" : discountAmount > 0 ? `-Rs. ${discountAmount.toFixed(2)} Applied` : "+ Add Discount"}
                        </button>
                      </div>

                      {showDiscountInput && (
                        <div className="mt-3 space-y-2.5 pt-2 border-t border-[#ece4da] dark:border-white/10">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setDiscountType("percent")}
                              className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                                discountType === "percent"
                                  ? "bg-[#173c32] text-white"
                                  : "border border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]"
                              }`}
                            >
                              Percentage (%)
                            </button>
                            <button
                              type="button"
                              onClick={() => setDiscountType("fixed")}
                              className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                                discountType === "fixed"
                                  ? "bg-[#173c32] text-white"
                                  : "border border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]"
                              }`}
                            >
                              Fixed Rupees (Rs.)
                            </button>
                          </div>

                          {/* Quick Preset Discount Chips */}
                          <div className="flex flex-wrap gap-1.5">
                            {discountType === "percent" ? (
                              [5, 10, 15, 20, 25, 50].map((pct) => (
                                <button
                                  key={pct}
                                  type="button"
                                  onClick={() => setDiscountValue(pct.toString())}
                                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold border transition ${
                                    discountValue === pct.toString()
                                      ? "bg-[#d7a35d] text-[#173c32] border-[#d7a35d]"
                                      : "bg-white dark:bg-white/5 border-[#ece4da] dark:border-white/10 text-[#173c32] dark:text-white hover:bg-[#ece4da]"
                                  }`}
                                >
                                  {pct}%
                                </button>
                              ))
                            ) : (
                              [20, 50, 100, 200, 500].map((amt) => (
                                <button
                                  key={amt}
                                  type="button"
                                  onClick={() => setDiscountValue(amt.toString())}
                                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold border transition ${
                                    discountValue === amt.toString()
                                      ? "bg-[#d7a35d] text-[#173c32] border-[#d7a35d]"
                                      : "bg-white dark:bg-white/5 border-[#ece4da] dark:border-white/10 text-[#173c32] dark:text-white hover:bg-[#ece4da]"
                                  }`}
                                >
                                  Rs. {amt}
                                </button>
                              ))
                            )}
                          </div>
                          
                          <div className="flex gap-2 items-center">
                            <div className="relative flex-1">
                              <span className="absolute left-3 top-2 text-xs font-bold text-[#5d665f]">
                                {discountType === "percent" ? "%" : "Rs."}
                              </span>
                              <input
                                type="number"
                                min="0"
                                max={discountType === "percent" ? "100" : undefined}
                                step="any"
                                value={discountValue}
                                onChange={(e) => setDiscountValue(e.target.value)}
                                placeholder={discountType === "percent" ? "Custom % (e.g. 10)" : "Custom Rs. (e.g. 50)"}
                                className={`w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-black/30 ${discountType === "percent" ? "pl-7" : "pl-10"} pr-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#d7a35d]`}
                              />
                            </div>
                            {discountValue && (
                              <button
                                type="button"
                                onClick={() => setDiscountValue("")}
                                className="text-xs text-red-500 font-bold px-2 py-1 hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </div>

                          {discountAmount > 0 && (
                            <div className="rounded-xl bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 p-2 text-[11px] font-bold text-green-800 dark:text-green-300 flex justify-between items-center">
                              <span>✓ Discount Applied:</span>
                              <span>-Rs. {discountAmount.toFixed(2)} off subtotal</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Price Breakdown */}
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                        <span>Subtotal</span>
                        <span className="font-bold">Rs. {subtotal.toFixed(2)}</span>
                      </div>
                      
                      {discountAmount > 0 && (
                        <div className="flex justify-between text-green-700 dark:text-green-400 font-semibold">
                          <span>Special Discount ({discountType === "percent" ? `${numDiscountVal}%` : `Rs. ${numDiscountVal}`})</span>
                          <span>-Rs. {discountAmount.toFixed(2)}</span>
                        </div>
                      )}

                      {tax > 0 && (
                        <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                          <span>Sales Tax</span>
                          <span className="font-bold">Rs. {tax.toFixed(2)}</span>
                        </div>
                      )}
                      
                      <div className="flex justify-between text-base font-black text-[#173c32] dark:text-white pt-2 border-t border-[#ece4da] dark:border-white/10">
                        <span>Total Due (Bill Amount)</span>
                        <span className="text-[#d7a35d]">Rs. {grandTotal.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Payment Method Selector */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("card")}
                        className={`rounded-xl py-2.5 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                          paymentMethod === "card"
                            ? "bg-[#173c32] text-white shadow-sm"
                            : "border border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da]"
                        }`}
                      >
                        <span>💳</span> Card Payment
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("cash")}
                        className={`rounded-xl py-2.5 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                          paymentMethod === "cash"
                            ? "bg-[#173c32] text-white shadow-sm"
                            : "border border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da]"
                        }`}
                      >
                        <span>💵</span> Cash Register
                      </button>
                    </div>

                    {/* Cash Tendered & Change Return Box (When Cash is selected) */}
                    {paymentMethod === "cash" && (
                      <div className="rounded-2xl border-2 border-[#d7a35d] bg-[#fffaf3] dark:bg-black/30 p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-[#173c32] dark:text-white">
                            💵 Cash Tendered &amp; Return Change
                          </span>
                          <span className="text-[11px] font-bold text-[#5d665f] dark:text-[#a0ada5]">
                            Total Due: Rs. {grandTotal.toFixed(2)}
                          </span>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold uppercase tracking-wider text-[#5d665f] dark:text-[#a0ada5] mb-1">
                            Cash Received from Customer (Required):
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-xs font-bold text-[#5d665f]">Rs.</span>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={cashGiven}
                              onChange={(e) => setCashGiven(e.target.value)}
                              placeholder="0.00"
                              className={`w-full rounded-xl border bg-white dark:bg-black/40 pl-10 pr-3 py-2 text-sm font-black text-[#173c32] dark:text-white focus:outline-none focus:ring-2 ${
                                !hasCashEntered
                                  ? "border-amber-400 dark:border-amber-600 focus:ring-amber-400"
                                  : cashGivenAmount < grandTotal
                                  ? "border-red-500 ring-2 ring-red-400/40 focus:ring-red-500"
                                  : "border-green-500 ring-2 ring-green-400/40 focus:ring-green-500"
                              }`}
                            />
                          </div>

                          {/* Quick Cash Buttons (Pakistani Rupee Denominations) */}
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <button
                              type="button"
                              onClick={() => setCashGiven(grandTotal.toFixed(2))}
                              className="rounded-lg bg-white dark:bg-white/10 border border-[#d9d0c3] dark:border-white/10 px-2 py-1 text-[11px] font-bold text-[#173c32] dark:text-white hover:bg-[#ece4da]"
                            >
                              Exact (Rs. {grandTotal.toFixed(2)})
                            </button>
                            {[100, 200, 500, 1000, 2000, 5000].map((amt) => (
                              <button
                                key={amt}
                                type="button"
                                onClick={() => setCashGiven(amt.toString())}
                                className="rounded-lg bg-white dark:bg-white/10 border border-[#d9d0c3] dark:border-white/10 px-2 py-1 text-[11px] font-bold text-[#173c32] dark:text-white hover:bg-[#ece4da]"
                              >
                                Rs. {amt}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Change to Return Calculation */}
                        <div className="rounded-xl bg-white dark:bg-black/50 p-2.5 border border-[#ece4da] dark:border-white/10 space-y-1">
                          <div className="flex justify-between text-xs text-[#5d665f] dark:text-[#a0ada5]">
                            <span>Cash Customer Pays:</span>
                            <span className="font-bold">
                              {hasCashEntered ? `Rs. ${cashGivenAmount.toFixed(2)}` : "— (Not yet entered)"}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs text-[#5d665f] dark:text-[#a0ada5]">
                            <span>Bill Amount Deducted:</span>
                            <span className="font-bold text-red-600 dark:text-red-400">-Rs. {grandTotal.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-black border-t border-[#ece4da] dark:border-white/10 pt-1.5">
                            <span className="text-[#173c32] dark:text-white">Change to Customer:</span>
                            <span
                              className={`text-base font-extrabold ${
                                hasCashEntered && cashGivenAmount >= grandTotal
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-amber-600 dark:text-amber-400"
                              }`}
                            >
                              Rs. {changeDue.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {/* Feedback warnings */}
                        {!hasCashEntered && grandTotal > 0 ? (
                          <p className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                            <span>⚠️</span> Operator must input customer cash received before completing sale.
                          </p>
                        ) : cashGivenAmount < grandTotal && grandTotal > 0 ? (
                          <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-2 border border-red-200 dark:border-red-800 text-xs font-bold text-red-700 dark:text-red-300 flex items-center gap-1.5">
                            <span>❌</span> Insufficient Cash: Customer gave Rs. ${cashGivenAmount.toFixed(2)}, which is short by Rs. ${cashShortfall.toFixed(2)}.
                          </div>
                        ) : (
                          <p className="text-xs font-bold text-green-700 dark:text-green-400 flex items-center gap-1">
                            <span>✓</span> Cash accepted! Hand Rs. {changeDue.toFixed(2)} change to customer upon completion.
                          </p>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={cart.length === 0 || processingSale || !isCashSufficient}
                      onClick={handleCheckout}
                      className="w-full rounded-2xl bg-[#d7a35d] px-4 py-3.5 text-sm font-black text-[#173c32] transition hover:bg-[#c98d41] disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[#d7a35d]/20 flex items-center justify-center gap-2"
                    >
                      {processingSale ? (
                        <>
                          <span className="animate-spin text-base">⏳</span> Processing Sale…
                        </>
                      ) : paymentMethod === "cash" && !hasCashEntered ? (
                        <>
                          <span>💵</span> Enter Cash Given to Complete Sale
                        </>
                      ) : paymentMethod === "cash" && cashGivenAmount < grandTotal ? (
                        <>
                          <span>⚠️</span> Insufficient Cash (Need Rs. {cashShortfall.toFixed(2)} more)
                        </>
                      ) : paymentMethod === "cash" ? (
                        <>
                          <span>✓</span> Complete Cash Sale (Rs. {grandTotal.toFixed(2)}) · Return Rs. {changeDue.toFixed(2)} Change
                        </>
                      ) : (
                        <>
                          <span>✓</span> Complete Sale (Rs. {grandTotal.toFixed(2)}) · Card Payment
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* TAB 2: RETURN ITEMS TAB */}
            {operatorTab === "returns" && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] p-6 shadow-sm">
                  <div className="max-w-2xl">
                    <h2 className="text-lg font-black text-[#173c32] dark:text-white flex items-center gap-2">
                      <span>↺</span> Return Items &amp; Customer Refunds
                    </h2>
                    <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mt-1">
                      Lookup customer receipt by Receipt Number (RCP). Select exact item quantities to return (e.g. bought 3 units, return 1). Returned units will be restocked into inventory and the refund amount deducted from store sales.
                    </p>

                    {/* Fast Search Input */}
                    <form onSubmit={handleSearchReceipt} className="mt-4 flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={returnRcpSearch}
                          onChange={(e) => setReturnRcpSearch(e.target.value)}
                          placeholder="Search Receipt Number (e.g. RCP-123456 or 123456)…"
                          className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/30 px-3.5 py-2.5 text-xs font-semibold placeholder:text-[#8d948f] focus:outline-none focus:ring-2 focus:ring-[#d7a35d]"
                        />
                      </div>
                      <button
                        type="submit"
                        className="rounded-xl bg-[#173c32] dark:bg-[#215446] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#0f2d2b] flex items-center justify-center gap-1.5"
                      >
                        <span>🔍</span> Quick Search (O(1))
                      </button>
                    </form>

                    {/* Quick recent receipts chips */}
                    {transactions.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-bold text-[#5d665f] dark:text-[#a0ada5]">Recent Receipts:</span>
                        {transactions.slice(0, 6).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setReturnRcpSearch(t.receiptNumber);
                              setSearchedReturnTxn(t);
                              setReturnSearchError("");
                              setReturnSuccessMsg("");
                            }}
                            className={`text-[11px] font-mono px-2.5 py-1 rounded-lg border transition ${
                              searchedReturnTxn?.id === t.id
                                ? "bg-[#173c32] text-white border-[#173c32]"
                                : "bg-white dark:bg-white/5 border-[#ece4da] dark:border-white/10 text-[#173c32] dark:text-white hover:bg-[#ece4da] dark:hover:bg-white/10"
                            }`}
                          >
                            {t.receiptNumber} (Rs. ${(t.netTotal !== undefined && t.netTotal !== null ? t.netTotal : t.total).toFixed(2)})
                          </button>
                        ))}
                      </div>
                    )}

                    {returnSearchError && (
                      <div className="mt-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-xs font-semibold text-red-700 dark:text-red-300">
                        {returnSearchError}
                      </div>
                    )}

                    {returnSuccessMsg && (
                      <div className="mt-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-3 text-xs font-semibold text-green-800 dark:text-green-300">
                        {returnSuccessMsg}
                      </div>
                    )}
                  </div>
                </div>

                {/* Searched Receipt Results Card */}
                {searchedReturnTxn && (() => {
                  const subtotalVal = Number(searchedReturnTxn.subtotal) || 0;
                  const discountVal = Number((searchedReturnTxn.discount as any)?.amount) || 0;
                  const discountFactor = subtotalVal > 0 ? Math.max(0, subtotalVal - discountVal) / subtotalVal : 1;

                  let totalCalculatedRefund = 0;
                  let totalUnitsReturning = 0;

                  searchedReturnTxn.items.forEach((it, idx) => {
                    const originalQty = it.quantity;
                    const alreadyReturned = Number(it.returnedQuantity) || 0;
                    const maxReturnable = Math.max(0, originalQty - alreadyReturned);
                    const returnQty = Math.min(maxReturnable, returnItemQuantities[idx] || 0);

                    if (returnQty > 0) {
                      totalUnitsReturning += returnQty;
                      const unitPrice = Number(it.unitPrice) || (originalQty > 0 ? Number(it.lineTotal) / originalQty : 0);
                      const lineSub = returnQty * unitPrice * discountFactor;
                      totalCalculatedRefund += Number((lineSub * 1.08).toFixed(2));
                    }
                  });

                  const priorRefundAmount = Number(searchedReturnTxn.refundAmount) || (searchedReturnTxn.status === "returned" ? searchedReturnTxn.total : 0);
                  const remainingEligibleRefund = Math.max(0, Number((searchedReturnTxn.total - priorRefundAmount).toFixed(2)));
                  const effectiveRefund = Math.min(remainingEligibleRefund, totalCalculatedRefund);

                  return (
                    <div className="rounded-3xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] p-6 shadow-sm space-y-6">
                      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ece4da] dark:border-white/10 pb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-black text-[#173c32] dark:text-white font-mono">
                              {searchedReturnTxn.receiptNumber}
                            </h3>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                searchedReturnTxn.status === "returned"
                                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                  : searchedReturnTxn.status === "partially_returned"
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                  : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                              }`}
                            >
                              {searchedReturnTxn.status === "returned"
                                ? "↺ Fully Returned"
                                : searchedReturnTxn.status === "partially_returned"
                                ? "↺ Partially Returned"
                                : "✓ Completed Sale"}
                            </span>
                          </div>
                          <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mt-1">
                            Date: {new Date(searchedReturnTxn.createdAt).toLocaleString()} · Cashier: {searchedReturnTxn.operatorName} · Payment: {searchedReturnTxn.paymentMethod.toUpperCase()}
                          </p>
                        </div>

                        <div className="text-right">
                          <div className="text-xs text-[#5d665f] dark:text-[#a0ada5]">Original Bill Total</div>
                          <div className="text-xl font-black text-[#173c32] dark:text-[#d7a35d]">
                            Rs. {searchedReturnTxn.total.toFixed(2)}
                          </div>
                          {priorRefundAmount > 0 && (
                            <div className="text-[11px] text-red-600 dark:text-red-400 font-bold">
                              Refunded so far: -Rs. {priorRefundAmount.toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Itemized list with partial quantity selection */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-[#5d665f] dark:text-[#a0ada5]">
                            Items on Receipt (Adjust units to return):
                          </h4>
                          {searchedReturnTxn.status !== "returned" && (
                            <div className="flex gap-2 text-[11px] font-bold">
                              <button
                                type="button"
                                onClick={() => {
                                  const allUnits: Record<number, number> = {};
                                  searchedReturnTxn.items.forEach((it, i) => {
                                    const maxReturnable = Math.max(0, it.quantity - (Number(it.returnedQuantity) || 0));
                                    allUnits[i] = maxReturnable;
                                  });
                                  setReturnItemQuantities(allUnits);
                                }}
                                className="text-[#d7a35d] hover:underline"
                              >
                                Select All Eligible
                              </button>
                              <span>·</span>
                              <button
                                type="button"
                                onClick={() => setReturnItemQuantities({})}
                                className="text-[#5d665f] dark:text-[#a0ada5] hover:underline"
                              >
                                Reset to 0
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="divide-y divide-[#ece4da] dark:divide-white/10 border rounded-2xl border-[#ece4da] dark:border-white/10 overflow-hidden">
                          {searchedReturnTxn.items.map((it, idx) => {
                            const originalQty = it.quantity;
                            const alreadyReturned = Number(it.returnedQuantity) || 0;
                            const maxReturnable = Math.max(0, originalQty - alreadyReturned);
                            const returnQty = Math.min(maxReturnable, returnItemQuantities[idx] || 0);
                            const unitPrice = Number(it.unitPrice) || (originalQty > 0 ? Number(it.lineTotal) / originalQty : 0);
                            const lineSub = returnQty * unitPrice * discountFactor;
                            const lineRefund = Number((lineSub * 1.08).toFixed(2));

                            return (
                              <div
                                key={idx}
                                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 text-xs transition ${
                                  returnQty > 0
                                    ? "bg-amber-50/70 dark:bg-amber-950/20 border-l-4 border-[#d7a35d]"
                                    : "bg-[#faf8f4] dark:bg-black/20"
                                }`}
                              >
                                <div className="space-y-0.5">
                                  <div className="font-bold text-sm text-[#173c32] dark:text-white">
                                    {it.productName}
                                  </div>
                                  <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                                    Purchased: <strong className="text-[#173c32] dark:text-white">{originalQty}</strong> @ ${unitPrice.toFixed(2)} each
                                    {alreadyReturned > 0 && (
                                      <span className="text-red-600 dark:text-red-400 font-semibold ml-2">
                                        ({alreadyReturned} already returned)
                                      </span>
                                    )}
                                    {maxReturnable > 0 ? (
                                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold ml-2">
                                        · {maxReturnable} eligible to return
                                      </span>
                                    ) : (
                                      <span className="text-[#8d948f] font-semibold ml-2">
                                        · Fully returned
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 self-end sm:self-auto">
                                  {maxReturnable > 0 && searchedReturnTxn.status !== "returned" ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] font-bold text-[#5d665f] dark:text-[#a0ada5] mr-1">
                                        Return Qty:
                                      </span>
                                      <button
                                        type="button"
                                        disabled={returnQty <= 0}
                                        onClick={() =>
                                          setReturnItemQuantities((prev) => ({
                                            ...prev,
                                            [idx]: Math.max(0, (prev[idx] || 0) - 1),
                                          }))
                                        }
                                        className="h-7 w-7 rounded-lg border border-[#d9d0c3] dark:border-white/20 bg-white dark:bg-white/10 font-bold hover:bg-[#ece4da] dark:hover:bg-white/20 transition disabled:opacity-40"
                                      >
                                        –
                                      </button>
                                      <span className="w-8 text-center font-black text-sm text-[#173c32] dark:text-white">
                                        {returnQty}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={returnQty >= maxReturnable}
                                        onClick={() =>
                                          setReturnItemQuantities((prev) => ({
                                            ...prev,
                                            [idx]: Math.min(maxReturnable, (prev[idx] || 0) + 1),
                                          }))
                                        }
                                        className="h-7 w-7 rounded-lg border border-[#d9d0c3] dark:border-white/20 bg-white dark:bg-white/10 font-bold hover:bg-[#ece4da] dark:hover:bg-white/20 transition disabled:opacity-40"
                                      >
                                        +
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-[#8d948f] font-bold">
                                      —
                                    </span>
                                  )}

                                  <div className="w-24 text-right">
                                    <div className="font-extrabold text-sm text-[#173c32] dark:text-white">
                                      {returnQty > 0 ? `-Rs. ${lineRefund.toFixed(2)}` : "Rs. 0.00"}
                                    </div>
                                    <div className="text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                                      {returnQty > 0 ? `(${returnQty} unit refund)` : "0 selected"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Refund Breakdown */}
                      <div className="space-y-1.5 text-xs max-w-xs ml-auto border-t border-[#ece4da] dark:border-white/10 pt-3">
                        <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                          <span>Original Bill Total:</span>
                          <span className="font-bold">Rs. {searchedReturnTxn.total.toFixed(2)}</span>
                        </div>
                        {priorRefundAmount > 0 && (
                          <div className="flex justify-between text-red-600 dark:text-red-400">
                            <span>Previously Refunded:</span>
                            <span>-Rs. {priorRefundAmount.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-black text-sm text-[#173c32] dark:text-white pt-1 border-t border-[#ece4da] dark:border-white/10">
                          <span>Total Refund Due Customer:</span>
                          <span className="text-red-600 dark:text-red-400 font-extrabold text-base">
                            Rs. {effectiveRefund.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      {searchedReturnTxn.status !== "returned" ? (
                        <div className="border-t border-[#ece4da] dark:border-white/10 pt-4 space-y-3">
                          <div>
                            <label className="block text-xs font-bold text-[#173c32] dark:text-white mb-1">
                              Return Reason:
                            </label>
                            <input
                              type="text"
                              value={returnReason}
                              onChange={(e) => setReturnReason(e.target.value)}
                              placeholder="Reason for customer return (e.g. damaged unit, customer changed mind)…"
                              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/30 p-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#d7a35d]"
                            />
                          </div>

                          <div className="pt-1">
                            <button
                              type="button"
                              disabled={processingReturn || totalUnitsReturning === 0}
                              onClick={() => handleProcessReturn(searchedReturnTxn)}
                              className="w-full sm:w-auto rounded-2xl bg-red-600 px-7 py-3.5 text-xs font-black text-white hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                            >
                              <span>💰</span> {processingReturn ? "Restocking & Processing Return…" : `Process Return & Refund (Rs. ${effectiveRefund.toFixed(2)}) · ${totalUnitsReturning} Unit${totalUnitsReturning > 1 ? "s" : ""}`}
                            </button>
                          </div>

                          {totalUnitsReturning === 0 && (
                            <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                              ⚠️ Select at least 1 unit using the stepper above to process a return.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 p-4 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
                          <strong>Fully Returned:</strong> All items from this transaction have been completely returned and refunded.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB 3: COMPLETED SALES & RECEIPTS HISTORY */}
            {operatorTab === "sales" && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] p-6 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#ece4da] dark:border-white/10 pb-4">
                    <div>
                      <h2 className="text-lg font-black text-[#173c32] dark:text-white flex items-center gap-2">
                        <span>🧾</span> Store Sales &amp; Receipts Registry
                      </h2>
                      <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mt-1">
                        View itemized details, check discounts applied, and print customer receipts for all registered transactions.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2 text-right">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">Today&apos;s Revenue</div>
                        <div className="text-base font-black text-emerald-950 dark:text-emerald-100">Rs. {todayRevenue.toFixed(2)}</div>
                      </div>
                      <div className="rounded-2xl bg-[#faf8f4] dark:bg-black/30 border border-[#ece4da] dark:border-white/10 px-3.5 py-2 text-right">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#5d665f] dark:text-[#a0ada5]">My Completed Orders</div>
                        <div className="text-base font-black text-[#173c32] dark:text-white">{myTodayCompletedTxns.length}</div>
                      </div>
                    </div>
                  </div>

                  {/* Scope Switcher: My Register vs All Store Cashiers */}
                  <div className="mt-4 flex items-center gap-2 border-b border-[#ece4da] dark:border-white/10 pb-3">
                    <span className="text-xs font-bold text-[#5d665f] dark:text-[#a0ada5]">Register View:</span>
                    <button
                      type="button"
                      onClick={() => setSalesScope("my_sales")}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                        salesScope === "my_sales"
                          ? "bg-[#173c32] text-white shadow-sm"
                          : "bg-[#faf8f4] dark:bg-black/20 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da]"
                      }`}
                    >
                      👤 My Register ({transactions.filter((t) => isMyTransaction(t)).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSalesScope("store_sales")}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                        salesScope === "store_sales"
                          ? "bg-[#173c32] text-white shadow-sm"
                          : "bg-[#faf8f4] dark:bg-black/20 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da]"
                      }`}
                    >
                      🏬 All Store Registers ({transactions.length})
                    </button>
                  </div>

                  {/* Search & Filter Controls */}
                  <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={salesSearch}
                        onChange={(e) => setSalesSearch(e.target.value)}
                        placeholder="Search by Receipt (RCP-...), Product Name, Cashier, or Payment Method…"
                        className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/30 px-3.5 py-2.5 text-xs font-semibold placeholder:text-[#8d948f] focus:outline-none focus:ring-2 focus:ring-[#d7a35d]"
                      />
                      {salesSearch && (
                        <button
                          type="button"
                          onClick={() => setSalesSearch("")}
                          className="absolute right-3 top-2.5 text-xs font-bold text-[#8d948f] hover:text-black dark:hover:text-white"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {(["all", "completed", "partially_returned", "returned"] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setSalesFilterStatus(st)}
                          className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                            salesFilterStatus === st
                              ? "bg-[#173c32] text-white"
                              : "border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da]"
                          }`}
                        >
                          {st === "all"
                            ? `All (${salesScope === "my_sales" ? transactions.filter((t) => isMyTransaction(t)).length : transactions.length})`
                            : st === "completed"
                            ? `Completed (${(salesScope === "my_sales" ? transactions.filter((t) => isMyTransaction(t)) : transactions).filter((t) => t.status === "completed").length})`
                            : st === "partially_returned"
                            ? `Partially Returned (${(salesScope === "my_sales" ? transactions.filter((t) => isMyTransaction(t)) : transactions).filter((t) => t.status === "partially_returned").length})`
                            : `Fully Returned (${(salesScope === "my_sales" ? transactions.filter((t) => isMyTransaction(t)) : transactions).filter((t) => t.status === "returned").length})`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Sales List Table / Cards */}
                {(() => {
                  const query = salesSearch.trim().toLowerCase();
                  const filtered = transactions.filter((t) => {
                    if (salesScope === "my_sales" && !isMyTransaction(t)) return false;
                    const matchesStatus = salesFilterStatus === "all" || t.status === salesFilterStatus;
                    if (!matchesStatus) return false;
                    if (!query) return true;
                    const rcp = (t.receiptNumber || "").toLowerCase();
                    const cashier = (t.operatorName || "").toLowerCase();
                    const payment = (t.paymentMethod || "").toLowerCase();
                    const items = t.items.map((i) => i.productName.toLowerCase()).join(" ");
                    return rcp.includes(query) || cashier.includes(query) || payment.includes(query) || items.includes(query);
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="rounded-3xl border border-dashed border-[#d9d0c3] dark:border-white/10 bg-white dark:bg-[#14211c] p-12 text-center">
                        <span className="text-3xl">🧾</span>
                        <p className="mt-2 font-bold text-sm text-[#173c32] dark:text-white">No sales transactions match your search</p>
                        <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mt-1">
                          {salesSearch ? `No results found for "${salesSearch}". Try clearing the search.` : "Sales recorded at this terminal will appear here."}
                        </p>
                        {salesSearch && (
                          <button
                            type="button"
                            onClick={() => setSalesSearch("")}
                            className="mt-3 rounded-xl bg-[#173c32] px-4 py-2 text-xs font-bold text-white"
                          >
                            Clear Search
                          </button>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3.5">
                      {filtered.map((txn) => {
                        const txnDiscount = txn.discount as any;
                        return (
                          <div
                            key={txn.id}
                            className="rounded-3xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] p-5 shadow-sm transition hover:shadow-md space-y-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ece4da] dark:border-white/10 pb-3">
                              <div className="flex items-center gap-2.5">
                                <span className="font-mono text-sm font-black text-[#173c32] dark:text-white">
                                  {txn.receiptNumber}
                                </span>
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                    txn.status === "returned"
                                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                      : txn.status === "partially_returned"
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                      : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                                  }`}
                                >
                                  {txn.status === "returned"
                                    ? "↺ Fully Returned"
                                    : txn.status === "partially_returned"
                                    ? "↺ Partially Returned"
                                    : "✓ Completed Sale"}
                                </span>
                                <span className="text-xs text-[#5d665f] dark:text-[#a0ada5]">
                                  {new Date(txn.createdAt).toLocaleDateString()} {new Date(txn.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>

                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                                    {txn.status === "partially_returned" || txn.status === "returned" ? "Net Amount" : "Bill Amount"}
                                  </div>
                                  <div className="text-base font-black text-[#173c32] dark:text-[#d7a35d]">
                                    Rs. {Number(txn.netTotal !== undefined && txn.netTotal !== null ? txn.netTotal : txn.status === "returned" ? 0 : txn.total).toFixed(2)}
                                  </div>
                                  {(txn.refundAmount || 0) > 0 && (
                                    <div className="text-[10px] font-bold text-red-600 dark:text-red-400">
                                      Refunded: -Rs. {Number(txn.refundAmount).toFixed(2)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Itemized List Summary */}
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="flex-1 min-w-[200px]">
                                <span className="font-bold text-[#173c32] dark:text-white">Items: </span>
                                <span className="text-[#5d665f] dark:text-[#a0ada5]">
                                  {txn.items.map((it) => `${it.productName} × ${it.quantity} (Rs. ${it.lineTotal.toFixed(2)})`).join(" · ")}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {txnDiscount && txnDiscount.amount > 0 && (
                                  <span className="rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:text-green-300">
                                    Discount: -Rs. {Number(txnDiscount.amount).toFixed(2)} ({txnDiscount.type === "percent" ? `${txnDiscount.value}%` : `Rs. ${txnDiscount.value}`})
                                  </span>
                                )}
                                <span className="rounded-lg bg-[#faf8f4] dark:bg-black/30 border border-[#ece4da] dark:border-white/10 px-2 py-0.5 text-[10px] font-bold text-[#5d665f] dark:text-[#a0ada5]">
                                  {txn.paymentMethod.toUpperCase()}
                                  {txn.cashGiven ? ` (Given: Rs. ${txn.cashGiven.toFixed(2)}, Chg: Rs. ${(txn.changeDue || 0).toFixed(2)})` : ""}
                                </span>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#ece4da] dark:border-white/10 text-xs">
                              <span className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                                Cashier: <strong className="text-[#173c32] dark:text-white">{txn.operatorName}</strong>
                              </span>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setCompletedTxn(txn)}
                                  className="rounded-xl border border-[#d7a35d] bg-[#d7a35d]/10 hover:bg-[#d7a35d]/20 px-3 py-1.5 font-bold text-xs text-[#173c32] dark:text-[#d7a35d] transition flex items-center gap-1.5"
                                >
                                  <span>🧾</span> View / Print Receipt
                                </button>
                                {(txn.status === "completed" || txn.status === "partially_returned") && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReturnRcpSearch(txn.receiptNumber);
                                      setSearchedReturnTxn(txn);
                                      switchOperatorTab("returns");
                                    }}
                                    className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 px-3 py-1.5 font-bold text-xs text-red-700 dark:text-red-300 transition flex items-center gap-1"
                                  >
                                    <span>↺</span> Return Items
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Recent Completed Transactions */}
            <SectionCard title="Recent Transactions in Store">
              {transactions.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
                  No sales recorded yet today. Completed transactions will display here.
                </div>
              ) : (
                <div className="space-y-3">
                  {transactions.slice(0, 5).map((txn) => {
                    const txnDiscount = txn.discount as any;
                    return (
                      <div
                        key={txn.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 px-4 py-3"
                      >
                        <div>
                          <div className="font-bold text-xs text-[#173c32] dark:text-white flex items-center gap-2">
                            <span>{txn.items.map((i) => `${i.productName} × ${i.quantity}`).join(", ")}</span>
                            {txnDiscount && txnDiscount.amount > 0 && (
                              <span className="rounded-md bg-green-100 dark:bg-green-950 px-1.5 py-0.5 text-[9px] font-bold text-green-700 dark:text-green-300">
                                -Rs. {Number(txnDiscount.amount).toFixed(2)} off
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                            {txn.receiptNumber} · {new Date(txn.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Cashier: {txn.operatorName} · {txn.paymentMethod.toUpperCase()}
                            {txn.cashGiven && ` · Cash: Rs. ${txn.cashGiven.toFixed(2)} (Change: Rs. ${(txn.changeDue || 0).toFixed(2)})`}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="font-black text-sm text-[#173c32] dark:text-[#d7a35d]">
                              Rs. {txn.total.toFixed(2)}
                            </div>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                txn.status === "returned"
                                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                  : txn.status === "partially_returned"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                  : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                              }`}
                            >
                              {txn.status === "returned"
                                ? "↺ Returned"
                                : txn.status === "partially_returned"
                                ? "↺ Partial Return"
                                : "✓ Completed"}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => setCompletedTxn(txn)}
                            className="rounded-xl border border-[#d7a35d] bg-[#d7a35d]/10 hover:bg-[#d7a35d]/20 px-2.5 py-1.5 text-xs font-bold text-[#173c32] dark:text-[#d7a35d] transition flex items-center gap-1"
                          >
                            <span>🧾</span> View
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>

      {/* Floating mobile cart drawer button for screens < lg */}
      {cart.length > 0 && operatorTab === "register" && (
        <aside aria-label="Mobile cart" className="fixed bottom-4 left-4 right-4 z-30 lg:hidden animate-in fade-in slide-in-from-bottom-3 duration-200">
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("cart-panel");
              el?.scrollIntoView({ behavior: "smooth" });
            }}
            className="flex w-full items-center justify-between rounded-2xl bg-[#173c32] dark:bg-[#d7a35d] px-5 py-3.5 text-white dark:text-[#173c32] shadow-xl shadow-black/25 font-bold text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">🛒</span>
              <span>{cart.length} {cart.length === 1 ? "item" : "items"} in cart</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black">Rs. {grandTotal.toFixed(2)}</span>
              <span className="rounded-lg bg-white/20 dark:bg-black/20 px-2 py-1 text-xs">Checkout ↓</span>
            </div>
          </button>
        </aside>
      )}

      {/* Sale Completion Receipt Modal */}
      {completedTxn && (
        <Modal
          open={true}
          onClose={() => setCompletedTxn(null)}
          title="Sale Receipt"
        >
          <div className="space-y-4 receipt-printable">
            <div className="rounded-2xl bg-green-50 dark:bg-green-950/30 p-4 text-center border border-green-200 dark:border-green-800">
              <span className="text-2xl">🎉</span>
              <h3 className="text-base font-black text-green-800 dark:text-green-300 mt-1">
                Transaction Successful!
              </h3>
              <p className="text-xs text-green-700 dark:text-green-400 font-mono mt-0.5">
                {completedTxn.receiptNumber} · Stored in {isOnline ? "RxDB + DynamoDB" : "RxDB (Offline Sync Queue)"}
              </p>
              <p className="text-[11px] text-[#5d665f] dark:text-[#a0ada5] mt-1">
                {new Date(completedTxn.createdAt).toLocaleString()} · Cashier: {completedTxn.operatorName}
              </p>
            </div>

            <div className="space-y-2 border-y border-[#ece4da] dark:border-white/10 py-3 text-xs">
              <div className="font-bold text-[#5d665f] dark:text-[#a0ada5] text-[10px] uppercase tracking-wider pb-1">
                Itemized Summary
              </div>
              {completedTxn.items.map((it, idx) => (
                <div key={idx} className="flex justify-between">
                  <span>{it.productName} × {it.quantity}</span>
                  <span className="font-bold">Rs. {it.lineTotal.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                <span>Subtotal</span>
                <span>Rs. {completedTxn.subtotal.toFixed(2)}</span>
              </div>
              
              {completedTxn.discount && (
                <div className="flex justify-between text-green-700 dark:text-green-400 font-semibold">
                  <span>Special Discount ({completedTxn.discount.type === "percent" ? `${completedTxn.discount.value}%` : `Rs. ${completedTxn.discount.value}`})</span>
                  <span>-Rs. {Number((completedTxn.discount as any).amount || 0).toFixed(2)}</span>
                </div>
              )}

              {completedTxn.tax > 0 && (
                <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                  <span>Sales Tax</span>
                  <span>Rs. {completedTxn.tax.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between font-black text-sm text-[#173c32] dark:text-white pt-1 border-t border-[#ece4da] dark:border-white/10">
                <span>Grand Total</span>
                <span className="text-[#d7a35d]">Rs. {completedTxn.total.toFixed(2)}</span>
              </div>

              <div className="flex justify-between text-[11px] text-[#5d665f] dark:text-[#a0ada5] pt-0.5">
                <span>Payment Method</span>
                <span className="font-semibold uppercase">{completedTxn.paymentMethod}</span>
              </div>

              {completedTxn.paymentMethod === "cash" && completedTxn.cashGiven && (
                <div className="mt-2 rounded-xl bg-[#faf8f4] dark:bg-white/5 p-2 border border-[#ece4da] dark:border-white/10 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>Cash Tendered:</span>
                    <span className="font-bold">Rs. {completedTxn.cashGiven.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Bill Amount:</span>
                    <span className="font-bold text-red-600">-Rs. {completedTxn.total.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-black text-green-700 dark:text-green-400 border-t border-[#ece4da] dark:border-white/10 pt-1">
                    <span>Change Returned:</span>
                    <span>Rs. {(completedTxn.changeDue || 0).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-2 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 rounded-2xl border border-[#d7a35d] bg-[#d7a35d]/10 hover:bg-[#d7a35d]/20 py-3 text-xs font-bold text-[#173c32] dark:text-[#d7a35d] transition flex items-center justify-center gap-1.5"
              >
                <span>🖨️</span> Print Customer Receipt
              </button>
              <button
                type="button"
                onClick={() => setCompletedTxn(null)}
                className="flex-1 rounded-2xl bg-[#173c32] dark:bg-[#215446] py-3 text-xs font-bold text-white transition hover:bg-[#0f2d2b]"
              >
                Close & Next Sale
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Product & Inventory Modal */}
      <Modal open={addProdModalOpen} onClose={() => setAddProdModalOpen(false)} title="Add Product to Store Inventory">
        <form onSubmit={handleAddProductSubmit} className="space-y-4 text-xs">
          {addProdError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300">
              {addProdError}
            </div>
          )}

          {(() => {
            const match = products.find(
              (p) => p.name.trim().toLowerCase() === newProdName.trim().toLowerCase()
            );
            if (!match) return null;
            return (
              <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-2.5 text-[11px] text-blue-700 dark:text-blue-300 font-semibold flex items-center gap-2">
                <span>ℹ️</span>
                <span>
                  Existing product detected ({inventory[match.id] ?? 0} in stock). Saving will add <strong>+{newProdStock || 0}</strong> units to existing inventory.
                </span>
              </div>
            );
          })()}

          <div>
            <label className="block font-bold mb-1">Product Name</label>
            <input
              required
              type="text"
              value={newProdName}
              onChange={(e) => setNewProdName(e.target.value)}
              placeholder="e.g. Single Origin Espresso"
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 font-semibold text-[#173c32] dark:text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">SKU / Barcode</label>
              <input
                type="text"
                value={newProdSku}
                onChange={(e) => setNewProdSku(e.target.value)}
                placeholder="Auto-generated if blank"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 font-mono text-[#173c32] dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Category</label>
              <input
                type="text"
                value={newProdCategory}
                onChange={(e) => setNewProdCategory(e.target.value)}
                placeholder="Beverages, Bakery, Food…"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-[#173c32] dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-bold mb-1">Selling Price (Rs. / PKR) *</label>
              <input
                required
                type="number"
                step="any"
                min="0.01"
                value={newProdPrice}
                onChange={(e) => setNewProdPrice(e.target.value)}
                placeholder="150.00"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 font-bold text-[#173c32] dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Initial Stock</label>
              <input
                type="number"
                min="0"
                value={newProdStock}
                onChange={(e) => setNewProdStock(e.target.value)}
                placeholder="50"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 font-bold text-[#173c32] dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Low Warning</label>
              <input
                type="number"
                min="1"
                value={newProdLowStock}
                onChange={(e) => setNewProdLowStock(e.target.value)}
                placeholder="5"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-[#173c32] dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">Unit of Measure</label>
            <input
              type="text"
              value={newProdUnit}
              onChange={(e) => setNewProdUnit(e.target.value)}
              placeholder="pcs, cups, bottles, kg…"
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-[#173c32] dark:text-white"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddProdModalOpen(false)}
              className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 transition touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addingProd}
              className="flex-1 rounded-xl bg-[#173c32] dark:bg-[#215446] py-2.5 font-bold text-white hover:bg-[#0f2d2b] disabled:opacity-60 transition touch-manipulation"
            >
              {addingProd ? "Adding Product…" : "Add Product & Stock"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Quick Restock Modal */}
      {restockTargetProd && (
        <Modal
          open={restockModalOpen}
          onClose={() => {
            setRestockModalOpen(false);
            setRestockTargetProd(null);
          }}
          title={`Restock: ${restockTargetProd.name}`}
        >
          <form onSubmit={handleRestockSubmit} className="space-y-4 text-xs">
            {restockError && (
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300">
                {restockError}
              </div>
            )}

            <div className="rounded-2xl bg-[#faf8f4] dark:bg-black/20 p-3 border border-[#ece4da] dark:border-white/10 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">Current Stock:</span>
                <p className="text-sm font-black text-[#173c32] dark:text-white">
                  {(inventory[restockTargetProd.id] ??
                    (restockTargetProd.name
                      ? inventory[restockTargetProd.name.trim().toLowerCase()]
                      : undefined) ??
                    0)}{" "}
                  units
                </p>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">SKU:</span>
                <p className="font-mono font-bold text-xs text-[#173c32] dark:text-white">
                  {restockTargetProd.sku}
                </p>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">Add Units to Inventory Stock</label>
              <input
                required
                type="number"
                min="1"
                value={restockUnitsToAdd}
                onChange={(e) => setRestockUnitsToAdd(e.target.value)}
                placeholder="20"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 font-bold text-base text-[#173c32] dark:text-white"
              />
              <p className="mt-1 text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                New total stock will be:{" "}
                <strong>
                  {(inventory[restockTargetProd.id] ?? 0) + (parseInt(restockUnitsToAdd, 10) || 0)} units
                </strong>
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRestockModalOpen(false);
                  setRestockTargetProd(null);
                }}
                className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 transition touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={restocking}
                className="flex-1 rounded-xl bg-[#173c32] dark:bg-[#215446] py-2.5 font-bold text-white hover:bg-[#0f2d2b] disabled:opacity-60 transition touch-manipulation"
              >
                {restocking ? "Updating Stock…" : "Confirm & Update Stock"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}

export default function OperatorDashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#173c32] dark:text-[#f6f1ea] font-semibold">
          Loading POS Register…
        </div>
      }
    >
      <OperatorDashboardContent />
    </Suspense>
  );
}

"use client";

import { useEffect, useState, useCallback, useMemo, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePosDatabase } from "@/context/DatabaseContext";
import { getJson, postJson, putJson, deleteJson } from "@/lib/api";
import { DashboardHeader } from "@/components/ui/DashboardHeader";
import { StatCard } from "@/components/ui/StatCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Sidebar } from "@/components/layout/Sidebar";
import { EmailOtpVerifier } from "@/components/ui/EmailOtpVerifier";
import type { PosProduct, PosInventory, PosTransaction } from "@/lib/pos-database";

type StaffUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
  dailyWage?: number;
  jobTitle?: string;
  createdAt: string;
};

type TabType = "team" | "products" | "inventory" | "transactions";

type AttendanceEditRequest = {
  id: string;
  tenantId: string;
  date: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "used";
  requestedBy: string;
  requestedByName: string;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: string;
  updatedAt: string;
};

function SubAdminContent() {
  const { user, token, loading } = useAuth();
  const { db, isOnline, dbReady } = usePosDatabase();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Active tab: team | products | inventory | transactions
  const urlTab = (searchParams.get("tab") as TabType) || "team";
  const [activeTab, setActiveTab] = useState<TabType>(urlTab);

  useEffect(() => {
    const tab = searchParams.get("tab") as TabType;
    if (tab && ["team", "products", "inventory", "transactions"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    router.replace(`/dashboard/subadmin?tab=${tab}`);
  };

  // Staff State
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Add staff modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [newStaffPassword, setNewStaffPassword] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<"HR" | "Operator">("Operator");
  const [newStaffDailyWage, setNewStaffDailyWage] = useState("0");
  const [staffOtpVerified, setStaffOtpVerified] = useState(false);
  const [staffVerificationToken, setStaffVerificationToken] = useState("");
  const [addStaffError, setAddStaffError] = useState("");
  const [addingStaff, setAddingStaff] = useState(false);

  // Daily Wage Edit Modal State
  const [wageModalUser, setWageModalUser] = useState<StaffUser | null>(null);
  const [editWageValue, setEditWageValue] = useState("");
  const [savingWage, setSavingWage] = useState(false);
  const [wageError, setWageError] = useState("");

  // Products, Inventory, Transactions state
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [inventory, setInventory] = useState<PosInventory[]>([]);
  const [transactions, setTransactions] = useState<PosTransaction[]>([]);

  // Product & Inventory Deletion State
  const [deleteProdTarget, setDeleteProdTarget] = useState<{
    id: string;
    name: string;
    sku?: string;
    price?: number;
    stock?: number;
  } | null>(null);
  const [deleteProdError, setDeleteProdError] = useState("");
  const [deletingProd, setDeletingProd] = useState(false);
  const [prodNotice, setProdNotice] = useState("");

  const showProdNotice = (msg: string) => {
    setProdNotice(msg);
    setTimeout(() => setProdNotice(""), 6000);
  };

  // Search/Filter states
  const [prodSearch, setProdSearch] = useState("");
  const [invSearch, setInvSearch] = useState("");
  const [txnSearch, setTxnSearch] = useState("");

  // View Transaction modal state
  const [viewTxnTarget, setViewTxnTarget] = useState<PosTransaction | null>(null);

  // Attendance Edit Requests (from HR)
  const [attRequests, setAttRequests] = useState<AttendanceEditRequest[]>([]);
  const [actionAttId, setActionAttId] = useState<string | null>(null);
  const [attFeedback, setAttFeedback] = useState("");

  // Auth guard — SubAdmin only
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "SubAdmin") {
      router.replace("/dashboard");
      return;
    }
  }, [user, loading, router]);

  // Load team users from API
  const loadUsers = useCallback(async () => {
    if (!token) return;
    setUsersLoading(true);
    try {
      const data = await getJson<{ users: StaffUser[] }>("/api/users", token);
      setUsers(data.users);
    } catch {
      // silently fail — show empty table
    } finally {
      setUsersLoading(false);
    }
  }, [token]);

  // Load products, inventory, transactions (RxDB + Direct API Hydration)
  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    let loadedProducts: PosProduct[] = [];
    let loadedInventory: PosInventory[] = [];
    let loadedTxns: PosTransaction[] = [];

    // 1. Read from local RxDB
    if (db) {
      try {
        const pDocs = await db.products
          .find({ selector: { tenantId: user.tenantId, _deleted: false } })
          .exec();
        loadedProducts = pDocs.map((d: any) => d.toJSON() as PosProduct);

        const iDocs = await db.inventory
          .find({ selector: { tenantId: user.tenantId, _deleted: false } })
          .exec();
        loadedInventory = iDocs.map((d: any) => d.toJSON() as PosInventory);

        const tDocs = await db.transactions
          .find({ selector: { tenantId: user.tenantId, _deleted: false } })
          .exec();
        loadedTxns = tDocs.map((d: any) => d.toJSON() as PosTransaction);
      } catch (e) {
        console.warn("SubAdmin RxDB load error:", e);
      }
    }

    // 2. Fetch directly from server when online
    if (isOnline && token) {
      try {
        const [prodRes, invRes, txnRes] = await Promise.all([
          getJson<{ products: PosProduct[] }>("/api/products", token),
          getJson<{ inventory: PosInventory[] }>("/api/inventory", token),
          getJson<{ transactions: PosTransaction[] }>("/api/transactions", token).catch(() => ({ transactions: [] })),
        ]);

        if (prodRes?.products) {
          loadedProducts = prodRes.products;
          if (db) {
            const onlineIds = new Set(prodRes.products.map((p) => p.id));
            const localDocs = await db.products
              .find({ selector: { tenantId: user.tenantId, _deleted: false } })
              .exec();
            for (const doc of localDocs) {
              if (!onlineIds.has(doc.id)) {
                try {
                  await doc.patch({ _deleted: true });
                } catch {}
              }
            }
            for (const p of prodRes.products) {
              try {
                const existing = await db.products.findOne({ selector: { id: p.id } }).exec();
                if (existing) await existing.patch(p);
                else await db.products.insert(p);
              } catch {}
            }
          }
        }

        if (invRes?.inventory) {
          loadedInventory = invRes.inventory;
          if (db) {
            const onlineInvIds = new Set(invRes.inventory.map((i) => i.id));
            const localInvs = await db.inventory
              .find({ selector: { tenantId: user.tenantId, _deleted: false } })
              .exec();
            for (const doc of localInvs) {
              if (!onlineInvIds.has(doc.id)) {
                try {
                  await doc.patch({ _deleted: true });
                } catch {}
              }
            }
            for (const i of invRes.inventory) {
              try {
                const existing = await db.inventory.findOne({ selector: { id: i.id } }).exec();
                if (existing) await existing.patch(i);
                else await db.inventory.insert(i);
              } catch {}
            }
          }
        }

        if (txnRes?.transactions && txnRes.transactions.length > 0) {
          loadedTxns = txnRes.transactions;
        }
      } catch (apiErr) {
        console.warn("SubAdmin online data fetch notice:", apiErr);
      }
    }

    loadedTxns.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    setProducts(loadedProducts);
    setInventory(loadedInventory);
    setTransactions(loadedTxns);
  }, [db, user?.tenantId, isOnline, token]);

  useEffect(() => {
    loadUsers();
    loadData();
  }, [loadUsers, loadData]);

  // Periodic poll to keep SubAdmin console in sync with Operators' live counter actions
  useEffect(() => {
    const timer = setInterval(() => {
      loadData();
    }, 10000);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    if (dbReady && db) {
      loadData();
      const subP = db.products.$.subscribe(() => loadData());
      const subI = db.inventory.$.subscribe(() => loadData());
      const subT = db.transactions.$.subscribe(() => loadData());
      return () => {
        subP.unsubscribe();
        subI.unsubscribe();
        subT.unsubscribe();
      };
    }
  }, [dbReady, db, loadData]);

  // Handle Product Deletion from Catalog & Inventory
  const handleDeleteProductConfirm = async () => {
    if (!deleteProdTarget || !user?.tenantId) return;
    setDeletingProd(true);
    setDeleteProdError("");
    try {
      // 1. Delete on backend API if online
      if (isOnline && token) {
        try {
          await deleteJson(`/api/products/${deleteProdTarget.id}`, token);
        } catch (apiErr: any) {
          try {
            await deleteJson(`/api/inventory/${deleteProdTarget.id}`, token);
          } catch (invErr) {
            console.warn("API delete fallback notice:", invErr);
          }
        }
      }

      // 2. Soft-delete in local RxDB
      if (db) {
        try {
          const pDoc = await db.products.findOne({ selector: { id: deleteProdTarget.id } }).exec();
          if (pDoc) await pDoc.patch({ _deleted: true });

          const pDocByName = await db.products.findOne({
            selector: { tenantId: user.tenantId, name: deleteProdTarget.name }
          }).exec();
          if (pDocByName) await pDocByName.patch({ _deleted: true });

          const iDocs = await db.inventory.find({
            selector: { tenantId: user.tenantId, _deleted: false }
          }).exec();
          for (const doc of iDocs) {
            const data = doc.toJSON();
            if (
              data.productId === deleteProdTarget.id ||
              data.productName?.trim().toLowerCase() === deleteProdTarget.name.trim().toLowerCase()
            ) {
              await doc.patch({ _deleted: true });
            }
          }
        } catch (rxErr) {
          console.warn("RxDB soft delete notice:", rxErr);
        }
      }

      // 3. Immediately update React state
      const targetId = deleteProdTarget.id;
      const targetName = deleteProdTarget.name.trim().toLowerCase();
      setProducts((prev) =>
        prev.filter((p) => p.id !== targetId && p.name.trim().toLowerCase() !== targetName)
      );
      setInventory((prev) =>
        prev.filter((i) => i.productId !== targetId && i.productName.trim().toLowerCase() !== targetName)
      );

      showProdNotice(`✓ Removed "${deleteProdTarget.name}" from store catalog & inventory!`);
      setDeleteProdTarget(null);
      await loadData();
    } catch (err: any) {
      console.error("Failed to delete product:", err);
      setDeleteProdError(err?.message || "Failed to remove product from inventory.");
    } finally {
      setDeletingProd(false);
    }
  };

  // Stock mapping by ID and lowercase name
  const stockMap = useMemo(() => {
    const map: Record<string, { stockQty: number; lowStockThreshold: number; unit: string }> = {};
    inventory.forEach((inv) => {
      if (inv.productId) {
        map[inv.productId] = {
          stockQty: inv.stockQty,
          lowStockThreshold: inv.lowStockThreshold || 5,
          unit: inv.unit || "pcs",
        };
      }
      if (inv.productName) {
        map[inv.productName.trim().toLowerCase()] = {
          stockQty: inv.stockQty,
          lowStockThreshold: inv.lowStockThreshold || 5,
          unit: inv.unit || "pcs",
        };
      }
    });
    return map;
  }, [inventory]);

  // Inventory Health Metrics & Low Stock Detection
  const inventoryHealth = useMemo(() => {
    let healthyCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    inventory.forEach((inv) => {
      if (inv.stockQty <= 0) {
        outOfStockCount++;
      } else if (inv.stockQty <= (inv.lowStockThreshold || 5)) {
        lowStockCount++;
      } else {
        healthyCount++;
      }
    });

    return {
      total: inventory.length,
      healthyCount,
      lowStockCount,
      outOfStockCount,
      hasAlerts: lowStockCount > 0 || outOfStockCount > 0,
    };
  }, [inventory]);

  // Load attendance edit requests from HR
  const loadAttendanceRequests = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getJson<{ requests: AttendanceEditRequest[] }>("/api/attendance/requests", token);
      setAttRequests(data.requests || []);
    } catch {
      // silently fail
    }
  }, [token]);

  useEffect(() => {
    loadAttendanceRequests();
  }, [loadAttendanceRequests]);

  const handleApproveAttendanceRequest = async (id: string, reqDate: string) => {
    if (!token) return;
    setActionAttId(id);
    setAttFeedback("");
    try {
      await postJson(`/api/attendance/requests/${id}/approve`, {}, token);
      setAttFeedback(`✓ Attendance edit permission granted for ${reqDate}. HR can now modify and re-save.`);
      await loadAttendanceRequests();
      setTimeout(() => setAttFeedback(""), 6000);
    } catch (err: any) {
      setAttFeedback(`⚠️ Failed to approve: ${err?.message || "Unknown error"}`);
    } finally {
      setActionAttId(null);
    }
  };

  const handleRejectAttendanceRequest = async (id: string, reqDate: string) => {
    if (!token) return;
    setActionAttId(id);
    setAttFeedback("");
    try {
      await postJson(`/api/attendance/requests/${id}/reject`, {}, token);
      setAttFeedback(`✕ Attendance edit request for ${reqDate} was rejected.`);
      await loadAttendanceRequests();
      setTimeout(() => setAttFeedback(""), 6000);
    } catch (err: any) {
      setAttFeedback(`⚠️ Failed to reject: ${err?.message || "Unknown error"}`);
    } finally {
      setActionAttId(null);
    }
  };

  const hrCount = users.filter((u) => u.role === "HR").length;
  const operatorCount = users.filter((u) => u.role === "Operator").length;
  const employeeCount = users.filter((u) => u.role === "Employee").length;

  // Local calendar date helper (YYYY-MM-DD)
  const todayStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  // Store Financials: Gross Sales, Returns, Net Earnings
  const storeGrossSales = useMemo(() => {
    return transactions.reduce((sum, t) => sum + (Number(t.total) || 0), 0);
  }, [transactions]);

  const storeTotalReturns = useMemo(() => {
    return transactions.reduce((sum, t) => {
      if (t.status === "returned") {
        return sum + (Number(t.refundAmount) || Number(t.total) || 0);
      }
      if (t.status === "partially_returned") {
        return sum + (Number(t.refundAmount) || 0);
      }
      return sum;
    }, 0);
  }, [transactions]);

  const storeNetEarnings = useMemo(() => {
    return Math.max(0, Number((storeGrossSales - storeTotalReturns).toFixed(2)));
  }, [storeGrossSales, storeTotalReturns]);

  // Today's metrics (standard local date)
  const todayGrossSales = useMemo(() => {
    return transactions
      .filter((t) => (t.createdAt || "").slice(0, 10) === todayStr)
      .reduce((sum, t) => sum + (Number(t.total) || 0), 0);
  }, [transactions, todayStr]);

  const todayReturns = useMemo(() => {
    return transactions.reduce((sum, t) => {
      const returnDate = (t.returnedAt || t.updatedAt || "").slice(0, 10);
      const createdDate = (t.createdAt || "").slice(0, 10);
      if (returnDate === todayStr || (createdDate === todayStr && (t.status === "returned" || t.status === "partially_returned"))) {
        return sum + (Number(t.refundAmount) || (t.status === "returned" ? Number(t.total) : 0));
      }
      return sum;
    }, 0);
  }, [transactions, todayStr]);

  const todayNetSales = useMemo(() => {
    return Math.max(0, Number((todayGrossSales - todayReturns).toFixed(2)));
  }, [todayGrossSales, todayReturns]);

  const pendingRequests = attRequests.filter((r) => r.status === "pending");

  // Handle staff addition
  const handleOpenAddModal = () => {
    setNewStaffName("");
    setNewStaffEmail("");
    setNewStaffPassword("");
    setNewStaffRole(hrCount >= 1 ? "Operator" : "HR");
    setNewStaffDailyWage("50");
    setStaffOtpVerified(false);
    setStaffVerificationToken("");
    setAddStaffError("");
    setAddModalOpen(true);
  };

  const handleAddStaffSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setAddStaffError("");

    if (newStaffRole === "HR" && hrCount >= 1) {
      setAddStaffError("Your store already has an assigned HR account (maximum 1 HR).");
      return;
    }

    if (newStaffPassword.length < 8) {
      setAddStaffError("Password must be at least 8 characters.");
      return;
    }

    if (!staffOtpVerified) {
      setAddStaffError("Please verify the staff email address with the OTP code first.");
      return;
    }

    setAddingStaff(true);
    try {
      await postJson<{ user: StaffUser }>(
        "/api/users/staff",
        {
          name: newStaffName.trim(),
          email: newStaffEmail.trim(),
          password: newStaffPassword,
          role: newStaffRole,
          dailyWage: parseFloat(newStaffDailyWage) || 0,
          verificationToken: staffVerificationToken,
        },
        token
      );
      setAddModalOpen(false);
      setStaffOtpVerified(false);
      setStaffVerificationToken("");
      await loadUsers();
    } catch (err: any) {
      setAddStaffError(err?.message || "Failed to add staff member.");
    } finally {
      setAddingStaff(false);
    }
  };

  // Open Wage Edit Modal
  const handleOpenWageModal = (target: StaffUser) => {
    setWageModalUser(target);
    setEditWageValue((target.dailyWage ?? 0).toString());
    setWageError("");
  };

  // Save Daily Wage
  const handleSaveWage = async (e: FormEvent) => {
    e.preventDefault();
    if (!wageModalUser || !token) return;
    setWageError("");
    const wageNum = parseFloat(editWageValue);
    if (isNaN(wageNum) || wageNum < 0) {
      setWageError("Please enter a valid non-negative daily wage amount.");
      return;
    }

    setSavingWage(true);
    try {
      await putJson<{ user: StaffUser }>(
        `/api/users/${wageModalUser.id}/wage`,
        { dailyWage: wageNum },
        token
      );
      setWageModalUser(null);
      await loadUsers();
    } catch (err: any) {
      setWageError(err?.message || "Failed to update daily wage.");
    } finally {
      setSavingWage(false);
    }
  };

  // Handle staff deletion
  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !token) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteJson(`/api/users/${deleteTarget.id}`, token);
      setDeleteTarget(null);
      await loadUsers();
    } catch (err: any) {
      setDeleteError(err?.message || "Failed to delete staff member.");
    } finally {
      setDeleting(false);
    }
  };



  // Filtered products list
  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(prodSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(prodSearch.toLowerCase()) ||
      p.category.toLowerCase().includes(prodSearch.toLowerCase())
  );

  // Filtered inventory list
  const filteredInventory = inventory.filter((inv) =>
    inv.productName.toLowerCase().includes(invSearch.toLowerCase()) ||
    inv.unit.toLowerCase().includes(invSearch.toLowerCase())
  );

  // Filtered transactions list
  const filteredTransactions = transactions.filter(
    (t) =>
      t.receiptNumber.toLowerCase().includes(txnSearch.toLowerCase()) ||
      t.operatorName.toLowerCase().includes(txnSearch.toLowerCase()) ||
      t.items.some((it) => it.productName.toLowerCase().includes(txnSearch.toLowerCase()))
  );

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#173c32] dark:text-[#f6f1ea] font-semibold">
        Loading Store Console…
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f1ea] dark:bg-[#0d1512] p-4 text-[#1f2a25] dark:text-[#f6f1ea] lg:p-8 transition-colors duration-200">
      <div className="mx-auto max-w-7xl">
        <DashboardHeader
          title="Store Console"
          subtitle={`Management & Operations · ${user.tenantName ?? "Your Organisation"}`}
        />

        {/* Live Network & Database Sync Banner */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] p-4 shadow-sm">
          <div className="flex items-center gap-3">
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
                {isOnline ? "Online — Live DynamoDB Synchronization Active" : "Offline — Operating on Local RxDB Storage"}
              </strong>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-[#5d665f] dark:text-[#a0ada5]">
            <span>Catalog: <strong className="text-[#173c32] dark:text-white">{products.length} items</strong></span>
            <span>Gross Sales: <strong className="text-[#173c32] dark:text-white">Rs. {storeGrossSales.toFixed(2)}</strong></span>
            {storeTotalReturns > 0 && (
              <span>Returns: <strong className="text-red-600 dark:text-red-400 font-bold">-Rs. {storeTotalReturns.toFixed(2)}</strong></span>
            )}
            <span>Net Earnings: <strong className="text-green-700 dark:text-green-400 font-extrabold">Rs. {storeNetEarnings.toFixed(2)}</strong></span>
          </div>
        </div>

        {prodNotice && (
          <div className="mb-6 rounded-2xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-3 text-xs font-bold text-green-800 dark:text-green-300 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <span>✓</span>
              <span>{prodNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setProdNotice("")}
              className="text-xs text-green-700 hover:text-green-900 dark:text-green-400 dark:hover:text-green-200"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex flex-col gap-6 lg:flex-row">
          <Sidebar role="SubAdmin" />

          <div className="min-w-0 flex-1 space-y-6">
            {/* KPI Stats */}
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Net Store Earnings"
                value={`Rs. ${storeNetEarnings.toFixed(2)}`}
                accent="gold"
                sub={`Today: Rs. ${todayNetSales.toFixed(2)}`}
              />
              <StatCard
                label="Gross Store Sales"
                value={`Rs. ${storeGrossSales.toFixed(2)}`}
                accent="green"
                sub={`Today: Rs. ${todayGrossSales.toFixed(2)}`}
              />
              <StatCard
                label="Returns / Refunds"
                value={`-Rs. ${storeTotalReturns.toFixed(2)}`}
                accent={storeTotalReturns > 0 ? "slate" : "slate"}
                sub={`Today: -Rs. ${todayReturns.toFixed(2)}`}
              />
              <StatCard
                label="Store Products"
                value={products.length.toString()}
                accent="blue"
                sub={inventoryHealth.lowStockCount > 0 ? `${inventoryHealth.lowStockCount} low stock` : "Healthy stock"}
              />
              <StatCard
                label="Store Team"
                value={`${hrCount + operatorCount + employeeCount}`}
                accent="green"
                sub={`${hrCount} HR, ${operatorCount} Operators, ${employeeCount} Staff`}
              />
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-[#ece4da] dark:border-white/10 gap-2 overflow-x-auto touch-scroll pb-1 sm:justify-center">
              {[
                {
                  id: "team",
                  label:
                    pendingRequests.length > 0
                      ? `👥 Store Team & Wages (${pendingRequests.length} Pending)`
                      : "👥 Store Team & Wages",
                },
                {
                  id: "products",
                  label: `📦 Product Catalog (${products.length})`,
                },
                {
                  id: "inventory",
                  label:
                    inventoryHealth.hasAlerts
                      ? `📊 Inventory & Stock (${inventoryHealth.lowStockCount + inventoryHealth.outOfStockCount} Low/Out)`
                      : `📊 Inventory & Stock (${inventory.length})`,
                },
                { id: "transactions", label: "🧾 Sales & Transactions" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchTab(tab.id as TabType)}
                  className={`shrink-0 border-b-2 px-3 sm:px-4 py-2.5 text-xs font-bold transition touch-manipulation min-h-[44px] inline-flex items-center justify-center gap-1.5 ${
                    activeTab === tab.id
                      ? "border-[#173c32] dark:border-[#d7a35d] text-[#173c32] dark:text-white"
                      : "border-transparent text-[#5d665f] dark:text-[#a0ada5] hover:text-[#173c32] dark:hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* TAB 1: TEAM & WAGES */}
            {activeTab === "team" && (
              <div className="space-y-6">
                {/* HR Attendance Edit Approvals */}
                <div className="rounded-2xl border border-amber-300 dark:border-amber-700/50 bg-[#fffdf7] dark:bg-amber-950/20 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-[#173c32] dark:text-white flex items-center gap-2">
                        <span>🔒</span> HR Attendance Edit Requests
                        {pendingRequests.length > 0 && (
                          <span className="rounded-full bg-amber-500 text-white px-2 py-0.5 text-[10px] font-black">
                            {pendingRequests.length} PENDING
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mt-0.5">
                        HR can only save daily attendance once. When HR requests to update a saved date, you can review their reason and approve or reject permission here.
                      </p>
                    </div>
                  </div>

                  {attFeedback && (
                    <div className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      {attFeedback}
                    </div>
                  )}

                  {attRequests.length === 0 ? (
                    <div className="py-2 text-xs text-[#5d665f] dark:text-[#a0ada5] italic">
                      No attendance edit requests received from HR yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto touch-scroll">
                      <table className="w-full min-w-[620px] text-xs text-left">
                        <thead>
                          <tr className="border-b border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]">
                            <th className="pb-2.5 font-bold">Target Date</th>
                            <th className="pb-2.5 font-bold">Requested By</th>
                            <th className="pb-2.5 font-bold">Reason</th>
                            <th className="pb-2.5 font-bold">Status</th>
                            <th className="pb-2.5 font-bold text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ece4da] dark:divide-white/5">
                          {attRequests.slice(0, 8).map((req) => (
                            <tr key={req.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                              <td className="py-2.5 font-mono font-bold text-[#173c32] dark:text-white">{req.date}</td>
                              <td className="py-2.5 text-[#5d665f] dark:text-[#a0ada5]">{req.requestedByName}</td>
                              <td className="py-2.5 max-w-[220px] truncate" title={req.reason}>{req.reason}</td>
                              <td className="py-2.5">
                                <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                                  req.status === "pending"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-extrabold"
                                    : req.status === "approved"
                                    ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                                    : req.status === "rejected"
                                    ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                                    : "bg-stone-100 text-[#5d665f] dark:bg-white/5 dark:text-[#a0ada5]"
                                }`}>
                                  {req.status === "pending" ? "Pending Approval" : req.status === "used" ? "Updated & Re-locked" : req.status}
                                </span>
                              </td>
                              <td className="py-2.5 text-right">
                                {req.status === "pending" ? (
                                  <div className="inline-flex items-center gap-1.5 justify-end">
                                    <button
                                      type="button"
                                      disabled={actionAttId === req.id}
                                      onClick={() => handleApproveAttendanceRequest(req.id, req.date)}
                                      className="rounded-lg bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-50"
                                    >
                                      ✓ Approve
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionAttId === req.id}
                                      onClick={() => handleRejectAttendanceRequest(req.id, req.date)}
                                      className="rounded-lg bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 px-2 py-1 text-[11px] font-bold transition disabled:opacity-50"
                                    >
                                      ✕ Reject
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-[#5d665f]">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <SectionCard
                  title="Store Team & Daily Wages"
                action={
                  <button
                    type="button"
                    onClick={handleOpenAddModal}
                    className="rounded-xl bg-[#173c32] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#0f2d2b] touch-manipulation"
                  >
                    + Add Staff Member
                  </button>
                }
              >
                {usersLoading ? (
                  <div className="py-10 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">Loading store personnel…</div>
                ) : (
                  <DataTable<StaffUser>
                    columns={[
                      { header: "Name", accessor: "name" },
                      { header: "Email / ID", accessor: "email" },
                      {
                        header: "Role / Title",
                        accessor: (u) => (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                u.role === "SubAdmin"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                  : u.role === "HR"
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                  : u.role === "Operator"
                                  ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                                  : "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                              }`}
                            >
                              {u.role}
                            </span>
                            {u.jobTitle && <span className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">({u.jobTitle})</span>}
                          </div>
                        ),
                      },
                      {
                        header: "Daily Wage",
                        accessor: (u) => (
                          <span className="font-extrabold text-xs text-[#173c32] dark:text-[#d7a35d]">
                            Rs. ${(u.dailyWage ?? 0).toFixed(2)}/day
                          </span>
                        ),
                      },
                    ]}
                    actions={(u) => (
                      <div className="inline-flex items-center gap-2">
                        {u.role !== "SubAdmin" && (
                          <button
                            type="button"
                            onClick={() => handleOpenWageModal(u)}
                            className="rounded-lg border border-[#d7a35d] bg-[#d7a35d]/10 hover:bg-[#d7a35d]/20 px-2.5 py-1 text-xs font-bold text-[#173c32] dark:text-[#d7a35d] transition touch-manipulation"
                          >
                            💵 Set Wage
                          </button>
                        )}
                        {u.id !== user?.id && u.role !== "SubAdmin" && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteTarget(u);
                              setDeleteError("");
                            }}
                            className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 transition touch-manipulation"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                    rows={users}
                    keyField="id"
                    emptyMessage="No staff members found. Click '+ Add Staff Member' to invite HR or Operators."
                  />
                )}
              </SectionCard>
              </div>
            )}

            {/* TAB 2: PRODUCTS */}
            {activeTab === "products" && (
              <SectionCard
                title="Store Products & Catalog"
                action={
                  <span className="text-xs font-semibold text-[#5d665f] dark:text-[#a0ada5]">
                    {products.length} Products registered
                  </span>
                }
              >
                {/* Search bar */}
                <div className="mb-4">
                  <input
                    type="text"
                    value={prodSearch}
                    onChange={(e) => setProdSearch(e.target.value)}
                    placeholder="Search products by name, SKU, or category…"
                    className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                  />
                </div>

                {filteredProducts.length === 0 ? (
                  <div className="py-10 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
                    {prodSearch
                      ? "No products match your search query."
                      : "No products added yet. Operators can add new products directly from their counter or catalog."}
                  </div>
                ) : (
                  <div className="overflow-x-auto touch-scroll">
                    <table className="w-full min-w-[700px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]">
                          <th className="pb-3 font-bold">Product Name</th>
                          <th className="pb-3 font-bold">SKU / Code</th>
                          <th className="pb-3 font-bold">Category</th>
                          <th className="pb-3 font-bold">Unit Price</th>
                          <th className="pb-3 font-bold">Current Stock</th>
                          <th className="pb-3 font-bold">Stock Status</th>
                          <th className="pb-3 font-bold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ece4da] dark:divide-white/5">
                        {filteredProducts.map((p) => {
                          const stockInfo = stockMap[p.id] ?? (p.name ? stockMap[p.name.trim().toLowerCase()] : undefined);
                          const curStock = stockInfo?.stockQty ?? 0;
                          const threshold = stockInfo?.lowStockThreshold ?? 5;
                          const unit = stockInfo?.unit ?? "pcs";
                          const isOut = curStock <= 0;
                          const isLow = curStock > 0 && curStock <= threshold;

                          return (
                            <tr key={p.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                              <td className="py-3 font-bold text-[#173c32] dark:text-white">
                                {p.name}
                              </td>
                              <td className="py-3 font-mono text-[#5d665f] dark:text-[#a0ada5]">
                                {p.sku || "—"}
                              </td>
                              <td className="py-3">{p.category || "General"}</td>
                              <td className="py-3 font-black text-[#173c32] dark:text-[#d7a35d]">
                                Rs. ${p.price.toFixed(2)}
                              </td>
                              <td className="py-3 font-extrabold text-[#173c32] dark:text-white">
                                {curStock} {unit}
                              </td>
                              <td className="py-3">
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                    isOut
                                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                      : isLow
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                      : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                                  }`}
                                >
                                  {isOut ? "🚨 Out of Stock" : isLow ? `⚠️ Low Stock (≤${threshold})` : "✓ Healthy"}
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteProdTarget({
                                      id: p.id,
                                      name: p.name,
                                      sku: p.sku,
                                      price: p.price,
                                      stock: curStock,
                                    });
                                    setDeleteProdError("");
                                  }}
                                  className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-2.5 py-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition touch-manipulation"
                                  title="Delete product from store and operator counters"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            )}

            {/* TAB 3: INVENTORY */}
            {activeTab === "inventory" && (
              <div className="space-y-4">
                {/* Inventory Overview Health Cards */}
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-2xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-[#14211c] p-4 shadow-sm">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#5d665f] dark:text-[#a0ada5]">
                      Total Tracked Items
                    </span>
                    <p className="mt-1 text-2xl font-black text-[#173c32] dark:text-white">
                      {inventoryHealth.total}
                    </p>
                    <span className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                      Active inventory records
                    </span>
                  </div>

                  <div className="rounded-2xl border border-green-200 dark:border-green-900/40 bg-green-50/50 dark:bg-green-950/20 p-4 shadow-sm">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-green-700 dark:text-green-300">
                      Healthy Stock
                    </span>
                    <p className="mt-1 text-2xl font-black text-green-700 dark:text-green-300">
                      {inventoryHealth.healthyCount}
                    </p>
                    <span className="text-[11px] text-green-600 dark:text-green-400">
                      Above threshold
                    </span>
                  </div>

                  <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 p-4 shadow-sm">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                      Low Stock Warning
                    </span>
                    <p className="mt-1 text-2xl font-black text-amber-700 dark:text-amber-300">
                      {inventoryHealth.lowStockCount}
                    </p>
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">
                      Restock recommended
                    </span>
                  </div>

                  <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 p-4 shadow-sm">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                      Out of Stock
                    </span>
                    <p className="mt-1 text-2xl font-black text-red-700 dark:text-red-300">
                      {inventoryHealth.outOfStockCount}
                    </p>
                    <span className="text-[11px] text-red-600 dark:text-red-400">
                      Unavailable for sales
                    </span>
                  </div>
                </div>

                {/* Stock Alert Warning Banner for SubAdmin */}
                {inventoryHealth.hasAlerts && (
                  <div className="rounded-2xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs">
                    <div className="flex items-start gap-3">
                      <span className="text-xl">⚠️</span>
                      <div className="flex-1">
                        <h4 className="font-extrabold text-amber-900 dark:text-amber-200 text-sm">
                          Inventory Alert: Stock is Running Low in Your Store
                        </h4>
                        <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                          {inventoryHealth.outOfStockCount > 0 && (
                            <strong className="text-red-700 dark:text-red-400 font-bold">
                              {inventoryHealth.outOfStockCount} product(s) are completely out of stock.{" "}
                            </strong>
                          )}
                          {inventoryHealth.lowStockCount > 0 && (
                            <span>
                              {inventoryHealth.lowStockCount} product(s) have fallen to or below their low-stock threshold.
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                          Operators cannot sell out-of-stock items. Please restock items or delete discontinued products below.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <SectionCard
                  title="Store Inventory & Stock Levels"
                  action={
                    <span className="text-xs font-semibold text-[#5d665f] dark:text-[#a0ada5]">
                      {inventory.length} Stock items tracked
                    </span>
                  }
                >
                  {/* Search bar */}
                  <div className="mb-4">
                    <input
                      type="text"
                      value={invSearch}
                      onChange={(e) => setInvSearch(e.target.value)}
                      placeholder="Search stock by product name or unit…"
                      className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                    />
                  </div>

                  {filteredInventory.length === 0 ? (
                    <div className="py-10 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
                      {invSearch
                        ? "No inventory items match your search query."
                        : "No inventory records found. Products and stock are initialized by Operators."}
                    </div>
                  ) : (
                    <div className="overflow-x-auto touch-scroll">
                      <table className="w-full min-w-[700px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]">
                            <th className="pb-3 font-bold">Product</th>
                            <th className="pb-3 font-bold">Product Price</th>
                            <th className="pb-3 font-bold">Current Stock</th>
                            <th className="pb-3 font-bold">Low Stock Threshold</th>
                            <th className="pb-3 font-bold">Unit</th>
                            <th className="pb-3 font-bold">Stock Status</th>
                            <th className="pb-3 font-bold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ece4da] dark:divide-white/5">
                          {filteredInventory.map((inv) => {
                            const isOut = inv.stockQty <= 0;
                            const isLow = inv.stockQty > 0 && inv.stockQty <= (inv.lowStockThreshold || 5);
                            const prod = products.find(
                              (p) => p.id === inv.productId || p.name.trim().toLowerCase() === inv.productName.trim().toLowerCase()
                            );
                            const unitPrice = prod ? `Rs. ${prod.price.toFixed(2)}` : "—";
                            const prodId = prod?.id || inv.productId || inv.id;

                            return (
                              <tr
                                key={inv.id}
                                className={`transition ${
                                  isOut
                                    ? "bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50/70"
                                    : isLow
                                    ? "bg-amber-50/40 dark:bg-amber-950/10 hover:bg-amber-50/70"
                                    : "hover:bg-black/5 dark:hover:bg-white/5"
                                }`}
                              >
                                <td className="py-3">
                                  <div className="font-bold text-[#173c32] dark:text-white">
                                    {inv.productName}
                                  </div>
                                  {prod?.sku && (
                                    <span className="font-mono text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                                      SKU: {prod.sku}
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 font-black text-sm text-[#173c32] dark:text-[#d7a35d]">
                                  {unitPrice}
                                </td>
                                <td className="py-3 font-extrabold text-sm">
                                  <span
                                    className={
                                      isOut
                                        ? "text-red-600 dark:text-red-400"
                                        : isLow
                                        ? "text-amber-600 dark:text-amber-400"
                                        : "text-[#173c32] dark:text-white"
                                    }
                                  >
                                    {inv.stockQty}
                                  </span>{" "}
                                  <span className="text-[11px] font-normal text-[#5d665f] dark:text-[#a0ada5]">
                                    {inv.unit}
                                  </span>
                                </td>
                                <td className="py-3 text-[#5d665f] dark:text-[#a0ada5]">
                                  ≤ {inv.lowStockThreshold || 5} {inv.unit}
                                </td>
                                <td className="py-3 font-mono">{inv.unit}</td>
                                <td className="py-3">
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                      isOut
                                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 font-extrabold"
                                        : isLow
                                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-extrabold"
                                        : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                                    }`}
                                  >
                                    {isOut
                                      ? "🚨 Out of Stock"
                                      : isLow
                                      ? `⚠️ Low Stock (${inv.stockQty} left)`
                                      : `✓ Healthy (${inv.stockQty} in stock)`}
                                  </span>
                                </td>
                                <td className="py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeleteProdTarget({
                                        id: prodId,
                                        name: inv.productName,
                                        sku: prod?.sku,
                                        price: prod?.price,
                                        stock: inv.stockQty,
                                      });
                                      setDeleteProdError("");
                                    }}
                                    className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-2.5 py-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition touch-manipulation"
                                    title="Delete product and inventory from store"
                                  >
                                    Delete Product
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </SectionCard>
              </div>
            )}

            {/* TAB 4: TRANSACTIONS */}
            {activeTab === "transactions" && (
              <SectionCard title="Store Sales & Returns Registry">
                {/* Financial Summary Ribbon for SubAdmin */}
                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#5d665f] dark:text-[#a0ada5]">
                      Total Gross Store Sales
                    </div>
                    <div className="mt-1 text-xl font-black text-[#173c32] dark:text-white">
                      Rs. {storeGrossSales.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5] mt-0.5">
                      Today&apos;s Gross: <strong className="text-[#173c32] dark:text-white">Rs. {todayGrossSales.toFixed(2)}</strong>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                      Customer Returns &amp; Refunds
                    </div>
                    <div className="mt-1 text-xl font-black text-red-700 dark:text-red-400">
                      -Rs. {storeTotalReturns.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                      Today&apos;s Returns: <strong className="text-red-700 dark:text-red-300">-Rs. {todayReturns.toFixed(2)}</strong>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      Net Store Earnings
                    </div>
                    <div className="mt-1 text-xl font-black text-emerald-800 dark:text-emerald-300">
                      Rs. {storeNetEarnings.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                      Today&apos;s Net: <strong className="text-emerald-800 dark:text-emerald-300">Rs. {todayNetSales.toFixed(2)}</strong>
                    </div>
                  </div>
                </div>

                {/* Search bar */}
                <div className="mb-4">
                  <input
                    type="text"
                    value={txnSearch}
                    onChange={(e) => setTxnSearch(e.target.value)}
                    placeholder="Search transactions by receipt, cashier, or product…"
                    className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                  />
                </div>

                {filteredTransactions.length === 0 ? (
                  <div className="py-10 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
                    {txnSearch
                      ? "No transactions match your search query."
                      : "No transactions registered yet. All sales from POS registers sync here."}
                  </div>
                ) : (
                  <div className="overflow-x-auto touch-scroll">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]">
                          <th className="pb-3 font-bold">Receipt</th>
                          <th className="pb-3 font-bold">Items Sold</th>
                          <th className="pb-3 font-bold">Cashier</th>
                          <th className="pb-3 font-bold">Status</th>
                          <th className="pb-3 font-bold">Total Bill</th>
                          <th className="pb-3 font-bold text-red-600 dark:text-red-400">Refund</th>
                          <th className="pb-3 font-bold text-emerald-700 dark:text-emerald-400">Net Total</th>
                          <th className="pb-3 font-bold">Date & Time</th>
                          <th className="pb-3 font-bold text-right">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ece4da] dark:divide-white/5">
                        {filteredTransactions.map((t) => {
                          const hasRefund = Number(t.refundAmount) > 0 || t.status === "returned";
                          const refundVal = Number(t.refundAmount) || (t.status === "returned" ? Number(t.total) : 0);
                          const netVal = t.netTotal !== undefined ? Number(t.netTotal) : (t.status === "returned" ? 0 : Number(t.total) - refundVal);

                          return (
                            <tr key={t.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                              <td className="py-3 font-mono font-bold text-[#173c32] dark:text-white">
                                {t.receiptNumber}
                              </td>
                              <td className="py-3 max-w-[200px] truncate" title={t.items.map((it) => `${it.productName} (${it.quantity})`).join(", ")}>
                                {t.items.map((it) => `${it.productName} (${it.quantity})`).join(", ")}
                              </td>
                              <td className="py-3">{t.operatorName}</td>
                              <td className="py-3">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                    t.status === "returned"
                                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                      : t.status === "partially_returned"
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                      : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                                  }`}
                                >
                                  {t.status === "returned" ? "↺ Returned" : t.status === "partially_returned" ? "↺ Partial Return" : "✓ Completed"}
                                </span>
                              </td>
                              <td className="py-3 font-mono text-xs text-[#5d665f] dark:text-[#a0ada5]">
                                Rs. {t.total.toFixed(2)}
                              </td>
                              <td className="py-3 font-mono text-xs font-bold text-red-600 dark:text-red-400">
                                {hasRefund ? `-Rs. ${refundVal.toFixed(2)}` : "—"}
                              </td>
                              <td className="py-3 font-black text-sm text-[#173c32] dark:text-[#d7a35d]">
                                Rs. {netVal.toFixed(2)}
                              </td>
                              <td className="py-3 text-[#5d665f] dark:text-[#a0ada5]">
                                {new Date(t.createdAt).toLocaleString()}
                              </td>
                              <td className="py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => setViewTxnTarget(t)}
                                  className="rounded-lg border border-[#d9d0c3] dark:border-white/20 bg-white dark:bg-white/5 px-2.5 py-1 text-xs font-semibold text-[#173c32] dark:text-white transition hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
                                >
                                  View
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        </div>
      </div>

      {/* Add Staff Modal (with Daily Wage) */}
      <Modal open={addModalOpen} onClose={() => setAddModalOpen(false)} title="Add Staff Member">
        <form onSubmit={handleAddStaffSubmit} className="space-y-4 text-xs">
          {addStaffError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300">{addStaffError}</div>
          )}

          <div>
            <label className="block font-bold mb-1">Full Name</label>
            <input
              required
              type="text"
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              placeholder="Alex Smith"
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">Email Address</label>
            <input
              required
              type="email"
              value={newStaffEmail}
              onChange={(e) => {
                setNewStaffEmail(e.target.value);
                setStaffOtpVerified(false);
                setStaffVerificationToken("");
              }}
              placeholder="alex@store.com"
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
            />
          </div>

          <div className="pt-1">
            <EmailOtpVerifier
              email={newStaffEmail}
              purpose="subadmin_add_staff"
              isVerified={staffOtpVerified}
              onVerified={(vToken) => {
                setStaffOtpVerified(true);
                setStaffVerificationToken(vToken);
              }}
              onResetVerification={() => {
                setStaffOtpVerified(false);
                setStaffVerificationToken("");
              }}
            />
          </div>

          <div>
            <label className="block font-bold mb-1">Assign Role</label>
            <select
              value={newStaffRole}
              onChange={(e) => setNewStaffRole(e.target.value as any)}
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
            >
              <option value="Operator">Operator (POS Cashier - Multiple Allowed)</option>
              <option value="HR" disabled={hrCount >= 1}>
                HR Manager {hrCount >= 1 ? "(Seat Filled - Max 1 HR)" : "(1 Seat Available)"}
              </option>
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">Daily Wage (Rs. / PKR per day)</label>
            <input
              required
              type="number"
              min="0"
              step="any"
              value={newStaffDailyWage}
              onChange={(e) => setNewStaffDailyWage(e.target.value)}
              placeholder="e.g. 1500.00"
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">Temporary Password</label>
            <input
              required
              type="password"
              minLength={8}
              value={newStaffPassword}
              onChange={(e) => setNewStaffPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
            />
          </div>

          <button
            type="submit"
            disabled={addingStaff || !staffOtpVerified || !newStaffName.trim() || !newStaffEmail.trim() || !newStaffPassword || newStaffPassword.length < 8}
            className="w-full rounded-2xl bg-[#173c32] dark:bg-[#215446] py-3 text-xs font-bold text-white transition hover:bg-[#0f2d2b] disabled:opacity-60 touch-manipulation"
          >
            {addingStaff ? "Creating Account…" : "Create Staff Account"}
          </button>
        </form>
      </Modal>

      {/* Edit Daily Wage Modal */}
      <Modal open={!!wageModalUser} onClose={() => setWageModalUser(null)} title={`Set Daily Wage — ${wageModalUser?.name}`}>
        <form onSubmit={handleSaveWage} className="space-y-4 text-xs">
          <p className="text-[#5d665f] dark:text-[#a0ada5]">
            Set the agreed daily rate for <strong>{wageModalUser?.name}</strong> ({wageModalUser?.role}). HR will use this rate to calculate pay based on daily attendance.
          </p>

          {wageError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300">{wageError}</div>
          )}

          <div>
            <label className="block font-bold mb-1">Daily Wage Rate (Rs. / PKR)</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 font-bold text-[#5d665f]">Rs.</span>
              <input
                required
                type="number"
                min="0"
                step="any"
                value={editWageValue}
                onChange={(e) => setEditWageValue(e.target.value)}
                placeholder="1500.00"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 pl-11 pr-3 py-2.5 font-bold text-[#173c32] dark:text-white"
              />
            </div>
            <p className="mt-1 text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
              Full attendance earns 100%, Half Time earns 50%, Absent earns 0%.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setWageModalUser(null)}
              className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingWage}
              className="flex-1 rounded-xl bg-[#173c32] dark:bg-[#215446] py-2.5 font-bold text-white hover:bg-[#0f2d2b] disabled:opacity-60 touch-manipulation"
            >
              {savingWage ? "Saving…" : "Update Daily Wage"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Staff Confirmation Modal */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Confirm Removal">
        <div className="space-y-4 text-xs">
          <p>
            Are you sure you want to remove <strong>{deleteTarget?.name}</strong> ({deleteTarget?.role})?
          </p>
          {deleteError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300">{deleteError}</div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={handleDeleteConfirm}
              className="flex-1 rounded-xl bg-red-600 py-2.5 font-bold text-white hover:bg-red-700 disabled:opacity-60 touch-manipulation"
            >
              {deleting ? "Removing…" : "Confirm Removal"}
            </button>
          </div>
        </div>
      </Modal>

      {/* View Transaction Details Modal */}
      <Modal open={!!viewTxnTarget} onClose={() => setViewTxnTarget(null)} title="Transaction Receipt">
        {viewTxnTarget && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl bg-[#faf8f4] dark:bg-black/20 p-3 flex justify-between items-center">
              <div>
                <span className="font-mono font-bold text-[#173c32] dark:text-white">
                  {viewTxnTarget.receiptNumber}
                </span>
                <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                  {new Date(viewTxnTarget.createdAt).toLocaleString()} · {viewTxnTarget.operatorName}
                </div>
              </div>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                  viewTxnTarget.status === "returned"
                    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                    : viewTxnTarget.status === "partially_returned"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                }`}
              >
                {viewTxnTarget.status === "returned"
                  ? "↺ Returned / Refunded"
                  : viewTxnTarget.status === "partially_returned"
                  ? "↺ Partial Return"
                  : "✓ Completed Sale"}
              </span>
            </div>

            <div className="border rounded-xl border-[#ece4da] dark:border-white/10 p-3 space-y-2">
              <div className="font-bold border-b dark:border-white/10 pb-1">Items Purchased</div>
              <div className="space-y-1.5 divide-y divide-[#ece4da] dark:divide-white/5">
                {viewTxnTarget.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between pt-1">
                    <span>{it.productName} × {it.quantity}</span>
                    <span className="font-bold">Rs. {it.lineTotal.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 space-y-1">
                <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                  <span>Subtotal:</span>
                  <span>Rs. {viewTxnTarget.subtotal.toFixed(2)}</span>
                </div>
                {viewTxnTarget.discount && (
                  <div className="flex justify-between text-green-700 font-semibold">
                    <span>Discount:</span>
                    <span>-Rs. {Number((viewTxnTarget.discount as any).amount || 0).toFixed(2)}</span>
                  </div>
                )}
                {viewTxnTarget.tax > 0 && (
                  <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                    <span>Tax:</span>
                    <span>Rs. {viewTxnTarget.tax.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-sm text-[#173c32] dark:text-[#d7a35d] pt-1 border-t dark:border-white/10">
                  <span>Total Bill:</span>
                  <span>Rs. {viewTxnTarget.total.toFixed(2)}</span>
                </div>

                {Number(viewTxnTarget.refundAmount) > 0 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400 font-bold">
                    <span>Customer Refund / Return:</span>
                    <span>-Rs. {Number(viewTxnTarget.refundAmount).toFixed(2)}</span>
                  </div>
                )}

                {viewTxnTarget.status !== "completed" && (
                  <div className="flex justify-between font-black text-sm text-emerald-800 dark:text-emerald-300 pt-1 border-t dark:border-white/10">
                    <span>Net Store Earnings:</span>
                    <span>Rs. {(viewTxnTarget.netTotal !== undefined ? Number(viewTxnTarget.netTotal) : viewTxnTarget.status === "returned" ? 0 : viewTxnTarget.total).toFixed(2)}</span>
                  </div>
                )}

                {viewTxnTarget.returnReason && (
                  <div className="mt-2 rounded-xl bg-red-50 dark:bg-red-950/20 p-2 border border-red-200 dark:border-red-900/30 text-[11px] text-red-700 dark:text-red-300">
                    <strong>Return Reason:</strong> {viewTxnTarget.returnReason}
                  </div>
                )}

                {viewTxnTarget.paymentMethod === "cash" && viewTxnTarget.cashGiven && (
                  <div className="flex justify-between text-[#5d665f] text-[11px] pt-1">
                    <span>Cash Tendered / Change:</span>
                    <span>Rs. {viewTxnTarget.cashGiven.toFixed(2)} (Change: Rs. {(viewTxnTarget.changeDue || 0).toFixed(2)})</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setViewTxnTarget(null)}
                className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 rounded-xl bg-[#173c32] dark:bg-[#215446] py-2.5 font-bold text-white hover:bg-[#0f2d2b] touch-manipulation"
              >
                🖨️ Print Receipt
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Product Confirmation Modal */}
      {deleteProdTarget && (
        <Modal
          open={true}
          onClose={() => setDeleteProdTarget(null)}
          title={`Delete Product: ${deleteProdTarget.name}`}
        >
          <div className="space-y-4 text-xs">
            {deleteProdError && (
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300 font-bold">
                {deleteProdError}
              </div>
            )}

            <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-950/20 p-4">
              <div className="flex items-center gap-2 text-red-800 dark:text-red-300 font-bold mb-2">
                <span>🗑️</span>
                <span>Remove Product from Store & Inventory</span>
              </div>
              <p className="text-[#5d665f] dark:text-[#a0ada5] leading-relaxed">
                Are you sure you want to permanently remove <strong>{deleteProdTarget.name}</strong>
                {deleteProdTarget.sku ? ` (${deleteProdTarget.sku})` : ""} from this store?
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-white/70 dark:bg-black/30 p-2.5 border border-[#ece4da] dark:border-white/10 text-[11px]">
                <div>
                  <span className="text-[#5d665f] dark:text-[#a0ada5]">Selling Price:</span>{" "}
                  <strong className="text-[#173c32] dark:text-white">
                    Rs. {deleteProdTarget.price ? deleteProdTarget.price.toFixed(2) : "—"}
                  </strong>
                </div>
                <div>
                  <span className="text-[#5d665f] dark:text-[#a0ada5]">Current Stock:</span>{" "}
                  <strong className="text-[#173c32] dark:text-white">
                    {deleteProdTarget.stock ?? 0} units
                  </strong>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-red-700 dark:text-red-400 font-semibold">
                ⚠️ This product and its inventory will be deleted from the store and immediately removed from all Operator checkout registers for this tenant.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={deletingProd}
                onClick={() => setDeleteProdTarget(null)}
                className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 transition touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingProd}
                onClick={handleDeleteProductConfirm}
                className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white py-2.5 font-bold transition disabled:opacity-50 touch-manipulation"
              >
                {deletingProd ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

export default function SubAdminDashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#173c32] dark:text-[#f6f1ea] font-semibold">
          Loading Store Console…
        </div>
      }
    >
      <SubAdminContent />
    </Suspense>
  );
}

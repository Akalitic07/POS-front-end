"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getJson, postJson, patchJson, deleteJson } from "@/lib/api";
import { DashboardHeader } from "@/components/ui/DashboardHeader";
import { StatCard } from "@/components/ui/StatCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Sidebar } from "@/components/layout/Sidebar";
import { EmailOtpVerifier } from "@/components/ui/EmailOtpVerifier";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "pending_payment" | "pending_approval" | "rejected";
  contactEmail?: string;
  paymentSenderName?: string;
  paymentMethod?: string;
  paymentAccount?: string;
  paymentSubmittedAt?: string;
  rejectionReason?: string;
  createdAt: string;
};

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

export default function AdminDashboard() {
  const { user, token, loading } = useAuth();
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [health, setHealth] = useState<{ mode: string; dynamodbReachable: boolean } | null>(null);

  // Status/Feedback message
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Search/Filter states
  const [tenantSearch, setTenantSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");

  // Create tenant modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newEmailVerified, setNewEmailVerified] = useState(false);
  const [newVerificationToken, setNewVerificationToken] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  // Inspect tenant modal (Admin view access to all subadmin tenants)
  const [inspectTenant, setInspectTenant] = useState<Tenant | null>(null);
  const [inspectUsers, setInspectUsers] = useState<StaffUser[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  // Delete user modal
  const [deleteUser, setDeleteUser] = useState<StaffUser | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Delete tenant modal (after suspending)
  const [deleteTenantTarget, setDeleteTenantTarget] = useState<Tenant | null>(null);
  const [deleteTenantError, setDeleteTenantError] = useState("");
  const [deletingTenant, setDeletingTenant] = useState(false);

  // Auth guard — Admin only
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/admin-login");
      return;
    }
    if (user.role !== "Admin") {
      router.replace("/dashboard");
      return;
    }
  }, [user, loading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setTenantsLoading(true);
    setUsersLoading(true);

    const [tResult, uResult, hResult] = await Promise.allSettled([
      getJson<{ tenants: Tenant[] }>("/api/tenants/all", token),
      getJson<{ users: StaffUser[] }>("/api/users", token),
      getJson<{ mode: string; dynamodbReachable: boolean }>("/health"),
    ]);

    if (tResult.status === "fulfilled") setTenants(tResult.value.tenants);
    setTenantsLoading(false);

    if (uResult.status === "fulfilled") setUsers(uResult.value.users);
    setUsersLoading(false);

    if (hResult.status === "fulfilled") setHealth(hResult.value);
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Inspect tenant users & access ─────────────────────────────────────────
  const handleInspectTenant = async (tenant: Tenant) => {
    if (!token) return;
    setInspectTenant(tenant);
    setInspectUsers([]);
    setInspectLoading(true);
    try {
      const data = await getJson<{ tenant: Tenant; users: StaffUser[] }>(`/api/tenants/${tenant.id}/users`, token);
      setInspectUsers(data.users);
    } catch (err) {
      console.error("Failed to inspect tenant users:", err);
    } finally {
      setInspectLoading(false);
    }
  };

  // ── Create tenant ─────────────────────────────────────────────────────────
  const handleCreateTenant = async () => {
    if (!token) return;
    if (!newEmailVerified) {
      setCreateError("Please verify the tenant owner/contact email with the OTP code first.");
      return;
    }
    setCreateError("");
    setCreating(true);
    try {
      await postJson(
        "/api/tenants",
        {
          name: newName,
          slug: newSlug,
          email: newEmail.trim().toLowerCase(),
          verificationToken: newVerificationToken,
        },
        token
      );
      setCreateOpen(false);
      setNewName("");
      setNewSlug("");
      setNewEmail("");
      setNewEmailVerified(false);
      setNewVerificationToken("");
      setFeedback({ type: "success", text: "New store tenant created successfully." });
      await loadData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create tenant.");
    } finally {
      setCreating(false);
    }
  };

  // ── Toggle tenant status ──────────────────────────────────────────────────
  const toggleTenantStatus = async (tenant: Tenant) => {
    if (!token) return;
    const newStatus = tenant.status === "active" ? "suspended" : "active";
    try {
      await patchJson(`/api/tenants/${tenant.id}/status`, { status: newStatus }, token);
      setFeedback({
        type: "success",
        text: `Store "${tenant.name}" has been ${newStatus === "active" ? "activated" : "suspended"}.`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update tenant status.",
      });
    }
  };

  // ── Review Tenant Payment (NayaPay Approval / Rejection) ───────────────────
  const handleReviewTenantPayment = async (tenant: Tenant, action: "approve" | "reject") => {
    if (!token) return;
    try {
      const res = await postJson<{ message: string }>(`/api/tenants/${tenant.id}/review-payment`, { action }, token);
      setFeedback({
        type: "success",
        text: res.message || `Store "${tenant.name}" has been ${action === "approve" ? "approved & activated" : "rejected"}.`,
      });
      await loadData();
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : `Failed to ${action} store.`,
      });
    }
  };

  // ── Delete user ───────────────────────────────────────────────────────────
  const handleDeleteUser = async () => {
    if (!deleteUser || !token) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteJson(`/api/users/${deleteUser.id}`, token);
      setDeleteUser(null);
      setFeedback({ type: "success", text: "Staff account removed successfully." });
      await loadData();
      if (inspectTenant) {
        await handleInspectTenant(inspectTenant);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  // ── Delete tenant (after suspending) ──────────────────────────────────────
  const handleDeleteTenant = async () => {
    if (!deleteTenantTarget || !token) return;
    if (deleteTenantTarget.status !== "suspended") {
      setDeleteTenantError("Tenant must be suspended before it can be removed. Please suspend the store first.");
      return;
    }
    setDeletingTenant(true);
    setDeleteTenantError("");
    try {
      await deleteJson(`/api/tenants/${deleteTenantTarget.id}`, token);
      setFeedback({
        type: "success",
        text: `Store tenant "${deleteTenantTarget.name}" and associated accounts have been permanently removed.`,
      });
      setDeleteTenantTarget(null);
      if (inspectTenant?.id === deleteTenantTarget.id) {
        setInspectTenant(null);
      }
      await loadData();
    } catch (err) {
      setDeleteTenantError(err instanceof Error ? err.message : "Failed to remove tenant.");
    } finally {
      setDeletingTenant(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#173c32] dark:text-[#f6f1ea] font-semibold">
        Loading…
      </div>
    );
  }

  const activeTenants = tenants.filter((t) => t.status === "active").length;
  const suspendedTenants = tenants.filter((t) => t.status === "suspended").length;

  const pendingApprovalTenants = tenants.filter((t) => t.status === "pending_approval");

  const tenantName = (tenantId: string) =>
    tenants.find((t) => t.id === tenantId)?.name ?? tenantId.slice(0, 8) + "…";

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
      t.slug.toLowerCase().includes(tenantSearch.toLowerCase()) ||
      t.status.toLowerCase().includes(tenantSearch.toLowerCase())
  );

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.role.toLowerCase().includes(userSearch.toLowerCase()) ||
      tenantName(u.tenantId).toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-[#f6f1ea] dark:bg-[#0d1512] text-[#1f2a25] dark:text-[#f6f1ea] transition-colors duration-200 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <DashboardHeader title="Admin Console" subtitle="System-wide management — all store tenants" />

        {/* Global Action Feedback Banner */}
        {feedback && (
          <div
            className={`mb-6 flex items-center justify-between rounded-2xl border p-4 text-xs font-semibold shadow-sm transition-all ${
              feedback.type === "success"
                ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300"
                : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300"
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 px-2 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex flex-col gap-6 lg:flex-row">
          <Sidebar role="Admin" />

          <div className="min-w-0 flex-1 space-y-6">
            {/* Stats */}
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Total Tenants" value={tenants.length} accent="green" sub="Registered Stores" />
              <StatCard label="Active Stores" value={activeTenants} accent="gold" sub="Online" />
              <StatCard label="Total Staff Users" value={users.length} accent="blue" sub="All Roles" />
              <StatCard
                label="Suspended"
                value={suspendedTenants}
                accent="slate"
                sub={suspendedTenants > 0 ? "Needs attention" : "All clear"}
              />
            </div>

            {/* System status */}
            <div id="system-status">
              <SectionCard title="System Status" dark>
                <div className="grid gap-4 sm:grid-cols-3 text-sm">
                  {[
                    { label: "DB Mode", value: health?.mode ?? "checking…" },
                    { label: "DynamoDB", value: health?.dynamodbReachable ? "Connected" : "Offline (memory)" },
                    { label: "Local RxDB", value: "Dexie / IndexedDB" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl bg-white/5 p-4">
                      <span className="block text-xs uppercase tracking-[0.24em] text-[#d7a35d]">{item.label}</span>
                      <span
                        className={`mt-2 block text-base font-bold ${
                          item.label === "DynamoDB" && !health?.dynamodbReachable ? "text-amber-400" : "text-white"
                        }`}
                      >
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            {/* Pending NayaPay Payment Approvals Section */}
            {pendingApprovalTenants.length > 0 && (
              <div id="approvals-section" className="rounded-3xl border-2 border-amber-300 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/20 p-5 sm:p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/60 px-2.5 py-1 rounded-md">
                      Action Required
                    </span>
                    <h3 className="text-base font-black text-[#173c32] dark:text-white mt-1">
                      Store Approval Requests (NayaPay Payment Verification)
                    </h3>
                  </div>
                  <span className="rounded-full bg-amber-500 text-white font-bold text-xs px-2.5 py-0.5">
                    {pendingApprovalTenants.length} Pending
                  </span>
                </div>

                <div className="space-y-3">
                  {pendingApprovalTenants.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-2xl border border-amber-200 dark:border-white/10 bg-white dark:bg-white/[0.04] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-[#173c32] dark:text-white">{t.name}</span>
                          <span className="text-xs font-mono text-[#5d665f] dark:text-[#a0ada5]">({t.slug})</span>
                        </div>
                        <div className="mt-1 text-xs text-[#5d665f] dark:text-[#a0ada5] flex flex-wrap gap-x-4 gap-y-1">
                          <span>
                            NayaPay Sender:{" "}
                            <strong className="text-[#173c32] dark:text-white font-mono bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 rounded">
                              {t.paymentSenderName || "Not provided"}
                            </strong>
                          </span>
                          <span>Account: <strong>03217253923</strong></span>
                          {t.paymentSubmittedAt && (
                            <span>
                              Submitted: {new Date(t.paymentSubmittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => handleReviewTenantPayment(t, "approve")}
                          className="flex-1 sm:flex-none rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white transition touch-manipulation shadow-sm"
                        >
                          ✓ Accept & Activate
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewTenantPayment(t, "reject")}
                          className="flex-1 sm:flex-none rounded-xl bg-red-100 dark:bg-red-950/60 hover:bg-red-200 text-red-700 dark:text-red-300 px-3 py-2 text-xs font-bold transition touch-manipulation"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tenant management */}
            <div id="tenants-section">
              <SectionCard
                title="Store Tenants"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setCreateOpen(true);
                      setCreateError("");
                      setNewEmail("");
                      setNewEmailVerified(false);
                      setNewVerificationToken("");
                    }}
                    className="rounded-xl bg-[#173c32] dark:bg-[#215446] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0f2d2b] touch-manipulation"
                  >
                    + New Tenant
                  </button>
                }
              >
                {/* Search bar */}
                <div className="mb-4">
                  <input
                    type="text"
                    value={tenantSearch}
                    onChange={(e) => setTenantSearch(e.target.value)}
                    placeholder="Search tenants by store name, slug, or status…"
                    className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                  />
                </div>

                {tenantsLoading ? (
                  <div className="py-10 text-center text-sm text-[#5d665f] dark:text-[#a0ada5]">Loading tenants…</div>
                ) : (
                  <DataTable<Tenant>
                    columns={[
                      { header: "Store Name", accessor: "name" },
                      { header: "Slug", accessor: "slug" },
                      {
                        header: "Status",
                        accessor: (t) => {
                          const statusStyles: Record<string, string> = {
                            active: "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300",
                            pending_approval: "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 font-black",
                            pending_payment: "bg-stone-100 dark:bg-white/10 text-stone-700 dark:text-stone-300",
                            rejected: "bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 border border-red-300",
                            suspended: "bg-stone-200 dark:bg-white/20 text-stone-800 dark:text-stone-200",
                          };
                          const labelMap: Record<string, string> = {
                            active: "Active",
                            pending_approval: "Pending Approval",
                            pending_payment: "Awaiting Payment",
                            rejected: "Rejected",
                            suspended: "Suspended",
                          };
                          return (
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                                statusStyles[t.status] || "bg-stone-100 text-stone-800"
                              }`}
                            >
                              {labelMap[t.status] || t.status}
                            </span>
                          );
                        },
                      },
                    ]}
                    rows={filteredTenants}
                    emptyMessage={tenantSearch ? "No stores match your search." : "No store tenants registered yet."}
                    actions={(t) => (
                      <div className="flex items-center gap-2">
                        {t.status === "pending_approval" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleReviewTenantPayment(t, "approve")}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 transition touch-manipulation shadow-sm"
                            >
                              ✓ Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReviewTenantPayment(t, "reject")}
                              className="rounded-lg bg-red-100 dark:bg-red-950/60 px-2.5 py-1 text-xs font-bold text-red-700 dark:text-red-300 hover:bg-red-200 transition touch-manipulation"
                            >
                              ✕ Reject
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleInspectTenant(t)}
                              className="rounded-lg bg-[#173c32]/10 dark:bg-white/10 px-2.5 py-1 text-xs font-semibold text-[#173c32] dark:text-white hover:bg-[#173c32]/20 touch-manipulation"
                              title="View accounts under this tenant"
                            >
                              View Access
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleTenantStatus(t)}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition touch-manipulation ${
                                t.status === "active"
                                  ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100"
                                  : "bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 hover:bg-green-100"
                              }`}
                            >
                              {t.status === "active" ? "Suspend" : "Activate"}
                            </button>
                            {t.status === "suspended" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteTenantTarget(t);
                                  setDeleteTenantError("");
                                }}
                                className="rounded-lg bg-red-50 dark:bg-red-950/40 px-2.5 py-1 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition touch-manipulation"
                                title="Remove suspended store tenant"
                              >
                                Remove
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  />
                )}
              </SectionCard>
            </div>

            {/* All users */}
            <div id="users-section">
              <SectionCard title="All Staff Users Across Stores">
                {/* Search / Filter */}
                <div className="mb-4">
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search staff by name, email, role, or store…"
                    className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                  />
                </div>

                {usersLoading ? (
                  <div className="py-10 text-center text-sm text-[#5d665f] dark:text-[#a0ada5]">Loading users…</div>
                ) : (
                  <DataTable<StaffUser>
                    columns={[
                      { header: "Name", accessor: "name" },
                      { header: "Email", accessor: "email" },
                      {
                        header: "Role",
                        accessor: (u) => (
                          <span
                            className={`inline-block rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wide ${
                              u.role === "SubAdmin"
                                ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300"
                                : u.role === "HR"
                                ? "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
                                : u.role === "Operator"
                                ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300"
                                : "bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300"
                            }`}
                          >
                            {u.role}
                          </span>
                        ),
                      },
                      { header: "Store Tenant", accessor: (u) => tenantName(u.tenantId) },
                      { header: "Joined", accessor: (u) => new Date(u.createdAt).toLocaleDateString() },
                    ]}
                    rows={filteredUsers}
                    emptyMessage={userSearch ? "No staff match your search." : "No staff users registered yet."}
                    actions={(u) => (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteUser(u);
                          setDeleteError("");
                        }}
                        className="rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-1 text-xs font-semibold text-red-600 dark:text-red-400 transition hover:bg-red-100 touch-manipulation"
                      >
                        Remove
                      </button>
                    )}
                  />
                )}
              </SectionCard>
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────── INSPECT TENANT / VIEW ACCESS MODAL ──────────────── */}
      <Modal
        open={!!inspectTenant}
        title={`Store Access: ${inspectTenant?.name ?? ""}`}
        onClose={() => setInspectTenant(null)}
      >
        {inspectTenant && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-[#faf8f4] dark:bg-black/30 p-4 border border-[#ece4da] dark:border-white/10 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[#5d665f] dark:text-[#a0ada5]">Store ID:</span>
                <span className="font-mono font-bold text-[#173c32] dark:text-white">{inspectTenant.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5d665f] dark:text-[#a0ada5]">Slug:</span>
                <span className="font-mono text-[#173c32] dark:text-white">{inspectTenant.slug}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5d665f] dark:text-[#a0ada5]">Status:</span>
                <span
                  className={`font-bold ${
                    inspectTenant.status === "active" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {inspectTenant.status.toUpperCase()}
                </span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#173c32] dark:text-white">
                  Accounts Under This Store ({inspectUsers.length})
                </h3>
              </div>

              {inspectLoading ? (
                <div className="py-6 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
                  Loading store accounts…
                </div>
              ) : inspectUsers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#d9d0c3] dark:border-white/10 p-6 text-center text-xs text-[#5d665f]">
                  No staff accounts provisioned under this store yet.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {inspectUsers.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center justify-between rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#fffdfa] dark:bg-white/5 p-3 text-xs"
                    >
                      <div>
                        <div className="font-bold text-[#173c32] dark:text-white">{u.name}</div>
                        <div className="text-[#5d665f] dark:text-[#a0ada5]">{u.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 font-bold uppercase tracking-wide text-[10px] ${
                            u.role === "SubAdmin"
                              ? "bg-amber-100 text-amber-800"
                              : u.role === "HR"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {u.role}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteUser(u);
                            setDeleteError("");
                          }}
                          className="text-red-600 hover:text-red-800 font-bold px-1 touch-manipulation"
                          title="Remove user"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setInspectTenant(null)}
                className="flex-1 rounded-2xl border border-[#d9d0c3] dark:border-white/20 px-4 py-3 text-sm font-bold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
              >
                Close View
              </button>
              {inspectTenant.status === "suspended" && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTenantTarget(inspectTenant);
                    setDeleteTenantError("");
                  }}
                  className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-700 touch-manipulation"
                >
                  Remove Store
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ──────────────── CREATE TENANT MODAL ──────────────── */}
      <Modal open={createOpen} title="Create Tenant" onClose={() => setCreateOpen(false)}>
        <div className="space-y-4">
          <label className="block text-sm font-semibold">
            Organisation Name
            <input
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNewSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
              }}
              className="mt-1 w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-sm"
              placeholder="Acme Coffee Co."
            />
          </label>
          <label className="block text-sm font-semibold">
            Slug (URL-safe identifier)
            <input
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-sm"
              placeholder="acme-coffee-co"
            />
          </label>
          <label className="block text-sm font-semibold">
            Tenant Owner / Contact Email
            <input
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setNewEmailVerified(false);
                setNewVerificationToken("");
              }}
              className="mt-1 w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-sm"
              placeholder="owner@store.com"
            />
          </label>
          <div className="pt-1">
            <EmailOtpVerifier
              email={newEmail}
              purpose="admin_add_tenant"
              isVerified={newEmailVerified}
              onVerified={(vToken) => {
                setNewEmailVerified(true);
                setNewVerificationToken(vToken);
              }}
              onResetVerification={() => {
                setNewEmailVerified(false);
                setNewVerificationToken("");
              }}
            />
          </div>
          {createError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
              {createError}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="flex-1 rounded-2xl border border-[#d9d0c3] dark:border-white/20 px-4 py-3 font-semibold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateTenant}
              disabled={creating || !newName.trim() || !newSlug.trim() || !newEmail.trim() || !newEmailVerified}
              className="flex-1 rounded-2xl bg-[#173c32] dark:bg-[#215446] px-4 py-3 font-semibold text-white transition hover:bg-[#0f2d2b] disabled:opacity-60 touch-manipulation"
            >
              {creating ? "Creating…" : "Create Tenant"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ──────────────── DELETE USER MODAL ──────────────── */}
      <Modal open={!!deleteUser} title="Remove Staff Member" onClose={() => setDeleteUser(null)}>
        <p className="text-sm text-[#5d665f] dark:text-[#a0ada5]">
          Permanently remove <span className="font-bold text-[#173c32] dark:text-white">{deleteUser?.name}</span> (
          {deleteUser?.role}) from <strong className="text-[#173c32] dark:text-white">{deleteUser ? tenantName(deleteUser.tenantId) : ""}</strong>?
          This cannot be undone.
        </p>
        {deleteError && (
          <div className="mt-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
            {deleteError}
          </div>
        )}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => setDeleteUser(null)}
            className="flex-1 rounded-2xl border border-[#d9d0c3] dark:border-white/20 px-4 py-3 font-semibold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDeleteUser}
            disabled={deleting}
            className="flex-1 rounded-2xl bg-red-600 px-4 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60 touch-manipulation"
          >
            {deleting ? "Removing…" : "Yes, remove"}
          </button>
        </div>
      </Modal>

      {/* ──────────────── DELETE TENANT MODAL ──────────────── */}
      <Modal open={!!deleteTenantTarget} title="Remove Store Tenant" onClose={() => setDeleteTenantTarget(null)}>
        <div className="space-y-4 text-xs">
          <p className="text-sm text-[#5d665f] dark:text-[#a0ada5]">
            Are you sure you want to permanently remove store tenant{" "}
            <strong className="text-[#173c32] dark:text-white">{deleteTenantTarget?.name}</strong>?
          </p>
          <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 p-3 text-red-700 dark:text-red-300 text-xs leading-relaxed">
            ⚠️ This store is currently <strong>suspended</strong>. Removing it will permanently delete the store record and all associated staff accounts (SubAdmin, HR, Operators). This action cannot be undone.
          </div>
          {deleteTenantError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
              {deleteTenantError}
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setDeleteTenantTarget(null)}
              className="flex-1 rounded-2xl border border-[#d9d0c3] dark:border-white/20 px-4 py-3 font-semibold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteTenant}
              disabled={deletingTenant}
              className="flex-1 rounded-2xl bg-red-600 px-4 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60 touch-manipulation"
            >
              {deletingTenant ? "Removing Store…" : "Yes, permanently remove"}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

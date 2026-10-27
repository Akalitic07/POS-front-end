"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { postJson, type UserSession } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useConnectionStatus } from "@/context/ConnectionStatusContext";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function AdminLoginPage() {
  const router       = useRouter();
  const { user, login } = useAuth();
  const { isOnline } = useConnectionStatus();

  const [adminId,  setAdminId]  = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  // Redirect already-logged-in admin
  useEffect(() => {
    if (user?.role === "Admin") router.replace("/admin-dashboard");
    else if (user) router.replace("/dashboard");
  }, [user, router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!isOnline) {
      setError("System is offline. Administrator authentication requires an active online connection.");
      return;
    }

    setLoading(true);

    try {
      const data = await postJson<{ token: string; user: UserSession }>("/api/auth/admin-login", {
        adminId: adminId.trim(),
        password: password.trim(),
      });

      await login(data.token, data.user);
      router.push("/admin-dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin login failed.");
    } finally {
      setLoading(false);
    }
  }

  const fillDefaultCredentials = () => {
    setAdminId("POINTE-ADMIN");
    setPassword("admin-local");
    setError("");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#1f2a25] dark:text-[#f6f1ea] transition-colors duration-200 px-4 py-10">
      <div className="w-full max-w-lg rounded-[2rem] bg-white dark:bg-[#14211c] border border-[#ece4da] dark:border-white/10 p-5 sm:p-7 md:p-10 shadow-xl shadow-[#173c32]/10">
        {/* Header */}
        <div className="mb-6 sm:mb-8 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.22em] text-[#a26d2d] dark:text-[#edd3ab] truncate">Super access</p>
            <h1 className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-black text-[#173c32] dark:text-white truncate">Admin login</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <Link
              href="/"
              className="min-h-[38px] inline-flex items-center rounded-full border border-[#d9d0c3] dark:border-white/20 px-3 py-1.5 text-xs font-semibold text-[#173c32] dark:text-white transition hover:bg-[#f3efe9] dark:hover:bg-white/10"
            >
              Home
            </Link>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm font-semibold text-[#1f2a25] dark:text-[#f6f1ea]">
            Admin ID
            <input
              required
              type="text"
              value={adminId}
              onChange={e => setAdminId(e.target.value)}
              className="field"
              placeholder="POINTE-ADMIN or admin"
              autoComplete="username"
            />
          </label>

          <label className="block text-sm font-semibold text-[#1f2a25] dark:text-[#f6f1ea]">
            Password
            <input
              required
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="field"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {!isOnline && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700/50 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2 font-bold mb-1">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                Offline Mode
              </div>
              Administrator authentication requires an active connection to the database.
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isOnline}
            className="w-full rounded-2xl bg-[#d7a35d] px-4 py-3 text-base font-bold text-[#173c32] transition hover:bg-[#c98d41] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Verifying…" : !isOnline ? "Admin Login (Online Only)" : "Enter admin console"}
          </button>
        </form>

        <div className="mt-6 rounded-2xl border border-dashed border-[#d9d0c3] dark:border-white/15 bg-[#fffaf1] dark:bg-white/5 p-4 text-sm text-[#5d665f] dark:text-[#a0ada5]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#173c32] dark:text-white">Default Admin Credentials:</span>
            <button
              type="button"
              onClick={fillDefaultCredentials}
              className="text-xs font-bold text-[#a26d2d] dark:text-[#d7a35d] underline hover:text-[#173c32] dark:hover:text-white"
            >
              Fill demo credentials
            </button>
          </div>
          <div className="mt-2 text-xs space-y-1 font-mono text-[#5d665f] dark:text-[#c4d1c9]">
            <div>ID: <strong className="text-[#173c32] dark:text-white">POINTE-ADMIN</strong> (or <strong>admin</strong>)</div>
            <div>Password: <strong className="text-[#173c32] dark:text-white">admin-local</strong> (or <strong>admin</strong>)</div>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
          Staff member?{" "}
          <Link href="/login" className="font-semibold text-[#173c32] dark:text-[#d7a35d] hover:underline">
            Staff login
          </Link>
        </div>
      </div>
    </main>
  );
}

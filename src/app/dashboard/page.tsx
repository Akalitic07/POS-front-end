"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_DASHBOARD } from "@/lib/api";

/**
 * Smart redirect — reads the session role and sends users to their
 * dedicated dashboard. Unauthenticated users are sent to /login.
 * This page has no visual content of its own.
 */
export default function DashboardRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    router.replace(ROLE_DASHBOARD[user.role] ?? "/login");
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] transition-colors duration-200">
      <div className="flex items-center gap-3 text-[#173c32] dark:text-[#f6f1ea]">
        <span className="animate-spin text-2xl text-[#d7a35d]">↻</span>
        <span className="text-lg font-semibold">Loading your dashboard…</span>
      </div>
    </div>
  );
}

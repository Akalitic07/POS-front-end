"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { Role } from "@/lib/api";

type NavItem = { label: string; href: string; icon: string };

const navItems: Record<Role, NavItem[]> = {
  Admin: [
    { label: "Overview",      href: "/admin-dashboard",                 icon: "◈" },
    { label: "Store Tenants", href: "/admin-dashboard#tenants-section", icon: "⬡" },
    { label: "All Users",     href: "/admin-dashboard#users-section",   icon: "◎" },
    { label: "System Health", href: "/admin-dashboard#system-status",   icon: "⬟" },
  ],
  SubAdmin: [
    { label: "Overview",     href: "/dashboard/subadmin",                  icon: "◈" },
    { label: "Store Team",   href: "/dashboard/subadmin?tab=team",         icon: "👥" },
    { label: "Products",     href: "/dashboard/subadmin?tab=products",     icon: "📦" },
    { label: "Inventory",    href: "/dashboard/subadmin?tab=inventory",    icon: "📊" },
    { label: "Transactions", href: "/dashboard/subadmin?tab=transactions", icon: "🧾" },
  ],
  HR: [
    { label: "Daily Attendance Tracker", href: "/dashboard/hr?tab=tracker", icon: "📅" },
    { label: "Employee Wage Calculation & Deductions", href: "/dashboard/hr?tab=wages", icon: "💵" },
    { label: "Employee Directory & Staff Roster", href: "/dashboard/hr?tab=roster", icon: "👥" },
  ],
  Operator: [
    { label: "Counter Register", href: "/dashboard/operator?tab=register", icon: "🛒" },
    { label: "Exchange / Returns", href: "/dashboard/operator?tab=returns", icon: "🔄" },
    { label: "Recent Sales", href: "/dashboard/operator#recent-transactions", icon: "🧾" },
  ],
};

const accentBg: Record<Role, string> = {
  Admin:    "bg-[#d7a35d] text-[#173c32]",
  SubAdmin: "bg-emerald-700 text-white",
  HR:       "bg-blue-600 text-white",
  Operator: "bg-[#365f59] text-white",
};

interface SidebarProps {
  role: Role;
}

function SidebarNav({ role }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const items = navItems[role] ?? [];

  const currentTab = searchParams.get("tab");
  const defaultTab =
    pathname === "/dashboard/hr"
      ? "tracker"
      : pathname === "/dashboard/subadmin"
      ? "team"
      : pathname === "/dashboard/operator"
      ? "register"
      : null;
  const effectiveTab = currentTab || defaultTab;
  const fullPath = effectiveTab ? `${pathname}?tab=${effectiveTab}` : pathname;

  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = fullPath === item.href || (pathname === item.href && !item.href.includes("?"));
        return (
          <li key={`${item.href}-${item.label}`}>
            <Link
              href={item.href}
              title={item.label}
              className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs xl:text-sm font-semibold transition touch-manipulation ${
                active
                  ? "bg-[#173c32] dark:bg-[#215446] text-white shadow-sm ring-1 ring-white/10"
                  : "text-[#4b594f] dark:text-[#c4d1c9] hover:bg-[#f3efe9] dark:hover:bg-white/10 hover:text-[#173c32] dark:hover:text-white"
              }`}
            >
              <span className="w-6 h-6 flex items-center justify-center text-center text-sm xl:text-base leading-none shrink-0">
                {item.icon}
              </span>
              <span className="leading-tight">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({ role }: SidebarProps) {
  return (
    <aside className="hidden w-52 xl:w-56 2xl:w-60 shrink-0 lg:block">
      <nav className="sticky top-6 rounded-[2rem] bg-white dark:bg-[#14211c] border border-[#ece4da] dark:border-white/10 p-3 shadow-sm shadow-[#173c32]/5">
        {/* Role badge */}
        <div className={`mb-3 rounded-xl px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.18em] ${accentBg[role]}`}>
          {role}
        </div>

        <Suspense fallback={<div className="p-2 text-xs text-stone-400">Loading menu…</div>}>
          <SidebarNav role={role} />
        </Suspense>
      </nav>
    </aside>
  );
}

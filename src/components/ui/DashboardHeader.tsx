"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "./ThemeToggle";
import type { Role } from "@/lib/api";

const rolePill: Record<Role, string> = {
  Admin: "bg-[#d7a35d] text-[#173c32]",
  SubAdmin: "bg-emerald-700 text-white",
  HR: "bg-blue-600 text-white",
  Operator: "bg-[#365f59] text-white",
};

const mobileNavLinks: Record<Role, { label: string; href: string; icon: string }[]> = {
  Admin: [
    { label: "Overview", href: "/admin-dashboard", icon: "◈" },
    { label: "Store Tenants", href: "/admin-dashboard#tenants-section", icon: "⬡" },
    { label: "All Users", href: "/admin-dashboard#users-section", icon: "◎" },
    { label: "System Health", href: "/admin-dashboard#system-status", icon: "⬟" },
  ],
  SubAdmin: [
    { label: "Store Overview", href: "/dashboard/subadmin", icon: "◈" },
    { label: "Staff Team", href: "/dashboard/subadmin?tab=team", icon: "👥" },
    { label: "Products Catalog", href: "/dashboard/subadmin?tab=products", icon: "📦" },
    { label: "Inventory Stock", href: "/dashboard/subadmin?tab=inventory", icon: "📊" },
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

function CenteredNavIcons({
  links,
}: {
  links: { label: string; href: string; icon: string }[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
    <div className="hidden sm:flex md:hidden items-center justify-center gap-1.5 px-1 shrink-0">
      {links.map((link) => {
        const active = fullPath === link.href || (pathname === link.href && !link.href.includes("?"));
        return (
          <Link
            key={`center-${link.label}`}
            href={link.href}
            title={link.label}
            className={`flex h-9 w-9 min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-xl transition touch-manipulation ${
              active
                ? "bg-[#d7a35d] text-[#173c32] shadow-sm font-bold ring-2 ring-white/20"
                : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
            }`}
          >
            <span className="flex items-center justify-center text-center leading-none text-base select-none">
              {link.icon}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function MobileNavLinksList({
  links,
  onNavigate,
}: {
  links: { label: string; href: string; icon: string }[];
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#d7a35d]/90 px-1">Navigation</p>
      {links.map((link) => {
        const active = fullPath === link.href || (pathname === link.href && !link.href.includes("?"));
        return (
          <Link
            key={link.label}
            href={link.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition touch-manipulation ${
              active
                ? "bg-white/20 text-white font-bold ring-1 ring-white/30"
                : "text-[#ebebeb]/80 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span className="w-7 h-7 flex items-center justify-center text-center leading-none text-base shrink-0 rounded-lg bg-white/10">
              {link.icon}
            </span>
            <span className="leading-snug">{link.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

interface DashboardHeaderProps {
  title: string;
  subtitle?: string;
}

export function DashboardHeader({ title, subtitle }: DashboardHeaderProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push(user?.role === "Admin" ? "/admin-login" : "/login");
  };

  const navLinks = user ? mobileNavLinks[user.role] ?? [] : [];

  return (
    <header className="mb-5 sm:mb-6 lg:mb-8 rounded-2xl sm:rounded-[2rem] bg-[#173c32] dark:bg-[#122820] border border-transparent dark:border-white/10 p-3 sm:p-4 md:px-5 md:py-4 lg:px-6 lg:py-5 text-[#f6f1ea] shadow-lg shadow-[#173c32]/10 transition-colors">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Main Navbar Bar: Mobile flex-between, Tablet (640px to 767px) 3-column Grid, Desktop md:flex */}
        <div className="flex items-center justify-between sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center md:flex md:items-center md:justify-start md:gap-4 md:flex-1 min-w-0 w-full">
          {/* Column 1 (Left): Brand + Title */}
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 justify-self-start">
            <Link
              href="/"
              className="grid h-9 w-9 sm:h-10 sm:w-10 min-h-[36px] min-w-[36px] shrink-0 place-items-center rounded-xl bg-[#d7a35d] text-base sm:text-lg font-black text-[#173c32] transition hover:bg-[#c98d41] touch-manipulation leading-none text-center"
              title="Return to Pointe POS Home"
            >
              P
            </Link>
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.22em] text-[#d7a35d] truncate">
                Pointe POS
              </div>
              <h1 className="text-sm sm:text-base md:text-xl lg:text-2xl font-black leading-tight text-white truncate">
                {title}
              </h1>
              {subtitle && (
                <p className="hidden md:block mt-0.5 text-[11px] sm:text-xs lg:text-sm text-[#ebebeb]/80 truncate max-w-xs sm:max-w-md lg:max-w-xl">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Column 2 (Center): Centered Navigation Icons (640px to 767px) */}
          <div className="justify-self-center flex items-center justify-center">
            <Suspense fallback={null}>
              <CenteredNavIcons links={navLinks} />
            </Suspense>
          </div>

          {/* Column 3 (Right): Mobile/Tablet Controls (< md, covers narrow screens up to 767px) */}
          <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0 md:hidden justify-self-end">
            {user && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  rolePill[user.role] ?? "bg-white/20 text-white"
                }`}
              >
                {user.role}
              </span>
            )}
            <ThemeToggle className="bg-white/10 border-white/20 text-white hover:bg-white/20 h-9 w-9 min-h-[36px] min-w-[36px]" />
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
              className="flex h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition touch-manipulation"
            >
              <span className="flex items-center justify-center text-center leading-none text-base select-none">
                {mobileMenuOpen ? "✕" : "☰"}
              </span>
            </button>
          </div>
        </div>

        {/* Right (Desktop / Tablet >= md, 768px to 1080px and above): user info + role badge + theme + logout */}
        {user && (
          <div className="hidden md:flex flex-nowrap items-center gap-1.5 lg:gap-2 shrink-0">
            {user.tenantName && (
              <span
                title={user.tenantName}
                className="hidden lg:inline-block max-w-[130px] truncate rounded-full border border-white/20 px-2.5 py-1 text-xs font-semibold text-[#d7a35d]"
              >
                {user.tenantName}
              </span>
            )}
            <span
              title={user.name}
              className="max-w-[110px] lg:max-w-[150px] truncate rounded-full bg-white/10 px-2.5 py-1 text-xs sm:text-sm font-semibold text-white"
            >
              {user.name}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                rolePill[user.role] ?? "bg-white/20 text-white"
              }`}
            >
              {user.role}
            </span>

            <ThemeToggle className="bg-white/10 border-white/20 text-white hover:bg-white/20 h-9 w-9" />

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl bg-[#d7a35d] px-3 lg:px-4 py-1.5 lg:py-2 text-xs sm:text-sm font-bold text-[#173c32] transition hover:bg-[#c98d41] touch-manipulation whitespace-nowrap"
            >
              Logout
            </button>
          </div>
        )}
      </div>

      {/* Mobile Drawer/Menu (displays on < md when hamburger is active) */}
      {mobileMenuOpen && user && (
        <div className="mt-4 pt-4 border-t border-white/10 md:hidden space-y-3 animate-in fade-in slide-in-from-top-2 duration-150 max-h-[calc(835px-120px)] overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {user.tenantName && (
              <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-[11px] font-semibold text-[#d7a35d]">
                {user.tenantName}
              </span>
            )}
            <span className="text-xs font-bold text-white">{user.name}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                rolePill[user.role] ?? "bg-white/20 text-white"
              }`}
            >
              {user.role}
            </span>
          </div>

          {/* Role navigation links for mobile */}
          <Suspense fallback={<div className="p-2 text-xs text-white/60">Loading…</div>}>
            <MobileNavLinksList links={navLinks} onNavigate={() => setMobileMenuOpen(false)} />
          </Suspense>

          <div className="pt-2 border-t border-white/10 flex justify-between items-center">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="text-xs text-[#ebebeb]/70 hover:text-white"
            >
              ← Landing Page
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl bg-[#d7a35d] px-4 py-2 text-xs font-bold text-[#173c32] transition hover:bg-[#c98d41] touch-manipulation"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

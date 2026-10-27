"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function Home() {
  const [contactName, setContactName]       = useState("");
  const [contactEmail, setContactEmail]     = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactSent, setContactSent]       = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleContactSubmit = (e: FormEvent) => {
    e.preventDefault();
    setContactSent(true);
    setContactName("");
    setContactEmail("");
    setContactMessage("");
    setTimeout(() => setContactSent(false), 5000);
  };

  return (
    <main className="min-h-screen bg-[#f6f1ea] dark:bg-[#0d1512] text-[#1f2a25] dark:text-[#f6f1ea] transition-colors duration-200">
      {/* ──────────────── STICKY NAVBAR ──────────────── */}
      <header className="sticky top-0 z-40 w-full border-b border-[#ece4da]/80 dark:border-white/10 bg-[#f6f1ea]/90 dark:bg-[#0d1512]/90 backdrop-blur-md">
        <div className="mx-auto flex items-center justify-between sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center max-w-7xl px-3 sm:px-6 py-3 sm:py-4 lg:px-12">
          {/* Logo & Brand (Column 1) */}
          <Link href="#home" className="flex items-center gap-2.5 sm:gap-3 min-w-0 justify-self-start">
            <div className="grid h-9 w-9 sm:h-10 sm:w-10 shrink-0 place-items-center rounded-2xl bg-[#d7a35d] text-base sm:text-lg font-black text-[#173c32] leading-none text-center">
              P
            </div>
            <div className="min-w-0">
              <div className="text-lg sm:text-xl font-bold tracking-tight text-[#173c32] dark:text-[#f6f1ea] truncate">pointe POS</div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.22em] text-[#a26d2d] dark:text-[#edd3ab] truncate">
                Offline-First Commerce
              </div>
            </div>
          </Link>

          {/* Centered Navigation Links (Column 2: 640px to 767px and up) */}
          <nav className="hidden sm:flex items-center justify-center justify-self-center gap-2.5 sm:gap-3 md:gap-5 lg:gap-8 text-xs lg:text-sm font-semibold text-[#5d665f] dark:text-[#a0ada5]">
            <Link href="#home" className="transition hover:text-[#173c32] dark:hover:text-white whitespace-nowrap">
              Home
            </Link>
            <Link href="#about" className="transition hover:text-[#173c32] dark:hover:text-white whitespace-nowrap">
              About
            </Link>
            <Link href="#get-access" className="transition hover:text-[#173c32] dark:hover:text-white whitespace-nowrap">
              Get an Access
            </Link>
            <Link href="#contact" className="transition hover:text-[#173c32] dark:hover:text-white whitespace-nowrap">
              Contact
            </Link>
          </nav>

          {/* Actions: Theme Toggle, Sign In, Sign Up, Mobile Menu Toggle (Column 3) */}
          <div className="flex items-center justify-end justify-self-end gap-1.5 sm:gap-2.5 shrink-0">
            <ThemeToggle className="h-9 w-9 min-h-[36px] min-w-[36px]" />

            <Link
              href="/login"
              className="hidden sm:inline-flex rounded-xl border border-[#d9d0c3] dark:border-white/20 px-3 py-1.5 text-xs font-semibold text-[#173c32] dark:text-white transition hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap"
            >
              Sign in
            </Link>

            <Link
              href="/register"
              className="rounded-xl bg-[#173c32] dark:bg-[#215446] px-3 sm:px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0f2d2b] whitespace-nowrap"
            >
              Sign up
            </Link>

            {/* Mobile hamburger button (< sm only, below 640px) */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle navigation"
              aria-expanded={mobileMenuOpen}
              className="flex sm:hidden h-9 w-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-xl border border-[#d9d0c3] dark:border-white/20 text-[#173c32] dark:text-white hover:bg-black/5 dark:hover:bg-white/10 transition touch-manipulation"
            >
              <span className="flex items-center justify-center text-center leading-none text-base select-none">
                {mobileMenuOpen ? "✕" : "☰"}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Dropdown (< sm only) */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-t border-[#ece4da] dark:border-white/10 bg-[#f6f1ea] dark:bg-[#0d1512] px-4 sm:px-6 py-4 space-y-3 animate-in fade-in duration-150 max-h-[calc(835px-90px)] overflow-y-auto">
            <nav className="flex flex-col space-y-1 text-sm font-semibold text-[#5d665f] dark:text-[#a0ada5]">
              <Link
                href="#home"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[40px] flex items-center px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#173c32] dark:hover:text-white"
              >
                Home
              </Link>
              <Link
                href="#about"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[40px] flex items-center px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#173c32] dark:hover:text-white"
              >
                About
              </Link>
              <Link
                href="#get-access"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[40px] flex items-center px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#173c32] dark:hover:text-white"
              >
                Get an Access
              </Link>
              <Link
                href="#contact"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[40px] flex items-center px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 hover:text-[#173c32] dark:hover:text-white"
              >
                Contact
              </Link>
            </nav>
            <div className="pt-2 border-t border-[#ece4da] dark:border-white/10 flex gap-2">
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="flex-1 min-h-[42px] flex items-center justify-center text-center rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2 text-xs font-semibold text-[#173c32] dark:text-white"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                onClick={() => setMobileMenuOpen(false)}
                className="flex-1 min-h-[42px] flex items-center justify-center text-center rounded-xl bg-[#173c32] dark:bg-[#215446] py-2 text-xs font-semibold text-white"
              >
                Sign up
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* ──────────────── HERO SECTION (#home) ──────────────── */}
      <section id="home" className="mx-auto max-w-7xl px-6 pt-12 pb-16 lg:px-12 lg:pt-20">
        <div className="grid gap-10 overflow-hidden rounded-[2.5rem] bg-[#173c32] dark:bg-[#122b24] text-[#f7f3ee] shadow-2xl shadow-[#173c32]/10 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="flex flex-col justify-center px-8 py-12 lg:px-16 lg:py-16">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-[#d7a35d] w-fit mb-6">
              <span>●</span> Next-Gen POS Platform
            </div>
            <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl leading-[1.1]">
              Streamline sales, <span className="block text-[#d7a35d]">people, and stock.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#ebebeb]/80">
              A high-availability point-of-sale platform built with offline-ready local RxDB caching, seamless online DynamoDB sync, and role-based store governance.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/get-access"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl bg-[#d7a35d] px-6 py-3.5 text-base font-bold text-[#173c32] transition hover:bg-[#c98d41] shadow-lg shadow-[#d7a35d]/20"
              >
                Get Pointe POS (Free) →
              </Link>
              <Link
                href="#about"
                className="rounded-2xl border border-white/20 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Learn more
              </Link>
            </div>

            <div className="mt-12 grid grid-cols-3 gap-4 border-t border-white/10 pt-8">
              <div>
                <div className="text-2xl lg:text-3xl font-black text-white">4 Roles</div>
                <div className="text-xs uppercase tracking-[0.16em] text-[#d7a35d] mt-1">Full Control</div>
              </div>
              <div>
                <div className="text-2xl lg:text-3xl font-black text-white">100%</div>
                <div className="text-xs uppercase tracking-[0.16em] text-[#d7a35d] mt-1">Offline-Ready</div>
              </div>
              <div>
                <div className="text-2xl lg:text-3xl font-black text-white">Zero</div>
                <div className="text-xs uppercase tracking-[0.16em] text-[#d7a35d] mt-1">Transaction Fees</div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center bg-[#133229] dark:bg-[#0e221c] p-8 lg:p-12 border-t lg:border-t-0 lg:border-l border-white/10">
            <div className="rounded-2xl bg-white/5 p-6 border border-white/10 backdrop-blur-sm space-y-4">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#d7a35d]">
                Architecture Highlights
              </div>
              <div className="space-y-3 text-sm text-[#ebebeb]/90">
                <div className="flex items-start gap-3">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <div>
                    <strong className="text-white block">Multi-Tenant Isolation</strong>
                    Dedicated tenant store IDs guarantee zero data leakage between stores.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <div>
                    <strong className="text-white block">Offline RxDB Persistence</strong>
                    Registers continue taking sales even when internet connections drop.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <div>
                    <strong className="text-white block">Central DynamoDB Cloud</strong>
                    Global Admin manages tenants and monitors system health in real-time.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <div>
                    <strong className="text-white block">Store Staff Governance</strong>
                    1 Store SubAdmin, 1 dedicated HR seat, and unlimited Operator counter staff.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────── ABOUT SECTION (#about) ──────────────── */}
      <section id="about" className="mx-auto max-w-7xl px-6 py-16 lg:px-12 border-t border-[#ece4da] dark:border-white/10">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-bold uppercase tracking-[0.24em] text-[#a26d2d]">About Pointe POS</span>
          <h2 className="mt-2 text-3xl font-black text-[#173c32] dark:text-[#f6f1ea] sm:text-4xl">
            Built for store owners, managers, and counter staff
          </h2>
          <p className="mt-4 text-base text-[#5d665f] dark:text-[#a0ada5]">
            Pointe POS combines local device-level resilience with cloud synchronization. Whether you are running a single specialty boutique or a multi-branch chain, each store operates independently while the central administrator maintains unified oversight.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-[2rem] bg-white dark:bg-[#14211c] p-8 shadow-sm border border-[#ece4da] dark:border-white/10">
            <div className="text-3xl mb-4">🏪</div>
            <h3 className="text-xl font-bold text-[#173c32] dark:text-white">Tenant-First Store Model</h3>
            <p className="mt-2 text-sm leading-6 text-[#5d665f] dark:text-[#a0ada5]">
              Every merchant registers their own store (tenant). Each tenant has one dedicated SubAdmin who manages staff, shifts, and counters for that store only.
            </p>
          </div>

          <div className="rounded-[2rem] bg-white dark:bg-[#14211c] p-8 shadow-sm border border-[#ece4da] dark:border-white/10">
            <div className="text-3xl mb-4">⚡</div>
            <h3 className="text-xl font-bold text-[#173c32] dark:text-white">Offline RxDB Engine</h3>
            <p className="mt-2 text-sm leading-6 text-[#5d665f] dark:text-[#a0ada5]">
              Cashiers never wait on network latency. Transactions and cart operations run on client-side IndexedDB and sync to DynamoDB when connected.
            </p>
          </div>

          <div className="rounded-[2rem] bg-white dark:bg-[#14211c] p-8 shadow-sm border border-[#ece4da] dark:border-white/10">
            <div className="text-3xl mb-4">🛡️</div>
            <h3 className="text-xl font-bold text-[#173c32] dark:text-white">Bank-Grade Security</h3>
            <p className="mt-2 text-sm leading-6 text-[#5d665f] dark:text-[#a0ada5]">
              Cryptographic JWT claims enforce strict tenant boundaries. SubAdmins can never see or mutate accounts belonging to other stores.
            </p>
          </div>
        </div>
      </section>

      {/* ──────────────── GET AN ACCESS SECTION (#get-access) ──────────────── */}
      <section id="get-access" className="mx-auto max-w-7xl px-6 py-16 lg:px-12 border-t border-[#ece4da] dark:border-white/10">
        <div className="rounded-[2.5rem] bg-gradient-to-br from-[#173c32] to-[#122b24] text-white p-8 md:p-14 shadow-xl">
          <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr] items-center">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.24em] text-[#d7a35d]">
                Get An Access
              </span>
              <h2 className="mt-2 text-3xl font-black sm:text-4xl">
                Ready to launch your store counter?
              </h2>
              <p className="mt-4 text-base text-[#ebebeb]/80 max-w-xl leading-7">
                Get immediate access to your own store tenant. Complete our fast, zero-fee payment onboarding, set your SubAdmin credentials, and begin staffing your registers.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-6 text-sm text-[#ebebeb]">
                <div className="flex items-center gap-2">
                  <span className="text-[#d7a35d]">✓</span> 1 Store SubAdmin (Manager)
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#d7a35d]">✓</span> 1 Assigned HR Account
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#d7a35d]">✓</span> Multiple Operator Registers
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#d7a35d]">✓</span> Rs. 0 Free Activation
                </div>
              </div>
            </div>

            <div className="flex flex-col items-start lg:items-end justify-center">
              <div className="rounded-2xl bg-white/10 p-6 border border-white/10 backdrop-blur-md w-full max-w-sm text-center">
                <div className="text-xs uppercase tracking-[0.2em] text-[#d7a35d] font-bold">
                  Merchant Access Tier
                </div>
                <div className="mt-2 text-4xl font-black text-white">Rs. 0.00</div>
                <div className="mt-1 text-xs text-[#ebebeb]/70">Free Test Card Simulation / No Fees</div>

                <Link
                  href="/get-access"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 block w-full rounded-xl bg-[#d7a35d] px-5 py-3.5 text-center text-base font-bold text-[#173c32] transition hover:bg-[#c98d41] shadow-lg shadow-[#d7a35d]/20"
                >
                  Get Pointe POS →
                </Link>

                <div className="mt-3 text-[11px] text-[#ebebeb]/60">
                  Opens onboarding portal in new tab
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────── CONTACT SECTION (#contact) ──────────────── */}
      <section id="contact" className="mx-auto max-w-7xl px-6 py-16 lg:px-12 border-t border-[#ece4da] dark:border-white/10">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.24em] text-[#a26d2d]">Contact Us</span>
            <h2 className="mt-2 text-3xl font-black text-[#173c32] dark:text-[#f6f1ea] sm:text-4xl">
              We&apos;re here to support your store
            </h2>
            <p className="mt-4 text-base text-[#5d665f] dark:text-[#a0ada5]">
              Have questions regarding custom integrations, barcode scanner configurations, or enterprise cloud hosting? Reach out to our technical team.
            </p>

            <div className="mt-8 space-y-4 text-sm text-[#5d665f] dark:text-[#a0ada5]">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#173c32]/10 dark:bg-white/10 text-base text-[#173c32] dark:text-[#d7a35d]">
                  ✉
                </span>
                <div>
                  <div className="font-bold text-[#173c32] dark:text-white">Email Support</div>
                  <div>support@pointepos.local</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#173c32]/10 dark:bg-white/10 text-base text-[#173c32] dark:text-[#d7a35d]">
                  📞
                </span>
                <div>
                  <div className="font-bold text-[#173c32] dark:text-white">Phone Inquiries</div>
                  <div>+1 (800) 555-POINTE</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#173c32]/10 dark:bg-white/10 text-base text-[#173c32] dark:text-[#d7a35d]">
                  ⏱
                </span>
                <div>
                  <div className="font-bold text-[#173c32] dark:text-white">Hours of Operation</div>
                  <div>Monday – Saturday, 8:00 AM – 8:00 PM EST</div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] bg-white dark:bg-[#14211c] p-8 shadow-sm border border-[#ece4da] dark:border-white/10">
            <h3 className="text-xl font-bold text-[#173c32] dark:text-white mb-4">Send us a message</h3>
            {contactSent ? (
              <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/40 p-5 text-center text-sm font-semibold text-green-800 dark:text-green-300">
                ✓ Thank you for reaching out! Our team will contact you shortly.
              </div>
            ) : (
              <form onSubmit={handleContactSubmit} className="space-y-4">
                <label className="block text-sm font-semibold">
                  Your Name
                  <input
                    required
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="field"
                    placeholder="Jane Doe"
                  />
                </label>

                <label className="block text-sm font-semibold">
                  Email Address
                  <input
                    required
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="field"
                    placeholder="jane@store.com"
                  />
                </label>

                <label className="block text-sm font-semibold">
                  Message / Inquiry
                  <textarea
                    required
                    rows={4}
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    className="field resize-none"
                    placeholder="How can we help your business?"
                  />
                </label>

                <button
                  type="submit"
                  className="w-full rounded-2xl bg-[#173c32] dark:bg-[#215446] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#0f2d2b]"
                >
                  Send Message
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* ──────────────── FOOTER ──────────────── */}
      <footer className="border-t border-[#ece4da] dark:border-white/10 py-10 px-6 lg:px-12 bg-white/50 dark:bg-black/20">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-[#5d665f] dark:text-[#a0ada5]">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-[#d7a35d] grid place-items-center text-xs font-black text-[#173c32]">
              P
            </div>
            <span>© {new Date().getFullYear()} Pointe POS Inc. All rights reserved.</span>
          </div>

          <div className="flex items-center gap-6">
            <Link href="/login" className="hover:text-[#173c32] dark:hover:text-white transition">
              Staff Portal
            </Link>
            <Link href="/get-access" className="hover:text-[#173c32] dark:hover:text-white transition">
              Get Access
            </Link>
            <Link href="/admin-login" className="font-semibold text-[#173c32] dark:text-[#d7a35d] hover:underline">
              System Admin Console
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

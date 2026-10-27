"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { postJson, getJson, type Role } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { EmailOtpVerifier } from "@/components/ui/EmailOtpVerifier";

const STAFF_ROLES: Role[] = ["SubAdmin", "HR", "Operator"];

type Tenant = { id: string; name: string };

export default function RegisterForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { user }     = useAuth();

  // Pre-select role from URL query param (e.g. /register?role=HR)
  const paramRole = (searchParams.get("role") as Role) || "Operator";

  const [role,     setRole]     = useState<Role>(STAFF_ROLES.includes(paramRole) ? paramRole : "Operator");
  const [tenants,  setTenants]  = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [otpVerified, setOtpVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");

  // Redirect already-logged-in users
  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  // Fetch active tenants for the dropdown
  useEffect(() => {
    async function loadTenants() {
      try {
        const res = await getJson<any>("/api/tenants");
        const list: Tenant[] = Array.isArray(res) ? res : res?.tenants ?? [];
        setTenants(list);
        if (list.length > 0) setTenantId(list[0].id);
      } catch {
        setError("Could not load organisations. Make sure the API is running.");
      } finally {
        setTenantLoading(false);
      }
    }
    loadTenants();
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!tenantId) {
      setError("Please select an organisation.");
      return;
    }

    if (role === "SubAdmin" && !otpVerified) {
      setError("Please verify your email address with the OTP code first.");
      return;
    }

    setLoading(true);
    try {
      await postJson("/api/auth/register", {
        name,
        email,
        password,
        role,
        tenantId,
        verificationToken,
      });
      router.push(`/login?registered=1&role=${encodeURIComponent(role)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#1f2a25] dark:text-[#f6f1ea] transition-colors duration-200 px-4 py-10">
      <div className="w-full max-w-xl rounded-[2rem] bg-white dark:bg-[#14211c] border border-[#ece4da] dark:border-white/10 p-5 sm:p-7 md:p-10 shadow-xl shadow-[#173c32]/10">
        {/* Header */}
        <div className="mb-6 sm:mb-8 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.22em] text-[#a26d2d] dark:text-[#edd3ab] truncate">Create account</p>
            <h1 className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-black text-[#173c32] dark:text-white truncate">Register staff member</h1>
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

        {/* Role selector */}
        <div className="mb-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#5d665f] dark:text-[#a0ada5]">Select your role</p>
          <div className="flex flex-wrap gap-2">
            {STAFF_ROLES.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  role === r
                    ? "bg-[#173c32] text-white shadow-sm"
                    : "bg-[#f3efe9] dark:bg-white/5 text-[#4b594f] dark:text-[#c4d1c9] hover:bg-[#e8e0d4] dark:hover:bg-white/10"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Organisation */}
          <label className="block text-sm font-semibold text-[#1f2a25] dark:text-[#f6f1ea]">
            Organisation
            {tenantLoading ? (
              <div className="field flex items-center gap-2 text-[#5d665f] dark:text-[#a0ada5]">
                <span className="animate-spin">↻</span> Loading organisations...
              </div>
            ) : tenants.length === 0 ? (
              <div className="mt-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                No active organisations found. Ask your administrator to create one.
              </div>
            ) : (
              <select
                required
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                className="field"
              >
                <option value="">Select organisation…</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </label>

          {/* Full name */}
          <label className="block text-sm font-semibold text-[#1f2a25] dark:text-[#f6f1ea]">
            Full name
            <input
              required
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="field"
              placeholder="Your full name"
              autoComplete="name"
            />
          </label>

          {/* Email */}
          <label className="block text-sm font-semibold text-[#1f2a25] dark:text-[#f6f1ea]">
            Email address
            <input
              required
              type="email"
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                setOtpVerified(false);
                setVerificationToken("");
              }}
              className="field"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>

          {/* OTP Verification for SubAdmin self-registration */}
          {role === "SubAdmin" && (
            <div className="pt-1">
              <EmailOtpVerifier
                email={email}
                purpose="subadmin_register"
                isVerified={otpVerified}
                onVerified={(token) => {
                  setOtpVerified(true);
                  setVerificationToken(token);
                  setError("");
                }}
                onResetVerification={() => {
                  setOtpVerified(false);
                  setVerificationToken("");
                }}
              />
            </div>
          )}

          {/* Password */}
          <label className="block text-sm font-semibold text-[#1f2a25] dark:text-[#f6f1ea]">
            Password
            <input
              required
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="field"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </label>

          {/* Confirm password */}
          <label className="block text-sm font-semibold text-[#1f2a25] dark:text-[#f6f1ea]">
            Confirm password
            <input
              required
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="field"
              placeholder="Repeat your password"
              autoComplete="new-password"
            />
          </label>

          {/* Role summary */}
          <div className="rounded-2xl bg-[#fff7eb] dark:bg-white/5 px-4 py-3 text-sm text-[#5e4829] dark:text-[#edd3ab]">
            Registering as <span className="font-bold text-[#173c32] dark:text-white">{role}</span>
            {tenantId && tenants.find(t => t.id === tenantId) && (
              <> at <span className="font-bold text-[#173c32] dark:text-white">{tenants.find(t => t.id === tenantId)?.name}</span></>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || tenantLoading || tenants.length === 0}
            className="w-full rounded-2xl bg-[#173c32] dark:bg-[#215446] px-4 py-3 text-base font-bold text-white transition hover:bg-[#0f2d2b] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Creating account…" : `Register as ${role}`}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[#5d665f] dark:text-[#a0ada5]">
          Already have an account?{" "}
          <Link href="/login" className="font-bold text-[#173c32] dark:text-[#d7a35d] hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}

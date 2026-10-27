"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState, Suspense } from "react";
import { postJson, ROLE_DASHBOARD, type Role, type UserSession } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useConnectionStatus } from "@/context/ConnectionStatusContext";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Modal } from "@/components/ui/Modal";

const ROLES: Role[] = ["SubAdmin", "HR", "Operator"];

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { user, login } = useAuth();
  const { isOnline } = useConnectionStatus();

  const paramRole  = (searchParams.get("role") as Role) || "SubAdmin";
  const paramEmail = searchParams.get("email") || "";

  const [selectedRole, setSelectedRole] = useState<Role>(ROLES.includes(paramRole) ? paramRole : "SubAdmin");
  const [email,    setEmail]    = useState(paramEmail);
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  // Forgot password & OTP reset states
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetStep, setResetStep] = useState<"email" | "otp" | "success">("email");
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");
  const [resetDevOtp, setResetDevOtp] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(90);
  const [timerActive, setTimerActive] = useState(false);

  // Sync query params if they change
  useEffect(() => {
    if (paramRole && ROLES.includes(paramRole)) setSelectedRole(paramRole);
    if (paramEmail) setEmail(paramEmail);
  }, [paramRole, paramEmail]);

  // Show success banner when coming from registration
  const justRegistered = searchParams.get("registered") === "1";

  // Redirect already-logged-in users
  useEffect(() => {
    if (user) router.replace(ROLE_DASHBOARD[user.role] ?? "/dashboard");
  }, [user, router]);

  // 90-second countdown timer for OTP
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (timerActive && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev - 1);
      }, 1000);
    } else if (timerSeconds === 0) {
      setTimerActive(false);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerActive, timerSeconds]);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const OFFLINE_OPERATORS_KEY = "pointe_offline_operators";

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    const trimmedEmail = email.trim().toLowerCase();
    const currentPassHash = typeof btoa !== "undefined" ? btoa(`${trimmedEmail}:${password}`) : password;

    if (!isOnline) {
      // 1. Role enforcement: SubAdmin and HR require online connection
      if (selectedRole && selectedRole !== "Operator") {
        setError(`System is offline. Offline mode is available for Counter Operators only. ${selectedRole} management requires an active online connection.`);
        return;
      }

      // 2. Offline Operator authentication check
      try {
        const raw = localStorage.getItem(OFFLINE_OPERATORS_KEY);
        const cachedList: any[] = raw ? JSON.parse(raw) : [];
        const match = cachedList.find((op) => op.email === trimmedEmail);

        if (!match) {
          setError("Offline access is only available for Operators who have signed in on this device before. SubAdmin and HR must use an online connection.");
          return;
        }

        if (match.passwordHash !== currentPassHash) {
          setError("Invalid password for offline Operator login.");
          return;
        }

        // Successfully authenticated offline Operator!
        await login(match.token, {
          id: match.id,
          name: match.name,
          email: match.email,
          role: "Operator",
          tenantId: match.tenantId,
          tenantName: match.tenantName,
        });

        router.push("/dashboard/operator");
        return;
      } catch (offlineErr) {
        setError("Could not verify offline credentials. Please connect to the internet.");
        return;
      }
    }

    setLoading(true);

    try {
      const data = await postJson<{ token: string; user: UserSession }>("/api/auth/login", {
        email: email.trim(),
        password,
      });

      if (selectedRole && data.user.role !== selectedRole) {
        console.info(`User logged in with role: ${data.user.role}`);
      }

      // If user is an Operator, securely cache their profile for offline terminal resilience
      if (data.user.role === "Operator") {
        try {
          const raw = localStorage.getItem(OFFLINE_OPERATORS_KEY);
          let cachedList: any[] = raw ? JSON.parse(raw) : [];
          cachedList = cachedList.filter((op) => op.email !== trimmedEmail);
          cachedList.push({
            id: data.user.id,
            email: trimmedEmail,
            name: data.user.name,
            role: "Operator",
            tenantId: data.user.tenantId,
            tenantName: data.user.tenantName,
            token: data.token,
            passwordHash: currentPassHash,
            lastLoginAt: new Date().toISOString(),
          });
          localStorage.setItem(OFFLINE_OPERATORS_KEY, JSON.stringify(cachedList));
        } catch {}
      }

      await login(data.token, data.user);
      router.push(ROLE_DASHBOARD[data.user.role] ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  // Handle Send OTP
  async function handleSendOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResetLoading(true);
    setResetError("");
    setResetSuccess("");

    try {
      const data = await postJson<{ message: string; expiresInSeconds?: number; devOtp?: string }>("/api/auth/forgot-password", {
        email: resetEmail.trim(),
      });
      setResetStep("otp");
      setTimerSeconds(data.expiresInSeconds || 90);
      setTimerActive(true);
      setResetDevOtp(data.devOtp || null);
      setResetSuccess(data.message);
    } catch (err: any) {
      setResetError(err?.message || "Failed to send verification code.");
    } finally {
      setResetLoading(false);
    }
  }

  // Handle Resend OTP
  async function handleResendOtp() {
    setResetLoading(true);
    setResetError("");
    try {
      const data = await postJson<{ message: string; expiresInSeconds?: number; devOtp?: string }>("/api/auth/forgot-password", {
        email: resetEmail.trim(),
      });
      setTimerSeconds(data.expiresInSeconds || 90);
      setTimerActive(true);
      setResetDevOtp(data.devOtp || null);
      setResetSuccess("✓ New code sent! (Valid for 90s)");
    } catch (err: any) {
      setResetError(err?.message || "Failed to resend code.");
    } finally {
      setResetLoading(false);
    }
  }

  // Handle Reset Password Submit
  async function handleResetPasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResetError("");

    if (timerSeconds <= 0) {
      setResetError("Verification code has expired (90s limit). Please request a new code.");
      return;
    }

    if (resetNewPassword !== resetConfirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }

    if (resetNewPassword.length < 8) {
      setResetError("Password must be at least 8 characters long.");
      return;
    }

    setResetLoading(true);
    try {
      const data = await postJson<{ message: string }>("/api/auth/reset-password", {
        email: resetEmail.trim(),
        otp: resetOtp.trim(),
        newPassword: resetNewPassword,
      });
      setResetStep("success");
      setResetSuccess(data.message);
      // Pre-fill login email
      setEmail(resetEmail.trim());
      setPassword("");
    } catch (err: any) {
      setResetError(err?.message || "Failed to reset password.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#1f2a25] dark:text-[#f6f1ea] transition-colors duration-200 px-4 py-10">
      <div className="w-full max-w-lg rounded-[2rem] bg-white dark:bg-[#14211c] p-5 sm:p-7 md:p-10 shadow-xl shadow-[#173c32]/10 border border-[#ece4da] dark:border-white/10">
        {/* Header */}
        <div className="mb-6 sm:mb-8 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.22em] text-[#a26d2d] truncate">Staff Portal</p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-black text-[#173c32] dark:text-[#f6f1ea] truncate">Sign in</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <Link
              href="/"
              className="min-h-[38px] inline-flex items-center rounded-full border border-[#d9d0c3] dark:border-white/20 px-3 py-1.5 text-xs font-semibold text-[#173c32] dark:text-white transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              Home
            </Link>
          </div>
        </div>

        {/* Role selection tabs */}
        <div className="mb-6">
          <label className="block text-xs font-bold uppercase tracking-[0.18em] text-[#5d665f] dark:text-[#a0ada5] mb-2">
            Select Your Role
          </label>
          <div className="flex rounded-2xl bg-[#faf8f4] dark:bg-black/20 p-1.5 border border-[#ece4da] dark:border-white/10">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setSelectedRole(r)}
                className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                  selectedRole === r
                    ? "bg-[#173c32] text-white shadow-sm"
                    : "text-[#5d665f] dark:text-[#a0ada5] hover:text-[#173c32] dark:hover:text-white"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Success banner (post-registration) */}
        {justRegistered && (
          <div className="mb-5 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/40 dark:border-green-800 px-4 py-3 text-sm font-semibold text-green-700 dark:text-green-300">
            ✓ Account created! Sign in to enter your dashboard.
          </div>
        )}

        {/* Offline notice */}
        {!isOnline && (
          <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700/50 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2 font-bold mb-1">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              Offline Mode Detected
            </div>
            Authentication requires an active online connection to verify your credentials. Once signed in, you can work fully offline.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm font-semibold">
            Email address
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-semibold">Password</label>
              <button
                type="button"
                onClick={() => {
                  setResetEmail(email || "");
                  setResetOtp("");
                  setResetNewPassword("");
                  setResetConfirmPassword("");
                  setResetError("");
                  setResetSuccess("");
                  setResetDevOtp(null);
                  setResetStep("email");
                  setTimerActive(false);
                  setResetModalOpen(true);
                }}
                className="text-xs font-bold text-[#173c32] dark:text-[#d7a35d] hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <div className="rounded-xl bg-[#fff7eb] dark:bg-white/5 p-3 text-xs text-[#5e4829] dark:text-[#edd3ab]">
            Signing in as <strong className="text-[#173c32] dark:text-white">{selectedRole}</strong>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isOnline}
            className="w-full rounded-2xl bg-[#d7a35d] px-4 py-3 text-base font-bold text-[#173c32] transition hover:bg-[#c98d41] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in…" : !isOnline ? "Sign in (Online Only)" : `Sign in as ${selectedRole}`}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[#5d665f] dark:text-[#a0ada5]">
          Need to register your store?{" "}
          <Link href="/get-access" className="font-bold text-[#173c32] dark:text-[#d7a35d] hover:underline">
            Get Pointe POS
          </Link>
        </div>

        <div className="mt-4 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
          System administrator?{" "}
          <Link href="/admin-login" className="font-semibold text-[#173c32] dark:text-[#d7a35d] hover:underline">
            Admin login
          </Link>
        </div>
      </div>

      {/* Reset Password Modal with OTP & 90s Countdown */}
      <Modal open={resetModalOpen} onClose={() => setResetModalOpen(false)} title="Reset Password">
        <div className="text-xs space-y-4">
          {resetError && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-800 p-3 text-red-700 dark:text-red-300">
              {resetError}
            </div>
          )}

          {resetSuccess && resetStep !== "success" && (
            <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/40 dark:border-green-800 p-3 text-green-700 dark:text-green-300 font-semibold">
              {resetSuccess}
            </div>
          )}

          {/* STEP 1: Enter email to receive OTP */}
          {resetStep === "email" && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <p className="text-[#5d665f] dark:text-[#a0ada5]">
                Enter your registered account email. A 6-digit verification code will be sent to your inbox, valid for <strong>1 minute and 30 seconds (90s)</strong>.
              </p>

              <div>
                <label className="block font-bold mb-1">Account Email *</label>
                <input
                  required
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@store.com"
                  className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setResetModalOpen(false)}
                  className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading || !resetEmail.trim()}
                  className="flex-1 rounded-xl bg-[#173c32] hover:bg-[#0f2d2b] text-white py-2.5 font-bold disabled:opacity-60"
                >
                  {resetLoading ? "Sending OTP…" : "Send Verification Code"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: Verify OTP & Enter New Password */}
          {resetStep === "otp" && (
            <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
                <div>
                  <div className="font-bold text-[#173c32] dark:text-white">Email: {resetEmail}</div>
                  <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">Check inbox for 6-digit code</div>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-sm font-black ${timerSeconds <= 15 ? "text-red-600 animate-pulse" : "text-amber-800 dark:text-amber-300"}`}>
                    ⏱️ {formatTimer(timerSeconds)}
                  </div>
                  <div className="text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                    {timerSeconds > 0 ? "Expires soon" : "Code expired"}
                  </div>
                </div>
              </div>

              {resetDevOtp && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2 shadow-sm">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold">🛠️ Dev Mode OTP:</span>
                    <span className="font-mono font-black text-sm tracking-widest text-[#173c32] dark:text-[#edd3ab] bg-white dark:bg-black/40 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-white/10">
                      {resetDevOtp}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setResetOtp(resetDevOtp)}
                    className="shrink-0 rounded-lg bg-amber-200 dark:bg-amber-900/60 hover:bg-amber-300 dark:hover:bg-amber-800 px-2.5 py-1 text-[11px] font-bold text-amber-900 dark:text-amber-100 transition touch-manipulation"
                    title="Fill 6-digit code automatically"
                  >
                    Auto-Fill
                  </button>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold">Enter 6-Digit OTP *</label>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resetLoading}
                    className="text-[11px] font-bold text-[#173c32] dark:text-[#d7a35d] hover:underline disabled:opacity-50"
                  >
                    Resend Code
                  </button>
                </div>
                <input
                  required
                  type="text"
                  maxLength={6}
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-full text-center tracking-[0.4em] font-mono text-lg font-black rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-[#173c32] dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">New Password (min 8 chars) *</label>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Confirm New Password *</label>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setResetStep("email")}
                  className="rounded-xl border border-[#d9d0c3] dark:border-white/20 px-3 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={resetLoading || resetOtp.length < 6 || timerSeconds <= 0}
                  className="flex-1 rounded-xl bg-[#d7a35d] hover:bg-[#c98d41] text-[#173c32] py-2.5 font-bold disabled:opacity-60"
                >
                  {resetLoading ? "Updating Password…" : "Confirm & Update Password"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: Success Screen */}
          {resetStep === "success" && (
            <div className="space-y-4 py-2 text-center">
              <div className="text-3xl">🎉</div>
              <h3 className="text-base font-bold text-[#173c32] dark:text-white">Password Updated!</h3>
              <p className="text-[#5d665f] dark:text-[#a0ada5]">
                Your password has been successfully updated. You can now sign in with your new credentials.
              </p>
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                className="w-full rounded-xl bg-[#173c32] hover:bg-[#0f2d2b] text-white py-3 font-bold"
              >
                Sign In Now
              </button>
            </div>
          )}
        </div>
      </Modal>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#173c32] dark:text-[#f6f1ea] font-semibold">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useEffect, useRef } from "react";
import { postJson, getJson, saveSession } from "@/lib/api";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { EmailOtpVerifier } from "@/components/ui/EmailOtpVerifier";

type WizardStep = "register" | "payment" | "waiting" | "active" | "rejected";

export default function GetAccessPage() {
  const router = useRouter();

  // Wizard state
  const [step, setStep] = useState<WizardStep>("register");

  // Step 1: Store & Owner Registration
  const [storeName, setStoreName]                 = useState("");
  const [ownerName, setOwnerName]                 = useState("");
  const [email, setEmail]                         = useState("");
  const [password, setPassword]                   = useState("");
  const [confirmPass, setConfirmPass]             = useState("");
  const [otpVerified, setOtpVerified]             = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [registering, setRegistering]             = useState(false);

  // Authenticated tenant / session info
  const [tenantId, setTenantId]     = useState<string | null>(null);
  const [authToken, setAuthToken]   = useState<string | null>(null);
  const [tenantStatus, setTenantStatus] = useState<string>("pending_payment");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  // Step 2: NayaPay Payment Details
  const NAYAPAY_ACCOUNT = "03217253923";
  const NAYAPAY_TITLE   = "Pointe POS (NayaPay)";
  const [senderName, setSenderName] = useState("");
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentSubmittedOnce, setPaymentSubmittedOnce] = useState(false);
  const [copiedAccount, setCopiedAccount] = useState(false);

  // General error & notice handling
  const [error, setError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");

  // Polling interval ref for waiting state
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check if user is already logged in as SubAdmin
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pointe-session");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.token && parsed.user?.role === "SubAdmin") {
          setAuthToken(parsed.token);
          if (parsed.user.tenantId) setTenantId(parsed.user.tenantId);
          // Check live status
          checkTenantStatus(parsed.token);
        }
      }
    } catch {}
  }, []);

  // Poll status function
  const checkTenantStatus = async (token: string) => {
    try {
      const res = await getJson<{ tenant: any }>("/api/tenants/my-status", token);
      if (res?.tenant) {
        setTenantStatus(res.tenant.status);
        if (res.tenant.paymentSenderName) {
          setSenderName(res.tenant.paymentSenderName);
        }
        if (res.tenant.rejectionReason) {
          setRejectionReason(res.tenant.rejectionReason);
        }

        if (res.tenant.status === "active") {
          setStep("active");
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setTimeout(() => {
            router.push("/dashboard/subadmin");
          }, 1500);
        } else if (res.tenant.status === "pending_approval") {
          setStep("waiting");
          setPaymentSubmittedOnce(true);
        } else if (res.tenant.status === "rejected") {
          setStep("rejected");
          setPaymentSubmittedOnce(false); // Re-activate button on rejection
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        } else {
          setStep("payment");
        }
      }
    } catch (err) {
      console.warn("[status check error]:", err);
    }
  };

  // Start polling while in waiting state
  useEffect(() => {
    if (step === "waiting" && authToken) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(() => {
        checkTenantStatus(authToken);
      }, 4000);
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [step, authToken]);

  // Copy NayaPay Account Number
  const handleCopyAccount = () => {
    navigator.clipboard.writeText(NAYAPAY_ACCOUNT);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2000);
  };

  // ── Step 1: Submit Store Registration ───────────────────────────────────────
  const handleRegisterStore = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessNotice("");

    if (!storeName.trim() || !ownerName.trim() || !email.trim()) {
      setError("Please fill in all store and owner details.");
      return;
    }

    if (!otpVerified || !verificationToken) {
      setError("Please verify your email address with the 6-digit OTP code before continuing.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPass) {
      setError("Passwords do not match.");
      return;
    }

    setRegistering(true);
    try {
      // 1. Onboard store and create SubAdmin
      const data = await postJson<{
        message: string;
        tenant: { id: string; name: string; slug: string };
        user: any;
      }>("/api/auth/onboard-store", {
        storeName: storeName.trim(),
        name: ownerName.trim(),
        email: email.trim().toLowerCase(),
        password,
        verificationToken,
      });

      // 2. Automatically log in to obtain JWT for payment verification
      const loginRes = await postJson<{ token: string; user: any }>("/api/auth/login", {
        email: email.trim().toLowerCase(),
        password,
      });

      saveSession(loginRes.token, loginRes.user);
      setAuthToken(loginRes.token);
      setTenantId(data.tenant.id);
      setTenantStatus("pending_payment");
      setStep("payment");
      setSuccessNotice("Store profile created! Please complete payment verification below.");
    } catch (err: any) {
      setError(err?.message || "Registration failed. Please check your information.");
    } finally {
      setRegistering(false);
    }
  };

  // ── Step 2: Submit NayaPay Payment Verification ─────────────────────────────
  const handleSubmitPaymentVerification = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessNotice("");

    if (!senderName.trim()) {
      setError("Sender Account Holder Name is mandatory (jo account mn payment send kr ga).");
      return;
    }

    if (!authToken) {
      setError("Session expired. Please log in again to verify payment.");
      return;
    }

    setSubmittingPayment(true);
    try {
      const res = await postJson<{ message: string; tenant: any }>(
        "/api/tenants/payment-verification",
        { senderName: senderName.trim() },
        authToken
      );

      // Disable button immediately after single press
      setPaymentSubmittedOnce(true);
      setTenantStatus("pending_approval");
      setStep("waiting");
      setSuccessNotice("Verification request sent to Admin! Waiting for approval.");
    } catch (err: any) {
      setError(err?.message || "Failed to submit payment verification.");
    } finally {
      setSubmittingPayment(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f6f1ea] dark:bg-[#0d1512] text-[#1f2a25] dark:text-[#f6f1ea] transition-colors duration-200 px-4 py-8 md:py-12">
      <div className="mx-auto max-w-2xl">
        {/* Top Header */}
        <div className="mb-6 sm:mb-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <Link
              href="/"
              className="grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-xl bg-[#d7a35d] text-lg font-black text-[#173c32]"
            >
              P
            </Link>
            <div className="min-w-0">
              <span className="block text-xs font-bold uppercase tracking-wider text-[#a26d2d] dark:text-[#d7a35d]">
                Pointe POS
              </span>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-[#173c32] dark:text-white truncate">
                Store Onboarding & Activation
              </h1>
            </div>
          </div>
          <ThemeToggle />
        </div>

        {/* Global Feedback Banner */}
        {error && (
          <div className="mb-6 rounded-2xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-xs font-bold text-red-700 dark:text-red-300 shadow-sm flex items-center justify-between">
            <span>⚠️ {error}</span>
            <button type="button" onClick={() => setError("")} className="px-2 font-bold hover:opacity-75">✕</button>
          </div>
        )}

        {successNotice && (
          <div className="mb-6 rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-xs font-bold text-emerald-800 dark:text-emerald-300 shadow-sm">
            ✓ {successNotice}
          </div>
        )}

        {/* Step Indicator */}
        <div className="mb-8 flex items-center justify-center gap-3 text-xs font-bold">
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all ${
              step === "register"
                ? "bg-[#173c32] text-white dark:bg-[#d7a35d] dark:text-[#173c32]"
                : "bg-[#e8e2d8] text-[#5d665f] dark:bg-white/10 dark:text-white/60"
            }`}
          >
            <span>1</span>
            <span>Store Registration</span>
          </div>

          <span className="text-[#a26d2d]">→</span>

          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all ${
              step !== "register"
                ? "bg-[#173c32] text-white dark:bg-[#d7a35d] dark:text-[#173c32]"
                : "bg-[#e8e2d8] text-[#5d665f] dark:bg-white/10 dark:text-white/60"
            }`}
          >
            <span>2</span>
            <span>NayaPay Verification & Approval</span>
          </div>
        </div>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* STEP 1: STORE & SUBADMIN REGISTRATION */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        {step === "register" && (
          <div className="rounded-3xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-white/[0.03] p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-black text-[#173c32] dark:text-white mb-1">
              Create Your Store Profile
            </h2>
            <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mb-6">
              Register your store and SubAdmin credentials. Real email verification is required.
            </p>

            <form onSubmit={handleRegisterStore} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#173c32] dark:text-white mb-1">
                  Store / Business Name *
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="e.g. Urban Roasters, City Supermarket"
                  className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-3 text-sm text-[#173c32] dark:text-white placeholder-[#8a948c] focus:outline-none focus:ring-2 focus:ring-[#173c32]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#173c32] dark:text-white mb-1">
                  SubAdmin Owner Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="e.g. Muhammad Tauseef"
                  className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-3 text-sm text-[#173c32] dark:text-white placeholder-[#8a948c] focus:outline-none focus:ring-2 focus:ring-[#173c32]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#173c32] dark:text-white mb-1">
                  Business Email Address *
                </label>
                <input
                  type="email"
                  required
                  disabled={otpVerified}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@yourstore.com"
                  className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-3 text-sm text-[#173c32] dark:text-white placeholder-[#8a948c] focus:outline-none focus:ring-2 focus:ring-[#173c32] disabled:opacity-60"
                />
              </div>

              {/* Email OTP Verifier Component */}
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

              <div className="grid sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-bold text-[#173c32] dark:text-white mb-1">
                    Password (Min. 8 chars) *
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-3 text-sm text-[#173c32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#173c32]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#173c32] dark:text-white mb-1">
                    Confirm Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-3 text-sm text-[#173c32] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#173c32]"
                  />
                </div>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={registering || !otpVerified}
                  className="w-full rounded-2xl bg-[#173c32] dark:bg-[#d7a35d] hover:bg-[#0f2d2b] dark:hover:bg-[#c28e46] py-3.5 text-sm font-black text-white dark:text-[#173c32] shadow-md transition disabled:opacity-50 touch-manipulation flex items-center justify-center gap-2"
                >
                  {registering ? "Initializing Store…" : "Continue to Payment Verification →"}
                </button>
              </div>

              <p className="text-center text-xs text-[#5d665f] dark:text-[#a0ada5] pt-2">
                Already registered?{" "}
                <Link href="/login" className="font-bold text-[#173c32] dark:text-[#d7a35d] hover:underline">
                  Sign in here
                </Link>
              </p>
            </form>
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* STEP 2: NAYAPAY PAYMENT DETAILS & APPROVAL WORKFLOW */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        {step !== "register" && (
          <div className="space-y-6">
            {/* Payment Details Card */}
            <div className="rounded-3xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-white/[0.03] p-6 sm:p-8 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-800">
                    Official NayaPay Account
                  </span>
                  <h2 className="text-lg font-black text-[#173c32] dark:text-white mt-1.5">
                    Manual Payment Verification
                  </h2>
                </div>
                <div className="h-10 w-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-800 dark:text-emerald-300 font-black text-lg">
                  ₦
                </div>
              </div>

              <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] leading-relaxed mb-6">
                Please transfer your store subscription fee via the <strong>NayaPay app</strong> or online banking to the verified mobile account below:
              </p>

              {/* NayaPay Account Info Box */}
              <div className="rounded-2xl border-2 border-dashed border-[#173c32]/30 dark:border-[#d7a35d]/40 bg-[#fbf9f5] dark:bg-black/30 p-4 sm:p-5 mb-6">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <span className="block text-[11px] font-bold text-[#5d665f] dark:text-[#a0ada5] uppercase tracking-wider">
                      Mobile Account Number
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-xl sm:text-2xl font-black text-[#173c32] dark:text-[#edd3ab] tracking-wider">
                        {NAYAPAY_ACCOUNT}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyAccount}
                        className="rounded-lg bg-[#e8e2d8] dark:bg-white/10 hover:bg-[#dcd4c7] px-2 py-1 text-[11px] font-bold text-[#173c32] dark:text-white transition touch-manipulation"
                      >
                        {copiedAccount ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="block text-[11px] font-bold text-[#5d665f] dark:text-[#a0ada5] uppercase tracking-wider">
                      Account Title / Bank
                    </span>
                    <span className="block text-base font-bold text-[#173c32] dark:text-white mt-1">
                      {NAYAPAY_TITLE}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rejection Alert (If previous submission was rejected) */}
              {step === "rejected" && (
                <div className="mb-6 rounded-2xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-xs text-red-800 dark:text-red-200">
                  <div className="font-bold flex items-center gap-1.5 text-sm mb-1 text-red-900 dark:text-red-300">
                    <span>⚠️</span> Verification Request Rejected by Admin
                  </div>
                  <p className="leading-relaxed">
                    <strong>Reason:</strong> {rejectionReason || "Payment could not be verified on NayaPay account 03217253923."}
                  </p>
                  <p className="mt-2 text-[11px] text-red-700 dark:text-red-400 font-semibold">
                    The verification button has been re-activated below. Please ensure your payment has been sent and update your account holder name before resubmitting.
                  </p>
                </div>
              )}

              {/* Waiting State Banner */}
              {step === "waiting" && (
                <div className="mb-6 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-5 text-xs text-amber-900 dark:text-amber-200 shadow-sm animate-pulse">
                  <div className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-300 mb-2">
                    <span className="animate-spin text-base">⏳</span>
                    <span>Waiting for System Administrator Approval...</span>
                  </div>
                  <p className="leading-relaxed">
                    Your verification request for sender <strong>"{senderName}"</strong> has been delivered to the Admin console.
                  </p>
                  <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-400">
                    The verification button is locked while your request is pending review. This screen automatically updates the moment the Admin approves your store.
                  </p>
                </div>
              )}

              {/* Active Success Screen */}
              {step === "active" && (
                <div className="mb-6 rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-5 text-xs text-emerald-900 dark:text-emerald-200">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-300 mb-1">
                    <span>🎉</span> Store Approved & Active!
                  </div>
                  <p>Redirecting you to your SubAdmin dashboard now…</p>
                </div>
              )}

              {/* Sender Name Form & Single-Click Verification Button */}
              <form onSubmit={handleSubmitPaymentVerification} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#173c32] dark:text-white mb-1">
                    Sender Account Holder Name *{" "}
                    <span className="text-[#a26d2d] dark:text-[#d7a35d] font-normal">
                      (jo account mn payment send kr ga)
                    </span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={step === "waiting" || step === "active"}
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="Enter the exact account holder title used to send payment"
                    className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-3 text-sm text-[#173c32] dark:text-white placeholder-[#8a948c] focus:outline-none focus:ring-2 focus:ring-[#173c32] disabled:opacity-60"
                  />
                  <span className="block text-[11px] text-[#5d665f] dark:text-[#a0ada5] mt-1">
                    Mandatory field: Admin will cross-reference this name with incoming NayaPay statements.
                  </span>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={
                      submittingPayment ||
                      step === "waiting" ||
                      step === "active" ||
                      !senderName.trim()
                    }
                    className={`w-full rounded-2xl py-3.5 text-sm font-black shadow-md transition touch-manipulation flex items-center justify-center gap-2 ${
                      step === "waiting"
                        ? "bg-amber-600/80 text-white cursor-not-allowed opacity-75"
                        : step === "active"
                        ? "bg-emerald-600 text-white cursor-not-allowed"
                        : "bg-[#173c32] dark:bg-[#d7a35d] hover:bg-[#0f2d2b] dark:hover:bg-[#c28e46] text-white dark:text-[#173c32] disabled:opacity-50"
                    }`}
                  >
                    {submittingPayment
                      ? "Submitting to Admin…"
                      : step === "waiting"
                      ? "⏳ Verification Under Review by Admin (Locked)"
                      : step === "active"
                      ? "✓ Approved! Redirecting…"
                      : step === "rejected"
                      ? "Resubmit Payment for Verification"
                      : "Submit for Verification (One-Time)"}
                  </button>
                </div>
              </form>

              <div className="mt-6 pt-4 border-t border-[#ece4da] dark:border-white/10 flex flex-wrap items-center justify-between text-xs text-[#5d665f] dark:text-[#a0ada5]">
                <span>Status: <strong className="uppercase font-mono text-[#173c32] dark:text-white">{tenantStatus}</strong></span>
                <Link href="/login" className="font-bold text-[#173c32] dark:text-[#d7a35d] hover:underline">
                  Back to Sign In
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

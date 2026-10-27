"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { postJson } from "@/lib/api";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { EmailOtpVerifier } from "@/components/ui/EmailOtpVerifier";

// Luhn algorithm validator for credit cards
function isValidLuhn(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (isNaN(digit)) return false;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export default function GetAccessPage() {
  const router = useRouter();

  // Wizard steps: 1 = Store Details, 2 = Payment, 3 = Credentials, 4 = Success
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Store & Contact
  const [storeName, setStoreName] = useState("");
  const [email, setEmail]         = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");

  // Step 2: Payment Details (Zero-fee reliable test card gateway)
  const [cardName, setCardName]     = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc]       = useState("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);

  // Step 3: Owner Credentials
  const [ownerName, setOwnerName]     = useState("");
  const [password, setPassword]       = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [submitting, setSubmitting]   = useState(false);

  // General error handling
  const [error, setError] = useState("");

  // Quick fill test card
  const handleFillTestCard = () => {
    setCardName(ownerName || "Jane Storeowner");
    setCardNumber("4242 4242 4242 4242");
    setCardExpiry("12/28");
    setCardCvc("123");
    setError("");
  };

  // Step 1 submit: Move to payment
  const handleStoreDetailsSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!storeName.trim() || !email.trim()) {
      setError("Please provide your store name and business email.");
      return;
    }
    if (!otpVerified) {
      setError("Please verify your business email with the OTP code before proceeding.");
      return;
    }
    setError("");
    setStep(2);
  };

  // Step 2 submit: Process zero-fee card payment verification
  const handlePaymentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanCard = cardNumber.replace(/\s+/g, "");
    if (cleanCard.length < 13 || cleanCard.length > 19 || !isValidLuhn(cleanCard)) {
      setError("Please enter a valid credit card number (or click 'Fill Test Card').");
      return;
    }

    if (!/^(0[1-9]|1[0-2])\/?([0-9]{2})$/.test(cardExpiry.trim())) {
      setError("Please enter a valid expiry date in MM/YY format.");
      return;
    }

    if (!/^[0-9]{3,4}$/.test(cardCvc.trim())) {
      setError("Please enter a valid 3 or 4 digit CVC.");
      return;
    }

    setIsProcessingPayment(true);
    // Simulate secure 256-bit gateway verification with reliable zero-fee simulation
    setTimeout(() => {
      setIsProcessingPayment(false);
      setPaymentDone(true);
      setStep(3);
    }, 1200);
  };

  // Step 3 submit: Create Tenant + SubAdmin account
  const handleAccountCreation = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!ownerName.trim()) {
      setError("Please enter your full name or admin username.");
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

    setSubmitting(true);
    try {
      await postJson("/api/auth/onboard-store", {
        storeName: storeName.trim(),
        email: email.trim(),
        name: ownerName.trim(),
        password,
        verificationToken,
      });

      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize store and account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f6f1ea] dark:bg-[#0d1512] text-[#1f2a25] dark:text-[#f6f1ea] transition-colors duration-200 px-4 py-8 md:py-12">
      <div className="mx-auto max-w-2xl">
        {/* Header bar */}
        <div className="mb-6 sm:mb-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <Link
              href="/"
              className="grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-xl bg-[#d7a35d] text-lg font-black text-[#173c32]"
            >
              P
            </Link>
            <div className="min-w-0">
              <div className="text-lg sm:text-xl font-bold tracking-tight text-[#173c32] dark:text-[#f6f1ea] truncate">Pointe POS</div>
              <div className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-[#a26d2d] dark:text-[#edd3ab] truncate">
                Store Onboarding Portal
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            <Link
              href="/login"
              className="min-h-[38px] inline-flex items-center rounded-xl border border-[#d9d0c3] dark:border-white/20 px-3 sm:px-3.5 py-1.5 text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/10"
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* Wizard progress tracker */}
        <div className="mb-8 rounded-2xl bg-white dark:bg-[#14211c] p-4 shadow-sm border border-[#ece4da] dark:border-white/10">
          <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold">
            <div className={`py-2 rounded-xl transition ${step >= 1 ? "bg-[#173c32] text-white" : "text-[#5d665f]"}`}>
              1. Store Details
            </div>
            <div className={`py-2 rounded-xl transition ${step >= 2 ? "bg-[#173c32] text-white" : "text-[#5d665f]"}`}>
              2. Payment (Rs. 0 Free Trial)
            </div>
            <div className={`py-2 rounded-xl transition ${step >= 3 ? "bg-[#173c32] text-white" : "text-[#5d665f]"}`}>
              3. Account Setup
            </div>
          </div>
        </div>

        {/* Card Container */}
        <div className="rounded-[2rem] bg-white dark:bg-[#14211c] p-7 md:p-10 shadow-xl shadow-[#173c32]/5 border border-[#ece4da] dark:border-white/10">
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* ──────────────── STEP 1: STORE & CONTACT ──────────────── */}
          {step === 1 && (
            <div>
              <div className="mb-6">
                <span className="text-xs font-bold uppercase tracking-[0.22em] text-[#a26d2d]">Get Pointe POS</span>
                <h1 className="mt-1 text-3xl font-black text-[#173c32] dark:text-[#f6f1ea]">
                  Set up your store
                </h1>
                <p className="mt-2 text-sm text-[#5d665f] dark:text-[#a0ada5]">
                  Start managing your counter sales, inventory, and staff with our offline-first POS platform.
                </p>
              </div>

              <form onSubmit={handleStoreDetailsSubmit} className="space-y-5">
                <label className="block text-sm font-semibold">
                  Store / Business Name
                  <input
                    required
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="field"
                    placeholder="e.g. Apex Coffee & Roastery"
                  />
                  <span className="mt-1 block text-xs text-[#5d665f] dark:text-[#a0ada5]">
                    This will create your dedicated store tenant.
                  </span>
                </label>

                <label className="block text-sm font-semibold">
                  Owner Business Email
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setOtpVerified(false);
                      setVerificationToken("");
                    }}
                    className="field"
                    placeholder="owner@apexcoffee.com"
                  />
                  <span className="mt-1 block text-xs text-[#5d665f] dark:text-[#a0ada5]">
                    Your primary login and system notifications address.
                  </span>
                </label>

                {/* OTP Verification for Store Owner */}
                <EmailOtpVerifier
                  email={email}
                  purpose="subadmin_register"
                  isVerified={otpVerified}
                  onVerified={(tok) => {
                    setOtpVerified(true);
                    setVerificationToken(tok);
                    setError("");
                  }}
                  onResetVerification={() => {
                    setOtpVerified(false);
                    setVerificationToken("");
                  }}
                />

                <div className="rounded-2xl bg-[#fff7eb] dark:bg-white/5 p-4 text-sm text-[#5e4829] dark:text-[#edd3ab]">
                  ✨ Includes 1 SubAdmin (Store Manager), 1 dedicated HR seat, and unlimited Operator counter registers.
                </div>

                <button
                  type="submit"
                  className="w-full rounded-2xl bg-[#173c32] px-4 py-3.5 text-base font-bold text-white transition hover:bg-[#0f2d2b]"
                >
                  Continue to Payment Verification →
                </button>
              </form>
            </div>
          )}

          {/* ──────────────── STEP 2: PAYMENT VERIFICATION ──────────────── */}
          {step === 2 && (
            <div>
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-[0.22em] text-[#a26d2d]">Zero-Cost Activation</span>
                  <h1 className="mt-1 text-2xl font-black text-[#173c32] dark:text-[#f6f1ea]">
                    Card Payment System
                  </h1>
                  <p className="mt-1 text-sm text-[#5d665f] dark:text-[#a0ada5]">
                    Store: <strong className="text-[#173c32] dark:text-white">{storeName}</strong> ({email})
                  </p>
                </div>
                <div className="rounded-xl bg-green-100 dark:bg-green-950/60 px-3 py-1 text-xs font-bold text-green-800 dark:text-green-300">
                  Rs. 0.00 / Free Activation
                </div>
              </div>

              <div className="mb-5 flex items-center justify-between rounded-2xl border border-dashed border-[#d7a35d] bg-[#fffaf1] dark:bg-white/5 p-3.5 text-xs text-[#5d665f] dark:text-[#edd3ab]">
                <div>
                  <span>Need quick test card info? </span>
                  <button
                    type="button"
                    onClick={handleFillTestCard}
                    className="font-bold text-[#173c32] dark:text-[#d7a35d] underline"
                  >
                    Click to auto-fill free test card
                  </button>
                </div>
                <span className="text-xs font-mono bg-white dark:bg-black/30 px-2 py-0.5 rounded border border-[#d9d0c3] dark:border-white/10">
                  4242 •••• 4242
                </span>
              </div>

              <form onSubmit={handlePaymentSubmit} className="space-y-4">
                <label className="block text-sm font-semibold">
                  Cardholder Name
                  <input
                    required
                    type="text"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    className="field"
                    placeholder="Full name as printed on card"
                  />
                </label>

                <label className="block text-sm font-semibold">
                  Card Number
                  <div className="relative">
                    <input
                      required
                      type="text"
                      maxLength={19}
                      value={cardNumber}
                      onChange={(e) => {
                        // Format with spaces every 4 digits
                        const v = e.target.value.replace(/\D/g, "").slice(0, 16);
                        setCardNumber(v.replace(/(\d{4})/g, "$1 ").trim());
                      }}
                      className="field font-mono"
                      placeholder="4242 4242 4242 4242"
                    />
                    <span className="absolute right-3 top-3.5 text-xs font-bold text-[#5d665f] dark:text-white/60">
                      💳 VISA / MC
                    </span>
                  </div>
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block text-sm font-semibold">
                    Expiry Date
                    <input
                      required
                      type="text"
                      maxLength={5}
                      value={cardExpiry}
                      onChange={(e) => {
                        let v = e.target.value.replace(/\D/g, "").slice(0, 4);
                        if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`;
                        setCardExpiry(v);
                      }}
                      className="field font-mono"
                      placeholder="MM/YY"
                    />
                  </label>

                  <label className="block text-sm font-semibold">
                    CVC / CVV
                    <input
                      required
                      type="password"
                      maxLength={4}
                      value={cardCvc}
                      onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      className="field font-mono"
                      placeholder="123"
                    />
                  </label>
                </div>

                <div className="flex items-center gap-2 pt-2 text-xs text-[#5d665f] dark:text-[#a0ada5]">
                  <span>🔒 256-bit SSL encrypted. Free reliable transaction verification. Zero fee charge.</span>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="rounded-2xl border border-[#d9d0c3] dark:border-white/20 px-4 py-3 text-sm font-semibold"
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessingPayment}
                    className="flex-1 rounded-2xl bg-[#d7a35d] px-4 py-3.5 text-base font-bold text-[#173c32] transition hover:bg-[#c98d41] disabled:opacity-60"
                  >
                    {isProcessingPayment ? "Verifying with gateway…" : "Complete Free Payment & Verify ($0.00)"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ──────────────── STEP 3: OWNER CREDENTIALS ──────────────── */}
          {step === 3 && (
            <div>
              <div className="mb-5 rounded-2xl bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 p-4">
                <div className="flex items-center gap-2 text-green-800 dark:text-green-300 font-bold text-sm">
                  <span>✓ Payment Verified Successfully!</span>
                </div>
                <div className="mt-1 text-xs text-green-700 dark:text-green-400">
                  Transaction confirmed with zero fee. Now create your SubAdmin credentials to access your store dashboard.
                </div>
              </div>

              <div className="mb-6">
                <span className="text-xs font-bold uppercase tracking-[0.22em] text-[#a26d2d]">Account Creation</span>
                <h2 className="mt-1 text-2xl font-black text-[#173c32] dark:text-[#f6f1ea]">
                  Set your SubAdmin credentials
                </h2>
                <p className="mt-1 text-sm text-[#5d665f] dark:text-[#a0ada5]">
                  This account registers as the <strong>SubAdmin (Store Manager)</strong> for{" "}
                  <strong className="text-[#173c32] dark:text-white">{storeName}</strong>.
                </p>
              </div>

              <form onSubmit={handleAccountCreation} className="space-y-4">
                <label className="block text-sm font-semibold">
                  Manager Full Name / Username
                  <input
                    required
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="field"
                    placeholder="e.g. Alex Henderson"
                  />
                </label>

                <label className="block text-sm font-semibold">
                  Store SubAdmin Email
                  <input
                    disabled
                    type="email"
                    value={email}
                    className="field opacity-75 cursor-not-allowed bg-black/5 dark:bg-white/5"
                  />
                </label>

                <label className="block text-sm font-semibold">
                  Password
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="field"
                    placeholder="At least 8 characters"
                  />
                </label>

                <label className="block text-sm font-semibold">
                  Confirm Password
                  <input
                    required
                    type="password"
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    className="field"
                    placeholder="Repeat your password"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-2xl bg-[#173c32] px-4 py-3.5 text-base font-bold text-white transition hover:bg-[#0f2d2b] disabled:opacity-60"
                >
                  {submitting ? "Initializing Store & SubAdmin Account…" : "Create SubAdmin Account & Launch Store"}
                </button>
              </form>
            </div>
          )}

          {/* ──────────────── STEP 4: SUCCESS & LOGIN REDIRECT ──────────────── */}
          {step === 4 && (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 dark:bg-emerald-950 text-3xl text-emerald-600">
                🎉
              </div>
              <h2 className="text-2xl font-black text-[#173c32] dark:text-[#f6f1ea]">
                Store Created Successfully!
              </h2>
              <p className="mt-2 text-sm text-[#5d665f] dark:text-[#a0ada5] max-w-md mx-auto">
                Your store <strong>{storeName}</strong> has been initialized in the system, and your default{" "}
                <strong>SubAdmin</strong> account is active.
              </p>

              <div className="my-6 rounded-2xl bg-[#faf8f4] dark:bg-white/5 p-4 text-sm text-left max-w-md mx-auto space-y-2 border border-[#ece4da] dark:border-white/10">
                <div className="flex justify-between">
                  <span className="text-[#5d665f] dark:text-[#a0ada5]">Store Tenant:</span>
                  <span className="font-bold text-[#173c32] dark:text-white">{storeName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5d665f] dark:text-[#a0ada5]">Manager Account:</span>
                  <span className="font-bold text-[#173c32] dark:text-white">{email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5d665f] dark:text-[#a0ada5]">Assigned Role:</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">SubAdmin (Default)</span>
                </div>
              </div>

              <div className="space-y-3 max-w-md mx-auto">
                <Link
                  href={`/login?role=SubAdmin&email=${encodeURIComponent(email)}`}
                  className="block w-full rounded-2xl bg-[#d7a35d] px-4 py-3.5 text-base font-bold text-[#173c32] transition hover:bg-[#c98d41]"
                >
                  Proceed to Login as SubAdmin →
                </Link>
                <Link
                  href="/"
                  className="block text-xs font-semibold text-[#5d665f] dark:text-[#a0ada5] hover:underline"
                >
                  Return to Home
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}


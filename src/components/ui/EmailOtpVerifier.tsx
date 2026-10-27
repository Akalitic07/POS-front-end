"use client";

import { useState, useEffect, useRef } from "react";
import { postJson } from "@/lib/api";

export type OtpPurpose = "subadmin_register" | "admin_add_tenant" | "subadmin_add_staff" | "password_reset";

interface EmailOtpVerifierProps {
  email: string;
  purpose: OtpPurpose;
  isVerified: boolean;
  onVerified: (verificationToken: string) => void;
  onResetVerification?: () => void;
  disabled?: boolean;
}

export function EmailOtpVerifier({
  email,
  purpose,
  isVerified,
  onVerified,
  onResetVerification,
  disabled = false,
}: EmailOtpVerifierProps) {
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [error, setError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeLeft]);

  const isValidEmail = (addr: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());

  // Send OTP
  const handleSendOtp = async () => {
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address first.");
      return;
    }
    setError("");
    setSuccessNotice("");
    setSending(true);

    try {
      const res = await postJson<{ message: string; expiresInSeconds?: number }>(
        "/api/auth/send-verification-otp",
        { email: email.trim().toLowerCase(), purpose }
      );
      setOtpSent(true);
      setTimeLeft(res.expiresInSeconds || 90);
      setSuccessNotice(res.message || "Verification code sent to your email.");
      setOtp("");
    } catch (err: any) {
      setError(err?.message || "Failed to send verification code. Please check your email.");
    } finally {
      setSending(false);
    }
  };

  // Verify OTP
  const handleVerifyOtp = async () => {
    if (!otp.trim() || otp.trim().length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }
    setError("");
    setVerifying(true);

    try {
      const res = await postJson<{ message: string; verified: boolean; verificationToken: string }>(
        "/api/auth/verify-registration-otp",
        {
          email: email.trim().toLowerCase(),
          otp: otp.trim(),
          purpose,
        }
      );
      if (res.verified && res.verificationToken) {
        onVerified(res.verificationToken);
        setSuccessNotice("✓ Email verified successfully!");
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setError("Verification was not completed. Please try again.");
      }
    } catch (err: any) {
      setError(err?.message || "Invalid or expired verification code.");
    } finally {
      setVerifying(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (isVerified) {
    return (
      <div className="rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2 transition-all">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">✓</span>
          <div>
            <strong>Email Verified:</strong> <span className="font-mono">{email}</span>
          </div>
        </div>
        {onResetVerification && (
          <button
            type="button"
            onClick={onResetVerification}
            className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 underline hover:text-emerald-900 transition"
          >
            Change Email
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-3.5 space-y-3 transition-colors">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-[#173c32] dark:text-white flex items-center gap-1.5">
          <span>📧</span> Email Verification Required
        </div>
        {!otpSent ? (
          <button
            type="button"
            disabled={sending || disabled || !isValidEmail(email)}
            onClick={handleSendOtp}
            className="rounded-xl bg-[#173c32] dark:bg-[#215446] hover:bg-[#0f2d2b] px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50 touch-manipulation flex items-center gap-1"
          >
            {sending ? "Sending Code…" : "Send Verification OTP"}
          </button>
        ) : (
          <button
            type="button"
            disabled={sending || disabled || timeLeft > 60}
            onClick={handleSendOtp}
            className="text-[11px] font-bold text-[#a26d2d] dark:text-[#edd3ab] underline hover:text-[#173c32] dark:hover:text-white transition disabled:opacity-50 disabled:no-underline"
          >
            {sending ? "Sending…" : timeLeft > 0 ? `Resend Code in ${timeLeft}s` : "Resend Verification Code"}
          </button>
        )}
      </div>

      {otpSent && (
        <div className="space-y-2.5 pt-1 border-t border-[#ece4da] dark:border-white/10">
          <p className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
            A 6-digit code was sent to <strong className="text-[#173c32] dark:text-white">{email}</strong>. Please check your inbox.
          </p>

          <div className="flex items-center gap-2">
            <input
              type="text"
              maxLength={6}
              value={otp}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                setOtp(val);
                if (val.length === 6) {
                  setError("");
                }
              }}
              placeholder="123456"
              className="w-36 tracking-[6px] font-mono text-center font-bold text-sm rounded-xl border border-[#ece4da] dark:border-white/10 bg-white dark:bg-black/40 p-2 text-[#173c32] dark:text-white"
            />

            <button
              type="button"
              disabled={verifying || disabled || otp.length !== 6}
              onClick={handleVerifyOtp}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50 touch-manipulation shadow-sm"
            >
              {verifying ? "Verifying…" : "Verify OTP"}
            </button>

            {timeLeft > 0 && (
              <span className="text-[11px] font-mono font-bold text-[#a26d2d] dark:text-[#edd3ab] ml-auto">
                ⏱️ {formatTimer(timeLeft)}
              </span>
            )}
          </div>
        </div>
      )}

      {successNotice && (
        <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
          {successNotice}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-2 text-[11px] font-bold text-red-700 dark:text-red-300">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}


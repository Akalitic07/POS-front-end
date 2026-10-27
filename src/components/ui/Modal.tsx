"use client";

import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
}

export function Modal({ open, title, onClose, children, maxWidthClass = "max-w-lg" }: ModalProps) {
  // Close on Escape key & lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = originalOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Backdrop
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Panel */}
      <div
        className={`w-full ${maxWidthClass} max-h-[92vh] overflow-y-auto touch-scroll rounded-3xl sm:rounded-[2rem] bg-white dark:bg-[#14211c] text-[#1f2a25] dark:text-[#f6f1ea] border border-[#ece4da] dark:border-white/10 p-5 sm:p-7 md:p-8 shadow-2xl shadow-black/30`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 sm:mb-6 flex items-center justify-between gap-3 border-b border-[#ece4da] dark:border-white/10 pb-3 sm:pb-4 sticky -top-5 sm:-top-7 bg-white dark:bg-[#14211c] z-10 pt-1">
          <h2 className="text-xl sm:text-2xl font-black text-[#173c32] dark:text-white leading-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#f3efe9] dark:hover:bg-white/10 hover:text-[#173c32] dark:hover:text-white transition touch-manipulation"
            aria-label="Close dialog"
          >
            <span className="text-lg font-bold">✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

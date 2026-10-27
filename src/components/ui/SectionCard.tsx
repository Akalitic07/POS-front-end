import type { ReactNode } from "react";

interface SectionCardProps {
  title?:     string;
  action?:    ReactNode;
  children:   ReactNode;
  className?: string;
  dark?:      boolean;
}

export function SectionCard({ title, action, children, className = "", dark = false }: SectionCardProps) {
  const base = dark
    ? "bg-[#173c32] dark:bg-[#10241e] text-[#f7f3ee] border border-transparent dark:border-white/10 shadow-[#173c32]/10"
    : "bg-white dark:bg-[#14211c] text-[#1f2a25] dark:text-[#f6f1ea] border border-[#ece4da] dark:border-white/10 shadow-[#173c32]/5";

  return (
    <div className={`rounded-[2rem] p-6 shadow-sm ${base} ${className}`}>
      {(title || action) && (
        <div className="mb-5 flex items-center justify-between gap-3">
          {title && (
            <h2 className={`text-xl font-black ${dark ? "text-white" : "text-[#173c32] dark:text-white"}`}>
              {title}
            </h2>
          )}
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

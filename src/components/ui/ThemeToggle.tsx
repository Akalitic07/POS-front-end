"use client";

import { useTheme } from "@/context/ThemeContext";

export function ThemeToggle({
  className = "",
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      className={`inline-flex items-center justify-center rounded-xl border border-[#d9d0c3] dark:border-white/20 transition hover:bg-black/5 dark:hover:bg-white/10 ${className}`}
    >
      <span className="flex items-center justify-center text-center leading-none text-sm select-none">
        {theme === "light" ? "🌙" : "☀️"}
      </span>
      {showLabel && (
        <span className="text-xs font-semibold ml-1.5 leading-none">
          {theme === "light" ? "Dark" : "Light"}
        </span>
      )}
    </button>
  );
}


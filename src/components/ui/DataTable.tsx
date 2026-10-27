"use client";

import type { ReactNode } from "react";

export type Column<T> = {
  header: string;
  accessor: keyof T | ((row: T) => ReactNode);
  className?: string;
};

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  rows: T[];
  keyField?: keyof T;
  actions?: (row: T) => ReactNode;
  emptyMessage?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  keyField = "id" as keyof T,
  actions,
  emptyMessage = "No records found.",
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[#5d665f] dark:text-[#a0ada5]">{emptyMessage}</div>
    );
  }

  return (
    <div className="overflow-x-auto touch-scroll rounded-2xl border border-[#ece4da] dark:border-white/10 -mx-1 sm:mx-0">
      <table className="w-full min-w-[560px] text-xs sm:text-sm">
        <thead>
          <tr className="bg-[#f6f1ea] dark:bg-black/30 border-b border-[#ece4da] dark:border-white/10">
            {columns.map((col) => (
              <th
                key={col.header}
                className={`px-3 sm:px-4 py-3 text-left text-[11px] sm:text-xs font-bold uppercase tracking-[0.13em] text-[#5d665f] dark:text-[#a0ada5] ${
                  col.className ?? ""
                }`}
              >
                {col.header}
              </th>
            ))}
            {actions && (
              <th className="px-3 sm:px-4 py-3 text-left text-[11px] sm:text-xs font-bold uppercase tracking-[0.13em] text-[#5d665f] dark:text-[#a0ada5]">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={String(row[keyField] ?? idx)}
              className={`border-t border-[#ece4da] dark:border-white/5 transition-colors hover:bg-[#faf8f4] dark:hover:bg-white/5 ${
                idx % 2 === 0 ? "bg-white dark:bg-[#14211c]" : "bg-[#fdfaf6] dark:bg-[#101c18]"
              }`}
            >
              {columns.map((col) => (
                <td
                  key={col.header}
                  className={`px-3 sm:px-4 py-3 text-[#1f2a25] dark:text-[#f6f1ea] ${col.className ?? ""}`}
                >
                  {typeof col.accessor === "function" ? col.accessor(row) : String(row[col.accessor] ?? "—")}
                </td>
              ))}
              {actions && <td className="px-3 sm:px-4 py-3">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

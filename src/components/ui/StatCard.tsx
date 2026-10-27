interface StatCardProps {
  label:   string;
  value:   string | number;
  sub?:    string;
  accent?: "green" | "gold" | "blue" | "slate";
}

const accentMap = {
  green: "text-[#173c32] dark:text-[#4ade80]",
  gold:  "text-[#a26d2d] dark:text-[#fbbf24]",
  blue:  "text-blue-700 dark:text-blue-400",
  slate: "text-[#365f59] dark:text-[#94a3b8]",
};

export function StatCard({ label, value, sub, accent = "green" }: StatCardProps) {
  return (
    <div className="rounded-[1.5rem] bg-white dark:bg-[#14211c] border border-[#ece4da] dark:border-white/10 p-5 shadow-sm shadow-[#173c32]/5">
      <div className="text-sm font-semibold text-[#5d665f] dark:text-[#a0ada5]">{label}</div>
      <div className={`mt-3 text-3xl font-black ${accentMap[accent]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[#5d665f] dark:text-[#a0ada5]">{sub}</div>}
    </div>
  );
}

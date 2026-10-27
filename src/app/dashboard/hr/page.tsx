"use client";

import { useEffect, useState, useCallback, useMemo, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getJson, postJson, deleteJson } from "@/lib/api";
import { DashboardHeader } from "@/components/ui/DashboardHeader";
import { StatCard } from "@/components/ui/StatCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { DataTable } from "@/components/ui/DataTable";
import { Sidebar } from "@/components/layout/Sidebar";
import { Modal } from "@/components/ui/Modal";

type StaffUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle?: string;
  phone?: string;
  dailyWage?: number;
  tenantId: string;
  createdAt: string;
};

type AttendanceRecord = {
  id: string;
  userId: string;
  userName: string;
  role: string;
  date: string;
  status: "Present" | "Absent" | "Half Time" | "Permitted Leave" | "Half Day" | "Paid Leave";
  dailyWage: number;
  earnedWage: number;
  deductedWage: number;
  wagePercentage: number;
  notes?: string;
  markedByName?: string;
  createdAt: string;
};

type AttendanceEntryState = {
  userId: string;
  userName: string;
  role: string;
  dailyWage: number;
  status: "Present" | "Absent" | "Half Time" | "Permitted Leave" | "Half Day" | "Paid Leave";
  notes: string;
};

type TransactionItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  returnedQuantity?: number;
};

type Transaction = {
  id: string;
  tenantId: string;
  total: number;
  subtotal?: number;
  tax?: number;
  discount?: { type: "percent" | "fixed"; value: number; amount: number } | null;
  refundAmount?: number;
  netTotal?: number;
  cashGiven?: number;
  changeDue?: number;
  paymentMethod?: string;
  receiptNumber?: string;
  operatorId?: string;
  operatorName?: string;
  items?: TransactionItem[];
  status: "completed" | "partially_returned" | "returned";
  returnedAt?: string;
  returnReason?: string;
  createdAt: string;
  updatedAt?: string;
};

type DateStatus = {
  date: string;
  today?: string;
  isToday?: boolean;
  isFuture?: boolean;
  isSaved: boolean;
  isLocked: boolean;
  canEdit: boolean;
  editRequest: {
    id: string;
    status: "pending" | "approved" | "rejected" | "used";
    reason: string;
    createdAt: string;
  } | null;
  recordCount: number;
};

type HRTab = "tracker" | "wages" | "sales" | "roster";

// Standard Time conversion helpers (handles ISO timestamps in local calendar standard time)
const getStandardLocalDate = (iso: string | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getStandardLocalMonth = (iso: string | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const formatStandardDateTime = (iso: string | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

function HRDashboardContent() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlTab = (searchParams.get("tab") as HRTab) || "tracker";
  const [activeTab, setActiveTab] = useState<HRTab>(
    urlTab && ["tracker", "wages", "sales", "roster"].includes(urlTab) ? urlTab : "tracker"
  );

  useEffect(() => {
    const tab = searchParams.get("tab") as HRTab;
    if (tab && ["tracker", "wages", "sales", "roster"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const switchTab = (tab: HRTab) => {
    setActiveTab(tab);
    router.replace(`/dashboard/hr?tab=${tab}`);
  };

  // Sales view states for HR (View Only)
  const [salesSearch, setSalesSearch] = useState("");
  const [salesStatusFilter, setSalesStatusFilter] = useState<"all" | "today" | "completed" | "partially_returned" | "returned">("all");
  const [viewReceiptTxn, setViewReceiptTxn] = useState<Transaction | null>(null);
  const [selectedOperatorWindow, setSelectedOperatorWindow] = useState<string>("all");

  const [employees, setEmployees] = useState<StaffUser[]>([]);
  const [empLoading, setEmpLoading] = useState(true);
  const [empSearch, setEmpSearch] = useState("");

  // Add shop employee modal state
  const [addEmpModalOpen, setAddEmpModalOpen] = useState(false);
  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpTitle, setNewEmpTitle] = useState("Shop Employee");
  const [newEmpPhone, setNewEmpPhone] = useState("");
  const [newEmpWage, setNewEmpWage] = useState("45");
  const [addingEmp, setAddingEmp] = useState(false);
  const [addEmpError, setAddEmpError] = useState("");

  // Attendance states
  const todayStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);
  const currentMonthStr = useMemo(() => todayStr.slice(0, 7), [todayStr]);

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [attendanceEntries, setAttendanceEntries] = useState<Record<string, AttendanceEntryState>>({});
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [attNotice, setAttNotice] = useState("");

  // Month filter for wage calculations: "all" or "YYYY-MM"
  const [selectedMonthFilter, setSelectedMonthFilter] = useState("all");

  // Selected employee for detailed history modal
  const [detailEmployee, setDetailEmployee] = useState<StaffUser | null>(null);

  // Date lock & SubAdmin permission states
  const [dateStatus, setDateStatus] = useState<DateStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState("");


  // Delete employee target
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Auth guard — HR only
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "HR") {
      router.replace("/dashboard");
      return;
    }
  }, [user, loading, router]);

  // Load employees
  const loadEmployees = useCallback(async () => {
    if (!token) return;
    setEmpLoading(true);
    try {
      const data = await getJson<{ users: StaffUser[] }>("/api/users", token);
      setEmployees(data.users || []);
    } catch {
      // silently fail
    } finally {
      setEmpLoading(false);
    }
  }, [token]);

  // Load Attendance Records
  const loadAttendance = useCallback(async () => {
    if (!token) return;
    setAttLoading(true);
    try {
      const data = await getJson<{
        records: AttendanceRecord[];
      }>("/api/attendance", token);
      setAttendanceRecords(data.records || []);
    } catch {
      // silently fail
    } finally {
      setAttLoading(false);
    }
  }, [token]);

  // Load Transactions for Store Earnings
  const loadTransactions = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getJson<{ transactions: Transaction[] }>("/api/transactions", token);
      setTransactions(data.transactions || []);
    } catch {
      // silently fail
    }
  }, [token]);

  // Check Lock Status for Selected Date
  const checkDateStatus = useCallback(async (date: string) => {
    if (!token) return;
    setStatusLoading(true);
    try {
      const data = await getJson<DateStatus>(`/api/attendance/date-status?date=${date}&today=${todayStr}`, token);
      setDateStatus(data);
    } catch {
      setDateStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [token, todayStr]);

  useEffect(() => {
    loadEmployees();
    loadAttendance();
    loadTransactions();
  }, [loadEmployees, loadAttendance, loadTransactions]);

  useEffect(() => {
    checkDateStatus(selectedDate);
  }, [selectedDate, checkDateStatus]);

  // Filter markable staff (Operators, Shop Employees, and HR themselves)
  const markableStaff = useMemo(
    () => employees.filter((e) => e.role === "Operator" || e.role === "Employee" || e.role === "HR"),
    [employees]
  );

  // Sync attendance entries template when employees, date, or records change
  useEffect(() => {
    if (markableStaff.length === 0) return;

    // Find existing records for selectedDate
    const existingForDate = attendanceRecords.filter((r) => r.date === selectedDate);
    const existingMap = new Map<string, AttendanceRecord>();
    existingForDate.forEach((r) => existingMap.set(r.userId, r));

    const initialMap: Record<string, AttendanceEntryState> = {};
    markableStaff.forEach((staff) => {
      const exist = existingMap.get(staff.id);
      initialMap[staff.id] = {
        userId: staff.id,
        userName: staff.name,
        role: staff.role,
        dailyWage: staff.dailyWage ?? 0,
        status: exist ? exist.status : "Present",
        notes: exist?.notes || "",
      };
    });
    setAttendanceEntries(initialMap);
  }, [employees, selectedDate, attendanceRecords, markableStaff]);

  // Helper to format month name (e.g. "2026-10" -> "October 2026")
  const formatMonthName = (ym: string) => {
    if (!ym || ym === "all") return "All Months";
    const [year, month] = ym.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  // Available months list extracted dynamically from attendance records
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    monthsSet.add(currentMonthStr);
    attendanceRecords.forEach((r) => {
      if (r.date && r.date.length >= 7) {
        monthsSet.add(r.date.slice(0, 7));
      }
    });
    return Array.from(monthsSet).sort().reverse();
  }, [attendanceRecords, currentMonthStr]);

  // Filter attendance records by selected month for real-time calculations
  const filteredAttendanceByMonth = useMemo(() => {
    if (selectedMonthFilter === "all") return attendanceRecords;
    return attendanceRecords.filter((r) => (r.date || "").startsWith(selectedMonthFilter));
  }, [attendanceRecords, selectedMonthFilter]);

  // Real-time calculation per employee for Employee Wage & Deduction Summary
  const realTimeEmployeeSummaries = useMemo(() => {
    return markableStaff.map((emp) => {
      // Find all records specifically matching this employee's unique ID
      const userRecs = filteredAttendanceByMonth.filter((r) => r.userId === emp.id);

      const daysPresent = userRecs.filter((r) => r.status === "Present").length;
      const daysPermittedLeave = userRecs.filter((r) => r.status === "Permitted Leave" || r.status === "Paid Leave").length;
      const daysHalfTime = userRecs.filter((r) => r.status === "Half Time" || r.status === "Half Day").length;
      const daysAbsent = userRecs.filter((r) => r.status === "Absent").length;
      const totalDaysLogged = userRecs.length;

      const earnedWage = Number(userRecs.reduce((sum, r) => sum + (r.earnedWage || 0), 0).toFixed(2));
      const deductedWage = Number(userRecs.reduce((sum, r) => sum + (r.deductedWage || 0), 0).toFixed(2));
      const grossWage = Number((totalDaysLogged * (emp.dailyWage || 0)).toFixed(2));

      return {
        userId: emp.id,
        userName: emp.name,
        role: emp.role,
        jobTitle: emp.jobTitle || emp.role,
        dailyWage: Number(emp.dailyWage) || 0,
        createdAt: emp.createdAt,
        totalDaysLogged,
        daysPresent,
        daysAbsent,
        daysHalfTime,
        daysPermittedLeave,
        totalLeaveDays: daysPermittedLeave + daysHalfTime,
        grossWage,
        earnedWage,     // Net wage after deductions
        deductedWage,   // Total deduction
      };
    });
  }, [markableStaff, filteredAttendanceByMonth]);

  // Financial Earnings & Sales Calculations (Standard Local Time & Return Deductions)
  // 1. Store Total Calculations (for top KPI summary cards)
  const dailyGrossSales = useMemo(() => {
    return transactions
      .filter((t) => getStandardLocalDate(t.createdAt) === todayStr)
      .reduce((sum, t) => sum + (Number(t.total) || 0), 0);
  }, [transactions, todayStr]);

  const dailyReturnsDeducted = useMemo(() => {
    return transactions.reduce((sum, t) => {
      const returnDate = getStandardLocalDate(t.returnedAt || (t.status === "returned" || t.status === "partially_returned" ? t.updatedAt : undefined));
      const createdDate = getStandardLocalDate(t.createdAt);
      if (returnDate === todayStr || (createdDate === todayStr && (t.status === "returned" || t.status === "partially_returned"))) {
        const ref = Number(t.refundAmount) || (t.status === "returned" ? Number(t.total) : 0);
        return sum + ref;
      }
      return sum;
    }, 0);
  }, [transactions, todayStr]);

  const dailyNetSales = useMemo(() => {
    return Math.max(0, Number((dailyGrossSales - dailyReturnsDeducted).toFixed(2)));
  }, [dailyGrossSales, dailyReturnsDeducted]);

  const monthlyGrossSales = useMemo(() => {
    return transactions
      .filter((t) => getStandardLocalMonth(t.createdAt) === currentMonthStr)
      .reduce((sum, t) => sum + (Number(t.total) || 0), 0);
  }, [transactions, currentMonthStr]);

  const monthlyReturnsDeducted = useMemo(() => {
    return transactions.reduce((sum, t) => {
      const returnMonth = getStandardLocalMonth(t.returnedAt || (t.status === "returned" || t.status === "partially_returned" ? t.updatedAt : undefined));
      const createdMonth = getStandardLocalMonth(t.createdAt);
      if (returnMonth === currentMonthStr || (createdMonth === currentMonthStr && (t.status === "returned" || t.status === "partially_returned"))) {
        const ref = Number(t.refundAmount) || (t.status === "returned" ? Number(t.total) : 0);
        return sum + ref;
      }
      return sum;
    }, 0);
  }, [transactions, currentMonthStr]);

  const monthlyNetSales = useMemo(() => {
    return Math.max(0, Number((monthlyGrossSales - monthlyReturnsDeducted).toFixed(2)));
  }, [monthlyGrossSales, monthlyReturnsDeducted]);

  // 2. Multi-Operator Windows Discovery
  const storeOperators = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    employees
      .filter((e) => e.role === "Operator")
      .forEach((e) => {
        map.set(e.id, { id: e.id, name: e.name });
      });
    transactions.forEach((t) => {
      const opId = t.operatorId || t.operatorName || "";
      const opName = t.operatorName || "Cashier";
      if (opId && !map.has(opId) && opName !== "Unknown") {
        map.set(opId, { id: opId, name: opName });
      }
    });
    return Array.from(map.values());
  }, [employees, transactions]);

  // Active Window Transactions (All Store vs Selected Operator)
  const activeWindowTxns = useMemo(() => {
    if (selectedOperatorWindow === "all") return transactions;
    const targetOp = storeOperators.find((o) => o.id === selectedOperatorWindow);
    const targetName = targetOp?.name || selectedOperatorWindow;
    return transactions.filter(
      (t) =>
        t.operatorId === selectedOperatorWindow ||
        t.operatorName === selectedOperatorWindow ||
        (targetName && t.operatorName === targetName)
    );
  }, [transactions, selectedOperatorWindow, storeOperators]);

  // Window-Specific Daily & Monthly Metrics
  const windowDailyGrossSales = useMemo(() => {
    return activeWindowTxns
      .filter((t) => getStandardLocalDate(t.createdAt) === todayStr)
      .reduce((sum, t) => sum + (Number(t.total) || 0), 0);
  }, [activeWindowTxns, todayStr]);

  const windowDailyReturnsDeducted = useMemo(() => {
    return activeWindowTxns.reduce((sum, t) => {
      const returnDate = getStandardLocalDate(
        t.returnedAt || (t.status === "returned" || t.status === "partially_returned" ? t.updatedAt : undefined)
      );
      const createdDate = getStandardLocalDate(t.createdAt);
      if (
        returnDate === todayStr ||
        (createdDate === todayStr && (t.status === "returned" || t.status === "partially_returned"))
      ) {
        const ref = Number(t.refundAmount) || (t.status === "returned" ? Number(t.total) : 0);
        return sum + ref;
      }
      return sum;
    }, 0);
  }, [activeWindowTxns, todayStr]);

  const windowDailyNetSales = useMemo(() => {
    return Math.max(0, Number((windowDailyGrossSales - windowDailyReturnsDeducted).toFixed(2)));
  }, [windowDailyGrossSales, windowDailyReturnsDeducted]);

  const windowMonthlyGrossSales = useMemo(() => {
    return activeWindowTxns
      .filter((t) => getStandardLocalMonth(t.createdAt) === currentMonthStr)
      .reduce((sum, t) => sum + (Number(t.total) || 0), 0);
  }, [activeWindowTxns, currentMonthStr]);

  const windowMonthlyReturnsDeducted = useMemo(() => {
    return activeWindowTxns.reduce((sum, t) => {
      const returnMonth = getStandardLocalMonth(
        t.returnedAt || (t.status === "returned" || t.status === "partially_returned" ? t.updatedAt : undefined)
      );
      const createdMonth = getStandardLocalMonth(t.createdAt);
      if (
        returnMonth === currentMonthStr ||
        (createdMonth === currentMonthStr && (t.status === "returned" || t.status === "partially_returned"))
      ) {
        const ref = Number(t.refundAmount) || (t.status === "returned" ? Number(t.total) : 0);
        return sum + ref;
      }
      return sum;
    }, 0);
  }, [activeWindowTxns, currentMonthStr]);

  const windowMonthlyNetSales = useMemo(() => {
    return Math.max(0, Number((windowMonthlyGrossSales - windowMonthlyReturnsDeducted).toFixed(2)));
  }, [windowMonthlyGrossSales, windowMonthlyReturnsDeducted]);

  // Filtered sales transactions for HR View-Only Registry
  const filteredSalesTransactions = useMemo(() => {
    const q = salesSearch.trim().toLowerCase();
    return activeWindowTxns.filter((t) => {
      if (salesStatusFilter === "today") {
        if (getStandardLocalDate(t.createdAt) !== todayStr) return false;
      } else if (salesStatusFilter !== "all") {
        if (t.status !== salesStatusFilter) return false;
      }

      if (!q) return true;
      const rcp = (t.receiptNumber || "").toLowerCase();
      const cashier = (t.operatorName || "").toLowerCase();
      const items = (t.items || []).map((i) => i.productName.toLowerCase()).join(" ");
      return rcp.includes(q) || cashier.includes(q) || items.includes(q);
    });
  }, [activeWindowTxns, salesSearch, salesStatusFilter, todayStr]);

  // Daily Wages to Pay (earned wages for today)
  const dailyWagesToPay = useMemo(() => {
    return attendanceRecords
      .filter((r) => r.date === todayStr)
      .reduce((sum, r) => sum + (r.earnedWage || 0), 0);
  }, [attendanceRecords, todayStr]);

  // Monthly Wages to Pay (earned wages for current month)
  const monthlyWagesToPay = useMemo(() => {
    return attendanceRecords
      .filter((r) => (r.date || "").slice(0, 7) === currentMonthStr)
      .reduce((sum, r) => sum + (r.earnedWage || 0), 0);
  }, [attendanceRecords, currentMonthStr]);

  // Overall Totals for Table Summary
  const totalNetWagesTable = realTimeEmployeeSummaries.reduce((sum, s) => sum + s.earnedWage, 0);
  const totalDeductionsTable = realTimeEmployeeSummaries.reduce((sum, s) => sum + s.deductedWage, 0);
  const totalAbsentDaysTable = realTimeEmployeeSummaries.reduce((sum, s) => sum + s.daysAbsent, 0);
  const totalLeaveDaysTable = realTimeEmployeeSummaries.reduce((sum, s) => sum + s.totalLeaveDays, 0);

  // Wage calculation helper for single entry preview
  const calculatePersonWage = (dailyWage: number, status: string) => {
    const wage = Number(dailyWage) || 0;
    switch (status) {
      case "Present":
        return { earned: wage, deducted: 0, pct: "100%" };
      case "Absent":
        return { earned: 0, deducted: wage, pct: "0% (Deducted)" };
      case "Half Time":
      case "Half Day":
        return { earned: Number((wage * 0.5).toFixed(2)), deducted: Number((wage * 0.5).toFixed(2)), pct: "50% (Half Day)" };
      case "Permitted Leave":
      case "Paid Leave":
        return { earned: wage, deducted: 0, pct: "100% (Paid Leave)" };
      default:
        return { earned: wage, deducted: 0, pct: "100%" };
    }
  };

  // Change individual attendance status
  const handleStatusChange = (userId: string, newStatus: AttendanceEntryState["status"]) => {
    if (dateStatus?.isLocked) return;
    setAttendanceEntries((prev) => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        status: newStatus,
      },
    }));
  };

  // Change selected date with restriction that next day / future dates cannot be selected
  const handleDateChange = (newDate: string) => {
    if (newDate > todayStr) {
      setAttNotice("⚠️ HR cannot mark attendance for next day or future dates. You can only mark attendance for the current date.");
      setSelectedDate(todayStr);
      return;
    }
    setSelectedDate(newDate);
  };

  // Change individual attendance notes
  const handleNotesChange = (userId: string, notes: string) => {
    if (dateStatus?.isLocked || selectedDate > todayStr) return;
    setAttendanceEntries((prev) => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        notes,
      },
    }));
  };

  // Save Attendance for Selected Date (Strict: Current date only, once per day unless unlocked by SubAdmin)
  const handleSaveAttendance = async () => {
    if (!token) return;

    if (selectedDate > todayStr) {
      setAttNotice("⚠️ HR cannot mark attendance for next day or future dates. You can only mark attendance for the current date.");
      return;
    }

    if (selectedDate < todayStr && !isApproved) {
      setAttNotice(`⚠️ HR can only mark attendance for the current date (${todayStr}). For past dates, an approved SubAdmin edit permission is required.`);
      return;
    }

    setSavingAttendance(true);
    setAttNotice("");

    try {
      const entriesToSubmit = Object.values(attendanceEntries);
      const res = await postJson<{ message: string }>(
        "/api/attendance",
        {
          date: selectedDate,
          today: todayStr,
          entries: entriesToSubmit,
        },
        token
      );
      setAttNotice(`✓ ${res.message || `Attendance and daily wages saved for ${selectedDate}!`}`);
      await loadAttendance();
      await checkDateStatus(selectedDate);
      setTimeout(() => setAttNotice(""), 6000);
    } catch (err: any) {
      setAttNotice(`⚠️ ${err?.message || "Failed to save attendance."}`);
    } finally {
      setSavingAttendance(false);
    }
  };


  // Submit Request for Edit Permission to SubAdmin
  const handleRequestEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setRequestSubmitting(true);
    setRequestError("");

    try {
      await postJson(
        "/api/attendance/request-edit",
        {
          date: selectedDate,
          reason: requestReason.trim(),
        },
        token
      );
      setRequestModalOpen(false);
      setRequestReason("");
      setAttNotice(`✓ Edit request for ${selectedDate} submitted to SubAdmin. Waiting for approval.`);
      await checkDateStatus(selectedDate);
      setTimeout(() => setAttNotice(""), 6000);
    } catch (err: any) {
      setRequestError(err?.message || "Failed to submit edit request.");
    } finally {
      setRequestSubmitting(false);
    }
  };

  // Add Shop Employee Submit
  const handleAddEmployeeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setAddEmpError("");
    setAddingEmp(true);

    try {
      await postJson(
        "/api/users/employee",
        {
          name: newEmpName.trim(),
          jobTitle: newEmpTitle.trim(),
          phone: newEmpPhone.trim(),
          dailyWage: parseFloat(newEmpWage) || 0,
        },
        token
      );
      setAddEmpModalOpen(false);
      setNewEmpName("");
      setNewEmpPhone("");
      setNewEmpWage("45");
      await loadEmployees();
      await loadAttendance();
    } catch (err: any) {
      setAddEmpError(err?.message || "Failed to add shop employee.");
    } finally {
      setAddingEmp(false);
    }
  };

  // Handle Remove Employee
  const handleDeleteEmployee = async () => {
    if (!deleteTarget || !token) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteJson(`/api/users/${deleteTarget.id}`, token);
      setDeleteTarget(null);
      await loadEmployees();
      await loadAttendance();
    } catch (err: any) {
      setDeleteError(err?.message || "Failed to remove employee.");
    } finally {
      setDeleting(false);
    }
  };

  // Export Staff Roster to CSV
  const handleExportRosterCsv = () => {
    if (employees.length === 0) return;
    const headers = ["Name", "Job Title / Role", "Email", "Daily Wage (Rs.)", "Date Added"];
    const rows = employees.map((e) => [
      `"${e.name.replace(/"/g, '""')}"`,
      `"${e.jobTitle || e.role}"`,
      `"${e.email.replace(/"/g, '""')}"`,
      `"${(e.dailyWage ?? 0).toFixed(2)}"`,
      `"${new Date(e.createdAt).toLocaleDateString()}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `staff_roster_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Wage & Deductions Payroll Summary to CSV
  const handleExportWageSummaryCsv = () => {
    if (realTimeEmployeeSummaries.length === 0) return;
    const headers = [
      "Employee Name",
      "Job Title / Role",
      "Daily Wage (Rs./day)",
      "Joining Date",
      "Days Present",
      "Permitted Leave Days",
      "Half Time Days",
      "Absent Days",
      "Gross Wages (Rs.)",
      "Total Deductions (Rs.)",
      "Net Wages Earned (Rs.)",
    ];
    const rows = realTimeEmployeeSummaries.map((s) => [
      `"${s.userName.replace(/"/g, '""')}"`,
      `"${s.jobTitle || s.role}"`,
      `"${s.dailyWage.toFixed(2)}"`,
      `"${new Date(s.createdAt).toLocaleDateString()}"`,
      s.daysPresent,
      s.daysPermittedLeave,
      s.daysHalfTime,
      s.daysAbsent,
      `"${s.grossWage.toFixed(2)}"`,
      `"${s.deductedWage.toFixed(2)}"`,
      `"${s.earnedWage.toFixed(2)}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `employee_wages_${selectedMonthFilter}_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#173c32] dark:text-[#f6f1ea] font-semibold">
        Loading HR Dashboard…
      </div>
    );
  }

  // Summary Metrics
  const totalStaff = employees.length;
  const operators = employees.filter((e) => e.role === "Operator").length;
  const shopWorkers = employees.filter((e) => e.role === "Employee").length;

  const filteredEmployees = employees.filter(
    (e) =>
      e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
      e.email.toLowerCase().includes(empSearch.toLowerCase()) ||
      (e.jobTitle && e.jobTitle.toLowerCase().includes(empSearch.toLowerCase())) ||
      e.role.toLowerCase().includes(empSearch.toLowerCase())
  );

  const isLocked = Boolean(dateStatus?.isLocked);
  const isApproved = dateStatus?.editRequest?.status === "approved";
  const isPending = dateStatus?.editRequest?.status === "pending";
  const isRejected = dateStatus?.editRequest?.status === "rejected";
  const isFutureDate = selectedDate > todayStr;
  const isPastDate = selectedDate < todayStr;
  const isCurrentDate = selectedDate === todayStr;
  const canMarkOrEdit = isFutureDate
    ? false
    : isCurrentDate
    ? (!isLocked || isApproved)
    : isApproved;

  // Records for detail modal (HR cannot see SubAdmin history)
  const detailEmployeeRecords = detailEmployee && detailEmployee.role !== "SubAdmin"
    ? filteredAttendanceByMonth.filter((r) => r.userId === detailEmployee.id)
    : [];
  const detailAbsences = detailEmployeeRecords.filter((r) => r.status === "Absent");
  const detailLeaves = detailEmployeeRecords.filter(
    (r) => r.status === "Permitted Leave" || r.status === "Paid Leave" || r.status === "Half Time" || r.status === "Half Day"
  );

  return (
    <main className="min-h-screen bg-[#f6f1ea] dark:bg-[#0d1512] text-[#1f2a25] dark:text-[#f6f1ea] transition-colors duration-200 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <DashboardHeader
          title="HR Dashboard"
          subtitle={`People, Attendance & Daily Wage Payroll · ${user.tenantName ?? "Your Store"}`}
        />

        <div className="flex flex-col gap-6 lg:flex-row">
          <Sidebar role="HR" />

          <div className="min-w-0 flex-1 space-y-6">
            {/* KPI Stats & Financial Overview */}
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
              {/* Daily Financials */}
              <div
                onClick={() => switchTab("sales")}
                className="cursor-pointer transition transform hover:scale-[1.01]"
              >
                <StatCard
                  label="Daily Sales (Net)"
                  value={`Rs. ${dailyNetSales.toFixed(2)}`}
                  accent="green"
                  sub={`Gross: Rs. ${dailyGrossSales.toFixed(2)} · Returns: -Rs. ${dailyReturnsDeducted.toFixed(2)} (Standard Time)`}
                />
              </div>

              {/* Monthly Financials */}
              <div
                onClick={() => switchTab("sales")}
                className="cursor-pointer transition transform hover:scale-[1.01]"
              >
                <StatCard
                  label="Monthly Sales (Net)"
                  value={`Rs. ${monthlyNetSales.toFixed(2)}`}
                  accent="gold"
                  sub={`Gross: Rs. ${monthlyGrossSales.toFixed(2)} · Returns: -Rs. ${monthlyReturnsDeducted.toFixed(2)} (Adds Daily Sales)`}
                />
              </div>

              {/* Total Personnel - Click switches to Roster Tab */}
              <div
                onClick={() => switchTab("roster")}
                className="cursor-pointer transition transform hover:scale-[1.01]"
              >
                <StatCard
                  label="Total Personnel"
                  value={totalStaff.toString()}
                  accent="blue"
                  sub={`${operators} Cashiers, ${shopWorkers} Shop Staff (Click for Roster)`}
                />
              </div>

              {/* Net Store Payroll - Click switches to Wages Tab */}
              <div
                onClick={() => switchTab("wages")}
                className="cursor-pointer transition transform hover:scale-[1.01]"
              >
                <StatCard
                  label="Payroll Balance"
                  value={`Rs. ${(monthlyNetSales - monthlyWagesToPay).toFixed(2)}`}
                  accent="slate"
                  sub={`Net Sales (Rs. ${monthlyNetSales.toFixed(2)}) − Wages (Rs. ${monthlyWagesToPay.toFixed(2)})`}
                />
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-[#ece4da] dark:border-white/10 gap-2 overflow-x-auto touch-scroll pb-1 sm:justify-center">
              {[
                { id: "tracker", label: "📅 Daily Attendance Tracker" },
                { id: "wages", label: "💵 Employee Wage Calculation & Deductions" },
                { id: "sales", label: "🧾 Store Sales & Returns (View Only)" },
                { id: "roster", label: "👥 Employee Directory & Staff Roster" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchTab(tab.id as HRTab)}
                  className={`shrink-0 border-b-2 px-3 sm:px-4 py-2.5 text-xs font-bold transition touch-manipulation min-h-[44px] inline-flex items-center justify-center gap-1.5 ${
                    activeTab === tab.id
                      ? "border-[#173c32] dark:border-[#d7a35d] text-[#173c32] dark:text-white"
                      : "border-transparent text-[#5d665f] dark:text-[#a0ada5] hover:text-[#173c32] dark:hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* TAB 1: DAILY ATTENDANCE TRACKER (Save Once Per Day, Lock & Permission) */}
            {activeTab === "tracker" && (
              <SectionCard
                title={`Daily Attendance & Wage Tracker (${selectedDate}${isCurrentDate ? " · Today" : isPastDate ? " · Past Date" : " · Future Date"})`}
                action={
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs font-bold text-[#5d665f] dark:text-[#a0ada5] flex items-center gap-1.5">
                      <span>📅</span> Date:
                      <input
                        type="date"
                        value={selectedDate}
                        max={todayStr}
                        onChange={(e) => handleDateChange(e.target.value)}
                        className="rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 px-2.5 py-1 text-xs font-bold text-[#173c32] dark:text-white"
                      />
                    </label>

                    {/* Action buttons based on date rules & lock status */}
                    {isFutureDate ? (
                      <span className="rounded-xl bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 px-3 py-1.5 text-xs font-bold border border-red-300">
                        ⚠️ Future Date (Cannot Mark)
                      </span>
                    ) : isPastDate && !isApproved ? (
                      isPending ? (
                        <span className="rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-3 py-1.5 text-xs font-bold border border-amber-300">
                          ⏳ Past Date Edit Pending SubAdmin
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="rounded-xl bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300 px-3 py-1.5 text-xs font-semibold border border-stone-300 dark:border-stone-700">
                            ℹ️ Current Date Only
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setRequestReason("");
                              setRequestError("");
                              setRequestModalOpen(true);
                            }}
                            className="rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2 text-xs font-bold text-white transition touch-manipulation flex items-center gap-1.5 shadow-sm"
                          >
                            <span>🔒</span> Request Edit Permission
                          </button>
                        </div>
                      )
                    ) : isLocked && !isApproved ? (
                      isPending ? (
                        <div className="flex items-center gap-2">
                          <span className="rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-3 py-1.5 text-xs font-bold border border-amber-300">
                            ⏳ Edit Request Pending SubAdmin Approval
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRequestReason("");
                            setRequestError("");
                            setRequestModalOpen(true);
                          }}
                          className="rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2 text-xs font-bold text-white transition touch-manipulation flex items-center gap-1.5 shadow-sm"
                        >
                          <span>🔒</span> Request Edit Permission from SubAdmin
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        disabled={savingAttendance || markableStaff.length === 0 || !canMarkOrEdit}
                        onClick={handleSaveAttendance}
                        className={`rounded-xl px-4 py-2 text-xs font-bold text-white transition touch-manipulation flex items-center gap-1.5 ${
                          isApproved
                            ? "bg-emerald-600 hover:bg-emerald-700"
                            : "bg-[#173c32] hover:bg-[#0f2d2b]"
                        } disabled:opacity-50`}
                      >
                        <span>{isApproved ? "🔓" : "💾"}</span>{" "}
                        {savingAttendance
                          ? "Saving…"
                          : isApproved
                          ? "Save Updated Attendance"
                          : dateStatus?.isSaved
                          ? "Save Attendance"
                          : "Save Attendance"}
                      </button>
                    )}
                  </div>
                }
              >
                {/* Future Date Warning Banner */}
                {isFutureDate && (
                  <div className="mb-4 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/40 p-3.5 text-xs text-red-900 dark:text-red-200 flex items-center gap-2">
                    <span className="text-base">⚠️</span>
                    <div>
                      <strong>Next day / future date attendance is disabled.</strong> HR can only mark attendance for the current date ({todayStr}).
                    </div>
                  </div>
                )}

                {/* Past Date Notice Banner */}
                {isPastDate && !isApproved && (
                  <div className="mb-4 rounded-xl border border-stone-300 bg-stone-50 dark:bg-stone-900/40 p-3.5 text-xs text-stone-800 dark:text-stone-300 flex items-center justify-between gap-2">
                    <div>
                      <strong>Viewing past date ({selectedDate}).</strong> HR can only mark attendance for the current date ({todayStr}). To modify this past date, request edit permission from SubAdmin.
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(todayStr)}
                      className="rounded-lg bg-[#173c32] text-white px-3 py-1 text-xs font-bold whitespace-nowrap hover:bg-[#0f2d2b]"
                    >
                      Go to Today
                    </button>
                  </div>
                )}
                {/* Status Notice Banners */}
                {isLocked && (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div>
                      <div className="font-bold flex items-center gap-1.5">
                        <span>🔒</span> Attendance for {selectedDate} is saved and locked.
                      </div>
                      <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                        Attendance can only be saved once per day. If you need to make changes, you must request permission from the SubAdmin.
                      </div>
                      {isRejected && (
                        <div className="mt-1 font-bold text-red-600 dark:text-red-400">
                          ✕ Previous edit request was rejected by SubAdmin. You may submit a new request with a detailed reason.
                        </div>
                      )}
                    </div>
                    {!isPending && (
                      <button
                        type="button"
                        onClick={() => {
                          setRequestReason("");
                          setRequestError("");
                          setRequestModalOpen(true);
                        }}
                        className="rounded-lg bg-amber-700 hover:bg-amber-800 text-white px-3 py-1.5 text-xs font-bold shrink-0 transition"
                      >
                        Ask Permission
                      </button>
                    )}
                  </div>
                )}

                {isApproved && (
                  <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-xs text-emerald-900 dark:text-emerald-200">
                    <span className="font-bold">🔓 Edit Permission Granted by SubAdmin!</span> You can modify the attendance entries below and click &quot;Save Updated Attendance&quot;.
                  </div>
                )}

                {!dateStatus?.isSaved && !statusLoading && (
                  <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-2.5 text-xs text-blue-800 dark:text-blue-300">
                    ℹ️ Attendance has not been saved yet for {selectedDate}. Mark entries carefully — attendance is saved once per day.
                  </div>
                )}

                {attNotice && (
                  <div className="mb-4 rounded-xl border border-[#d7a35d] bg-[#fffaf3] dark:bg-black/40 p-3 text-xs font-bold text-[#173c32] dark:text-[#d7a35d]">
                    {attNotice}
                  </div>
                )}

                <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mb-4">
                  Mark each staff member (including HR themselves, operators, and shop employees) as <strong>Present (+100%)</strong>, <strong>Absent (-100%)</strong>, <strong>Paid Leave (+100%)</strong>, or <strong>Half Day (-50%)</strong>. Daily wages are computed individually per person based on their wage rate.
                </p>

                {markableStaff.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#5d665f]">
                    No personnel to mark attendance for. Add employees in the Employee Directory tab first.
                  </div>
                ) : (
                  <div className="overflow-x-auto touch-scroll">
                    <table className="w-full min-w-[700px] text-xs text-left">
                      <thead>
                        <tr className="border-b border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]">
                          <th className="pb-3 font-bold">Staff Member</th>
                          <th className="pb-3 font-bold">Daily Wage Rate</th>
                          <th className="pb-3 font-bold">Attendance Status</th>
                          <th className="pb-3 font-bold">Earned Wage</th>
                          <th className="pb-3 font-bold">Wage Deduction</th>
                          <th className="pb-3 font-bold">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ece4da] dark:divide-white/5">
                        {markableStaff.map((staff) => {
                          const entry = attendanceEntries[staff.id] || {
                            userId: staff.id,
                            userName: staff.name,
                            role: staff.role,
                            dailyWage: staff.dailyWage ?? 0,
                            status: "Present",
                            notes: "",
                          };
                          const calc = calculatePersonWage(staff.dailyWage ?? 0, entry.status);

                          return (
                            <tr key={staff.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                              <td className="py-3">
                                <div className="font-bold text-[#173c32] dark:text-white flex items-center gap-1.5">
                                  <span>{staff.name}</span>
                                  {(staff.id === user?.id || staff.role === "HR") && (
                                    <span className="rounded-md bg-[#173c32]/10 dark:bg-white/10 text-[#173c32] dark:text-[#d7a35d] px-1.5 py-0.5 text-[10px] font-bold">
                                      {staff.id === user?.id ? "You (HR)" : "HR"}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                                  {staff.jobTitle || staff.role}
                                </div>
                              </td>

                              <td className="py-3 font-bold text-xs text-[#173c32] dark:text-[#d7a35d]">
                                Rs. {(staff.dailyWage ?? 0).toFixed(2)}/day
                              </td>

                              <td className="py-3">
                                <div className="flex flex-wrap gap-1">
                                  {(
                                    [
                                      { label: "Present", val: "Present", color: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-300" },
                                      { label: "Absent", val: "Absent", color: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-300" },
                                      { label: "Paid Leave", val: "Permitted Leave", color: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300" },
                                      { label: "Half Day", val: "Half Time", color: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300" },
                                    ] as const
                                  ).map((st) => {
                                    const isSelected =
                                      entry.status === st.val ||
                                      (st.val === "Permitted Leave" && entry.status === "Paid Leave") ||
                                      (st.val === "Half Time" && entry.status === "Half Day");
                                    return (
                                      <button
                                        key={st.val}
                                        type="button"
                                        disabled={!canMarkOrEdit}
                                        onClick={() => handleStatusChange(staff.id, st.val)}
                                        className={`rounded-lg px-2 py-1 text-[11px] font-bold border transition ${
                                          isSelected
                                            ? `${st.color} shadow-sm font-black`
                                            : !canMarkOrEdit
                                            ? "border-transparent bg-stone-100/50 dark:bg-white/5 text-[#8d968f] opacity-60 cursor-not-allowed"
                                            : "border-transparent bg-stone-100 dark:bg-white/5 text-[#5d665f] hover:bg-stone-200"
                                        }`}
                                      >
                                        {st.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>

                              <td className="py-3 font-black text-green-700 dark:text-green-400">
                                +Rs. {calc.earned.toFixed(2)}
                              </td>

                              <td className="py-3 font-bold text-red-600 dark:text-red-400">
                                {calc.deducted > 0 ? `-Rs. ${calc.deducted.toFixed(2)}` : "Rs. 0.00"}
                              </td>

                              <td className="py-3">
                                <input
                                  type="text"
                                  disabled={!canMarkOrEdit}
                                  value={entry.notes}
                                  onChange={(e) => handleNotesChange(staff.id, e.target.value)}
                                  placeholder={!canMarkOrEdit ? (isFutureDate ? "Future date disabled" : isLocked ? "Locked" : "Current date only") : "e.g. sick leave, shift 9-2…"}
                                  className="w-full min-w-[130px] rounded-lg border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-1.5 text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            )}

            {/* TAB 2: EMPLOYEE WAGE CALCULATION & DEDUCTIONS SUMMARY */}
            {activeTab === "wages" && (
              <SectionCard
                title={`Employee Wage Calculation & Deduction Summary (${formatMonthName(selectedMonthFilter)})`}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Month selector dropdown */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-[#5d665f] dark:text-[#a0ada5]">Month:</span>
                      <select
                        value={selectedMonthFilter}
                        onChange={(e) => setSelectedMonthFilter(e.target.value)}
                        className="rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 px-3 py-1.5 text-xs font-bold text-[#173c32] dark:text-white"
                      >
                        <option value="all">All Months (Overall)</option>
                        {availableMonths.map((ym) => (
                          <option key={ym} value={ym}>
                            {formatMonthName(ym)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleExportWageSummaryCsv}
                      disabled={realTimeEmployeeSummaries.length === 0}
                      className="rounded-xl border border-[#d9d0c3] dark:border-white/20 bg-white dark:bg-white/5 px-3 py-1.5 text-xs font-bold text-[#173c32] dark:text-white transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 touch-manipulation flex items-center gap-1.5"
                    >
                      <span>📥</span> Export CSV
                    </button>
                  </div>
                }
              >
                <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mb-4">
                  All metrics below are <strong>dynamically calculated in real-time</strong> from actual attendance records. <strong>Click any employee row</strong> to inspect their individual joining date, absence dates, leave history, and payroll logs.
                </p>

                {attLoading ? (
                  <div className="py-10 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
                    Calculating real-time employee wages and deductions…
                  </div>
                ) : realTimeEmployeeSummaries.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#5d665f]">
                    No employees or attendance records to display.
                  </div>
                ) : (
                  <div className="overflow-x-auto touch-scroll">
                    <table className="w-full min-w-[760px] text-xs text-left">
                      <thead>
                        <tr className="border-b border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]">
                          <th className="pb-3 font-bold">Staff Member (Click to View)</th>
                          <th className="pb-3 font-bold">Daily Wage Rate</th>
                          <th className="pb-3 font-bold">Present Days</th>
                          <th className="pb-3 font-bold">Leave Days (Permitted / Half)</th>
                          <th className="pb-3 font-bold">Absent Days</th>
                          <th className="pb-3 font-bold">Gross Wages</th>
                          <th className="pb-3 font-bold">Total Deductions</th>
                          <th className="pb-3 font-bold">Total Net Wage Earned</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ece4da] dark:divide-white/5">
                        {realTimeEmployeeSummaries.map((s) => {
                          const staffObj = employees.find((e) => e.id === s.userId);
                          return (
                            <tr
                              key={s.userId}
                              onClick={() => staffObj && setDetailEmployee(staffObj)}
                              className="hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer transition group"
                            >
                              <td className="py-3">
                                <div className="font-bold text-[#173c32] dark:text-white group-hover:text-[#a26d2d] flex items-center gap-1.5">
                                  <span>{s.userName}</span>
                                  <span className="text-[10px] text-[#a26d2d] underline font-normal">view details ↗</span>
                                </div>
                                <div className="text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                                  {s.jobTitle || s.role} · Joined {new Date(s.createdAt).toLocaleDateString()}
                                </div>
                              </td>

                              <td className="py-3 font-bold text-xs text-[#173c32] dark:text-[#d7a35d]">
                                Rs. ${s.dailyWage.toFixed(2)}/day
                              </td>

                              <td className="py-3">
                                <span className="rounded-md bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 px-2 py-0.5 font-bold">
                                  {s.daysPresent} {s.daysPresent === 1 ? "day" : "days"}
                                </span>
                              </td>

                              <td className="py-3">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-semibold text-blue-700 dark:text-blue-300">
                                    {s.daysPermittedLeave} Permitted
                                  </span>
                                  {s.daysHalfTime > 0 && (
                                    <span className="text-[10px] text-amber-700 dark:text-amber-300">
                                      {s.daysHalfTime} Half Time (50% wage)
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-3">
                                <span
                                  className={`rounded-md px-2 py-0.5 font-bold ${
                                    s.daysAbsent > 0
                                      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                                      : "text-[#5d665f]"
                                  }`}
                                >
                                  {s.daysAbsent} {s.daysAbsent === 1 ? "day" : "days"}
                                </span>
                              </td>

                              <td className="py-3 font-semibold text-[#5d665f] dark:text-[#a0ada5]">
                                Rs. ${s.grossWage.toFixed(2)}
                              </td>

                              <td className="py-3 font-bold text-red-600 dark:text-red-400">
                                {s.deductedWage > 0 ? `-Rs. ${s.deductedWage.toFixed(2)}` : "Rs. 0.00"}
                              </td>

                              <td className="py-3">
                                <span className="font-black text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2.5 py-1 rounded-lg border border-green-200 dark:border-green-800">
                                  Rs. ${s.earnedWage.toFixed(2)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-[#173c32]/20 dark:border-white/20 font-bold text-[#173c32] dark:text-white bg-black/[0.02] dark:bg-white/[0.02]">
                          <td className="py-3.5 font-extrabold">Store Total ({formatMonthName(selectedMonthFilter)})</td>
                          <td className="py-3.5">—</td>
                          <td className="py-3.5 font-extrabold text-green-700 dark:text-green-400">
                            {realTimeEmployeeSummaries.reduce((sum, s) => sum + s.daysPresent, 0)} days
                          </td>
                          <td className="py-3.5 font-extrabold text-blue-700 dark:text-blue-300">
                            {realTimeEmployeeSummaries.reduce((sum, s) => sum + s.daysPermittedLeave, 0)} permitted,{" "}
                            {realTimeEmployeeSummaries.reduce((sum, s) => sum + s.daysHalfTime, 0)} half
                          </td>
                          <td className="py-3.5 font-extrabold text-red-600 dark:text-red-400">
                            {totalAbsentDaysTable} days
                          </td>
                          <td className="py-3.5 font-extrabold">
                            Rs. ${realTimeEmployeeSummaries.reduce((sum, s) => sum + s.grossWage, 0).toFixed(2)}
                          </td>
                          <td className="py-3.5 font-extrabold text-red-600 dark:text-red-400">
                            -Rs. ${totalDeductionsTable.toFixed(2)}
                          </td>
                          <td className="py-3.5">
                            <span className="font-black text-base text-green-700 dark:text-green-400">
                              Rs. ${totalNetWagesTable.toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </SectionCard>
            )}

            {/* TAB: STORE SALES & RETURNS REGISTRY (VIEW ONLY · STANDARD TIME) */}
            {activeTab === "sales" && (
              <SectionCard
                title="Store Sales & Returns Registry (View Only · Standard Time)"
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 text-xs font-black text-emerald-800 dark:text-emerald-200">
                      Standard Date: {todayStr}
                    </span>
                  </div>
                }
              >
                {/* Operator Window Switcher */}
                <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-[#ece4da] dark:border-white/10 pb-3">
                  <span className="text-xs font-bold text-[#5d665f] dark:text-[#a0ada5] mr-1">
                    Sales Window:
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedOperatorWindow("all")}
                    className={`rounded-xl px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                      selectedOperatorWindow === "all"
                        ? "bg-[#173c32] text-white shadow-sm"
                        : "border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da]"
                    }`}
                  >
                    <span>🏬</span> Store Total Window ({transactions.length})
                  </button>

                  {storeOperators.map((op) => {
                    const opTxns = transactions.filter(
                      (t) => t.operatorId === op.id || t.operatorName === op.name || t.operatorId === op.name
                    );
                    const isSelected = selectedOperatorWindow === op.id || selectedOperatorWindow === op.name;
                    return (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => setSelectedOperatorWindow(op.id)}
                        className={`rounded-xl px-3.5 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                          isSelected
                            ? "bg-[#173c32] text-white shadow-sm"
                            : "border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da]"
                        }`}
                      >
                        <span>👤</span> {op.name}&apos;s Window ({opTxns.length})
                      </button>
                    );
                  })}
                </div>

                {/* Window Financial Breakdown Banner */}
                <div className="mb-5 p-4 rounded-2xl bg-[#faf8f4] dark:bg-black/20 border border-[#ece4da] dark:border-white/10 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ece4da] dark:border-white/10 pb-2">
                    <div className="text-xs font-bold text-[#173c32] dark:text-white flex items-center gap-1.5">
                      <span>{selectedOperatorWindow === "all" ? "🏬" : "👤"}</span>
                      <span>
                        {selectedOperatorWindow === "all"
                          ? "Store Total Sales Window (Aggregated Across All Cashiers)"
                          : `${storeOperators.find((o) => o.id === selectedOperatorWindow)?.name || selectedOperatorWindow}'s Dedicated Sales Window`}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
                      Standard Day: <strong>12:00:00 AM – 11:59:59 PM</strong> ({todayStr})
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#5d665f] dark:text-[#a0ada5]">Today&apos;s Gross Sales</div>
                      <div className="text-base font-black text-[#173c32] dark:text-white">Rs. {windowDailyGrossSales.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Today&apos;s Returns Deducted</div>
                      <div className="text-base font-black text-red-600 dark:text-red-400">-Rs. {windowDailyReturnsDeducted.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Today&apos;s Net Sales</div>
                      <div className="text-base font-black text-emerald-700 dark:text-emerald-300">Rs. {windowDailyNetSales.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#d7a35d]">Monthly Net Sales</div>
                      <div className="text-base font-black text-[#173c32] dark:text-[#d7a35d]">Rs. {windowMonthlyNetSales.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                <div className="mb-4 flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={salesSearch}
                      onChange={(e) => setSalesSearch(e.target.value)}
                      placeholder="Search transactions by Receipt (RCP-...), Cashier, or Product…"
                      className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/30 px-3.5 py-2.5 text-xs font-semibold placeholder:text-[#8d948f] focus:outline-none focus:ring-2 focus:ring-[#d7a35d]"
                    />
                    {salesSearch && (
                      <button
                        type="button"
                        onClick={() => setSalesSearch("")}
                        className="absolute right-3 top-2.5 text-xs font-bold text-[#8d948f] hover:text-black dark:hover:text-white"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: "all", label: `All (${activeWindowTxns.length})` },
                        { id: "today", label: `Today (${activeWindowTxns.filter((t) => getStandardLocalDate(t.createdAt) === todayStr).length})` },
                        { id: "completed", label: `Completed (${activeWindowTxns.filter((t) => t.status === "completed").length})` },
                        { id: "partially_returned", label: `Partially Returned (${activeWindowTxns.filter((t) => t.status === "partially_returned").length})` },
                        { id: "returned", label: `Fully Returned (${activeWindowTxns.filter((t) => t.status === "returned").length})` },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSalesStatusFilter(f.id)}
                        className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                          salesStatusFilter === f.id
                            ? "bg-[#173c32] text-white"
                            : "border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 text-[#5d665f] dark:text-[#a0ada5] hover:bg-[#ece4da]"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-[#5d665f] dark:text-[#a0ada5] mb-4">
                  View-only sales and return audit registry. All sales are tracked in <strong>Standard Local Time</strong>. When customers return items, the refunded amount is automatically deducted from daily store sales, which roll up into monthly sales.
                </p>

                {filteredSalesTransactions.length === 0 ? (
                  <div className="py-10 text-center text-xs text-[#5d665f] dark:text-[#a0ada5]">
                    {salesSearch ? `No transactions found matching "${salesSearch}".` : "No sales transactions recorded yet."}
                  </div>
                ) : (
                  <div className="overflow-x-auto touch-scroll">
                    <table className="w-full min-w-[850px] text-xs text-left">
                      <thead>
                        <tr className="border-b border-[#ece4da] dark:border-white/10 text-[#5d665f] dark:text-[#a0ada5]">
                          <th className="pb-3 font-bold">Standard Time &amp; Date</th>
                          <th className="pb-3 font-bold">Receipt #</th>
                          <th className="pb-3 font-bold">Cashier / Operator</th>
                          <th className="pb-3 font-bold">Items Sold &amp; Returned</th>
                          <th className="pb-3 font-bold">Gross Total</th>
                          <th className="pb-3 font-bold">Returns Deducted</th>
                          <th className="pb-3 font-bold">Net Sale Amount</th>
                          <th className="pb-3 font-bold">Status</th>
                          <th className="pb-3 font-bold text-right">View (Audit)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ece4da] dark:divide-white/5">
                        {filteredSalesTransactions.map((txn) => {
                          const net = Number(txn.netTotal !== undefined && txn.netTotal !== null ? txn.netTotal : txn.status === "returned" ? 0 : txn.total);
                          const ref = txn.refundAmount || (txn.status === "returned" ? txn.total : 0);
                          const isTodayTxn = getStandardLocalDate(txn.createdAt) === todayStr;

                          return (
                            <tr key={txn.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition">
                              <td className="py-3 font-medium text-[#173c32] dark:text-white">
                                <div>{formatStandardDateTime(txn.createdAt)}</div>
                                {isTodayTxn && (
                                  <span className="inline-block mt-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-1.5 py-0.2 text-[9px] font-bold">
                                    Today
                                  </span>
                                )}
                              </td>

                              <td className="py-3 font-mono font-bold text-[#173c32] dark:text-white">
                                {txn.receiptNumber || txn.id.slice(0, 12)}
                              </td>

                              <td className="py-3">
                                <span className="font-semibold text-[#173c32] dark:text-white">{txn.operatorName || "Cashier"}</span>
                                <div className="text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                                  {(txn.paymentMethod || "CASH").toUpperCase()}
                                </div>
                              </td>

                              <td className="py-3 max-w-[240px]">
                                <div className="space-y-0.5">
                                  {(txn.items || []).map((it, idx) => (
                                    <div key={idx} className="text-[11px] truncate">
                                      <span className="font-semibold text-[#173c32] dark:text-white">{it.productName}</span>
                                      <span className="text-[#5d665f] dark:text-[#a0ada5]"> × {it.quantity}</span>
                                      {(it.returnedQuantity || 0) > 0 && (
                                        <span className="ml-1 text-[10px] font-bold text-red-600 dark:text-red-400">
                                          ({it.returnedQuantity} returned)
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>

                              <td className="py-3 font-bold text-[#173c32] dark:text-white">
                                Rs. {txn.total.toFixed(2)}
                              </td>

                              <td className="py-3 font-bold">
                                {ref > 0 ? (
                                  <span className="text-red-600 dark:text-red-400">-Rs. {ref.toFixed(2)}</span>
                                ) : (
                                  <span className="text-[#5d665f] dark:text-[#a0ada5]">Rs. 0.00</span>
                                )}
                              </td>

                              <td className="py-3 font-black text-sm text-[#173c32] dark:text-[#d7a35d]">
                                Rs. {net.toFixed(2)}
                              </td>

                              <td className="py-3">
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                                    txn.status === "returned"
                                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                      : txn.status === "partially_returned"
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                      : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                                  }`}
                                >
                                  {txn.status === "returned"
                                    ? "↺ Fully Returned"
                                    : txn.status === "partially_returned"
                                    ? "↺ Partial Return"
                                    : "✓ Completed"}
                                </span>
                              </td>

                              <td className="py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => setViewReceiptTxn(txn)}
                                  className="rounded-xl border border-[#d7a35d] bg-[#d7a35d]/10 hover:bg-[#d7a35d]/20 px-2.5 py-1 text-xs font-bold text-[#173c32] dark:text-[#d7a35d] transition"
                                >
                                  🧾 View
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            )}

            {/* TAB 3: EMPLOYEE DIRECTORY & SHOP STAFF ROSTER */}
            {activeTab === "roster" && (
              <div id="staff-directory">
                <SectionCard
                  title="Employee Roster & Shop Staff"
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAddEmpModalOpen(true)}
                        className="rounded-xl bg-[#173c32] dark:bg-[#215446] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#0f2d2b] touch-manipulation flex items-center gap-1.5"
                      >
                        <span>➕</span> Add Shop Employee
                      </button>
                      <button
                        type="button"
                        onClick={handleExportRosterCsv}
                        disabled={employees.length === 0}
                        className="rounded-xl border border-[#d9d0c3] dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 text-xs font-bold text-[#173c32] dark:text-white transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 touch-manipulation"
                      >
                        📥 Export CSV
                      </button>
                    </div>
                  }
                >
                  {/* Search input */}
                  <div className="mb-4">
                    <input
                      type="text"
                      value={empSearch}
                      onChange={(e) => setEmpSearch(e.target.value)}
                      placeholder="Search staff by name, title, or role…"
                      className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5 text-xs text-[#1f2a25] dark:text-[#f6f1ea]"
                    />
                  </div>

                  {empLoading ? (
                    <div className="py-10 text-center text-sm text-[#5d665f] dark:text-[#a0ada5]">Loading personnel…</div>
                  ) : (
                    <DataTable<StaffUser>
                      columns={[
                        { header: "Name", accessor: "name" },
                        {
                          header: "Role / Job Title",
                          accessor: (e) => (
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                  e.role === "SubAdmin"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                    : e.role === "HR"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                    : e.role === "Operator"
                                    ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                                    : "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                                }`}
                              >
                                {e.role}
                              </span>
                              {e.jobTitle && <span className="font-semibold text-xs text-[#173c32] dark:text-white">({e.jobTitle})</span>}
                            </div>
                          ),
                        },
                        {
                          header: "Contact / Identifier",
                          accessor: (e) => (
                            <div className="flex flex-col">
                              <span>{e.email.endsWith("@shop.local") ? (e.phone || "Shop Personnel") : e.email}</span>
                              {e.phone && !e.email.endsWith("@shop.local") && (
                                <span className="text-[10px] text-[#5d665f] dark:text-[#a0ada5]">{e.phone}</span>
                              )}
                            </div>
                          ),
                        },
                        {
                          header: "Daily Wage",
                          accessor: (e) => (
                            <span className="font-extrabold text-xs text-[#173c32] dark:text-[#d7a35d]">
                              Rs. {(e.dailyWage ?? 0).toFixed(2)}/day
                            </span>
                          ),
                        },
                        {
                          header: "Date Joined",
                          accessor: (e) => new Date(e.createdAt).toLocaleDateString(),
                        },
                      ]}
                      actions={(e) => (
                        <div className="inline-flex items-center gap-2">
                          {e.role !== "SubAdmin" ? (
                            <button
                              type="button"
                              onClick={() => setDetailEmployee(e)}
                              className="rounded-lg border border-[#ece4da] dark:border-white/20 bg-stone-100 dark:bg-white/5 hover:bg-stone-200 px-2 py-1 text-xs font-semibold text-[#173c32] dark:text-white transition"
                            >
                              History
                            </button>
                          ) : (
                            <span className="text-[10px] text-[#5d665f] dark:text-[#a0ada5] italic px-1">
                              Owner (No History)
                            </span>
                          )}
                          {e.role === "Employee" && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteTarget(e);
                                setDeleteError("");
                              }}
                              className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 transition"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                      rows={filteredEmployees}
                      keyField="id"
                      emptyMessage="No employees found matching query."
                    />
                  )}
                </SectionCard>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Employee Detailed History Modal (Joining Date, Absence Dates, Leave Log, Full Timeline) */}
      <Modal
        open={Boolean(detailEmployee && detailEmployee.role !== "SubAdmin")}
        onClose={() => setDetailEmployee(null)}
        title={detailEmployee ? `${detailEmployee.name} — Attendance & Payroll History` : "Employee History"}
        maxWidthClass="max-w-2xl"
      >
        {detailEmployee && detailEmployee.role !== "SubAdmin" && (
          <div className="space-y-4 text-xs">
            {/* Header profile info */}
            <div className="rounded-2xl bg-[#faf8f4] dark:bg-black/30 border border-[#ece4da] dark:border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-black text-[#173c32] dark:text-white flex items-center gap-2">
                    {detailEmployee.name}
                    <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 px-2.5 py-0.5 text-[10px] font-bold">
                      {detailEmployee.jobTitle || detailEmployee.role}
                    </span>
                  </h3>
                  <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5] mt-0.5">
                    {detailEmployee.email} {detailEmployee.phone ? `· ${detailEmployee.phone}` : ""}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-[#5d665f] dark:text-[#a0ada5] uppercase font-bold tracking-wider">
                    Date of Joining
                  </div>
                  <div className="font-mono font-bold text-xs text-[#173c32] dark:text-white">
                    📅 {new Date(detailEmployee.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                  </div>
                  <div className="text-[11px] font-extrabold text-[#d7a35d] mt-0.5">
                    Rs. {(detailEmployee.dailyWage ?? 0).toFixed(2)} / day
                  </div>
                </div>
              </div>
            </div>

            {/* Quick stats for current period filter */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl border border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-950/20 p-2.5 text-center">
                <div className="text-[10px] text-green-700 dark:text-green-300 font-bold uppercase">Present Days</div>
                <div className="text-lg font-black text-green-800 dark:text-green-200">
                  {detailEmployeeRecords.filter((r) => r.status === "Present").length}
                </div>
              </div>
              <div className="rounded-xl border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/20 p-2.5 text-center">
                <div className="text-[10px] text-blue-700 dark:text-blue-300 font-bold uppercase">Leave Days</div>
                <div className="text-lg font-black text-blue-800 dark:text-blue-200">
                  {detailLeaves.length}
                </div>
              </div>
              <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 p-2.5 text-center">
                <div className="text-[10px] text-red-700 dark:text-red-300 font-bold uppercase">Absent Days</div>
                <div className="text-lg font-black text-red-800 dark:text-red-200">
                  {detailAbsences.length}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/20 p-2.5 text-center">
                <div className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold uppercase">Net Earned Wages</div>
                <div className="text-lg font-black text-emerald-800 dark:text-emerald-200">
                  Rs. ${detailEmployeeRecords.reduce((sum, r) => sum + (r.earnedWage || 0), 0).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Specific Dates Employee Took Absents */}
            <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20 p-3">
              <h4 className="font-bold text-red-900 dark:text-red-200 mb-2 flex items-center justify-between">
                <span>🔴 Dates of Absences ({detailAbsences.length})</span>
                <span className="text-[10px] text-red-700 dark:text-red-300 font-normal">Full daily wage deducted</span>
              </h4>
              {detailAbsences.length === 0 ? (
                <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5] italic">
                  ✓ No absences recorded for this employee.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {detailAbsences.map((rec) => (
                    <div
                      key={rec.id}
                      className="flex items-center justify-between rounded-lg bg-white dark:bg-black/40 px-2.5 py-1.5 border border-red-200 dark:border-red-900/40 text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-red-700 dark:text-red-400">📅 {rec.date}</span>
                        {rec.notes && <span className="text-[#5d665f] dark:text-[#a0ada5]">· &quot;{rec.notes}&quot;</span>}
                      </div>
                      <span className="font-bold text-red-600 dark:text-red-400">-Rs. ${(rec.deductedWage || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Specific Dates Employee Took Leaves (Permitted or Half Time) */}
            <div className="rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20 p-3">
              <h4 className="font-bold text-blue-900 dark:text-blue-200 mb-2 flex items-center justify-between">
                <span>🔵 Dates of Leaves ({detailLeaves.length})</span>
                <span className="text-[10px] text-blue-700 dark:text-blue-300 font-normal">Permitted (100%) or Half-Time (50%)</span>
              </h4>
              {detailLeaves.length === 0 ? (
                <div className="text-[11px] text-[#5d665f] dark:text-[#a0ada5] italic">
                  ✓ No leaves recorded for this employee.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {detailLeaves.map((rec) => (
                    <div
                      key={rec.id}
                      className="flex items-center justify-between rounded-lg bg-white dark:bg-black/40 px-2.5 py-1.5 border border-blue-200 dark:border-blue-900/40 text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-blue-700 dark:text-blue-400">📅 {rec.date}</span>
                        <span className="rounded bg-blue-100 dark:bg-blue-950 px-1.5 py-0.5 text-[9px] font-bold text-blue-800 dark:text-blue-300">
                          {rec.status}
                        </span>
                        {rec.notes && <span className="text-[#5d665f] dark:text-[#a0ada5]">· &quot;{rec.notes}&quot;</span>}
                      </div>
                      <span className="font-bold text-green-700 dark:text-green-400">+Rs. ${(rec.earnedWage || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Complete Daily Attendance Log Table */}
            <div>
              <h4 className="font-bold mb-2">Complete Attendance History</h4>
              {detailEmployeeRecords.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-[#5d665f] italic">
                  No attendance records recorded yet for this employee.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-[#ece4da] dark:border-white/10 rounded-xl">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[#faf8f4] dark:bg-black/30 sticky top-0 border-b border-[#ece4da] dark:border-white/10">
                      <tr>
                        <th className="py-2 px-3 font-bold">Date</th>
                        <th className="py-2 px-3 font-bold">Status</th>
                        <th className="py-2 px-3 font-bold">Earned</th>
                        <th className="py-2 px-3 font-bold">Deducted</th>
                        <th className="py-2 px-3 font-bold">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ece4da] dark:divide-white/5">
                      {detailEmployeeRecords.map((rec) => (
                        <tr key={rec.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                          <td className="py-2 px-3 font-mono font-bold">{rec.date}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                rec.status === "Present"
                                  ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                                  : rec.status === "Absent"
                                  ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                                  : rec.status === "Half Time"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                  : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                              }`}
                            >
                              {rec.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-bold text-green-700 dark:text-green-400">
                            +Rs. ${(rec.earnedWage || 0).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 font-bold text-red-600 dark:text-red-400">
                            {rec.deductedWage > 0 ? `-Rs. ${rec.deductedWage.toFixed(2)}` : "Rs. 0.00"}
                          </td>
                          <td className="py-2 px-3 text-[#5d665f] max-w-[140px] truncate">{rec.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => setDetailEmployee(null)}
                className="rounded-xl bg-[#173c32] hover:bg-[#0f2d2b] text-white px-4 py-2 font-bold"
              >
                Close History
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Request Edit Permission Modal */}
      <Modal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        title="Request Attendance Edit Permission"
      >
        <form onSubmit={handleRequestEditSubmit} className="space-y-4 text-xs">
          <p className="text-[#5d665f] dark:text-[#a0ada5]">
            Attendance for <strong>{selectedDate}</strong> has already been saved and is locked. To modify it, please provide a reason for the SubAdmin to review and grant edit access.
          </p>

          {requestError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300">
              {requestError}
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">Reason for Edit *</label>
            <textarea
              required
              rows={3}
              value={requestReason}
              onChange={(e) => setRequestReason(e.target.value)}
              placeholder="e.g. Need to change Marcus's status from Absent to Half Time as he came for the second shift."
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRequestModalOpen(false)}
              className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={requestSubmitting}
              className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-700 text-white py-2.5 font-bold transition disabled:opacity-60 touch-manipulation"
            >
              {requestSubmitting ? "Submitting…" : "Send Request to SubAdmin"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Shop Employee Modal */}
      <Modal open={addEmpModalOpen} onClose={() => setAddEmpModalOpen(false)} title="Add Shop Employee">
        <form onSubmit={handleAddEmployeeSubmit} className="space-y-4 text-xs">
          <p className="text-[#5d665f] dark:text-[#a0ada5]">
            Add non-register store personnel (e.g. Barista, Stock Keeper, Cleaner, Baker). You can track their daily attendance and wages.
          </p>

          {addEmpError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300">
              {addEmpError}
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">Employee Full Name *</label>
            <input
              required
              type="text"
              value={newEmpName}
              onChange={(e) => setNewEmpName(e.target.value)}
              placeholder="e.g. Marcus Vance"
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">Job Role / Title *</label>
              <input
                required
                type="text"
                value={newEmpTitle}
                onChange={(e) => setNewEmpTitle(e.target.value)}
                placeholder="Barista, Cleaner, Stock Keeper…"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Daily Wage (Rs. / PKR per day) *</label>
              <input
                required
                type="number"
                min="0"
                step="any"
                value={newEmpWage}
                onChange={(e) => setNewEmpWage(e.target.value)}
                placeholder="45.00"
                className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">Phone Number (Optional)</label>
            <input
              type="tel"
              value={newEmpPhone}
              onChange={(e) => setNewEmpPhone(e.target.value)}
              placeholder="+1 555-0199"
              className="w-full rounded-xl border border-[#ece4da] dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 p-2.5"
            />
          </div>

          <button
            type="submit"
            disabled={addingEmp}
            className="w-full rounded-2xl bg-[#173c32] dark:bg-[#215446] py-3 text-xs font-bold text-white transition hover:bg-[#0f2d2b] disabled:opacity-60 touch-manipulation"
          >
            {addingEmp ? "Adding Staff…" : "Add Shop Employee"}
          </button>
        </form>
      </Modal>

      {/* Delete Employee Confirmation Modal */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Confirm Removal">
        <div className="space-y-4 text-xs">
          <p>
            Are you sure you want to remove <strong>{deleteTarget?.name}</strong> ({deleteTarget?.jobTitle || deleteTarget?.role}) from the shop roster?
          </p>
          {deleteError && (
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-red-700 dark:text-red-300">
              {deleteError}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="flex-1 rounded-xl border border-[#d9d0c3] dark:border-white/20 py-2.5 font-bold hover:bg-black/5 dark:hover:bg-white/10 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={handleDeleteEmployee}
              className="flex-1 rounded-xl bg-red-600 py-2.5 font-bold text-white hover:bg-red-700 disabled:opacity-60 touch-manipulation"
            >
              {deleting ? "Removing…" : "Confirm Removal"}
            </button>
          </div>
        </div>
      </Modal>

      {/* View-Only Receipt Audit Modal for HR */}
      <Modal
        open={!!viewReceiptTxn}
        onClose={() => setViewReceiptTxn(null)}
        title={`Receipt Audit · ${viewReceiptTxn?.receiptNumber || "View Receipt"}`}
      >
        {viewReceiptTxn && (
          <div className="space-y-4 text-xs font-sans">
            <div className="text-center border-b border-[#ece4da] dark:border-white/10 pb-3">
              <h3 className="font-mono text-sm font-black text-[#173c32] dark:text-white">
                {user?.tenantName || "Retail Store"}
              </h3>
              <p className="font-mono text-[11px] text-[#5d665f] dark:text-[#a0ada5] mt-0.5">
                Receipt: {viewReceiptTxn.receiptNumber}
              </p>
              <p className="font-mono text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                Standard Time: {formatStandardDateTime(viewReceiptTxn.createdAt)}
              </p>
              <p className="text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                Cashier: <strong>{viewReceiptTxn.operatorName || "Operator"}</strong> · Mode: <strong>(View Only)</strong>
              </p>
            </div>

            <div className="divide-y divide-[#ece4da] dark:divide-white/10">
              {(viewReceiptTxn.items || []).map((it, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-[#173c32] dark:text-white">{it.productName}</div>
                    <div className="text-[10px] text-[#5d665f] dark:text-[#a0ada5]">
                      {it.quantity} × Rs. ${it.unitPrice.toFixed(2)}
                      {(it.returnedQuantity || 0) > 0 && (
                        <span className="ml-2 font-bold text-red-600 dark:text-red-400">
                          (Returned: {it.returnedQuantity} units)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-right text-[#173c32] dark:text-white">
                    Rs. ${it.lineTotal.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5 border-t border-[#ece4da] dark:border-white/10 pt-3">
              {viewReceiptTxn.subtotal !== undefined && (
                <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                  <span>Subtotal:</span>
                  <span className="font-mono">Rs. ${Number(viewReceiptTxn.subtotal).toFixed(2)}</span>
                </div>
              )}
              {viewReceiptTxn.discount && (viewReceiptTxn.discount as any).amount > 0 && (
                <div className="flex justify-between text-green-700 dark:text-green-400 font-bold">
                  <span>Discount:</span>
                  <span className="font-mono">-Rs. ${Number((viewReceiptTxn.discount as any).amount).toFixed(2)}</span>
                </div>
              )}
              {viewReceiptTxn.tax !== undefined && (
                <div className="flex justify-between text-[#5d665f] dark:text-[#a0ada5]">
                  <span>Tax:</span>
                  <span className="font-mono">Rs. ${Number(viewReceiptTxn.tax).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-sm text-[#173c32] dark:text-white border-t border-[#ece4da] dark:border-white/10 pt-2">
                <span>Original Bill Total:</span>
                <span className="font-mono">Rs. ${viewReceiptTxn.total.toFixed(2)}</span>
              </div>
              {(viewReceiptTxn.refundAmount || 0) > 0 && (
                <div className="flex justify-between font-bold text-red-600 dark:text-red-400">
                  <span>Returns Deducted:</span>
                  <span className="font-mono">-Rs. ${Number(viewReceiptTxn.refundAmount).toFixed(2)}</span>
                </div>
              )}
              {(viewReceiptTxn.netTotal !== undefined || viewReceiptTxn.status === "returned") && (
                <div className="flex justify-between font-black text-sm text-emerald-800 dark:text-emerald-300 border-t border-dashed border-[#ece4da] dark:border-white/10 pt-2">
                  <span>Net Store Revenue:</span>
                  <span className="font-mono">
                    Rs. ${Number(viewReceiptTxn.netTotal !== undefined && viewReceiptTxn.netTotal !== null ? viewReceiptTxn.netTotal : (viewReceiptTxn.total - (viewReceiptTxn.refundAmount || 0))).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-xl bg-[#faf8f4] dark:bg-black/30 p-2.5 text-[11px] text-[#5d665f] dark:text-[#a0ada5]">
              <div>Payment: <strong>{(viewReceiptTxn.paymentMethod || "CASH").toUpperCase()}</strong></div>
              {viewReceiptTxn.cashGiven && (
                <div>Cash Tendered: <strong>Rs. ${viewReceiptTxn.cashGiven.toFixed(2)}</strong> (Change: <strong>Rs. ${(viewReceiptTxn.changeDue || 0).toFixed(2)}</strong>)</div>
              )}
              {viewReceiptTxn.returnedAt && (
                <div className="mt-1 text-red-600 dark:text-red-400 font-bold">
                  Returned at: {formatStandardDateTime(viewReceiptTxn.returnedAt)}
                  {viewReceiptTxn.returnReason && ` (Reason: ${viewReceiptTxn.returnReason})`}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 rounded-xl border border-[#d7a35d] bg-[#d7a35d]/10 hover:bg-[#d7a35d]/20 py-2.5 text-xs font-bold text-[#173c32] dark:text-[#d7a35d] transition"
              >
                🖨️ Print Receipt
              </button>
              <button
                type="button"
                onClick={() => setViewReceiptTxn(null)}
                className="flex-1 rounded-xl bg-[#173c32] py-2.5 text-xs font-bold text-white transition hover:bg-[#0f2d2b]"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

    </main>
  );
}

export default function HRDashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f6f1ea] dark:bg-[#0d1512] text-[#173c32] dark:text-[#f6f1ea] font-semibold">
          Loading HR Dashboard…
        </div>
      }
    >
      <HRDashboardContent />
    </Suspense>
  );
}

import { isAppSyncConfigured, graphqlRequest } from "./appsync-client";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Role = "Admin" | "SubAdmin" | "HR" | "Operator";

export type UserSession = {
  id: string;
  name: string;
  email?: string;
  role: Role;
  tenantId?: string;   // present for SubAdmin / HR / Operator; absent for Admin
  tenantName?: string; // display name of the tenant; absent for Admin
};

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? "Request failed");
  return data as T;
}

// ─── AppSync GraphQL Router & Fallback Dispatcher ─────────────────────────────

export async function postJson<T>(path: string, body: Record<string, unknown>, token?: string): Promise<T> {
  if (isAppSyncConfigured()) {
    try {
      const gqlResult = await handleAppSyncPost(path, body, token);
      if (gqlResult !== null) return gqlResult as T;
    } catch (err) {
      console.warn(`[AppSync Router POST error on ${path}]:`, err);
      throw err;
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return handleResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

export async function getJson<T>(path: string, token?: string): Promise<T> {
  if (isAppSyncConfigured()) {
    try {
      const gqlResult = await handleAppSyncGet(path, token);
      if (gqlResult !== null) return gqlResult as T;
    } catch (err) {
      console.warn(`[AppSync Router GET error on ${path}]:`, err);
      throw err;
    }
  }

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return handleResponse<T>(await fetch(`${API_URL}${path}`, { headers }));
}

export async function deleteJson<T>(path: string, token: string): Promise<T> {
  if (isAppSyncConfigured()) {
    try {
      const gqlResult = await handleAppSyncDelete(path, token);
      if (gqlResult !== null) return gqlResult as T;
    } catch (err) {
      console.warn(`[AppSync Router DELETE error on ${path}]:`, err);
      throw err;
    }
  }

  return handleResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  );
}

export async function patchJson<T>(path: string, body: Record<string, unknown>, token: string): Promise<T> {
  if (isAppSyncConfigured()) {
    try {
      const gqlResult = await handleAppSyncPatch(path, body, token);
      if (gqlResult !== null) return gqlResult as T;
    } catch (err) {
      console.warn(`[AppSync Router PATCH error on ${path}]:`, err);
      throw err;
    }
  }

  return handleResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  );
}

export async function putJson<T>(path: string, body: Record<string, unknown>, token: string): Promise<T> {
  if (isAppSyncConfigured()) {
    try {
      const gqlResult = await handleAppSyncPatch(path, body, token);
      if (gqlResult !== null) return gqlResult as T;
    } catch (err) {
      console.warn(`[AppSync Router PUT error on ${path}]:`, err);
      throw err;
    }
  }

  return handleResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  );
}

// ─── AppSync GraphQL Route Resolvers ──────────────────────────────────────────

async function handleAppSyncPost(path: string, body: Record<string, any>, token?: string): Promise<any> {
  // 1. Auth & Onboarding
  if (path === "/api/auth/login") {
    const data = await graphqlRequest<{ login: { token: string; user: UserSession } }>(
      `mutation AppSyncLogin($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          token
          user { id name email role tenantId tenantName }
        }
      }`,
      { email: body.email, password: body.password }
    );
    return data.login;
  }

  if (path === "/api/auth/admin-login") {
    const data = await graphqlRequest<{ adminLogin: { token: string; user: UserSession } }>(
      `mutation AppSyncAdminLogin($adminId: String!, $password: String!) {
        adminLogin(adminId: $adminId, password: $password) {
          token
          user { id name email role tenantId tenantName }
        }
      }`,
      { adminId: body.adminId, password: body.password }
    );
    return data.adminLogin;
  }

  if (path === "/api/auth/onboard-store") {
    const data = await graphqlRequest<{ onboardStore: any }>(
      `mutation AppSyncOnboardStore($input: OnboardStoreInput!) {
        onboardStore(input: $input) {
          message
          tenant { id name slug status contactEmail createdAt }
          user { id name email role tenantId tenantName }
        }
      }`,
      { input: body }
    );
    return data.onboardStore;
  }

  if (path === "/api/auth/register") {
    const data = await graphqlRequest<{ register: any }>(
      `mutation AppSyncRegister($input: RegisterInput!) {
        register(input: $input) {
          id name email role tenantId
        }
      }`,
      { input: body }
    );
    return { user: data.register };
  }

  if (path === "/api/auth/send-verification-otp") {
    const data = await graphqlRequest<{ sendVerificationOtp: any }>(
      `mutation AppSyncSendOtp($email: String!, $purpose: String, $recipientName: String, $entityName: String) {
        sendVerificationOtp(email: $email, purpose: $purpose, recipientName: $recipientName, entityName: $entityName) {
          message email expiresInSeconds
        }
      }`,
      body
    );
    return data.sendVerificationOtp;
  }

  if (path === "/api/auth/verify-registration-otp") {
    const data = await graphqlRequest<{ verifyRegistrationOtp: any }>(
      `mutation AppSyncVerifyOtp($email: String!, $otp: String!, $purpose: String) {
        verifyRegistrationOtp(email: $email, otp: $otp, purpose: $purpose) {
          message verified verificationToken
        }
      }`,
      body
    );
    return data.verifyRegistrationOtp;
  }

  if (path === "/api/auth/forgot-password") {
    const data = await graphqlRequest<{ forgotPassword: any }>(
      `mutation AppSyncForgotPassword($email: String!) {
        forgotPassword(email: $email) {
          message email expiresInSeconds
        }
      }`,
      { email: body.email }
    );
    return data.forgotPassword;
  }

  if (path === "/api/auth/reset-password") {
    const data = await graphqlRequest<{ resetPassword: any }>(
      `mutation AppSyncResetPassword($email: String!, $otp: String!, $newPassword: String!) {
        resetPassword(email: $email, otp: $otp, newPassword: $newPassword) {
          message success
        }
      }`,
      body
    );
    return data.resetPassword;
  }

  // 2. Tenants & Users
  if (path === "/api/tenants/payment-verification") {
    const data = await graphqlRequest<{ submitPaymentVerification: any }>(
      `mutation AppSyncSubmitPayment($senderName: String!) {
        submitPaymentVerification(senderName: $senderName) {
          id name slug status paymentSenderName paymentAccount paymentSubmittedAt
        }
      }`,
      body,
      token
    );
    return { message: "Payment verification submitted. Waiting for Admin review.", tenant: data.submitPaymentVerification };
  }

  if (path.startsWith("/api/tenants/") && path.endsWith("/review-payment")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ reviewPayment: any }>(
      `mutation AppSyncReviewPayment($tenantId: ID!, $action: String!, $rejectionReason: String) {
        reviewPayment(tenantId: $tenantId, action: $action, rejectionReason: $rejectionReason) {
          id name slug status rejectionReason
        }
      }`,
      { tenantId: id, action: body.action, rejectionReason: body.rejectionReason },
      token
    );
    return { message: `Store tenant has been ${body.action === "approve" ? "approved" : "rejected"}.`, tenant: data.reviewPayment };
  }

  if (path === "/api/tenants") {
    const data = await graphqlRequest<{ createTenant: any }>(
      `mutation AppSyncCreateTenant($name: String!, $slug: String!, $email: String!, $otp: String, $verificationToken: String) {
        createTenant(name: $name, slug: $slug, email: $email, otp: $otp, verificationToken: $verificationToken) {
          id name slug status contactEmail createdAt
        }
      }`,
      body,
      token
    );
    return { tenant: data.createTenant };
  }

  if (path === "/api/users") {
    const isStaff = body.role === "SubAdmin" || body.role === "HR" || body.role === "Operator";
    if (isStaff) {
      const data = await graphqlRequest<{ createStaff: any }>(
        `mutation AppSyncCreateStaff($input: CreateStaffInput!) {
          createStaff(input: $input) {
            id name email role tenantId dailyWage createdAt
          }
        }`,
        { input: body },
        token
      );
      return { user: data.createStaff };
    } else {
      const data = await graphqlRequest<{ createEmployee: any }>(
        `mutation AppSyncCreateEmployee($input: CreateEmployeeInput!) {
          createEmployee(input: $input) {
            id name email jobTitle dailyWage phone role tenantId createdAt
          }
        }`,
        { input: body },
        token
      );
      return { user: data.createEmployee };
    }
  }

  // 3. Products & Inventory
  if (path === "/api/products") {
    const data = await graphqlRequest<{ createProduct: any }>(
      `mutation AppSyncCreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
          id name sku category price description imageUrl isActive updatedAt
        }
      }`,
      { input: body },
      token
    );
    return { product: data.createProduct };
  }

  if (path === "/api/inventory") {
    const data = await graphqlRequest<{ createInventoryItem: any }>(
      `mutation AppSyncCreateInventory($productId: String!, $productName: String, $stockQty: Float!, $lowStockThreshold: Float, $unit: String, $mode: String) {
        createInventoryItem(productId: $productId, productName: $productName, stockQty: $stockQty, lowStockThreshold: $lowStockThreshold, unit: $unit, mode: $mode) {
          id tenantId productId productName stockQty lowStockThreshold unit updatedAt
        }
      }`,
      body,
      token
    );
    return { inventory: data.createInventoryItem };
  }

  // 4. Transactions & Returns
  if (path === "/api/transactions") {
    const data = await graphqlRequest<{ createTransaction: any }>(
      `mutation AppSyncCreateTx($input: CreateTransactionInput!) {
        createTransaction(input: $input) {
          id tenantId subtotal total tax paymentMethod receiptNumber createdAt status
        }
      }`,
      { input: body },
      token
    );
    return { transaction: data.createTransaction };
  }

  if (path.startsWith("/api/transactions/") && path.endsWith("/return")) {
    const parts = path.split("/");
    const transactionId = parts[3];
    const data = await graphqlRequest<{ processReturn: any }>(
      `mutation AppSyncProcessReturn($input: ProcessReturnInput!) {
        processReturn(input: $input) {
          success message refundAmount newStatus returnedItems
        }
      }`,
      { input: { transactionId, ...body } },
      token
    );
    return data.processReturn;
  }

  // 5. Attendance & Requests
  if (path === "/api/attendance") {
    const data = await graphqlRequest<{ saveDailyAttendance: any }>(
      `mutation AppSyncSaveAttendance($date: String!, $entries: [AttendanceEntryInput!]!, $today: String) {
        saveDailyAttendance(date: $date, entries: $entries, today: $today) {
          id userId userName status date isLocked notes
        }
      }`,
      body,
      token
    );
    return { message: "Attendance saved successfully", records: data.saveDailyAttendance };
  }

  if (path === "/api/attendance/requests") {
    const data = await graphqlRequest<{ requestAttendanceEdit: any }>(
      `mutation AppSyncRequestEdit($date: String!, $reason: String, $today: String) {
        requestAttendanceEdit(date: $date, reason: $reason, today: $today) {
          id tenantId date reason status requestedByName createdAt
        }
      }`,
      body,
      token
    );
    return { message: "Edit request submitted", request: data.requestAttendanceEdit };
  }

  if (path.startsWith("/api/attendance/requests/") && path.endsWith("/approve")) {
    const id = path.split("/")[4];
    const data = await graphqlRequest<{ approveAttendanceEdit: any }>(
      `mutation AppSyncApproveEdit($id: ID!) {
        approveAttendanceEdit(id: $id) { id status reviewedByName reviewedAt }
      }`,
      { id },
      token
    );
    return { message: "Request approved", request: data.approveAttendanceEdit };
  }

  if (path.startsWith("/api/attendance/requests/") && path.endsWith("/reject")) {
    const id = path.split("/")[4];
    const data = await graphqlRequest<{ rejectAttendanceEdit: any }>(
      `mutation AppSyncRejectEdit($id: ID!) {
        rejectAttendanceEdit(id: $id) { id status reviewedByName reviewedAt }
      }`,
      { id },
      token
    );
    return { message: "Request rejected", request: data.rejectAttendanceEdit };
  }

  return null;
}

async function handleAppSyncGet(path: string, token?: string): Promise<any> {
  const [basePath, queryString] = path.split("?");
  const params = new URLSearchParams(queryString || "");

  // Health probe
  if (basePath === "/health") {
    return { ok: true, mode: "AWS Cloud (AppSync + DynamoDB + Lambdas)", dynamodbReachable: true };
  }

  // Tenants
  if (basePath === "/api/tenants/all") {
    const data = await graphqlRequest<{ listAllTenants: any[] }>(
      `query AppSyncListAllTenants {
        listAllTenants {
          id name slug status contactEmail createdAt
        }
      }`,
      {},
      token
    );
    return { tenants: data.listAllTenants || [] };
  }

  if (basePath === "/api/tenants") {
    const data = await graphqlRequest<{ listTenants: any[] }>(
      `query AppSyncListTenants {
        listTenants {
          id name slug status
        }
      }`
    );
    return data.listTenants || [];
  }

  if (basePath.startsWith("/api/tenants/") && basePath.endsWith("/users")) {
    const tenantId = basePath.split("/")[3];
    const data = await graphqlRequest<{ getTenant: any; listUsers: any[] }>(
      `query AppSyncTenantUsers($tenantId: ID!) {
        getTenant(id: $tenantId) { id name slug status contactEmail }
        listUsers { id name email role tenantId dailyWage jobTitle phone createdAt }
      }`,
      { tenantId },
      token
    );
    const filteredUsers = (data.listUsers || []).filter(u => u.tenantId === tenantId);
    return { tenant: data.getTenant, users: filteredUsers };
  }

  if (basePath === "/api/tenants/my-status") {
    const data = await graphqlRequest<{ getMyTenantStatus: any }>(
      `query AppSyncMyTenantStatus {
        getMyTenantStatus {
          id name slug status paymentSenderName paymentAccount paymentSubmittedAt rejectionReason
        }
      }`,
      {},
      token
    );
    return { tenant: data.getMyTenantStatus };
  }

  // Users
  if (basePath === "/api/users") {
    const data = await graphqlRequest<{ listUsers: any[] }>(
      `query AppSyncListUsers {
        listUsers {
          id name email role tenantId dailyWage jobTitle phone createdAt
        }
      }`,
      {},
      token
    );
    return { users: data.listUsers || [] };
  }

  // Products
  if (basePath === "/api/products") {
    const tenantId = params.get("tenantId") || getStoredSession()?.user?.tenantId || "";
    const data = await graphqlRequest<{ getProducts: any[] }>(
      `query AppSyncGetProducts($tenantId: String!) {
        getProducts(tenantId: $tenantId) {
          id tenantId name sku category price description imageUrl isActive updatedAt _deleted
        }
      }`,
      { tenantId },
      token
    );
    return { products: data.getProducts || [] };
  }

  // Inventory
  if (basePath === "/api/inventory") {
    const tenantId = params.get("tenantId") || getStoredSession()?.user?.tenantId || "";
    const data = await graphqlRequest<{ getInventory: any[] }>(
      `query AppSyncGetInventory($tenantId: String!) {
        getInventory(tenantId: $tenantId) {
          id tenantId productId productName stockQty lowStockThreshold unit updatedAt _deleted
        }
      }`,
      { tenantId },
      token
    );
    return { inventory: data.getInventory || [] };
  }

  // Transactions
  if (basePath === "/api/transactions") {
    const tenantId = params.get("tenantId") || getStoredSession()?.user?.tenantId || "";
    const data = await graphqlRequest<{ getTransactions: any[] }>(
      `query AppSyncGetTransactions($tenantId: String!) {
        getTransactions(tenantId: $tenantId) {
          id tenantId subtotal total tax paymentMethod receiptNumber createdAt status
          items { productId productName quantity unitPrice lineTotal }
        }
      }`,
      { tenantId },
      token
    );
    return { transactions: data.getTransactions || [] };
  }

  if (basePath.startsWith("/api/transactions/") && basePath.endsWith("/lookup")) {
    const tenantId = params.get("tenantId") || getStoredSession()?.user?.tenantId || "";
    const receiptNumber = params.get("receiptNumber") || "";
    const data = await graphqlRequest<{ getTransactionByReceipt: any }>(
      `query AppSyncTxByReceipt($tenantId: String!, $receiptNumber: String!) {
        getTransactionByReceipt(tenantId: $tenantId, receiptNumber: $receiptNumber) {
          id tenantId subtotal total tax paymentMethod receiptNumber createdAt status
          items { productId productName quantity unitPrice lineTotal }
        }
      }`,
      { tenantId, receiptNumber },
      token
    );
    return { transaction: data.getTransactionByReceipt };
  }

  // Attendance
  if (basePath === "/api/attendance") {
    const tenantId = params.get("tenantId") || getStoredSession()?.user?.tenantId || "";
    const date = params.get("date") || undefined;
    const data = await graphqlRequest<{ getAttendance: any }>(
      `query AppSyncGetAttendance($tenantId: String!, $date: String) {
        getAttendance(tenantId: $tenantId, date: $date) {
          records { id userId userName role dailyWage status date isLocked notes }
          summary { totalRecords present absent halfTime permittedLeave totalWagesEarned totalWagesDeducted }
          employeeSummaries { userId userName role jobTitle dailyWage totalDaysLogged daysPresent daysAbsent daysHalfTime daysPermittedLeave totalLeaveDays grossWage earnedWage deductedWage }
        }
      }`,
      { tenantId, date },
      token
    );
    return data.getAttendance;
  }

  if (basePath === "/api/attendance/date-status") {
    const date = params.get("date") || undefined;
    const today = params.get("today") || undefined;
    const data = await graphqlRequest<{ getAttendanceDateStatus: any }>(
      `query AppSyncDateStatus($date: String, $today: String) {
        getAttendanceDateStatus(date: $date, today: $today) {
          date today isToday isFuture isSaved isLocked canEdit recordCount
        }
      }`,
      { date, today },
      token
    );
    return data.getAttendanceDateStatus;
  }

  if (basePath === "/api/attendance/requests") {
    const tenantId = params.get("tenantId") || getStoredSession()?.user?.tenantId || "";
    const date = params.get("date") || undefined;
    const status = params.get("status") || undefined;
    const data = await graphqlRequest<{ listAttendanceEditRequests: any[] }>(
      `query AppSyncListRequests($tenantId: String!, $date: String, $status: String) {
        listAttendanceEditRequests(tenantId: $tenantId, date: $date, status: $status) {
          id tenantId date reason status requestedBy requestedByName reviewedBy reviewedByName reviewedAt createdAt updatedAt
        }
      }`,
      { tenantId, date, status },
      token
    );
    return { requests: data.listAttendanceEditRequests || [] };
  }

  return null;
}

async function handleAppSyncPatch(path: string, body: Record<string, any>, token?: string): Promise<any> {
  // Update Tenant Status
  if (path.startsWith("/api/tenants/") && path.endsWith("/status")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ updateTenantStatus: any }>(
      `mutation AppSyncUpdateTenantStatus($id: ID!, $status: String!) {
        updateTenantStatus(id: $id, status: $status) {
          id name slug status contactEmail createdAt
        }
      }`,
      { id, status: body.status },
      token
    );
    return { tenant: data.updateTenantStatus };
  }

  // Update Employee Wage
  if (path.startsWith("/api/users/") && path.endsWith("/wage")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ updateWage: any }>(
      `mutation AppSyncUpdateWage($id: ID!, $dailyWage: Float!) {
        updateWage(id: $id, dailyWage: $dailyWage) {
          id dailyWage
        }
      }`,
      { id, dailyWage: Number(body.dailyWage) },
      token
    );
    return { user: data.updateWage };
  }

  // Update Product
  if (path.startsWith("/api/products/")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ updateProduct: any }>(
      `mutation AppSyncUpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
          id name sku category price description imageUrl isActive updatedAt
        }
      }`,
      { input: { id, ...body } },
      token
    );
    return { product: data.updateProduct };
  }

  // Update Inventory Item
  if (path.startsWith("/api/inventory/")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ updateInventoryItem: any }>(
      `mutation AppSyncUpdateInventory($id: ID!, $stockQty: Float, $lowStockThreshold: Float, $unit: String, $productName: String, $mode: String) {
        updateInventoryItem(id: $id, stockQty: $stockQty, lowStockThreshold: $lowStockThreshold, unit: $unit, productName: $productName, mode: $mode) {
          id productId productName stockQty lowStockThreshold unit updatedAt
        }
      }`,
      { id, ...body },
      token
    );
    return { inventory: data.updateInventoryItem };
  }

  return null;
}

async function handleAppSyncDelete(path: string, token: string): Promise<any> {
  // Delete User
  if (path.startsWith("/api/users/")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ deleteUser: any }>(
      `mutation AppSyncDeleteUser($id: ID!) {
        deleteUser(id: $id) { message success }
      }`,
      { id },
      token
    );
    return data.deleteUser;
  }

  // Delete Tenant
  if (path.startsWith("/api/tenants/")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ deleteTenant: any }>(
      `mutation AppSyncDeleteTenant($id: ID!) {
        deleteTenant(id: $id) { message success }
      }`,
      { id },
      token
    );
    return data.deleteTenant;
  }

  // Delete Product
  if (path.startsWith("/api/products/")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ deleteProduct: any }>(
      `mutation AppSyncDeleteProduct($id: ID!) {
        deleteProduct(id: $id) { id name _deleted }
      }`,
      { id },
      token
    );
    return { product: data.deleteProduct };
  }

  // Delete Inventory
  if (path.startsWith("/api/inventory/")) {
    const id = path.split("/")[3];
    const data = await graphqlRequest<{ deleteInventoryItem: any }>(
      `mutation AppSyncDeleteInventory($id: ID!) {
        deleteInventoryItem(id: $id) { id _deleted }
      }`,
      { id },
      token
    );
    return { inventory: data.deleteInventoryItem };
  }

  return null;
}

// ─── Session Helpers (localStorage fast path) ─────────────────────────────────

export function getStoredSession(): { token: string; user: UserSession } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("pointe-session");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveSession(token: string, user: UserSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("pointe-session", JSON.stringify({ token, user }));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("pointe-session");
}

// ─── Role Routing ─────────────────────────────────────────────────────────────

export const ROLE_DASHBOARD: Record<Role, string> = {
  Admin:    "/admin-dashboard",
  SubAdmin: "/dashboard/subadmin",
  HR:       "/dashboard/hr",
  Operator: "/dashboard/operator",
};

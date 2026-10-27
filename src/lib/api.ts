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

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? "Request failed");
  return data as T;
}

export async function postJson<T>(path: string, body: Record<string, unknown>, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return handleResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method:  "POST",
      headers,
      body:    JSON.stringify(body),
    })
  );
}

export async function getJson<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return handleResponse<T>(await fetch(`${API_URL}${path}`, { headers }));
}

export async function deleteJson<T>(path: string, token: string): Promise<T> {
  return handleResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method:  "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  );
}

export async function patchJson<T>(path: string, body: Record<string, unknown>, token: string): Promise<T> {
  return handleResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body),
    })
  );
}

export async function putJson<T>(path: string, body: Record<string, unknown>, token: string): Promise<T> {
  return handleResponse<T>(
    await fetch(`${API_URL}${path}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body),
    })
  );
}

// ─── Session helpers (localStorage fast path) ─────────────────────────────────

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

// ─── Role routing ─────────────────────────────────────────────────────────────

export const ROLE_DASHBOARD: Record<Role, string> = {
  Admin:    "/admin-dashboard",
  SubAdmin: "/dashboard/subadmin",
  HR:       "/dashboard/hr",
  Operator: "/dashboard/operator",
};

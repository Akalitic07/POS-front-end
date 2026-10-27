"use client";

import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  clearSession,
  getStoredSession,
  saveSession,
  type UserSession,
} from "@/lib/api";
import {
  clearOfflineSession,
  getOfflineSession,
  saveOfflineSession,
} from "@/lib/offline-db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthContextValue = {
  user:    UserSession | null;
  token:   string | null;
  loading: boolean;
  login:   (token: string, user: UserSession) => Promise<void>;
  logout:  () => Promise<void>;
};

// ─── Context ──────────────────────────────────────────────────────────────────

export const AuthContext = createContext<AuthContextValue>({
  user:    null,
  token:   null,
  loading: true,
  login:   async () => {},
  logout:  async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<UserSession | null>(null);
  const [token,   setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate on mount: fast path = localStorage; fallback = RxDB (Dexie)
  useEffect(() => {
    async function hydrate() {
      // 1. Fast path — localStorage (synchronous)
      const stored = getStoredSession();
      if (stored) {
        setToken(stored.token);
        setUser(stored.user);
        setLoading(false);
        return;
      }

      // 2. Slower fallback — RxDB (async IndexedDB read)
      //    Handles the edge case where localStorage was cleared but Dexie still has the session.
      const offline = await getOfflineSession();
      if (offline) {
        setToken(offline.token);
        setUser(offline.user);
        // Re-sync to localStorage so the fast path works next time
        saveSession(offline.token, offline.user);
      }
      setLoading(false);
    }
    hydrate();
  }, []);

  const login = useCallback(async (newToken: string, newUser: UserSession) => {
    saveSession(newToken, newUser);
    try {
      await saveOfflineSession(newToken, newUser);
    } catch (err) {
      console.warn("Offline session save error:", err);
    }
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    clearSession();
    try {
      await clearOfflineSession();
    } catch (err) {
      console.warn("Offline session clear error:", err);
    }
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}


"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RxDatabase } from 'rxdb';
import { useAuth } from '@/hooks/useAuth';
import { getPosDatabase, destroyPosDatabase } from '@/lib/pos-database';
import { startSync, stopSync } from '@/lib/sync-engine';
import { startConnectionMonitor, stopConnectionMonitor, getConnectionStatus, onConnectionChange } from '@/lib/connection-status';
import { startOutboxAutoSync, flushOutbox } from '@/lib/sync-outbox';

interface DatabaseContextValue {
  db: RxDatabase | null;
  isOnline: boolean;
  dbReady: boolean;
}

const DatabaseContext = createContext<DatabaseContextValue>({
  db: null,
  isOnline: true,
  dbReady: false,
});

export function usePosDatabase() {
  return useContext(DatabaseContext);
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const [db, setDb] = useState<RxDatabase | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const dbRef = useRef<RxDatabase | null>(null);

  const signedIn = Boolean(user && token);

  // Initialize database when user logs in; close it on logout (data stays on disk).
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!user || !token) {
        // No user — clean up
        stopSync();
        if (dbRef.current) {
          try {
            await destroyPosDatabase();
          } catch (err) {
            console.warn('[DatabaseProvider] cleanup warning:', err);
          }
          dbRef.current = null;
          setDb(null);
          setDbReady(false);
        }
        return;
      }

      try {
        const database = await getPosDatabase();
        if (cancelled || !database) return;
        dbRef.current = database;
        setDb(database);
        setDbReady(true);

        // Start sync if online and user has a tenant
        if (user.tenantId && getConnectionStatus()) {
          startSync(database, user.tenantId);
          startOutboxAutoSync();
          if (token) flushOutbox(token).catch(() => {});
        }
      } catch (err) {
        console.error('[DatabaseProvider] init error:', err);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [user?.id, token]);

  // Connection monitoring — only while signed in
  useEffect(() => {
    if (!signedIn) return;
    startConnectionMonitor();
    setIsOnline(getConnectionStatus());

    const unsub = onConnectionChange((online) => {
      setIsOnline(online);
      // Start/stop sync based on connectivity
      if (online && dbRef.current && user?.tenantId) {
        startSync(dbRef.current, user.tenantId);
        startOutboxAutoSync();
        if (token) flushOutbox(token).catch(() => {});
      } else if (!online) {
        stopSync();
      }
    });

    return () => {
      unsub();
      stopConnectionMonitor();
    };
  }, [signedIn, user?.tenantId]);

  return (
    <DatabaseContext.Provider value={{ db, isOnline, dbReady }}>
      {children}
    </DatabaseContext.Provider>
  );
}

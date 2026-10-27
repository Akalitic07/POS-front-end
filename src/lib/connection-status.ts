type ConnectionListener = (online: boolean) => void;

import { isAppSyncConfigured, graphqlRequest } from './appsync-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const HEALTH_INTERVAL_MS = 15000;

let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
let listeners: ConnectionListener[] = [];
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let monitorRefs = 0;

export function getConnectionStatus(): boolean {
  return isOnline;
}

export function onConnectionChange(listener: ConnectionListener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function setOnline(value: boolean) {
  if (isOnline !== value) {
    isOnline = value;
    listeners.forEach((l) => l(value));
  }
}

// Ping the cloud backend (AppSync GraphQL or Express health endpoint) to confirm real connectivity
async function checkHealth(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;

  // Cloud Mode: Ping AppSync
  if (isAppSyncConfigured()) {
    try {
      const data = await Promise.race([
        graphqlRequest<{ __typename: string }>('query HealthPing { __typename }'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AppSync timeout')), 5000)
        ),
      ]);
      return Boolean(data && data.__typename);
    } catch {
      return false;
    }
  }

  // Local / Express Fallback Mode
  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

async function recheck() {
  setOnline(await checkHealth());
}

const handleOnline = () => {
  void recheck();
};

const handleOffline = () => setOnline(false);

const handleVisibility = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    void recheck();
  }
};

export function startConnectionMonitor(): void {
  monitorRefs += 1;
  if (monitorRefs > 1) return;

  if (typeof window === 'undefined') return;

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibility);

  void recheck();

  healthCheckInterval = setInterval(() => {
    void recheck();
  }, HEALTH_INTERVAL_MS);
}

export function stopConnectionMonitor(): void {
  if (monitorRefs <= 0) return;
  monitorRefs -= 1;
  if (monitorRefs > 0) return;

  if (typeof window === 'undefined') return;

  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  document.removeEventListener('visibilitychange', handleVisibility);

  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

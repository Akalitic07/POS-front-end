type ConnectionListener = (online: boolean) => void;

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

// Ping the backend health endpoint to confirm real connectivity
async function checkHealth(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
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
  if (typeof window === 'undefined') return;

  monitorRefs += 1;
  if (monitorRefs > 1) return;

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibility);

  if (healthCheckInterval) clearInterval(healthCheckInterval);
  healthCheckInterval = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void recheck();
    }
  }, HEALTH_INTERVAL_MS);

  void recheck();
}

export function stopConnectionMonitor(): void {
  if (typeof window === 'undefined' || monitorRefs === 0) return;
  monitorRefs -= 1;
  if (monitorRefs > 0) return;

  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  document.removeEventListener('visibilitychange', handleVisibility);
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

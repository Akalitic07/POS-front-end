"use client";

import { usePosDatabase } from './DatabaseContext';

export function useConnectionStatus() {
  const { isOnline } = usePosDatabase();
  return { isOnline };
}

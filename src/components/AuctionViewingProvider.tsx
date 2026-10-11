"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AUTO_PLAY_STORAGE_KEY, readAutoPlayPreference } from "@/lib/auction-viewing";

const ViewingContext = createContext<{ enabled: boolean; ready: boolean; setEnabled: (enabled: boolean) => void }>({ enabled: true, ready: false, setEnabled: () => {} });
export const useAuctionViewing = () => useContext(ViewingContext);

export function AuctionViewingProvider({ children }: { children: React.ReactNode }) {
  const [enabled, updateEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { updateEnabled(readAutoPlayPreference(localStorage.getItem(AUTO_PLAY_STORAGE_KEY))); }
    catch { /* Storage can be unavailable; keep the in-memory preference. */ }
    setReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTO_PLAY_STORAGE_KEY || event.key === null) updateEnabled(readAutoPlayPreference(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const setEnabled = useCallback((next: boolean) => {
    updateEnabled(next);
    try { localStorage.setItem(AUTO_PLAY_STORAGE_KEY, next ? "on" : "off"); }
    catch { /* The switch still works for this visit. */ }
  }, []);
  return <ViewingContext.Provider value={{ enabled, ready, setEnabled }}>{children}</ViewingContext.Provider>;
}

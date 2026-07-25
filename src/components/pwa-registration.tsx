"use client";

import { useEffect } from "react";

// PwaRegistration installs the lightweight Vosio service worker for mobile app installability.
export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  return null;
}

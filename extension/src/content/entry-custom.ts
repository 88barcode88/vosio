// Content script entry for user added sites: reports page presence only (no DOM call detection).

import { sendToServiceWorker, startMonitor } from "./monitor.ts";
import { customDetector } from "./platforms/custom.ts";

startMonitor(customDetector, sendToServiceWorker);

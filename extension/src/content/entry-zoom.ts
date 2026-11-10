// Content script entry for Zoom web client pages: starts the monitor with the Zoom detector.

import { sendToServiceWorker, startMonitor } from "./monitor.ts";
import { zoomDetector } from "./platforms/zoom.ts";

startMonitor(zoomDetector, sendToServiceWorker);

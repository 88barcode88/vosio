// Content script entry for Google Meet pages: starts the monitor with the Meet detector.

import { sendToServiceWorker, startMonitor } from "./monitor.ts";
import { meetDetector } from "./platforms/meet.ts";

startMonitor(meetDetector, sendToServiceWorker);

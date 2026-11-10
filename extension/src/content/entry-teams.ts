// Content script entry for Microsoft Teams web pages: starts the monitor with the Teams detector.

import { sendToServiceWorker, startMonitor } from "./monitor.ts";
import { teamsDetector } from "./platforms/teams.ts";

startMonitor(teamsDetector, sendToServiceWorker);

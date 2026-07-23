import { initStatus } from "./status";
import { initHistoryChart } from "./chart";
import { initAscCharts } from "./asc-charts";
import { initAscSyncButton } from "./asc-status";
import { initTabs } from "./tabs";
import { initTdEngagementCharts } from "./td-charts";
import { initTdStatusPolling } from "./td-status";

document.addEventListener("DOMContentLoaded", () => {
  initStatus();
  initHistoryChart().catch(console.error);
  initAscCharts();
  initAscSyncButton();
  initTabs();
  initTdEngagementCharts();
  initTdStatusPolling();
});

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { sanitizeMonitorStrategyPrefStorage } from "./lib/etfMonitorStrategyPref";
import "./index.css";

sanitizeMonitorStrategyPrefStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

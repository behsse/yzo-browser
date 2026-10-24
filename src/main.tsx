import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { locale } from "./lib/i18n";
import { StoreProvider } from "./state/store";
import { SyncProvider } from "./sync/SyncProvider";
import "./styles.css";

document.documentElement.lang = locale;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <SyncProvider>
        <App />
      </SyncProvider>
    </StoreProvider>
  </StrictMode>,
);

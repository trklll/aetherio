import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import UpdatePopup from "./components/updater/UpdatePopup";
import { queryClient } from "./queryClient";
import { installAndroidTvRemoteNavigation, installRuntimeDocumentClasses } from "./runtime/platform";
import { installGsapAnimations } from "./utils/motion";
import { initBuiltinTmdbKey } from "./config/apiKeys";
import "./index.css";

installRuntimeDocumentClasses();
installAndroidTvRemoteNavigation();
installGsapAnimations();
initBuiltinTmdbKey();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <UpdatePopup />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

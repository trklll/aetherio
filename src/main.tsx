import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import NativeSplashWindow from "./components/startup/NativeSplashWindow.tsx";
import UpdatePopup from "./components/updater/UpdatePopup.tsx";
import { queryClient } from "./queryClient";
import { installAndroidTvRemoteNavigation, installRuntimeDocumentClasses } from "./runtime/platform.ts";
import { installGsapAnimations } from "./utils/motion.ts";
import { initBuiltinTmdbKey } from "./config/apiKeys.ts";
import "./index.css";

const isSplashWindow = new URLSearchParams(window.location.search).get("window") === "splash";

installRuntimeDocumentClasses();
installGsapAnimations();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (isSplashWindow) {
  root.render(<NativeSplashWindow />);
} else {
  installAndroidTvRemoteNavigation();
  initBuiltinTmdbKey();
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <UpdatePopup />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

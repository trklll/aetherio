import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import NativeSplashWindow from "./components/startup/NativeSplashWindow.tsx";
import UpdatePopup from "./components/updater/UpdatePopup.tsx";
import { ShellPreviewApp } from "./components/layout/ShellDetailPreview.tsx";
import { queryClient } from "./queryClient";
import { installSpatialRemoteNavigation, installRuntimeDocumentClasses } from "./runtime/platform.ts";
import { installGsapAnimations } from "./utils/motion.ts";
import { installModeTransition } from "./utils/bigPictureTransition.ts";
import { isShellPreviewBootstrap } from "./utils/shellPreview.ts";
import "./index.css";
import "./components/layout/BigPictureTransition.css";

const isSplashWindow = new URLSearchParams(window.location.search).get("window") === "splash";
const isShellPreview = isShellPreviewBootstrap(window.location.pathname, window.location.search, window.parent !== window);

installRuntimeDocumentClasses();
installGsapAnimations();
installModeTransition();
if (isShellPreview) document.documentElement.classList.add("aetherio-big-picture");

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (isSplashWindow) {
  root.render(<NativeSplashWindow />);
} else {
  if (!isShellPreview) installSpatialRemoteNavigation();
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {isShellPreview ? <ShellPreviewApp /> : <><App /><UpdatePopup /></>}
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

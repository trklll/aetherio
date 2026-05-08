import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

export async function toggleWindowFullscreen() {
  const win = getCurrentWindow();

  try {
    await invoke("toggle_window_fullscreen");
    return;
  } catch {
    // Fall back to the JS window API when the native command is unavailable.
  }

  try {
    await win.setFullscreen(!(await win.isFullscreen()));
  } catch {
    // Window controls are best-effort outside the desktop runtime.
  }
}

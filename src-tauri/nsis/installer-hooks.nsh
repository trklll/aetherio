; Aetherio - NSIS Installer Hooks
; Copyright (c) 2026 Trkll

; Pre-install hook: close Aetherio if running (important for updates)
!macro NSIS_HOOK_PREINSTALL
  ; Attempt to close any running Aetherio instance before install
  nsExec::ExecToLog 'taskkill /F /IM "aetherio.exe" /T'
  pop $0
  Sleep 500
!macroend

; Post-install hook: launch Aetherio after installation completes
!macro NSIS_HOOK_POSTINSTALL
  ; Launch the app asynchronously so the installer can finish immediately.
  ; nsExec::Exec* wait for the child process to exit, which would keep the
  ; installer alive until the app is closed. ExecShell returns right away.
  SetAutoClose false
  ExecShell "open" '"$INSTDIR\aetherio.exe"' "" SW_SHOWNORMAL
!macroend

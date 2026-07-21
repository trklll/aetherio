; Aetherio - NSIS Installer Hooks
; Copyright (c) 2026 Trkll

; Pre-install hook: close Aetherio if running (important for updates)
!macro NSIS_HOOK_PREINSTALL
  ; Attempt to close any running Aetherio instance before install
  nsExec::ExecToLog 'taskkill /F /IM "Aetherio.exe" /T'
  pop $0
  Sleep 500
!macroend

; Post-install hook: launch Aetherio after installation completes
!macro NSIS_HOOK_POSTINSTALL
  ; Unhide the main window first (NSIS may not show the app on top)
  SetAutoClose false
  nsExec::ExecToLog '"$INSTDIR\Aetherio.exe"'
  pop $0
!macroend

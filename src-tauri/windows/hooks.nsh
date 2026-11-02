; Transition from the Electron build of Orbi to this Tauri build (Windows, per-user).
; Electron installs to %LOCALAPPDATA%\Programs\Orbi with the uninstall key below. Its uninstaller removes
; the program and the "Orbi" shortcuts and keeps %APPDATA%\Orbi, which the app imports on first launch
; (src-tauri/src/legacy.rs). Electron's updater starts this installer with /UPDATE, and Tauri skips
; shortcuts and WebView2 in that mode, so both are handled here when an Electron install was replaced.
!ifndef ORBI_ELECTRON_KEY
  !define ORBI_ELECTRON_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.orbix.orbi"
!endif
!ifndef ORBI_ELECTRON_UNINSTALLER
  !define ORBI_ELECTRON_UNINSTALLER "Uninstall Orbi.exe"
!endif

Var OrbiFromElectron

!macro NSIS_HOOK_PREINSTALL
  StrCpy $OrbiFromElectron 0
  ReadRegStr $R9 HKCU "${ORBI_ELECTRON_KEY}" "InstallLocation"
  ${If} $R9 != ""
  ${AndIf} ${FileExists} "$R9\${ORBI_ELECTRON_UNINSTALLER}"
    StrCpy $OrbiFromElectron 1
    DetailPrint "Removing the previous Orbi (Electron) from $R9"
    ; _?= runs the uninstaller in place, so ExecWait really waits for it.
    ExecWait '"$R9\${ORBI_ELECTRON_UNINSTALLER}" /S _?=$R9' $R8
    DetailPrint "Previous Orbi uninstaller finished ($R8)"
    Delete "$R9\${ORBI_ELECTRON_UNINSTALLER}"
    RMDir "$R9"
    ; Electron never needed WebView2; install it if the machine lacks it.
    ReadRegStr $R7 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
    ${If} $R7 == ""
      ReadRegStr $R7 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
    ${EndIf}
    ${If} $R7 == ""
      DetailPrint "$(webview2Downloading)"
      NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
      Pop $R7
      ${If} $R7 == "success"
        ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe" /silent /install'
      ${Else}
        DetailPrint "$(webview2DownloadError)"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $OrbiFromElectron = 1
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend

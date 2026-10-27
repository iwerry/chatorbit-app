; Orbi installer for Windows (per-user, no admin rights needed).
Unicode true
SetCompressor /SOLID lzma
ManifestDPIAware true

!define APP_NAME "Orbi"
!define APP_ID "com.orbix.orbi"
!define COMPANY "Draft Creative Studio Ltda"
; Registry path stays the same so updates find the existing install.
!define REG_COMPANY "OrbiX"
!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME}"
OutFile "..\release\Orbi-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "Software\${REG_COMPANY}\${APP_NAME}" "InstallDir"
RequestExecutionLevel user
BrandingText "${COMPANY} · ${APP_NAME} ${VERSION}"

!ifndef NUMVER
  !define NUMVER "0.1.0.0"
!endif
VIProductVersion "${NUMVER}"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion" "${NUMVER}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© 2026 ${COMPANY} — Creative Design & Software Development"

!include "MUI2.nsh"
!include "FileFunc.nsh"

; Set when Orbi starts this installer to update itself (/UPDATE).
Var IsUpdate
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_NAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"

; Updates skip the questions and show only the progress bar, then reopen Orbi.
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipOnUpdate
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipOnUpdate
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_PAGE_HEADER_TEXT "Installing ${APP_NAME} ${VERSION}"
!define MUI_PAGE_HEADER_SUBTEXT "Orbi reopens by itself when this finishes. Please don't open it manually."
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipOnUpdate
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function SkipOnUpdate
  StrCmp $IsUpdate "1" 0 +2
    Abort
FunctionEnd

Function .onInit
  StrCpy $IsUpdate "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  IfErrors done_args
    StrCpy $IsUpdate "1"
    ; Older Orbi versions start updates with /S; show the progress window anyway.
    SetSilent normal
  done_args:
  StrCmp $IsUpdate "1" 0 +2
    Sleep 2500
  ; Close a running copy (and its helper processes) before upgrading.
  nsExec::Exec 'taskkill /IM "${APP_NAME}.exe" /F /T'
  Sleep 500
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources"
  File /r "..\release\win-unpacked\*"
  WriteUninstaller "$INSTDIR\Uninstall ${APP_NAME}.exe"

  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_NAME}.exe" "" "$INSTDIR\${APP_NAME}.exe" 0
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_NAME}.exe" "" "$INSTDIR\${APP_NAME}.exe" 0

  WriteRegStr HKCU "Software\${REG_COMPANY}\${APP_NAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_NAME}.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ; After an in-app update, open Orbi again and close this window.
  StrCmp $IsUpdate "1" 0 +3
    SetAutoClose true
    Exec '"$INSTDIR\${APP_NAME}.exe" --updated'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${APP_NAME}.exe" /F'
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${REG_COMPANY}\${APP_NAME}"
  ; Your chats and media in %APPDATA%\Orbi are kept on purpose.
SectionEnd

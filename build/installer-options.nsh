!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
  Var TermousOptionsDialog
  Var TermousDesktopShortcut
  Var TermousStartMenuShortcut
  Var TermousPathEntry
  Var TermousDesktopShortcutCheckbox
  Var TermousStartMenuShortcutCheckbox
  Var TermousPathEntryCheckbox
!endif

!macro termousBroadcastEnvironmentChange
  System::Call 'user32::SendMessageTimeout(i 0xffff, i ${WM_SETTINGCHANGE}, i 0, t "Environment", i 0, i 5000, *i .r0)'
!macroend

!macro termousAddInstallDirToUserPath
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$entry = '$INSTDIR'; $$path = [Environment]::GetEnvironmentVariable('Path', 'User'); $$items = @($$path -split ';' | Where-Object { $$_ }); if ($$items -notcontains $$entry) { [Environment]::SetEnvironmentVariable('Path', (($$items + $$entry) -join ';'), 'User') }"`
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Termous 已安装，但未能写入当前用户 PATH。你可以稍后手动添加：$INSTDIR"
  ${EndIf}
  !insertmacro termousBroadcastEnvironmentChange
!macroend

!macro termousRemoveInstallDirFromUserPath
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$entry = '$INSTDIR'; $$path = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($$null -ne $$path) { $$items = @($$path -split ';' | Where-Object { $$_ -and $$_ -ne $$entry }); [Environment]::SetEnvironmentVariable('Path', ($$items -join ';'), 'User') }"`
  Pop $0
  !insertmacro termousBroadcastEnvironmentChange
!macroend

!macro termousCreateStartMenuShortcut
  !insertmacro createMenuDirectory
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
!macroend

!macro termousCreateDesktopShortcut
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro termousRemoveShortcut LINKSHELL
  WinShell::UninstShortcut "${LINKSHELL}"
  Delete "${LINKSHELL}"
  ClearErrors
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customInit
    StrCpy $TermousDesktopShortcut ${BST_CHECKED}
    StrCpy $TermousStartMenuShortcut ${BST_CHECKED}
    StrCpy $TermousPathEntry ${BST_UNCHECKED}

    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousCreateDesktopShortcut"
    ${If} $0 == "0"
      StrCpy $TermousDesktopShortcut ${BST_UNCHECKED}
    ${ElseIf} $0 == "1"
      StrCpy $TermousDesktopShortcut ${BST_CHECKED}
    ${EndIf}

    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousCreateStartMenuShortcut"
    ${If} $0 == "0"
      StrCpy $TermousStartMenuShortcut ${BST_UNCHECKED}
    ${ElseIf} $0 == "1"
      StrCpy $TermousStartMenuShortcut ${BST_CHECKED}
    ${EndIf}

    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousAddToPath"
    ${If} $0 == "1"
      StrCpy $TermousPathEntry ${BST_CHECKED}
    ${ElseIf} $0 == "0"
      StrCpy $TermousPathEntry ${BST_UNCHECKED}
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom TermousOptionsPageCreate TermousOptionsPageLeave
  !macroend

  Function TermousOptionsPageCreate
    nsDialogs::Create 1018
    Pop $TermousOptionsDialog
    ${If} $TermousOptionsDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 18u "安装选项"
    Pop $0

    ${NSD_CreateCheckbox} 0 28u 100% 12u "创建桌面快捷方式"
    Pop $TermousDesktopShortcutCheckbox
    ${NSD_SetState} $TermousDesktopShortcutCheckbox $TermousDesktopShortcut

    ${NSD_CreateCheckbox} 0 48u 100% 12u "创建开始菜单快捷方式"
    Pop $TermousStartMenuShortcutCheckbox
    ${NSD_SetState} $TermousStartMenuShortcutCheckbox $TermousStartMenuShortcut

    ${NSD_CreateCheckbox} 0 68u 100% 12u "将 Termous 安装目录添加到当前用户 PATH"
    Pop $TermousPathEntryCheckbox
    ${NSD_SetState} $TermousPathEntryCheckbox $TermousPathEntry

    nsDialogs::Show
  FunctionEnd

  Function TermousOptionsPageLeave
    ${NSD_GetState} $TermousDesktopShortcutCheckbox $TermousDesktopShortcut
    ${NSD_GetState} $TermousStartMenuShortcutCheckbox $TermousStartMenuShortcut
    ${NSD_GetState} $TermousPathEntryCheckbox $TermousPathEntry
  FunctionEnd
  !macro customInstall
    ${If} $TermousDesktopShortcut == ${BST_CHECKED}
      !insertmacro termousCreateDesktopShortcut
      WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousCreateDesktopShortcut" "1"
    ${Else}
      WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousCreateDesktopShortcut" "0"
    ${EndIf}

    ${If} $TermousStartMenuShortcut == ${BST_CHECKED}
      !insertmacro termousCreateStartMenuShortcut
      WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousCreateStartMenuShortcut" "1"
    ${Else}
      WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousCreateStartMenuShortcut" "0"
    ${EndIf}

    ${If} $TermousPathEntry == ${BST_CHECKED}
      !insertmacro termousAddInstallDirToUserPath
      WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousAddToPath" "1"
    ${Else}
      !insertmacro termousRemoveInstallDirFromUserPath
      WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "TermousAddToPath" "0"
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  !insertmacro termousRemoveShortcut "$newDesktopLink"
  !insertmacro termousRemoveShortcut "$oldDesktopLink"
  !insertmacro termousRemoveShortcut "$newStartMenuLink"
  !insertmacro termousRemoveShortcut "$oldStartMenuLink"
  !ifdef MENU_FILENAME
    RMDir "$SMPROGRAMS\${MENU_FILENAME}"
  !endif
  !insertmacro termousRemoveInstallDirFromUserPath
!macroend

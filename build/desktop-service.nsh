!ifndef TERMOUS_DESKTOP_SERVICE_INCLUDED
!define TERMOUS_DESKTOP_SERVICE_INCLUDED
!include /CHARSET=UTF8 "${BUILD_RESOURCES_DIR}\installer-feedback.nsh"

!ifndef BUILD_UNINSTALLER
  Var TermousDesktopPrepared
  Var TermousPreviousDirectory
  Var TermousSelectedDirectory
!endif

!macro termousDesktopMaintenanceGate
  !if "${APP_ID}" == "com.termous.app"
    !ifmacrodef termousRuntimeGate
      !insertmacro termousRuntimeGate
    !else
      StrCpy $TermousCommandError "缺少运行时维护组件。"
      !insertmacro termousInstallerFail "安装包缺少必要组件。"
    !endif
  !endif
!macroend

; 维护命令来自安装包自身，不能先执行所选目录中的可替换程序。
!macro termousDesktopHelper
  !if "${APP_ID}" == "com.termous.app"
    SetDetailsPrint none
    InitPluginsDir
    !ifndef TERMOUS_SERVICE_PAYLOAD
      !define TERMOUS_SERVICE_PAYLOAD "${BUILD_RESOURCES_DIR}\core"
    !endif
    CreateDirectory "$PLUGINSDIR\termous-service"
    IfFileExists "$PLUGINSDIR\termous-service\termous-desktopd.exe" +2 0
    File /oname=$PLUGINSDIR\termous-service\termous-desktopd.exe "${TERMOUS_SERVICE_PAYLOAD}\termous-desktopd.exe"
    !ifndef BUILD_UNINSTALLER
      IfFileExists "$PLUGINSDIR\termous-service\termous-desktop.exe" +2 0
      File /oname=$PLUGINSDIR\termous-service\termous-desktop.exe "${TERMOUS_SERVICE_PAYLOAD}\termous-desktop.exe"
      IfFileExists "$PLUGINSDIR\termous-service\desktop-bundle.json" +2 0
      File /oname=$PLUGINSDIR\termous-service\desktop-bundle.json "${TERMOUS_SERVICE_PAYLOAD}\desktop-bundle.json"
    !endif
  !endif
!macroend

!macro termousDesktopCommand ACTION
  !if "${APP_ID}" == "com.termous.app"
    !if "${ACTION}" == "prepare-install-dir"
      !insertmacro termousInstallerStage "正在准备安装…"
    !else if "${ACTION}" == "prepare-update"
      !insertmacro termousInstallerStage "正在准备安装…"
    !else if "${ACTION}" == "begin-update"
      !insertmacro termousInstallerStage "正在准备安装…"
    !else if "${ACTION}" == "verify-install-dir"
      !insertmacro termousInstallerStage "正在配置运行环境…"
    !else if "${ACTION}" == "install"
      !insertmacro termousInstallerStage "正在配置桌面服务…"
    !else if "${ACTION}" == "uninstall"
      !insertmacro termousInstallerStage "正在准备卸载…"
    !else
      !ifdef BUILD_UNINSTALLER
        !insertmacro termousInstallerStage "正在清理安装信息…"
      !else
        !insertmacro termousInstallerStage "正在完成安装…"
      !endif
    !endif
    !insertmacro termousDesktopMaintenanceGate
    !insertmacro termousDesktopHelper
    !ifndef BUILD_UNINSTALLER
      !if "${ACTION}" == "prepare-update"
        !insertmacro termousInstallerExec "$PLUGINSDIR\termous-service\termous-desktopd.exe" '${ACTION} --directory "$INSTDIR" --payload-directory "$PLUGINSDIR\termous-service" --wait 30s'
      !else
        !insertmacro termousInstallerExec "$PLUGINSDIR\termous-service\termous-desktopd.exe" '${ACTION} --directory "$INSTDIR" --wait 30s'
      !endif
    !else
      !insertmacro termousInstallerExec "$PLUGINSDIR\termous-service\termous-desktopd.exe" '${ACTION} --directory "$INSTDIR" --wait 30s'
    !endif
    ${If} $TermousCommandCode != 0
      !if "${ACTION}" == "prepare-install-dir"
        !insertmacro termousInstallerFail "所选目录暂时无法用于安装。"
      !else if "${ACTION}" == "verify-install-dir"
        !insertmacro termousInstallerFail "应用文件检查未通过。"
      !else if "${ACTION}" == "install"
        !insertmacro termousInstallerFail "桌面服务配置失败。"
      !else
        !ifdef BUILD_UNINSTALLER
          !insertmacro termousInstallerFail "未能完成卸载配置。"
        !else
          !insertmacro termousInstallerFail "未能完成安装配置。"
        !endif
      !endif
    ${EndIf}
  !endif
!macroend

!macro termousDesktopMigrationCheck
  !if "${APP_ID}" == "com.termous.app"
    !insertmacro termousInstallerStage "正在准备安装…"
    !insertmacro termousDesktopHelper
    !insertmacro termousInstallerExec "$PLUGINSDIR\termous-service\termous-desktopd.exe" 'discover --output "$PLUGINSDIR\termous-installation.ini"'
    ${If} $TermousCommandCode != 0
      !insertmacro termousInstallerFail "无法读取现有安装信息。"
    ${EndIf}
    !insertmacro GetDParameter $R0
    ReadINIStr $TermousPreviousDirectory "$PLUGINSDIR\termous-installation.ini" "installation" "directory"
    ${If} $R0 == ""
      ReadINIStr $0 "$PLUGINSDIR\termous-installation.ini" "installation" "target"
      ${If} $0 != ""
        StrCpy $INSTDIR $0
      ${EndIf}
    ${EndIf}
    ReadINIStr $0 "$PLUGINSDIR\termous-installation.ini" "installation" "path"
    ${If} $0 == "1"
      StrCpy $TermousPathEntry ${BST_CHECKED}
    ${ElseIf} $0 == "0"
      StrCpy $TermousPathEntry ${BST_UNCHECKED}
    ${EndIf}
    ReadINIStr $0 "$PLUGINSDIR\termous-installation.ini" "installation" "desktop"
    ${If} $0 == "0"
      StrCpy $TermousDesktopShortcut ${BST_UNCHECKED}
    ${ElseIf} $0 == "1"
      StrCpy $TermousDesktopShortcut ${BST_CHECKED}
    ${EndIf}
  !endif
!macroend

!macro termousDesktopHeader
  !ifndef BUILD_UNINSTALLER
    Section "-Termous desktop service preflight"
      ; 先验证目录；用户确认关闭应用后才停止服务，取消提示不会留下维护状态。
      !insertmacro termousDesktopCommand "prepare-install-dir"
    SectionEnd
    !if "${APP_ID}" == "com.termous.app"
      Function TermousRestoreService
        ${If} $TermousSelectedDirectory != ""
          StrCpy $INSTDIR $TermousSelectedDirectory
        ${EndIf}
        ${If} $TermousDesktopPrepared == "1"
          StrCpy $TermousDesktopPrepared ""
          !insertmacro termousDesktopMaintenanceGate
          !insertmacro termousDesktopHelper
          ; 仅恢复本次已进入的维护；旧登记不匹配或已有修复标记时不启动服务。
          !insertmacro termousInstallerExec "$PLUGINSDIR\termous-service\termous-desktopd.exe" 'resume --directory "$INSTDIR" --wait 15s'
          ${If} $TermousCommandCode != 0
            !insertmacro termousInstallerLog "[恢复] 未完成；请重新运行同一完整安装包修复。"
            SetDetailsPrint listonly
            DetailPrint "桌面服务未恢复。请重新运行同一完整安装包修复。"
            SetDetailsPrint none
          ${EndIf}
        ${EndIf}
      FunctionEnd
      Function .onInstFailed
        Call TermousRestoreService
        ; 恢复结果仅追加日志，界面继续显示最初失败的步骤。
        !insertmacro termousInstallerFailureState
      FunctionEnd
      Function .onGUIEnd
        Call TermousRestoreService
      FunctionEnd
    !endif
  !endif
!macroend

!macro termousDesktopSelectPreviousApplication
  !if "${APP_ID}" == "com.termous.app"
    ${If} $TermousPreviousDirectory != ""
    ${AndIf} $TermousPreviousDirectory != $INSTDIR
      StrCpy $TermousSelectedDirectory $INSTDIR
      StrCpy $INSTDIR $TermousPreviousDirectory
    ${EndIf}
  !endif
!macroend

!macro termousDesktopPrepareUpdate
  StrCpy $TermousDesktopPrepared "1"
  !insertmacro termousDesktopCommand "prepare-update"
  !insertmacro termousDesktopCommand "begin-update"
!macroend

!macro termousDesktopBeforeUninstall
  ${If} ${isUpdated}
    !insertmacro termousDesktopCommand "prepare-update"
  ${Else}
    !insertmacro termousDesktopCommand "uninstall"
  ${EndIf}
!macroend

!endif

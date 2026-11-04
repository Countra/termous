!ifndef TERMOUS_DESKTOP_SERVICE_INCLUDED
!define TERMOUS_DESKTOP_SERVICE_INCLUDED

!ifndef BUILD_UNINSTALLER
  Var TermousDesktopPrepared
!endif

!macro termousDesktopMaintenanceGate
  !if "${APP_ID}" == "com.termous.app"
    !ifmacrodef termousRuntimeGate
      !insertmacro termousRuntimeGate
    !else
      Abort "安装包缺少机器级维护协调组件，请使用完整安装包。"
    !endif
  !endif
!macroend

; 维护命令来自安装包自身，不能先执行所选目录中的可替换程序。
!macro termousDesktopHelper
  !if "${APP_ID}" == "com.termous.app"
    InitPluginsDir
    !ifndef TERMOUS_DESKTOPD_PAYLOAD
      !define TERMOUS_DESKTOPD_PAYLOAD "${BUILD_RESOURCES_DIR}\core\termous-desktopd.exe"
    !endif
    File /oname=$PLUGINSDIR\termous-desktopd-installer.exe "${TERMOUS_DESKTOPD_PAYLOAD}"
  !endif
!macroend

!macro termousDesktopCommand ACTION
  !if "${APP_ID}" == "com.termous.app"
    !insertmacro termousDesktopMaintenanceGate
    !insertmacro termousDesktopHelper
    nsExec::ExecToLog '"$PLUGINSDIR\termous-desktopd-installer.exe" ${ACTION} --directory "$INSTDIR" --wait 30s'
    Pop $0
    ${If} $0 != 0
      Abort "桌面服务维护失败（${ACTION}）。请检查安装日志；不要手动混用新旧版本文件。"
    ${EndIf}
  !endif
!macroend

!macro termousDesktopMigrationCheck
  !if "${APP_ID}" == "com.termous.app"
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != ""
      MessageBox MB_ICONSTOP "此版本使用机器级桌面管理服务。请先卸载原按用户安装的 Termous，保留用户数据，然后重新安装。" /SD IDOK
      Quit
    ${EndIf}
  !endif
!macroend

!macro termousDesktopHeader
  !ifndef BUILD_UNINSTALLER
    Section "-Termous desktop service preflight"
      ; 在旧版本卸载和文件提取之前检查目录、其他已登录用户的旧安装与服务状态。
      !insertmacro termousDesktopCommand "prepare-install-dir"
      !insertmacro termousDesktopCommand "prepare-update"
      StrCpy $TermousDesktopPrepared "1"
    SectionEnd
    !if "${APP_ID}" == "com.termous.app"
      Function .onInstFailed
        ${If} $TermousDesktopPrepared == "1"
          !insertmacro termousDesktopMaintenanceGate
          !insertmacro termousDesktopHelper
          ; 仅恢复本次已进入的维护；旧登记不匹配或已有修复标记时不启动服务。
          nsExec::ExecToLog '"$PLUGINSDIR\termous-desktopd-installer.exe" resume --wait 15s'
          Pop $0
          ${If} $0 != 0
            DetailPrint "桌面服务未恢复。请重新运行同一完整安装包修复。"
          ${EndIf}
        ${EndIf}
      FunctionEnd
    !endif
  !endif
!macroend

!macro termousDesktopBeforeUninstall
  ${If} ${isUpdated}
    !insertmacro termousDesktopCommand "prepare-update"
  ${Else}
    !insertmacro termousDesktopCommand "uninstall"
  ${EndIf}
!macroend

!endif

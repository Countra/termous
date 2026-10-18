!ifndef TERMOUS_INSTALL_DISCOVERY_INCLUDED
!define TERMOUS_INSTALL_DISCOVERY_INCLUDED

!define TERMOUS_INSTALL_DISCOVERY_KEY "Software\Termous\Install"

!macro termousWriteInstallDiscovery
  ; 固定发现入口仅属于正式应用，不能由其他 appId 的验证安装包覆盖。
  !if "${APP_ID}" == "dev.termous.app"
    ; 先将记录标记为无效；失败则停止改写，不能留下仍被认可的部分记录。
    ClearErrors
    WriteRegDWORD SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "SchemaVersion" 0
    ${IfNot} ${Errors}
      WriteRegStr SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "AppId" "${APP_ID}"
      WriteRegStr SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "DisplayName" "${PRODUCT_NAME}"
      WriteRegStr SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "DisplayVersion" "${VERSION}"
      WriteRegStr SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "InstallLocation" "$INSTDIR"
      WriteRegStr SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "ExecutablePath" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${IfNot} ${Errors}
        WriteRegDWORD SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "SchemaVersion" 1
      ${EndIf}
    ${EndIf}
    ${If} ${Errors}
      DetailPrint "Termous 安装信息写入失败，外部工具可能无法自动定位应用。"
      MessageBox MB_ICONEXCLAMATION "Termous 已安装，但未能登记安装信息。外部工具可能无法自动定位应用，可重新运行安装包修复。" /SD IDOK
    ${EndIf}
    ClearErrors
  !endif
!macroend

!macro termousRemoveInstallDiscovery
  !if "${APP_ID}" == "dev.termous.app"
    ; 升级也清理旧范围，避免切换 HKCU/HKLM 后残留可被优先读取的旧版本。
    ; 只删除本安装目录拥有的子项，保留父项及其他自定义数据。
    Push $0
    Push $1
    ReadRegStr $0 SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "AppId"
    ReadRegStr $1 SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}" "InstallLocation"
    ${If} $0 == "${APP_ID}"
    ${AndIf} $1 == "$INSTDIR"
      ClearErrors
      DeleteRegKey SHELL_CONTEXT "${TERMOUS_INSTALL_DISCOVERY_KEY}"
      ${If} ${Errors}
        DetailPrint "未能清理 Termous 安装信息，外部工具应检查程序文件是否仍然存在。"
      ${EndIf}
    ${EndIf}
    Pop $1
    Pop $0
    ClearErrors
  !endif
!macroend

!endif

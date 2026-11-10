!ifndef TERMOUS_INSTALLER_FEEDBACK_INCLUDED
!define TERMOUS_INSTALLER_FEEDBACK_INCLUDED
!include "LogicLib.nsh"
!include "WinMessages.nsh"

Var TermousInstallerLog
Var TermousInstallerLogAvailable
Var TermousInstallerLogHint
Var TermousInstallerStage
Var TermousInstallerFailure
Var TermousCommandCode
Var TermousCommandOutput
Var TermousCommandError

; 仅修改原生进度页的失败文案，不调整布局、字体或进度计算。
!macro termousInstallerProgressPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW TermousInstallerProgressShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE TermousInstallerProgressLeave
  !define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "安装未完成"
  !define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "请查看错误说明，处理后重新运行安装包。"
!macroend

!macro termousInstallerFailureState
  SetDetailsPrint textonly
  !ifdef BUILD_UNINSTALLER
    DetailPrint "卸载未完成"
  !else
    DetailPrint "安装未完成"
  !endif
  SetDetailsPrint none
!macroend

!ifndef BUILD_UNINSTALLER
Function TermousInstallerProgressShow
  ; 初始化阶段也会在进度页创建前记录，首次进入页面仍须展示当前阶段。
  StrCpy $TermousInstallerStage ""
FunctionEnd

Function TermousInstallerProgressLeave
  ${If} ${Abort}
    !insertmacro termousInstallerFailureState
    ; 失败后只剩退出操作，避免继续使用“取消”暗示安装仍在运行。
    Push $0
    GetDlgItem $0 $HWNDPARENT 2
    SendMessage $0 ${WM_SETTEXT} 0 "STR:关闭"
    Pop $0
  ${EndIf}
FunctionEnd
!endif

!macro termousInstallerLog TEXT
  Push $0
  Push $1
  ; 先保存调用方文本，避免其中的寄存器参数被文件句柄覆盖。
  StrCpy $1 `${TEXT}`
  ClearErrors
  ${If} $TermousInstallerLog == ""
    System::Call 'ole32::CoCreateGuid(g .r0)'
    StrCpy $TermousInstallerLog "$TEMP\Termous-setup-$0.log"
    FileOpen $0 "$TermousInstallerLog" w
    ${IfNot} ${Errors}
      FileWriteUTF16LE /BOM $0 "Termous 安装维护日志$\r$\n"
      !ifdef VERSION
        FileWriteUTF16LE $0 "安装包版本：${VERSION}$\r$\n"
      !endif
      FileClose $0
    ${EndIf}
  ${EndIf}
  ClearErrors
  StrCpy $TermousInstallerLogAvailable ""
  FileOpen $0 "$TermousInstallerLog" a
  ${IfNot} ${Errors}
    FileSeek $0 0 END
    FileWriteUTF16LE $0 "$1$\r$\n"
    ${IfNot} ${Errors}
      StrCpy $TermousInstallerLogAvailable "1"
    ${EndIf}
    FileClose $0
  ${EndIf}
  ; 日志失败不能替换业务返回值，也不能污染后续文件操作的错误标记。
  ClearErrors
  Pop $1
  Pop $0
!macroend

!macro termousInstallerStage TEXT
  !insertmacro termousInstallerLog "[阶段] ${TEXT}"
  ${If} $TermousInstallerFailure == ""
    ${If} $TermousInstallerStage != "${TEXT}"
      SetDetailsPrint listonly
      DetailPrint "${TEXT}"
    ${EndIf}
    SetDetailsPrint textonly
    DetailPrint "${TEXT}"
    StrCpy $TermousInstallerStage "${TEXT}"
  ${EndIf}
  ; 底层文件操作不再覆盖阶段提示；命令结果由独立日志记录。
  SetDetailsPrint none
!macroend

; 命令返回码与错误使用专用变量，清理命令不会覆盖调用方保存的结果。
!macro termousInstallerExec EXECUTABLE ARGUMENTS
  Push $0
  Push $1
  StrCpy $TermousCommandError ""
  !insertmacro termousInstallerLog `[命令] ${ARGUMENTS}`
  ClearErrors
  Delete "${EXECUTABLE}.installer-error.txt"
  ${If} ${Errors}
    StrCpy $TermousCommandCode "error"
    StrCpy $TermousCommandError "无法清理上一条维护命令的诊断文件。"
    StrCpy $TermousCommandOutput ""
  ${Else}
    System::Call 'kernel32::SetEnvironmentVariable(w "TERMOUS_INSTALLER_REPORT_ERROR", w "1")'
    nsExec::ExecToStack '"${EXECUTABLE}" ${ARGUMENTS}'
    Pop $TermousCommandCode
    Pop $TermousCommandOutput
    System::Call 'kernel32::SetEnvironmentVariable(w "TERMOUS_INSTALLER_REPORT_ERROR", p 0)'
  ${EndIf}
  !insertmacro termousInstallerLog "[退出码] $TermousCommandCode"
  ${If} $TermousCommandOutput != ""
    !insertmacro termousInstallerLog "[控制台摘要] $TermousCommandOutput"
  ${EndIf}
  ; UTF-16 错误旁路保留中文路径和完整错误；控制台只保留 nsExec 的有界摘要。
  ClearErrors
  FileOpen $0 "${EXECUTABLE}.installer-error.txt" r
  ${IfNot} ${Errors}
    FileSeek $0 2 SET
    ${Do}
      ClearErrors
      FileReadUTF16LE $0 $1
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
      !insertmacro termousInstallerLog "$1"
      StrCpy $TermousCommandError "$TermousCommandError$1" 640
    ${Loop}
    FileClose $0
  ${EndIf}
  ${If} $TermousCommandCode != 0
  ${AndIf} $TermousCommandError == ""
    StrCpy $TermousCommandError $TermousCommandOutput 640
    ${If} $TermousCommandError == ""
      StrCpy $TermousCommandError "维护程序未返回错误详情（$TermousCommandCode）。"
    ${EndIf}
  ${EndIf}
  ClearErrors
  Pop $1
  Pop $0
!macroend

!macro termousInstallerFail MESSAGE
  StrCpy $TermousInstallerFailure "${MESSAGE}"
  !insertmacro termousInstallerLog "[失败] $TermousInstallerStage：${MESSAGE}"
  !insertmacro termousInstallerLog "$TermousCommandError"
  ${If} $TermousInstallerLogAvailable == "1"
    StrCpy $TermousInstallerLogHint "安装日志：$\r$\n$TermousInstallerLog"
  ${Else}
    StrCpy $TermousInstallerLogHint "未能保存安装日志，请保留此错误提示。"
  ${EndIf}
  SetDetailsPrint listonly
  DetailPrint "${MESSAGE}"
  ${If} $TermousInstallerLogAvailable == "1"
    DetailPrint "完整错误信息已保存到安装日志。"
    DetailPrint "$TermousInstallerLog"
  ${Else}
    DetailPrint "未能保存安装日志，请保留错误详情。"
  ${EndIf}
  SetDetailsPrint none
  !insertmacro termousInstallerFailureState
  SetErrorLevel 2
  ${IfNot} ${Silent}
    Push $0
    ${If} $TermousInstallerLogAvailable == "1"
      StrCpy $0 "$TermousInstallerLogHint"
    ${Else}
      ; 日志不可写时保留有界错误摘要；不让长命令输出撑满原生弹窗。
      StrLen $0 $TermousCommandError
      ${If} $0 > 200
        StrCpy $0 $TermousCommandError 200
        StrCpy $0 "$0…"
      ${Else}
        StrCpy $0 $TermousCommandError
      ${EndIf}
      StrCpy $0 "$TermousInstallerLogHint$\r$\n$\r$\n错误摘要：$\r$\n$0"
    ${EndIf}
    !ifdef BUILD_UNINSTALLER
      MessageBox MB_OK|MB_ICONSTOP "卸载未完成$\r$\n$\r$\n${MESSAGE}$\r$\n请关闭 Termous 后重新卸载。$\r$\n$\r$\n$0"
    !else
      MessageBox MB_OK|MB_ICONSTOP "安装未完成$\r$\n$\r$\n${MESSAGE}$\r$\n请重新运行完整安装包重试。$\r$\n$\r$\n$0"
    !endif
    Pop $0
  ${EndIf}
  Abort
!macroend

!endif

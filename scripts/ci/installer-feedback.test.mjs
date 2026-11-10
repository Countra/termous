import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const feedback = fileURLToPath(new URL('../../build/installer-feedback.nsh', import.meta.url))
const compiler = process.env.TERMOUS_TEST_MAKENSIS ?? path.join(
  process.env.LOCALAPPDATA ?? '', 'electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe',
)
const available = process.platform === 'win32' && existsSync(compiler)
const runtimeTemplate = fileURLToPath(new URL('../../../termous-buildtools/src/termous_build/templates/runtime.nsh', import.meta.url))

function compile(directory, name, body) {
  const file = path.join(directory, `${name}.nsi`)
  const executable = path.join(directory, `${name}.exe`)
  writeFileSync(file, `Unicode true
RequestExecutionLevel user
Name "Termous installer feedback fixture"
OutFile "${executable}"
AutoCloseWindow true
!include "LogicLib.nsh"
!include "FileFunc.nsh"
${body}`, 'utf8')
  execFileSync(compiler, ['/V2', '/INPUTCHARSET', 'UTF8', file], { windowsHide: true, timeout: 30000 })
  return executable
}

// 夹具只写临时文件，不包含正式安装宏、注册表、服务、ACL、提权或应用启动。
test('NSIS 实际执行保留阶段文案、中文错误、完整日志及首次失败', { skip: !available, timeout: 90000 }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'termous-feedback-'))
  try {
    const helper = compile(directory, 'helper', `
SilentInstall silent
Section
  \${GetParameters} $0
  \${If} $0 == "fail"
    FileOpen $0 "$EXEPATH.installer-error.txt" w
    FileWriteUTF16LE /BOM $0 "拒绝访问：中文 空格路径$\\r$\\n"
    StrCpy $1 0
    \${While} $1 < 600
      FileWriteUTF16LE $0 "诊断记录 $1：保留完整错误详情$\\r$\\n"
      IntOp $1 $1 + 1
    \${EndWhile}
    FileClose $0
    SetErrorLevel 7
  \${EndIf}
SectionEnd`)
    const trace = path.join(directory, 'trace.txt')
    const executable = compile(directory, 'feedback', `
!include /CHARSET=UTF8 "${feedback}"
Page instfiles
Function .onInstFailed
  !insertmacro termousInstallerExec "${helper}" "success"
  FileOpen $0 "${trace}" a
  FileSeek $0 0 END
  FileWriteUTF16LE $0 "$TermousInstallerFailure$\\r$\\n$TermousInstallerLogHint$\\r$\\n"
  FileClose $0
FunctionEnd
Section
  \${GetParameters} $R0
  \${GetOptions} $R0 "/nolog" $R1
  \${IfNot} \${Errors}
    StrCpy $TermousInstallerLog "${directory}"
  \${EndIf}
  StrCpy $0 "调用方参数 0"
  StrCpy $1 "调用方参数 1"
  !insertmacro termousInstallerLog "[参数初次] $0 / $1"
  !insertmacro termousInstallerLog "[参数再次] $0 / $1"
  !insertmacro termousInstallerStage "正在配置运行环境…"
  SetDetailsPrint textonly
  DetailPrint "临时目录操作"
  !insertmacro termousInstallerStage "正在配置运行环境…"
  CreateDirectory "${directory}\\普通文件夹"
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $0 $0 1006
  System::Call 'user32::GetWindowTextW(p r0, w .r1, i \${NSIS_MAX_STRLEN})'
  FileOpen $0 "${trace}" w
  FileWriteUTF16LE /BOM $0 "$1$\\r$\\n"
  FileClose $0
  !insertmacro termousInstallerExec "${helper}" "fail"
  FileOpen $0 "${trace}" a
  FileSeek $0 0 END
  FileWriteUTF16LE $0 "$TermousCommandCode$\\r$\\n$TermousCommandError$\\r$\\n"
  FileClose $0
  !insertmacro termousInstallerExec "${helper}" "success"
  FileOpen $0 "${trace}" a
  FileSeek $0 0 END
  FileWriteUTF16LE $0 "success=$TermousCommandCode,error=$TermousCommandError$\\r$\\n"
  FileClose $0
  !insertmacro termousInstallerExec "${directory}\\missing.exe" ""
  FileOpen $0 "${trace}" a
  FileSeek $0 0 END
  FileWriteUTF16LE $0 "missing=$TermousCommandCode$\\r$\\n"
  FileClose $0
  \${If} \${Silent}
    !insertmacro termousInstallerFail "原始失败步骤"
  \${EndIf}
SectionEnd`)
    const options = { windowsHide: true, timeout: 30000, env: { ...process.env, TEMP: directory, TMP: directory } }
    // 交互夹具自动进入唯一进度页并退出，用真实控件检查低层操作不会覆盖阶段文案。
    const normal = spawnSync(executable, [], options)
    assert.equal(normal.error, undefined)
    assert.equal(normal.status, 0)
    const content = readFileSync(trace, 'utf16le')
    assert.match(content, /正在配置运行环境…/)
    assert.doesNotMatch(content, /临时目录操作/)
    assert.match(content, /7\r\n拒绝访问：中文 空格路径/)
    assert.match(content, /success=0,error=\r\n/)
    assert.match(content, /missing=error/)
    const silent = spawnSync(executable, ['/S'], options)
    assert.equal(silent.error, undefined)
    assert.equal(silent.status, 2)
    assert.match(readFileSync(trace, 'utf16le'), /原始失败步骤\r\n安装日志：/)
    const unavailableLog = spawnSync(executable, ['/S', '/nolog'], options)
    assert.equal(unavailableLog.error, undefined)
    assert.equal(unavailableLog.status, 2)
    assert.match(readFileSync(trace, 'utf16le'), /原始失败步骤\r\n未能保存安装日志/)
    const logs = readdirSync(directory).filter(name => name.startsWith('Termous-setup-') && name.endsWith('.log'))
    assert.equal(logs.length, 2)
    for (const name of logs) {
      const log = readFileSync(path.join(directory, name), 'utf16le')
      assert.match(log, /诊断记录 599：保留完整错误详情/)
      assert.match(log, /\[退出码\] 7/)
      assert.match(log, /\[参数初次\] 调用方参数 0 \/ 调用方参数 1/)
      assert.match(log, /\[参数再次\] 调用方参数 0 \/ 调用方参数 1/)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('安装发现结果完整覆盖旧选项，缺失字段保留当前选择', { skip: !available, timeout: 60000 }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'termous-discovery-options-'))
  try {
    const source = readFileSync(new URL('../../build/desktop-service.nsh', import.meta.url), 'utf8')
    const migration = source.match(/!macro termousDesktopMigrationCheck\r?\n[\s\S]*?!macroend/)
    assert.ok(migration)
    const trace = path.join(directory, 'options.txt')
    // 发现助手由合成 INI 替代，只执行生产选项映射宏，不读取真实登记或部署服务。
    const executable = compile(directory, 'discovery', `
!include "nsDialogs.nsh"
!define APP_ID "com.termous.app"
Var TermousPathEntry
Var TermousDesktopShortcut
Var TermousPreviousDirectory
Var TermousCommandCode
!macro termousInstallerStage TEXT
!macroend
!macro termousInstallerFail MESSAGE
  Abort
!macroend
!macro termousDesktopHelper
!macroend
!macro termousInstallerExec HELPER ARGUMENTS
  StrCpy $TermousCommandCode 0
!macroend
!macro GetDParameter TARGET
  StrCpy \${TARGET} ""
!macroend
${migration[0]}
Section
  InitPluginsDir
  StrCpy $TermousPathEntry \${BST_CHECKED}
  StrCpy $TermousDesktopShortcut \${BST_UNCHECKED}
  WriteINIStr "$PLUGINSDIR\\termous-installation.ini" "installation" "path" "0"
  WriteINIStr "$PLUGINSDIR\\termous-installation.ini" "installation" "desktop" "1"
  !insertmacro termousDesktopMigrationCheck
  FileOpen $0 "${trace}" w
  FileWriteUTF16LE /BOM $0 "$TermousPathEntry,$TermousDesktopShortcut$\\r$\\n"
  FileClose $0
  WriteINIStr "$PLUGINSDIR\\termous-installation.ini" "installation" "path" "1"
  WriteINIStr "$PLUGINSDIR\\termous-installation.ini" "installation" "desktop" "0"
  !insertmacro termousDesktopMigrationCheck
  FileOpen $0 "${trace}" a
  FileSeek $0 0 END
  FileWriteUTF16LE $0 "$TermousPathEntry,$TermousDesktopShortcut$\\r$\\n"
  FileClose $0
  DeleteINIStr "$PLUGINSDIR\\termous-installation.ini" "installation" "path"
  DeleteINIStr "$PLUGINSDIR\\termous-installation.ini" "installation" "desktop"
  !insertmacro termousDesktopMigrationCheck
  FileOpen $0 "${trace}" a
  FileSeek $0 0 END
  FileWriteUTF16LE $0 "$TermousPathEntry,$TermousDesktopShortcut$\\r$\\n"
  FileClose $0
SectionEnd`)
    const result = spawnSync(executable, ['/S'], {
      windowsHide: true, timeout: 30000, env: { ...process.env, TEMP: directory, TMP: directory },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0)
    assert.equal(readFileSync(trace, 'utf16le').replace(/^\uFEFF/, ''), '0,1\r\n1,0\r\n1,0\r\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('运行组件安装失败不会被成功的临时目录清理覆盖', { skip: !available || !existsSync(runtimeTemplate), timeout: 60000 }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'termous-runtime-feedback-'))
  try {
    const helper = compile(directory, 'maintenance-helper', `
SilentInstall silent
Section
  \${GetParameters} $0
  StrCpy $1 $0 11
  \${If} $1 == "install-cpu"
    FileOpen $0 "$EXEPATH.installer-error.txt" w
    FileWriteUTF16LE /BOM $0 "合成组件安装失败$\\r$\\n"
    FileClose $0
    SetErrorLevel 8
  \${Else}
    StrCpy $1 $0 12
    \${If} $1 == "validate-gpu"
      SetErrorLevel 1
    \${EndIf}
  \${EndIf}
SectionEnd`)
    const source = readFileSync(runtimeTemplate, 'utf8')
    const install = source.match(/!macro termousRuntimeInstall\r?\n[\s\S]*?!macroend/)
    assert.ok(install)
    const trace = path.join(directory, 'result.txt')
    // 只替换载荷及临时租约准备，实际 CPU 安装与清理的控制流直接使用生产宏。
    const executable = compile(directory, 'runtime', `
!include /CHARSET=UTF8 "${feedback}"
Var TermousRuntimeTemp
Var TermousRuntimeLease
Var TermousRuntimeInstallCode
Var TermousRuntimeInstallError
!macro termousRuntimeHelper
  InitPluginsDir
  File /oname=$PLUGINSDIR\\termous-maintenance-installer.exe "${helper}"
!macroend
!macro termousRuntimeCreateWorkspace
  StrCpy $TermousRuntimeTemp "$PLUGINSDIR\\cpu"
  CreateDirectory "$TermousRuntimeTemp"
  StrCpy $TermousRuntimeLease 0
!macroend
${install[0].replace('@CPU_WHEELS@', '')}
Function .onInstFailed
  FileOpen $0 "${trace}" w
  FileWriteUTF16LE /BOM $0 "$TermousRuntimeInstallCode$\\r$\\n$TermousCommandCode$\\r$\\n$TermousCommandError"
  FileClose $0
FunctionEnd
Section
  StrCpy $INSTDIR "${directory}\\application"
  !insertmacro termousRuntimeInstall
SectionEnd`)
    const result = spawnSync(executable, ['/S'], {
      windowsHide: true, timeout: 30000, env: { ...process.env, TEMP: directory, TMP: directory },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2)
    assert.match(readFileSync(trace, 'utf16le'), /8\r\n0\r\n合成组件安装失败/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

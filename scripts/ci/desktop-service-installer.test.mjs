import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function macro(text, name) {
  const match = text.match(new RegExp(`!macro ${name}(?:[^\\n]*)\\n([\\s\\S]*?)!macroend`))
  assert.ok(match, `缺少安装宏 ${name}`)
  return match[1]
}

test('服务维护先取得现有机器级锁，静默卸载也不能跳过', async () => {
  const service = await readFile(new URL('../../build/desktop-service.nsh', import.meta.url), 'utf8')
  const installer = await readFile(new URL('../../build/installer-options.nsh', import.meta.url), 'utf8')
  const header = macro(installer, 'customHeader')
  assert.ok(header.indexOf('termousRuntimeHeader') < header.indexOf('termousDesktopHeader'))
  const command = macro(service, 'termousDesktopCommand')
  assert.ok(command.indexOf('termousDesktopMaintenanceGate') < command.indexOf('nsExec::'))
  assert.match(macro(service, 'termousDesktopMaintenanceGate'), /!insertmacro termousRuntimeGate/)
  assert.match(macro(service, 'termousDesktopBeforeUninstall'), /termousDesktopCommand "uninstall"/)
})

test('只有成功进入维护的安装器才恢复服务', async () => {
  const service = await readFile(new URL('../../build/desktop-service.nsh', import.meta.url), 'utf8')
  const header = macro(service, 'termousDesktopHeader')
  assert.ok(header.indexOf('termousDesktopCommand "prepare-update"') < header.indexOf('StrCpy $TermousDesktopPrepared "1"'))
  const failure = header.slice(header.indexOf('Function .onInstFailed'))
  assert.ok(failure.indexOf('${If} $TermousDesktopPrepared == "1"') < failure.indexOf(' resume --wait'))
})

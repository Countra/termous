import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DesktopIdentity } from '#common/desktop-identity'

export function prepareLinuxDevelopmentEntry(identity: DesktopIdentity, executable: string, icon: string, dataHome: string) {
  const directory = path.join(dataHome, 'applications')
  const file = path.join(directory, identity.desktopName)
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  // Exec 参数转义在字符串转义之后解析，百分号还需避免被当成文件占位符。
  const exec = escape(`"${executable.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&')}"`)
  const content = `[Desktop Entry]\nType=Application\nName=${identity.name}\nExec=${exec}\nIcon=${escape(icon)}\nTerminal=false\nStartupWMClass=${identity.desktopName.replace(/\.desktop$/, '')}\nX-Termous-AppId=${identity.appId}\n`
  if (existsSync(file)) {
    const previous = readFileSync(file, 'utf8')
    if (!previous.includes(`\nX-Termous-AppId=${identity.appId}\n`) || !previous.includes(`\nName=${identity.name}\n`)) throw new Error('desktop_entry_conflict')
    if (previous === content) return
  }
  mkdirSync(directory, { recursive: true })
  writeFileSync(`${file}.tmp`, content)
  renameSync(`${file}.tmp`, file)
}

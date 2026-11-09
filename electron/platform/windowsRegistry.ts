import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { IdentityMigrationAccess, RegistryValue } from './windowsMigration.ts'

const execute = promisify(execFile)
export function windowsRegistry(): IdentityMigrationAccess {
  const reg = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
  const run = (args: string[]) => execute(reg, args, { windowsHide: true, timeout: 5000, encoding: 'utf8' })
  const selector = (name: string) => name ? ['/v', name] : ['/ve']
  const read = async (key: string, name: string): Promise<RegistryValue | null> => {
    if (!key.startsWith('HKCU\\')) throw new Error('registry_scope_invalid')
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
    // Registry API 能区分值不存在和拒绝访问，不能把读取禁用标记失败当成允许开机启动。
    const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${quote(key.slice(5))}); if ($null -eq $k) { 'null'; exit }; try { $n=${quote(name)}; if ($k.GetValueNames() -notcontains $n) { 'null'; exit }; $kind=$k.GetValueKind($n).ToString(); $v=$k.GetValue($n); if ($kind -eq 'Binary') { @{type='REG_BINARY';data=([BitConverter]::ToString($v).Replace('-',''))} | ConvertTo-Json -Compress } elseif ($kind -eq 'String') { @{type='REG_SZ';data=$v} | ConvertTo-Json -Compress } else { throw 'registry_value_type_invalid' } } finally { $k.Dispose() }`
    const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 5000, encoding: 'utf8' })
    return JSON.parse(stdout.trim()) as RegistryValue | null
  }
  return {
    read,
    async write(key, name, value) {
      await run(['add', key, ...selector(name), '/t', value.type, '/d', value.data, '/f'])
      const actual = await read(key, name)
      if (actual?.type !== value.type || actual.data.toLowerCase() !== value.data.toLowerCase()) throw new Error('registry_write_verify_failed')
    },
    async removeValue(key, name) {
      if (await read(key, name)) await run(['delete', key, ...selector(name), '/f'])
    },
    async removeKey(key) { await run(['delete', key, '/f']) },
  }
}

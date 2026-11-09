const commonKeys = ['PATH', 'HOME', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']
const windowsKeys = ['PATHEXT', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PROGRAMFILES',
  'PROGRAMFILES(X86)', 'PROGRAMW6432', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA']

export function integrationEnvironment(source: Record<string, string | undefined>,
  configured: Record<string, string> = {}, platform: NodeJS.Platform = process.platform) {
  const result: Record<string, string> = {}
  const normalize = (key: string) => platform === 'win32' ? key.toUpperCase() : key
  const allowed = new Set(platform === 'win32' ? [...commonKeys, ...windowsKeys] : commonKeys)
  // 程序安装与用户目录用于定位已有浏览器和包缓存；不继承令牌、代理或解释器注入变量。
  for (const [key, value] of Object.entries(source)) {
    const name = normalize(key)
    if (value !== undefined && allowed.has(name)) result[name] = value
  }
  // Windows 不区分环境变量大小写，避免 Path/PATH 并存导致显式配置被 Node 忽略。
  for (const [key, value] of Object.entries(configured)) result[normalize(key)] = value
  return result
}

# Windows 安装信息发现

Windows 正式安装包在固定注册表路径保存安装元数据，供 Skill 或本机工具定位 Termous。记录由安装器维护，不替代 NSIS 原有的 GUID 安装键和系统卸载键，也不保存凭据、MCP 令牌、端口或用户业务配置。

## 稳定合同

- 当前用户安装：`HKEY_CURRENT_USER\Software\Termous\Install`。
- 所有用户安装：`HKEY_LOCAL_MACHINE\Software\Termous\Install`。
- 当前 Windows 安装包为 x64，使用 **64 位注册表视图**；32 位调用方也应显式选择 `Registry64`。
- 查询时先检查当前用户记录，再检查所有用户记录。前者缺失、不完整或程序文件不存在时可继续检查后者；访问失败需报告，不当作未安装。

| 值名 | 类型 | 含义 |
| --- | --- | --- |
| `SchemaVersion` | REG_DWORD | 有效记录为 `1`；写入期间为 `0`，全部字段成功写入后才设为 `1` |
| `AppId` | REG_SZ | 固定为 `dev.termous.app` |
| `DisplayName` | REG_SZ | 应用名称 `Termous` |
| `DisplayVersion` | REG_SZ | 本次安装包的应用版本 |
| `InstallLocation` | REG_SZ | 实际安装目录，不带命令行参数 |
| `ExecutablePath` | REG_SZ | `Termous.exe` 的绝对路径，不带命令行参数或外层引号 |

读取方只接受已支持的结构版本和应用标识；新增字段可忽略。安装元数据是定位信息，不是执行授权，也不是程序签名验证结果。未来其他自定义数据使用 `Software\Termous` 下的其他子项；`Install` 子项完全由安装器管理。

## 生命周期

- 首次安装、覆盖安装及升级完成时写入当前目录和版本。升级时旧安装成功卸载后清理旧范围记录，新安装再登记，避免切换用户／全机安装范围后残留旧版本；期间可能暂时无法发现应用，调用方可提示稍后重试。
- 卸载成功回调仅在应用标识与安装目录都匹配时删除当前安装范围内的 `Install` 子项。保留 `Software\Termous` 父项，不删除另一安装目录的记录或其他自定义数据，也不增加卸载页面。
- 写入失败不回滚已安装的应用，但安装器会提示发现信息未登记；静默安装写入日志。缺少 `SchemaVersion=1` 的记录不可使用。
- 更新验证应用使用不同 appId，不写入正式应用的发现入口。
- 旧版安装、解压直接运行及开发环境不会自动产生记录。旧版用户安装或升级到支持该合同的安装包后才会有此记录；记录缺失时不要猜测安装目录。
- 用户手动移动或删除程序后，记录可能失效，因此启动前仍须校验文件存在。

## PowerShell 查询示例

以下示例仅查询固定元数据，不启动应用，也不读取其他配置：

```powershell
$termousInstall = & {
    $ErrorActionPreference = 'Stop'
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
        try {
            $key = $baseKey.OpenSubKey('Software\Termous\Install')
            if ($null -eq $key) { continue }
            try {
                $schema = $key.GetValue('SchemaVersion')
                $appId = $key.GetValue('AppId')
                if ($schema -isnot [int] -or $schema -ne 1 -or
                    $appId -isnot [string] -or $appId -cne 'dev.termous.app') { continue }
                $installDirectory = $key.GetValue('InstallLocation')
                $executable = $key.GetValue('ExecutablePath')
                $version = $key.GetValue('DisplayVersion')
                if ($installDirectory -isnot [string] -or $executable -isnot [string] -or
                    $version -isnot [string] -or [string]::IsNullOrWhiteSpace($version)) { continue }
                $absolutePathPattern = '^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+(?:\\|$))'
                if ($installDirectory -notmatch $absolutePathPattern -or
                    $executable -notmatch $absolutePathPattern) { continue }
                try {
                    # 使用文件路径运算，避免失效盘符触发 PowerShell 驱动器错误。
                    $installDirectory = [IO.Path]::GetFullPath($installDirectory)
                    $expectedExecutable = [IO.Path]::GetFullPath([IO.Path]::Combine($installDirectory, 'Termous.exe'))
                    $executable = [IO.Path]::GetFullPath($executable)
                } catch [ArgumentException] { continue }
                catch [NotSupportedException] { continue }
                catch [IO.PathTooLongException] { continue }
                if ($executable -ine $expectedExecutable -or
                    -not (Test-Path -LiteralPath $expectedExecutable -PathType Leaf)) { continue }
                return [pscustomobject]@{
                    Version = $version
                    InstallLocation = $installDirectory
                    ExecutablePath = $expectedExecutable
                    RegistryHive = $hive.ToString()
                }
            } finally {
                $key.Dispose()
            }
        } finally {
            $baseKey.Dispose()
        }
    }
}
$termousInstall
```

取得用户对启动应用的授权后，可使用已验证的结果调用 `Start-Process -FilePath $termousInstall.ExecutablePath -WorkingDirectory $termousInstall.InstallLocation -ErrorAction Stop`。结果为空时先报告未找到有效安装；不要把注册表文本交给 `Invoke-Expression`，也不要自动提权或附加来源不明的启动参数。启动应用不代表 MCP 已启用，仍需使用用户配置的连接及权限。

## 验收

在隔离 Windows 环境分别验证当前用户安装、全用户安装、含空格及中文的自定义目录、升级、卸载和更新验证应用隔离。检查新版本与路径刷新、原 NSIS 升级及卸载行为不变、另一目录记录与其他自定义子项不会被旧卸载器删除。自动检查不得读写真实注册表或运行安装器；编译成功不能替代以上安装验收。

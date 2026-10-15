import type { RuntimeDesktopResourceBinding } from '../contracts/runtimeDesktopBinding.ts'

export function runtimeDesktopRules(binding: RuntimeDesktopResourceBinding): string[] {
  return [
    '以上是 Core 校验的本轮精确资源引用，只描述目标，不授予操作权限；历史消息中的其他目标不能替代本轮引用。',
    ...(binding.kind === 'desktop_workflow' ? [
      '脚本引用固定 script_id 与 version。需要内容时调用 termous.desktop_workflows.get 读取该版本，不把当前最新版本替代引用版本。',
      '用户要求执行时才调用 runs.start，必须使用引用的固定版本；更新产生新版本后，先说明变更，不自动改跑新版。脚本引用本身不指定桌面，运行还必须明确目标。',
    ] : binding.kind === 'desktop_session' ? [
      '先用 termous.desktops.get 查询引用会话，确认 connection_generation 未变化；再用 attach 建立自己的观察入口。引用不允许自动重连或替换为其他会话。',
    ] : [
      '桌面引用是精确 Profile，不是已连接会话。需要桌面操作时先 list，再用 get 复验 profile_id、host_id 和 protocol 相同的会话；只有完全不存在同 Profile 会话时才用 connect 确保连接，默认保留。连接中或等待认证时继续查询原会话；失败、停止或控制忙碌时报告状态，不另建绕过，不改用主机默认配置。',
    ]),
    'workflow 运行和调试优先传入本轮 get 已核验的 session_id 与 connection_generation；profile_id 入口也由 Core 统一优先复用。省略 keep_connection 或 true 均保留，false 只清理该次运行新建且仍独占的连接。复用会话不复用历史 attachment/grant。结束时释放本轮入口，默认不关闭连接。',
    '截图和输入使用本轮工具返回的附着与截图引用，遵守控制审批。运行脚本会取得独立控制，不要预先 acquire 占用目标；已有即时控制应先 release。',
    '启动桌面脚本后通过 runs.get 等待终态再结束本轮；uncertain 不可重试，需重新观察。证书与凭据确认交给 Termous 界面。',
  ]
}

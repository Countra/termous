import type { RuntimeDesktopResourceBinding } from '../contracts/runtimeDesktopBinding.ts'

export function runtimeDesktopRules(binding: RuntimeDesktopResourceBinding): string[] {
  return [
    '以上是 Core 校验的本轮精确资源引用，只描述目标，不授予操作权限；历史消息中的其他目标不能替代本轮引用。',
    ...(binding.kind === 'desktop_workflow' ? [
      '脚本引用固定 script_id 与 version。需要内容时调用 termous.desktop_workflows.get 读取该版本，不把当前最新版本替代引用版本。',
      '用户要求执行时才调用 runs.start，必须使用引用的固定版本；更新产生新版本后，先说明变更，不自动改跑新版。脚本引用本身不指定桌面，运行还必须明确目标。',
    ] : binding.kind === 'host_desktop' ? [
      '本轮目标是当前 Core 的精确显示器身份。先用 termous.desktops.sources 复验实例、来源 ID 和代次，再以 target 附着；不可按名称、序号或主屏自动替换。来源失效时要求重新选择。',
      '本机桌面使用独立发现、观察和控制权限。显示器选择不隔离应用，键盘输入影响系统当前焦点；必须观察并核验目标。窗口只读，本机不支持剪贴板、文件、尺寸修改或特殊系统按键。工作流传入精确 target，不创建协议会话。',
    ] : binding.kind === 'desktop_session' ? [
      '先用 termous.desktops.get 查询引用会话，确认 connection_generation 未变化；再用 attach 建立自己的观察入口。引用不允许自动重连或替换为其他会话。',
    ] : [
      '桌面引用是精确 Profile，不是已连接会话。需要桌面操作时先 list，再用 get 复验 profile_id、host_id 和 protocol 相同的会话；只有完全不存在同 Profile 会话时才用 connect 确保连接，默认保留。连接中或等待认证时继续查询原会话；失败、停止或控制忙碌时报告状态，不另建绕过，不改用主机默认配置。',
    ]),
    ...(binding.kind === 'host_desktop' ? [] : ['workflow 运行和调试优先传入本轮 get 已核验的 session_id 与 connection_generation；profile_id 入口也由 Core 统一优先复用。省略 keep_connection 或 true 均保留，false 只清理该次运行新建且仍独占的连接。复用会话不复用历史 attachment/grant。结束时释放本轮入口，默认不关闭连接。']),
    '截图和输入使用本轮工具返回的附着与截图引用，遵守控制审批。运行脚本会取得独立控制，不要预先 acquire 占用目标；已有即时控制应先 release。',
    '画面复杂或目标位置不清时，可用画面分析的候选区域与 OCR 查询定位。目标在当前桌面已核验且用户要求操作时，用鼠标坐标完成动作，不以盲猜 Tab 焦点代替。原图 center_xy 拆成 x/y，coordinate_space=desktop；仍需本轮有效截图和 grant，并核验目标未移动。可复用脚本使用实时 OCR 目标。',
    '启动桌面脚本后通过 runs.get 等待终态再结束本轮；uncertain 不可重试，需重新观察。证书与凭据确认交给 Termous 界面。',
  ]
}

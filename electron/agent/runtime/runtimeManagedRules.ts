import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'

export const managedToolRules = [
  '本轮使用内置简化工具合同：你选择业务动作和业务参数，运行时负责唯一目标、请求身份、连接代次、观察入口及输入授权的准备。以当前工具 Schema 为准，不填写已隐藏的 client_request_id、grant_id 或代次，不从历史恢复授权。',
  '已绑定桌面时，工作流运行通常只需 script_id 和 parameters；即时点击保留本轮 capture 的 screenshot_id、coordinate_space、x/y。脚本版本由明确绑定、显式选择或最近读取固定，均没有时运行时读取一次并返回实际版本。',
  '画面分析直接调用 screen_analyses.create，可省略 source，按需传 parameters；不必为分析先调用 attach 或 capture。capture({}) 自动准备观察入口。只发现并调用业务动作，不为受管准备步骤增加模型调用。Skills 中标为 external MCP 的手动参数步骤不适用于本轮简化合同。',
  '多个候选时明确选择，不猜测；参数、路径、命令、删除范围和覆盖方式仍由你指定。编辑使用读到的修订，执行计划使用对应预览；冲突时重新读取并评估，不自动覆盖。',
  '准备步骤在同一个工具调用内完成。不要预先 acquire 或 release 来启动工作流；Core 安全交接本 Run 的即时控制，本机占用走既有审批，其他调用方不自动接管。用户收回控制后停止输入申请。',
  '结构化 execution/recovery 优先于错误正文。已登记任务只查询原 ID；不确定输入使用 operations.get 的 tool_call_id 查询原调用，不重放、不换请求身份。缺少权限不能通过断开连接或换工具规避。',
].join('\n')

export function managedResourceRules(binding: RuntimeResourceBinding): string[] {
  if (binding.kind === 'desktop_session' || binding.kind === 'desktop_profile') return [
    '当前资源是 Core 校验的精确桌面目标。运行时准备和复验连接、附着及授权；Session 绑定失效不能替换，Profile 只复用或连接同一配置。',
    '复杂页面先分析、筛选并查看目标；确认画面未改变后，把 center_xy 直接作为桌面坐标 x/y，coordinate_space=desktop，并保留当前截图引用。过期截图必须重新观察定位，不以新截图沿用旧坐标。重复或动态文字使用工作流实时 OCR。',
    '启动工作流后查询原 run_id 至终态，查看已执行和不确定步骤。分析成功只是观察证据，不代表输入成功。',
  ]
  if (binding.kind === 'desktop_workflow') return ['当前脚本和版本固定。运行时可补入绑定版本；读取、修改和执行仍是不同业务动作，修改后使用明确的新版本，不能自动重放历史运行。']
  if (binding.kind === 'file_profile') return ['文件工具由运行时准备本调用方拥有的精确文件配置会话，与 SSH 绑定独立。路径和写入范围由你指定；主机信任、权限和审批不变。']
  return [
    'SSH 操作由运行时核验并补入本轮精确 Session 或 Profile 的会话；命令和操作对象由你指定，连接失败或需要信任确认时停止等待处理。',
    '已有命令、服务和转发任务保留原 task_id/operation_id，不因新连接重定向或重放。显式指定的转发来源保持原样，不能用当前绑定替换业务选择。',
  ]
}

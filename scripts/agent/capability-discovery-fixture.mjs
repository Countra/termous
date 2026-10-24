import { runtimeCapabilities, capabilityToolName, runtimeCapabilityStep, runtimeToolOperations } from '../../electron/agent/tools/runtimeCapabilityCatalog.ts'
import { mapMCPTools } from '../../electron/agent/tools/mcpClientAdapter.ts'
import { runtimeUserMessage } from '../../electron/agent/test-support/runtimeBootstrapTestFixture.ts'

// 此夹具只测真实模型的业务工具选择，不模拟真实协议执行或统计为桌面操作成功。
export const discoveryCases = [
  ['desktop_capture', '观察当前远程桌面，取得即时屏幕截图。', 'termous.desktops.capture'],
  ['desktop_click', '已经看清当前截图中的按钮，需要使用鼠标单击它。不要按键盘，也不要创建工作流。', 'termous.desktops.pointer.click'],
  ['desktop_type', '在已经聚焦的远程桌面输入框输入文字，不要只修改剪贴板。', 'termous.desktops.keyboard.text'],
  ['desktop_scroll', '滚动当前远程桌面页面，鼠标位于已确认的区域中。', 'termous.desktops.pointer.scroll'],
  ['desktop_clipboard', '只设置远端剪贴板文本，不输入到当前应用。', 'termous.desktops.clipboard.set_text'],
  ['analysis_create', '分析当前桌面的候选区域和 OCR 文字，创建一项画面分析。', 'termous.screen_analyses.create'],
  ['analysis_regions', '已有成功的画面分析，分页查询检测分数大于 0.5 的候选区域。', 'termous.screen_analyses.elements.list'],
  ['analysis_ocr', '已有成功的画面分析，查询全部 OCR，包括区域中的文字。', 'termous.screen_analyses.ocr_spans.list'],
  ['analysis_image', '查看已有画面分析的筛选标注图片，不重新推理。', 'termous.screen_analyses.images.get'],
  ['workflow_schema', '准备编辑 OCR 工作流，先读取工作流步骤的 schema 合同。', 'termous.desktop_workflows.schema'],
  ['workflow_ocr', '测试当前桌面上的 OCR 文字定位，不发送输入，不创建分析历史。', 'termous.desktop_workflows.ocr.test'],
  ['workflow_start', '已经选好并固定脚本版本，现在执行该桌面工作流。', 'termous.desktop_workflows.runs.start'],
  ['workflow_report', '已有桌面工作流 run_id，读取运行报告及完成状态，不重新启动。', 'termous.desktop_workflows.runs.get'],
  ['ssh_execute', '在已确认 SSH 目标上执行用户授权的命令。', 'termous.commands.dispatch'],
  ['ssh_output', '已有 SSH 命令 task_id，需要分页读取命令输出正文。', 'termous.commands.read_output'],
  ['file_read', '读取远程文本文件的正文，不是列目录或只查看属性。', 'termous.files.read_text'],
  ['file_list', '列出远程文件会话中某个目录的子项。', 'termous.files.list'],
  ['file_download', '把远程文件下载到本地，不上传文件。', 'termous.files.transfers.download'],
  ['snippet_read', '已经有命令片段 ID，读取片段正文，不执行其中命令。', 'termous.snippets.get'],
  ['crontab_read', '读取当前 SSH 用户的 Crontab 配置和修订，不启动工作流。', 'termous.remoteops.crontab.get'],
].map(([id, prompt, expected]) => ({ id: `catalog_${id}`, prompt, expected }))

export function discoveryFixture(scenario, onCall) {
  const task = discoveryCases.find((item) => item.id === scenario)
  if (!task) throw new Error('未知目录验收场景')
  const calls = []
  const definitions = runtimeCapabilities.flatMap((capability) => capability.steps.flatMap((step) => step.tools
    .map((name) => capabilityToolName(capability, name)).filter((name) => name.startsWith('termous.'))
    .map((name) => ({ name, description: `${capability.purpose} Actions: ${runtimeToolOperations(name).join(', ')}. Stage: ${runtimeCapabilityStep(name)?.role}.`,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} }, annotations: { readOnlyHint: true } }))))
  const mapped = mapMCPTools(definitions, async (definition) => {
    calls.push(definition.name)
    const success = definition.name === task.expected
    onCall({ name: definition.name, input: success, ...(success ? {} : { error: 'FIXTURE_WRONG_BUSINESS_TOOL' }) })
    const data = { fixture_goal_completed: success, message: success ? '合成业务工具选择已完成，请结束本次验收。' : '此工具的业务效果不符合目标，请选择准确动作。' }
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: !success }
  })
  return { mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
    success: () => calls.length === 1 && calls[0] === task.expected }
}

export function discoveryMessages(scenario) {
  const task = discoveryCases.find((item) => item.id === scenario)
  return [runtimeUserMessage([], { text: `本地合成工具选择验收：${task.prompt}\n工具执行都是本地替身，不会连接或操作真实资源。请发现并实际调用正确业务工具一次，参数以当前声明为准；收到 fixture_goal_completed=true 后结束。不要额外查询或清理。` })]
}

# 内置工具准备

内置 Agent 的工具准备入口为 `electron/agent/tools/preparation/index.ts`，按参数视图、身份、桌面、工作流、SSH、文件和修订分别组织。业务工具仍是原有 MCP 工具；准备调用使用已授权目录，不依赖模型提前 discover。

协议 15 要求宿主提供私有准备记录查询。首次派发前 `tool_prepared` 经原事件写入链路 flush；失败不派发。模型 Schema 隐藏机械字段、保留截图和业务选择。外部原始 Schema 不修改。

`tool_progress` 复用工具行显示 preparing/waiting/executing。前端只保留每个活动调用最后阶段，忽略私有准备正文，审批和终态优先。历史消息、图片资源以及既有有界缓存机制不变。

完整架构、错误恢复和控制规则见相邻 Backend 文档 `docs/agent-tool-preparation.md`；实际验收及未执行项见 `docs/agent-tool-preparation-acceptance.md`。不得将定向测试结果表述为真实 Agent 成功率。

## 本机桌面审批展示

工具行显示“申请桌面控制权限”只表示调用进入等待阶段。用户可操作的审批入口由主窗口的 `McpAccessRuntimeProvider` 与 `McpApprovalCoordinator` 通过原有 MCP 审批快照／事件提供，不由工具行或桌面托管浮层创建。

桌面审批的 `operation.resource_kind` 包含 `rdp`、`vnc`、`host_desktop`。本机工作流使用 `lifecycle: binding_only`，协议工作流继续使用 `keep_connection`、`close_owned`、`existing_connection`。HTTP 快照、WebSocket 事件和决定回执必须使用同一解码合同。本机来源不能显示为远程协议连接，详情需说明键盘影响当前系统焦点。

曾因前端仅接受 RDP/VNC 资源类型而拒绝整个审批快照，表现为工具持续等待、授权弹窗缺失；HTTP 对账也使用同一解析器，因此重试无法恢复。修复只补齐展示合同与目标说明，不改变授权范围、审批期限、租约或输入执行策略。

回归入口：

- `src/features/mcp-access/model/protocol/desktopApproval.test.ts`：本机／协议合同、混合审批快照、生命周期与非法范围。
- `src/app/data-runtime/api/gateways/mcpDesktopApproval.ui.test.tsx`：原始 HTTP／事件经生产客户端、运行时和真实弹窗完成允许／拒绝，覆盖取消、过期和迟到快照。

2026-10-27 已使用 In-app Browser 和内存模拟服务验证本机控制弹窗、决定提交、本机工作流刷新恢复及 VNC 展示兼容；没有授予真实桌面控制权或派发系统输入。模拟服务和截图位于工作区 `TEMP/host-desktop-approval`。

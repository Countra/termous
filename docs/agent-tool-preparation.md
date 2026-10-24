# 内置工具准备

内置 Agent 的工具准备入口为 `electron/agent/tools/preparation/index.ts`，按参数视图、身份、桌面、工作流、SSH、文件和修订分别组织。业务工具仍是原有 MCP 工具；准备调用使用已授权目录，不依赖模型提前 discover。

协议 15 要求宿主提供私有准备记录查询。首次派发前 `tool_prepared` 经原事件写入链路 flush；失败不派发。模型 Schema 隐藏机械字段、保留截图和业务选择。外部原始 Schema 不修改。

`tool_progress` 复用工具行显示 preparing/waiting/executing。前端只保留每个活动调用最后阶段，忽略私有准备正文，审批和终态优先。历史消息、图片资源以及既有有界缓存机制不变。

完整架构、错误恢复和控制规则见相邻 Backend 文档 `docs/agent-tool-preparation.md`；实际验收及未执行项见 `docs/agent-tool-preparation-acceptance.md`。不得将定向测试结果表述为真实 Agent 成功率。

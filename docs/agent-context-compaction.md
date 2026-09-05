# Agent 自动上下文压缩

Termous 使用固定版本 `@earendil-works/pi-agent-core@0.85.0` 的 `prepareCompaction` 与 `compact`。React 负责设置和活动展示，Electron Worker 负责官方算法、请求预算与活动上下文，Go Core 负责权威记录、事件顺序和 SQLite 快照。`termous-skills` 仍是静态工作流资源。

## 请求门禁

唯一门禁是 pi Agent 的 `transformContext`，每次主 Provider 请求前都会执行，包括第一次请求、工具批次完成和追加指令被 Agent 消费之后。

```text
初始输入 / 工具结果 / 已消费的追加指令
  → 投影活动上下文
  → 检查当前请求预算
  → 必要时 await 官方压缩和 Core 提交
  → 发送下一次 Provider 请求
```

门禁不打断工具，不重启 loop。摘要使用当前模型及既有受限 Provider 通道，独立发送且不提供工具，因此不会递归触发压缩。压缩期间接收的指令继续保存并排队；只有进入 pi 时才写入 `steer_applied`，不能把“已收到”当成“已执行”。

`transformContext` 返回值只影响当前请求。Worker 保持已提交摘要、官方保留尾部与原始数组覆盖位置，每次重新投影；完整聊天记录与原始 Agent 消息数组不被裁剪。

## 阈值与保留策略

自动压缩始终开启。全局 `context_compaction_threshold_percent` 默认 **80**，允许 **50–95** 的整数。设置沿用 revision 校验；创建 Run 时冻结，运行中的任务不受随后设置变更影响。

设模型窗口为 `C`、最大输出为 `O`、触发百分比为 `P`、系统提示与工具定义估算为 `F`：

```text
B = min(floor(C × P / 100), C − O)
A = B − F
reserveTokens    = min(16384, floor(A / 4))
keepRecentTokens = min(20000, floor(A / 2))
```

`B` 是当前请求的门禁预算。输出预留可能让压缩早于用户百分比触发。有效 Provider usage 优先作为基准，补计此后新增消息；没有有效 usage 时估算消息及固定开销。压缩之后不沿用旧 usage，模型身份变化也不复用旧模型的基准。

如果实际用量已经达到门禁，而 pi 的字符估算尚未找到可摘要前缀，仅按最后有效用量基准做一次近期预算的尺度换算，再调用官方 `prepareCompaction`。换算包含系统和工具固定开销，不把差额全部归入历史；模型、Provider 或 API 不匹配的用量不参与。切点仍由官方算法决定，不拆分消息，不增加模型请求重试，也不改变窗口占用的显示口径。

近期原文按 pi 的 Token 预算和合法消息边界保留，不固定轮数，不拆散工具调用与结果。没有“压到 30%”之类目标比例，也不增加固定最低 Token 数；但必须存在可摘要前缀并有可用空间。摘要必须实际缩小上下文且压后低于 `B`，否则停止本轮。

“下次发送前压缩”由第一道门禁消费，复用相同算法。尚无可压缩前缀且未超预算时不会发起无效摘要请求。

## 模板与失败处理

保留 pi 官方结构化摘要及长单轮的前缀摘要模板。两类请求都追加简短 Termous 要求：保存目标、最新约束、资源与任务标识、审批状态、操作结果、未知结果、未完成工作及下一步；未知不能写成成功，摘要不能产生新的授权。

连续切分同一个长轮次时，适配层保证旧摘要进入下一次官方摘要输入。历史及摘要以历史数据进入模型，不升级为系统指令。

只接受 `stop` 正常结束、非空、大小合法的摘要。空输出、截断、超预算、无可摘要前缀及提交失败均不能推进本地覆盖位置。摘要请求用量按请求计入 Run，包括多个摘要中部分成功、随后整体失败的情况。

摘要和主回复用量通过同一事件桥累计。门禁阻止触网后 pi 合成的零用量终态不参与统计，避免把已完整返回的摘要用量误标为部分统计；实际 Provider 失败而未返回用量时仍标记为部分统计。

失败由 Hook 内捕获，主 Provider 适配器在触网前阻止后续请求，保持 pi 的正常终止事件。当前 Run 结束，原始记录及最后成功快照保留；下次发送重新经过门禁。失败后未消费的追加指令不会继续交给已经失败的 loop。

完成序号已分配后，短暂的 Core 原子提交等待回执，不被用户取消信号截断；取消仍阻止下一次模型请求。普通取消和 Worker 中断均会收口未完成活动。

### 区分压缩失败与模型请求失败

占用接近阈值不能单独证明压缩失败。定位时同时核对 Run 冻结预算、最后 `context_usage`、`compaction` 活动及 `error_code`。没有压缩活动且错误为 `AGENT_MODEL_*` 时，应继续检查 Provider 请求链路；累计计费 Token 不作为窗口容量证据。

Worker 对模型错误区分连接中断、超时、限流或额度、鉴权、服务端容量、服务异常和内容限制，并通过现有 `error` 事件保存限长脱敏详情。真实凭据、服务地址和常见敏感字段不进入诊断正文。最新回复显示原因与详情，历史回复沿用已持久化的错误码；旧记录中已经丢失的 Provider 详情无法补回。

Responses 流缺少终止事件仍然失败，已生成的正文及已完成工具结果保留，不自动重放任务。正常 `max_output_tokens` 截断保持 pi 的 `length` 语义；摘要请求仍按前述规则拒绝截断结果。`runtimeProviderFailure.integration.test.ts` 使用真实 pi Agent 和受控 SSE 覆盖这两种情况及服务端失败、内容限制。

摘要适配器同时处理 Provider 返回的错误消息和请求直接抛出的异常，复用上述分类及脱敏流程。摘要错误以 `AGENT_RUNTIME_CONTEXT_COMPRESSION_*` 记录，区别于主回复的 `AGENT_MODEL_*`；完整的错误事件包含限长详情，历史回复仅有错误码时仍可显示具体失败阶段。摘要达到输出上限使用 `COMPRESSION_TRUNCATED`，摘要保存未获确认使用 `COMPRESSION_CHECKPOINT_FAILED`，均不提交不完整结果或继续主请求。保留原有失败后结束 Run 的策略，不在同一快照上自动重试摘要，也不重放远程工具。

`runtimeCompactionProvider.integration.test.ts` 使用真实官方算法与内存 Responses SSE，覆盖先成功提交、第二次摘要发生断流、服务异常、鉴权失败、内容过滤、截断或未知错误时的分类、用量累计和旧快照保留；`piAgentAdapter.test.ts` 另验证两种 Provider 的摘要错误经真实门禁和消息桥传递到事件，并验证凭据脱敏。

## 持久化协议

Runtime 协议为 **6**，SQLite 使用增量迁移兼容旧快照。

运行中 checkpoint 提交复用 `/agent/runs/:id/runtime-checkpoints` 和 Run bearer，包含稳定 `compaction_id`、基础 checkpoint、Run/generation/事件覆盖水位、摘要、原生 `retained_tail`、官方 `details` 及压前后估算。

Core 在同一事务中写入 checkpoint、完成活动和事件序列。相同幂等 ID 必须对应相同内容；网络响应丢失仅使用原请求重试一次。本地上下文只在确认成功后推进。请求保持既有 1 MiB 上限。

保留尾部中的图片替换为引用，用户图片引用附件 ID，工具图片引用原始结果 part 与内容索引。恢复校验会话归属、类型与 SHA-256 后还原原生图片。无法引用、内容异常或超限会明确失败。

v2 恢复使用覆盖水位后的消息事件以及 `steer_applied` 顺序。Core 可能将同一个 assistant ID 分成多个片段；Worker 按返回数组顺序还原，不能再按原消息 sequence 排序。旧版本 checkpoint 仅保留读取兼容。

## 前端投影

`compaction` 是 Run 内活动，状态为 `started / completed / failed / cancelled`，Run 保持现有槽位与停止能力。开始与终态更新同一活动行，使用 `after_part_sequence` 插入实际发生位置；历史通过当前页 assistant IDs 批量查询 `Message.compactions` 恢复。默认不弹窗或展开摘要。

`context_usage` 表示窗口占用估算，与累计计费用量分开。请求边界与压缩完成后更新；压缩进行中保留原数值。`steer_applied` 只推进事件游标，不重复插入已保存的用户消息。

旧 Run 的补拉事件只推进自身游标，不能覆盖同会话较新 generation 的占用值。压缩完成后的实时事件和断线补拉共用摘要信息回查；若回查期间收到较新的占用，只补齐 checkpoint 信息，保留实时数字。

活动行复用现有主题、时间线密度与字号，提供中英文、ARIA 温和状态播报和减少动画支持。

活动行右侧展示实际压前、压后占用比例及耗时，例如 `80% → 30% · 2.4 s`。比例分母来自当次 Run 冻结的 `context_window_tokens`，耗时由 Core 按开始至终态事件时间计算为 `duration_ms`；两者随实时事件和历史消息投影返回，不依赖之后的模型设置。压缩中仅展示压前值，失败或取消不展示压后值；旧数据无法取得窗口或耗时时，分别回退到 Token 数或省略耗时。服务端可从已有 Run 快照与压缩事件补齐旧历史，无须新增数据库列。

## 实现入口与验证

- `electron/agent/runtimeCompaction*.ts`：官方算法适配、预算、摘要请求与投影。
- `electron/agent/runtimeContextGate.ts`：事件、图片及 checkpoint 服务接入。
- `electron/agent/runtimeContextImages.ts`：图片引用；`runtimeCheckpoint.ts`：Worker 合同校验。
- `src/features/agent-setup`：阈值设置；`src/features/agent-runtime`：事件状态归并。
- `src/widgets/agent-workspace/ui/AgentCompactionActivity.tsx`：对话活动行。
- `backend/internal/service/agent/compaction_*.go`、`context_replay.go`：事务服务、引用校验与恢复。

回归覆盖首次/工具/追加指令请求边界、连续多次压缩、长单轮旧摘要延续、小窗口与输出预留、摘要失败和取消、图片引用、幂等提交、恢复顺序与历史活动。运行现有 Node/UI 测试、TypeScript、ESLint、样式与架构检查，并执行 `build:renderer` 验证 Worker 体积和允许依赖；不能放宽体积门禁或引入非目标 Provider SDK。

UI 验证优先使用 In-app Browser，不可用时使用 Playwright。纯浏览器不具有 Electron Agent bridge：设置可以连接真实 Core，活动组件可用受控 fixture 验证；完整链路须使用真实 Electron Worker 和本地 Provider fixture。

仓库提供 `scripts/agent/run-compaction-acceptance.mjs`，配套独立本地 Provider fixture。先完成 `build:renderer`，使用开发 Core `127.0.0.1:8122`、本地验收 Token `dev-token`，确保无其他 Supervisor 且 `18189/18190` 空闲。在 `web` 目录、继承下述缓存环境后执行：

```powershell
node node_modules/electron/cli.js scripts/agent/run-compaction-acceptance.mjs
```

验收启动无窗口 Electron 主进程及真实 `utilityProcess` Worker，仅调用本地 `read_skill_resource`。Chat Completions 与 Responses 各验证同 Run 多次压缩、追加指令及新 Run 恢复；另验证摘要截断、取消和随后重试。专用会话、模型、Provider 按本轮创建的 ID 清理，既有数据及全局设置保留。报告与事件证据位于 `TEMP/runtime/compaction-acceptance`，成功条件为退出码 0 且 `report.success=true`。

开发数据根固定为 `D:\Item\vibe_coding\termous\dev-data`。本工作区已有数据库位于其 `.termous` 子目录；直接启动 Go Core 时传入这个已解析目录，避免在根目录创建第二份数据库。所有缓存与产物复用工作区 `TEMP`：Go 的 `go/build`、`go/mod`、`go/tmp`，Node 的 `node-compile-cache`，包管理缓存 `pnpm` 与 `pnpm/store`，运行日志 `runtime`。缓存损坏时在原位置重建，不按验证阶段创建新的缓存体系。

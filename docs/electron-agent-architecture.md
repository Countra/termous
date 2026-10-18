# Electron Agent 架构

Agent 按进程边界与运行职责组织。目录调整不改变 Core HTTP、IPC、MCP、持久化数据或 pi 协议；公共合同仍与现有 Core 兼容。

## 模块归属

| 目录 | 职责 |
| --- | --- |
| `contracts` | Worker 和控制协议、IPC 通道、Core 端口、模型与资源快照、事件、检查点、参数与结果校验 |
| `host` | Supervisor、队列领取、租约、Worker 创建与监督、主进程 IPC、宿主 Core 客户端 |
| `worker` | utilityProcess 入口、单次运行生命周期、Worker Core 客户端、MCP 连接失败处理 |
| `runtime` | pi 装配、可信系统提示、事件桥接、事件与审计写入、请求统计、检查点提交协调 |
| `provider` | 模型适配、流式请求、重试、错误脱敏、用量转换 |
| `context` | 历史消息恢复、附件和图片工作集、Token 估算、工具历史投影 |
| `context/compaction` | 压缩准备、边界选择、摘要生成、用量校准与压缩状态 |
| `tools` | MCP 适配、发现与导航、资源选路、进展检查、Workflow 等待、Skill 与历史图片工具 |
| `execution` | 可选执行预算、累计用量、输入不确定保护 |
| `skills` | 磁盘 Skill 加载、清单解析与安装所需能力 |
| `test-support` | 跨测试和验收脚本复用的夹具，禁止生产导入 |

单元测试与被测模块共置。跨模块集成测试放在负责装配或对应业务行为的模块；测试文件不作为生产入口导出。

系统提示、历史消息恢复和 Provider 基础合同分别由相邻测试覆盖；`piAgentAdapter.test.ts` 保留真实 pi 装配、重试、预算与资源路由集成测试。共享启动数据由 `test-support/runtimeBootstrapTestFixture.ts` 创建，每次调用返回独立对象。

## 依赖方向

以下是 Agent 内允许的跨模块依赖；模块内部使用相对路径直接导入实现文件。

| 来源 | 允许的目标 |
| --- | --- |
| `contracts` | 无 Agent 内部依赖 |
| `provider`、`skills` | `contracts` |
| `context`、`execution` | `contracts`、`provider` |
| `tools` | `contracts`、`execution` |
| `runtime` | `contracts`、`provider`、`context`、`execution`、`tools` |
| `worker` | `contracts`、`runtime`、`tools` |
| `host` | `contracts`、`skills` |

合同只依赖 `common`、快照哈希所需的 `node:crypto` 和第三方纯类型，不能加载 HTTP 客户端、模型 SDK 实现或文件系统。宿主只通过协议与端口控制 Worker，不能导入 Worker 运行实现。Worker 也不能反向导入宿主或磁盘 Skill 加载器。

`runtimeContextGate` 属于 `runtime`：它负责事件序号和检查点提交。`context/compaction` 通过回调取得这些能力，不依赖事件桥或写入器。只有 Core 确认检查点提交后，才替换模型上下文。

图片工作集属于 `context`；历史图片读取工具属于 `tools`，由运行装配注入认证读取回调。图片引用不恢复过期桌面控制权限。

## 外部入口

- 主进程通过 `host/index.ts` 装配 Agent，通过 `skills/index.ts` 加载 Skill。
- Preload 只导入 `contracts/ipcChannels.ts`，不加载主进程注册代码。
- 终端补全通过 `provider/index.ts` 使用模型能力，通过具体合同文件取得模型校验、租约和错误类型；不引用 Agent Core 客户端实现。
- Skill 安装器通过 `skills/index.ts` 使用安装所需能力，通过合同读取快照类型。
- 验收脚本可以直接装配 Worker、运行时及测试夹具；不得被生产入口引用。

不创建 Agent 根级总入口。公共入口只导出已有调用者实际需要的符号，模块内部不能回导自身入口。Core 宿主与 Worker 的错误类保持独立，并保留原有错误码、状态和 `instanceof` 语义。

## 扩展与兼容约束

新增业务工具优先放入 `tools`；新增预算条件进入 `execution` 的统一预算入口；Provider 兼容处理放入 `provider`。只有组合多个模块、管理事件提交或 pi hooks 的代码进入 `runtime`，不新增并行的运行器或通用插件框架。

预算默认关闭。关闭预算不影响用量统计，也不关闭取消、权限、授权期限和输入不确定保护。工具发现、审批等待、资源清理和消息恢复保持原有生命周期。

类型导入、转导出、可静态解析的动态导入与 `require()` 都参与架构检查。`scripts/architecture/agent-rules.mjs` 使用现有 AST 依赖图检查模块方向、外部入口和运行环境；统一规则继续检查循环、路径大小写和生产代码引用测试的问题。

Worker 源码入口为 `electron/agent/worker/worker.ts`，产物名称仍为 `agent-worker.js`。构建检查按完整本地 chunk 依赖闭包计算体积，继续执行 Provider 与运行时依赖白名单以及 1,441,792 字节上限（含能力导航和执行摘要，依赖白名单不变）。

## 验证

### 工具导航、进展与上下文

`runtimeCapabilityCatalog` 从统一能力契约加载全部 134 个 MCP 工具的职责、阶段、完整 Skill URI 和后续入口。发现、导航、状态归一化及生命周期依赖共用通用引擎；Core 使用同一契约增强外部 MCP 目录。普通截图返回 `screenshot_id`，固定快照返回 `snapshot_id`，两者通过声明式后续关系导航。预加载声明不执行操作，也不扩大授权。架构和扩展方式见[统一能力契约](./agent-capability-architecture.md)。

`RuntimeToolProgress` 独立于可选执行预算。相同有效观察或同类失败第三次提示，最近 12 次实际调用也检查 2～4 步的三次循环；后续同模式按 3、6、12…退避。图像内容、区域及代次参与比较，临时截图标识和帧号不代表进展。异步查询回执中的 `failed` 也属于业务失败。普通诊断只提示并继续；资源清理门禁、授权与输入不确定保护保持独立。

成功创建同一附着的固定快照后，原普通截图诊断更新为已恢复；同一会话代次的失败查询得到成功回执后，也更新失败诊断。发现工具、轮询等待、其他资源的成功或仅接受输入不会冒充恢复。桌面路由门禁仍要求本轮先查询，再附着；缺少前置回执时明确给出 `required_tool` 与当前目标参数，下一请求预加载只读查询声明，历史附着不能因此恢复授权。

每次请求投影一份有界执行摘要和当前阶段所需文档。纯历史投影与请求补充项分开：补充项参与容量评估，但不进入压缩摘要正文或检查点保留尾部。显式 Skill 读取按 URI、内容哈希和纯历史中是否包含完整正文去重，临时自动文档不能代替持久读取。Provider 用量扣除上次补充投影的估算后再计入当前投影，避免累积占用；工具声明或图片工作集变化继续使旧基准失效。图片变化时先清除失效用量，再复制消息，避免按对象身份记录的失效标记被绕过。压缩仍按容量和输出预留触发，不因循环额外请求模型摘要。提交前将不超过 48 KiB 的诊断状态放入 checkpoint `details.execution_progress`，提交失败保留原上下文；旧检查点没有可恢复执行状态时，从保留历史重建诊断，恢复证据不会恢复历史权限。

Core 的 `progress_supported` 能力位控制进展事件、实际压缩阈值和请求诊断元数据。旧 Core 只接收模型侧提示。事件沿用既有 JSON 存储，界面按同一模式合并并展示恢复状态；请求诊断仅增加有效工具名、上下文指纹和摘要规模，不额外保存请求全文、图片或凭据。

使用现有项目命令执行 Node 测试、类型检查、lint、架构检查与构建。针对 Agent 的快速回归命令为：

```powershell
node --test "electron/agent/**/*.test.ts" "electron/terminalCompletion/**/*.test.ts" "electron/skills/**/*.test.ts" "scripts/architecture/**/*.test.mjs"
pnpm run typecheck
pnpm run lint
pnpm run build:renderer
```

测试重点包括队列和租约、取消与迟到事件、两种模型协议、审批等待、动态工具、重试、预算开关、图片历史、压缩提交及终端补全。测试默认使用本地协议夹具和合成数据，不读取真实凭据或操作远程桌面。

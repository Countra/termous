# 前端模块化架构

## 目标与边界

Termous Web 采用 FSD 启发式模块化单体。重构以迁移现有实现为主，目录调整不得改变 API、IPC、WebSocket、存储键、错误语义或交互行为。

目标目录如下：

```text
common/<slice>/         Electron 与 Renderer 共用的纯合同 Slice
electron/               Main、Preload、更新与系统运行时
src/
  app/                  启动、Provider、导航、生命周期与装配
  pages/                页面级组合
  widgets/              Workbench、Terminal、Files 等大型区域
  features/             用户可执行的业务用例
  entities/             Host、Session、File、Forward 等领域模型
  shared/               bridge、transport、UI、hooks、lib、i18n、styles
```

`src/api`、`src/components`、`src/hooks`、`src/i18n`、`src/theme`、`src/types`、根级页面文件和全局业务样式属于迁移期旧结构。现有源码文件和引用通过精确 allowlist 暂时保留，不允许在旧结构中增加文件或依赖。

## 依赖规则

应用层级只允许由上向下依赖：

```text
app -> pages -> widgets -> features -> entities -> shared -> common
electron -> common
```

- 上层可以跳过中间层依赖更低层；下层不得反向依赖上层。
- `common` 只能依赖自身或外部包，不能依赖 `src`、`electron`；`common` 的一级子目录同样视为 Slice。
- `electron` 不能依赖 Renderer 实现；Renderer 不能导入 `electron` 实现或其中的类型。
- `pages`、`widgets`、`features`、`entities`、`shared` 的一级子目录视为 Slice。
- Slice 内部只能使用相对路径，内部文件也不能相对回导自身的 `index.ts`；跨 Slice 必须通过目标 Slice 根目录的 `index.ts`，并使用 `#<layer>/<slice>` 导入。
- 同层 Slice 不得深层导入另一 Slice。需要组合两个同层 Slice 时，将组合职责上移。
- `common` 和所有 Sliced Layer 不能直接放置源码文件，源码必须归属具体 Slice。
- 生产源码不能导入 `src/test`、`*.test.*` 或 `*.spec.*`；测试文件作为目标保留在依赖图中，作为依赖源时跳过。
- 静态 import、re-export、类型 import、字符串形式的动态 `import()` 和 `require()` 都参与依赖图与循环检测。
- 生产源码不得使用三斜线 `path` 引用；共享类型必须通过受管模块的显式 type import 暴露。
- 相对路径或 `#` 别名解析到 `src`、`electron`、`common` 之外的项目源码会被拒绝。
- 已存在的本地目标通过 realpath 进入依赖图，同时校验 import 路径大小写，避免只在 Linux 构建时暴露错误。

## 公共入口

公共入口只导出外部调用者真正需要的稳定合同，不应把 Slice 的全部内部文件重新导出。示例：

```ts
// src/features/hosts/index.ts
export { HostsPage } from './ui/HostsPage'
export type { HostLauncherIntent } from './model/hostLauncherIntent'

// 其他 Slice
import { HostsPage, type HostLauncherIntent } from '#features/hosts'
```

禁止使用 `#features/hosts/ui/HostsPage` 或跨 Slice 的 `../hosts/ui/HostsPage`。Slice 自身内部仍应使用 `./ui/HostsPage` 等相对路径，且内部模块不能导入自身的 `index.ts`，避免形成自入口循环。

## 运行时不变量

结构迁移必须保持以下合同：

- Provider 顺序为 `TermousUi -> Update -> Shortcut -> FilesWorkspace -> Transfer -> Terminal -> AppShell`。
- Workbench 始终挂载，仅通过 `inert`、`active=false` 和样式隐藏，不能改为条件渲染。
- Terminal Runtime、xterm DOM、parking host 和 transport 保持单实例所有权。
- `main` 与 `update` 两个 Renderer Surface 的动态入口保持不变。
- `TermousApiError` 保持单一实现，避免破坏 `instanceof` 判断。
- 在建立等价性测试前，不调整 Props、状态更新顺序、revision、恢复和取消语义。

## SCSS 所有权

- 业务组件使用共置的 `*.module.scss`，样式跟随组件或 Slice 移动。
- 全局 SCSS 仅保留 tokens、根节点、主题、滚动条和必要的文档级状态。
- 运行时主题继续使用 CSS Custom Properties；Sass 变量只处理编译期复用。
- AntD Portal、xterm 和 CodeMirror 的全局覆盖必须挂在明确的局部根节点下。
- JavaScript 查询样式类名的代码先迁移到 `data-*` 或 ref，再启用 CSS Modules。
- `workstation.css` 按完整功能块逐段抽离，不整体改名或重写。

## 迁移纪律

1. 先用特征测试记录行为，再使用 `git mv` 移动完整文件。
2. 先调整 import、export 和公共入口，不修改文件内部业务逻辑。
3. 调用方尚未全部迁移时可在原路径保留临时纯 re-export：除注释外只能包含指向同一个规范公共入口的 export declaration。包含 import、声明、执行逻辑或多个目标的 facade 不属于兼容例外，真实实现始终只能有一份。
4. 巨型文件只按完整函数、Hook、组件或状态域提取，不整文件重写。
5. 每个小批次立即执行定向测试；阶段结束再执行全量门禁与 UI 联调。
6. 通过 `git diff --find-renames` 检查迁移是否保留历史，避免无必要的删除后重建。

## 架构门禁

执行：

```powershell
pnpm run check:architecture
```

检查器位于 `scripts/architecture/check.mjs`，覆盖：

- 层级方向；
- 同层跨 Slice 深层导入；
- Renderer 到 Electron 实现依赖；
- 旧结构源码文件、旧结构依赖及严格的纯 re-export 兼容出口；
- Slice 内部别名、自身公共入口、Layer 根文件和生产源码导入测试；
- 静态、类型、动态 import 与 CommonJS require 循环；
- 跨 Slice 公共入口、统一别名、项目范围外源码与路径大小写。

检查器从 `package.json#imports` 读取真实别名映射，并严格校验七个标准别名的键和值。缺失、目标漂移或额外别名都会直接中止检查，不能通过 allowlist 放行。

`scripts/architecture/legacy-allowlist.json` 保存当前历史债务。规则、源文件及适用的目标文件、import specifier、循环类型共同组成精确身份。检查器同时拒绝新增违规和过期条目，因此债务消除后必须同步删除对应条目。

需要审阅当前完整违规集时执行：

```powershell
node scripts/architecture/check.mjs --report-json
```

该命令只输出报告，不修改 allowlist。不得为了通过门禁直接扩大 allowlist；只有确认暂时无法在当前阶段消除、且不会扩大运行风险的既有债务才能登记。

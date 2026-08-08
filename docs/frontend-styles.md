# 前端样式边界

## 检查范围

- 样式清单会盘点 `src` 内的 `.css`、`.scss` 和 `.sass`，并拒绝扩展名大小写异常及任何符号链接。
- Stylelint 检查全部 `src/**/*.scss` 和 `src/**/*.module.scss`。
- 当前 `src` 内没有 `.css` 或 `.sass`；`scripts/styles/legacy-css-allowlist.json` 为空，并作为禁止重新引入 legacy CSS 的回归门禁保留。
- 业务目录只允许 `*.module.scss`；应用级非 Module SCSS 只能放在 `src/shared/styles`。
- 不使用缩进语法 `.sass`，所有 Sass 文件统一采用 SCSS 语法和小写扩展名。
- Sass 只承担嵌套、拆分和编译期复用；运行时主题继续使用现有 CSS Custom Properties。

## Renderer 样式入口

- `src/app/renderer-entry/main.tsx` 固定加载 `#shared/styles`，该入口只导入 `src/shared/styles/global.scss`，因此 `main` 与 `update` Surface 都能获得主题变量、根节点和文档级基础样式。
- `src/app/main/App.tsx` 额外加载 `#shared/main-styles`，该入口只保留尚未完成所有权迁移的 `workstation.scss` 主界面兼容规则。
- `update` Surface 不加载 `#shared/main-styles`，只使用共享 `global.scss` 与 `src/app/update-surface` 内共置的 SCSS Modules，避免主界面规则污染独立更新窗口。
- Surface 分流和样式入口由 Renderer 静态合同测试约束；调整入口或顺序时必须同步验证两个 Surface。

## 全局兼容层

- `global.scss` 是正式的共享全局层，只承载 CSS Custom Properties、主题、根节点和必要的文档级状态。
- `app.scss` 的通用业务规则已经迁入所有者共置的 SCSS Modules；`workstation.scss` 仍包含主界面历史类名、第三方覆盖和跨组件规则，是受控兼容层，不代表业务样式已全部完成局部作用域治理。
- 新增或重构后的业务样式应与组件共置到 `*.module.scss`，不得继续扩大 `workstation.scss`。兼容规则只能在保留导入顺序、最终计算样式和交互行为的前提下按完整功能块抽离。
- 部分现有 Module 为保持历史 DOM 类名和 Portal 行为，仍使用文件级 Stylelint 豁免或顶层 `:global`。这些写法属于可识别的兼容状态，不应复制到新组件；后续收敛时应先解除 JavaScript 和跨组件对类名的依赖。

## SCSS Modules

- 组件和业务样式与实现共置，并使用 `*.module.scss`。
- JavaScript 交互不得依赖模块生成后的类名；行为定位使用 `data-*` 或 ref。
- 每个选择器分支都必须包含本地 class，或由 Sass 嵌套形成的安全本地 class 祖先限定。`body`、`:root`、属性选择器和通配选择器不能在 Module 顶层独立使用。
- `:global` 只能用于 Ant Design、xterm、CodeMirror 等第三方生成的 DOM，并由同一选择器分支前方的本地模块 class 直接限定，例如 `.root :global(.ant-modal)` 或 `.root > :global(.ant-modal)`。
- Sass 嵌套写法 `.root { :global(.ant-modal) { ... } }` 可以使用；父级为选择器列表时，每个最终展开分支都必须能由祖先本地 class 限定。
- `:local(.root)` 可以建立显式本地作用域；`:is()` 和 `:where()` 只有在所有分支均可证明包含本地 class 时才能建立作用域。
- `:not()` 和 `:has()` 内的 class 不作为外层选择器的安全作用域；裸 `:global`、嵌套在其他伪类中的 `:global` 及选择器列表中的未限定分支都会被拒绝。
- `@keyframes` 的 `from`、`to` 和百分比步骤不属于 DOM 选择器作用域检查范围。
- `@at-root`、mixin 或其他无法静态证明会保留选择器祖先的边界不会继承外层安全作用域，应改用显式本地 class 前缀。
- 无法由组件根节点限定的 Portal 覆盖应放入受控的应用级全局 SCSS，不得在 Module 中使用裸 `:global`。

以上约束适用于新增和已经完成局部作用域治理的 Module；“全局兼容层”中明确记录的现有豁免不作为新代码模板。

## 收敛顺序

先按样式所有权原样移动兼容规则并保持导入顺序，再解除行为类依赖、转换为 SCSS Modules，最后删除已经无引用的全局 SCSS 规则。结构调整阶段不同时调整视觉设计或业务交互。

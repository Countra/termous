# 前端样式边界

## 检查范围

- 样式清单会盘点 `src` 内的 `.css`、`.scss` 和 `.sass`，并拒绝扩展名大小写异常及任何符号链接。
- Stylelint 检查新建或已经迁移的 `src/**/*.scss` 和 `src/**/*.module.scss`。
- 历史 `.css` 在所属模块迁移完成前保持原样，不参与自动修复。
- `scripts/styles/legacy-css-allowlist.json` 必须与现有历史 CSS 完全一致：新增 CSS 或删除、迁移后未同步收口清单都会使门禁失败。
- 业务目录只允许 `*.module.scss`；应用级非 Module SCSS 只能放在 `src/shared/styles`。
- 不使用缩进语法 `.sass`，所有 Sass 文件统一采用 SCSS 语法和小写扩展名。
- 迁移期可能暂时没有 SCSS 文件，因此样式检查命令必须保留 `--allow-empty-input`。
- Sass 只承担嵌套、拆分和编译期复用；运行时主题继续使用现有 CSS Custom Properties。

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

## 迁移顺序

先按样式所有权原样移动规则并保持导入顺序，再解除行为类依赖、转换为 SCSS Modules，最后删除已经无引用的旧 CSS。结构迁移阶段不同时调整视觉设计或业务交互。

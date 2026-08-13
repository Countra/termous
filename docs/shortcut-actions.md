# 快捷键动作开发指南

本文说明 Termous Web 中统一快捷键系统的扩展方式。目标是让新增动作能够复用现有设置、冲突检查和上下文解析，同时不破坏 xterm、Ant Design、CodeMirror 或浏览器原生键盘行为。

## 1. 架构概览

快捷键系统分为四层：

```text
ShortcutSettings
  └─ 默认绑定与用户稀疏覆盖
       └─ ShortcutActionRegistry
            └─ 预编译 ShortcutIndex
                 └─ ShortcutRuntime
                      ├─ Window Adapter
                      ├─ xterm Adapter
                      └─ Focus Adapter
                           └─ 当前上下文 Handler
```

- `src/entities/shortcuts/model/registry.ts` 是动作、默认绑定和作用域的唯一目录。
- `src/entities/shortcuts/model/scopes.ts` 定义作用域是否可能同时生效，以及运行时优先级。
- `src/entities/shortcuts/model/reserved.ts` 保护固定的终端、无障碍和编辑器键位。
- `src/entities/shortcuts/model/runtime.ts` 负责录制器、上下文栈、动作解析和 Handler 调度。
- `src/app/shortcut-runtime/ShortcutRuntimeProvider.tsx` 负责设置合并、索引更新、动态显示标签和 Window Adapter。
- 后端只持久化结构化的用户覆盖，不维护前端动作目录。

按键处理必须保持同步。运行时解析过程中不得请求后端，也不应触发与当前动作无关的全局 React 状态更新。

## 2. 动作、Scope 与冲突

每个可配置动作都必须有稳定的 `ShortcutActionId`，并在 Registry 中声明：

- `group`：设置页面中的分组。
- `scope`：动作能够生效的语义上下文。
- `defaultBindings`：当前版本默认绑定，数据库不保存默认值。
- `allowInEditable`：是否允许在输入框或可编辑区域执行。
- `allowRepeat`：是否接受操作系统自动重复按键。

Scope 不是页面名称，而是动作生效条件。例如：

- `terminal.selection`：终端存在选区。
- `terminal.writable`：终端连接可写。
- `terminal.completion.visible`：智能补全候选可交互。
- `files.standalone`：独立文件页。
- `files.list`：独立文件页和工作台文件列表共享。

修改或新增 Scope 时，必须同步检查 `shortcutScopesOverlap`：

- 可能同时出现的 Scope 必须判定为重叠，禁止保存相同绑定。
- 生命周期上确定互斥的 Scope 可以复用按键。
- `app.global` 与所有 Scope 重叠。

外部写入可能绕过前端冲突校验。运行时遇到同一按键对应多个有效动作时必须返回 `ambiguous` 并阻止执行，不能任意选择其中一个。

## 3. Context Stack

组件通过 `runtime.pushContext` 注册上下文：

```ts
const disposeContext = runtime.pushContext({
  id: contextId,
  layer: 'focus',
  priority: 10,
  scopes: ['files.list'],
  isActive: () => listRef.current?.contains(document.activeElement) ?? false,
})
```

Context 层级从低到高为：

```text
global → page → focus → transient
```

同层级使用 `priority` 和注册顺序稳定排序。上下文必须具备唯一、稳定的 ID，并在组件卸载或会话释放时调用 disposer。

### `contextIds` 与 `handlerContextIds`

调用 `runtime.dispatch` 时，两者用途不同：

- `contextIds`：限制参与动作资格判断和 Handler 查找的上下文集合。局部 React Adapter 通常应传入自己的 Context ID，避免其他区域影响解析。
- `handlerContextIds`：动作已经根据有效 Scope 唯一解析后，再限制哪些上下文可以执行 Handler。它不会缩小前面的冲突判定范围。

常见用法：

```ts
runtime.dispatch(event.nativeEvent, {
  adapterId: 'files-page',
  contextIds: [filesContextId],
  editable: false,
})
```

只有确实需要“全局 Scope 参与动作解析，但只允许指定组件执行 Handler”时才使用 `handlerContextIds`。不要用它代替 `contextIds` 隐藏本应被发现的冲突。

## 4. Handler 返回语义

Handler 只能返回以下三种结果：

- `handled`：动作已完成，Adapter 应阻止浏览器或远端继续处理。
- `blocked`：动作匹配但当前状态禁止执行，同样应阻止继续处理。
- `fallthrough`：当前 Handler 不处理，运行时继续查找下一个上下文；全部落空后保留原始按键行为。

建议：

- 状态不满足且原生行为仍有意义时返回 `fallthrough`。
- 动作应被识别但重复提交或危险操作被锁定时返回 `blocked`。
- 只有实际执行或明确消费了事件才返回 `handled`。
- 组件不要自行猜测是否应调用 `preventDefault`；统一根据 dispatch 结果处理。

## 5. Adapter 选择

### Window Adapter

仅用于应用窗口聚焦时真正全局的动作，例如打开主机连接器：

```tsx
<ShortcutWindowAdapter handlers={{
  'app.host_launcher.open': () => {
    openHostLauncher()
    return 'handled'
  },
}} />
```

不要为普通页面动作再创建独立的 `window.addEventListener('keydown', ...)`。

### xterm Adapter

终端按键必须继续由 xterm 的 `attachCustomKeyEventHandler` 在编码输入前处理：

```ts
terminal.attachCustomKeyEventHandler((event) => {
  const result = shortcutRuntime.dispatch(event, {
    adapterId: `xterm:${sessionId}`,
    editable: false,
  })
  if (result.result === 'handled' || result.result === 'blocked') {
    event.preventDefault()
    event.stopPropagation()
    return false
  }
  return true
})
```

返回 `true` 表示将按键原样交给 xterm。无选区的 `Ctrl+C`、原生 Tab 补全、Readline/ZLE/Fish 行编辑以及远端鼠标协议都依赖这一透传规则。

### Focus Adapter

文件列表、编辑器等聚焦区域使用局部 React 事件：

```tsx
<div
  data-shortcut-adapter="example-list"
  onKeyDown={(event) => {
    const result = runtime.dispatch(event.nativeEvent, {
      adapterId: 'example-list',
      contextIds: [contextId],
      editable: false,
    })
    if (result.result === 'handled' || result.result === 'blocked') {
      event.preventDefault()
      event.stopPropagation()
    }
  }}
/>
```

`data-shortcut-adapter` 是局部按键所有权标记，不是样式标记。终端视口等上层组件会据此避让已由子区域接管的按键；Window Adapter 仍会在 capture 阶段观察事件，但 `handlerContextIds` 只允许它执行 Window Context 的 Handler，局部 Adapter 再通过 `contextIds` 限制自身处理范围。三者共同避免同一真实按键重复执行。

组件自身必须优先处理固定的 WAI-ARIA 导航键，再将剩余按键交给统一运行时。

## 6. 录制器优先级

设置页录制快捷键时通过 `runtime.pushRecorder` 注册瞬态录制器。录制器优先于所有业务 Context：

- 录制期间任何真实业务动作都不能执行。
- 录制区域必须使用 `data-shortcut-adapter`，避免 Window Adapter 提前消费事件。
- 录制结束、Modal 关闭或组件卸载时必须释放 recorder。
- `keyup` 或窗口失焦时必须释放非重复按键锁存状态。
- IME composing、`Dead`、`Process`、`Unidentified` 和纯修饰键继续由标准规范化器过滤。

不要在录制组件中另写一套按键解析或展示字符串拼接逻辑。

## 7. 固定保留键

以下行为不开放自定义：

- `Tab`：Shell 原生补全、焦点遍历和编辑器缩进。
- `Escape`：关闭候选、弹窗、菜单和拖拽等安全退出。
- `ContextMenu`、`Shift+F10`：键盘上下文菜单。
- Tab、菜单、书签和列表的 Arrow/Home/End/Page 导航。
- 文件列表 `Space` 选择和调整手柄方向键。
- 搜索框 Enter、Shift+Enter、Escape。
- 无选区终端 `Ctrl+C` 中断。
- CodeMirror 内部编辑键。
- Electron 连续两次 `Ctrl+Shift+Alt+F` 诊断入口。

新增固定保留项时，应扩展 `reserved.ts` 并补充中文原因和测试；不要仅在设置 UI 中隐藏。

## 8. 动态快捷键提示

界面不得硬编码 `Ctrl+V`、`Enter` 等显示文本。使用运行时提供的动态标签：

```ts
const labels = useShortcutLabels('terminal.paste')
```

如逻辑只关心绑定是否变化，应使用结构化 `bindingSignatures`，不能依赖平台化展示文本。动作没有绑定时，不显示虚假的 `kbd` 或快捷键提示。

## 9. 新增全局动作示例

假设新增 `app.command_palette.open`：

1. 在 `SHORTCUT_ACTION_IDS` 中加入稳定 ID。
2. 在 Registry 中声明分组、`app.global` Scope 和默认绑定。
3. 为动作名、说明、Scope 和相关状态补齐中英文翻译。
4. 在应用组合根的 `ShortcutWindowAdapter` 注册 Handler。
5. 增加 Registry、冲突、设置和集成测试。

```ts
action('app.command_palette.open', 'global', 'app.global', [
  chord('KeyP', 'P', ['control', 'shift']),
], { allowInEditable: true })
```

```tsx
<ShortcutWindowAdapter handlers={{
  'app.command_palette.open': () => {
    openCommandPalette()
    return 'handled'
  },
}} />
```

## 10. 新增聚焦动作示例

假设为某个资源列表增加 `resources.open_focused`：

1. 新增动作 ID、分组和 Scope；如需新 Scope，同步更新 Scope 类型、重叠关系和优先级。
2. 组件创建稳定 Context ID，并用 ref 保存 Handler 所需的最新业务状态。
3. `pushContext` 的 `isActive` 必须检查页面、焦点和资源状态。
4. 注册 Handler，并在 effect cleanup 中释放 Handler 和 Context。
5. 列表根节点增加 `data-shortcut-adapter`，局部 dispatch 显式传入 `contextIds`。

```ts
useEffect(() => {
  const disposeContext = runtime.pushContext({
    id: contextId,
    layer: 'focus',
    scopes: ['resources.list'],
    isActive: () => rootRef.current?.contains(document.activeElement) ?? false,
  })
  const disposeHandler = runtime.registerHandler(
    contextId,
    'resources.open_focused',
    () => {
      const resource = focusedResourceRef.current
      if (!resource) return 'fallthrough'
      openResource(resource)
      return 'handled'
    },
  )
  return () => {
    disposeHandler()
    disposeContext()
  }
}, [contextId, runtime])
```

示例中的新 ID 和 Scope 还必须加入相应 TypeScript 联合类型；不能只在组件内使用字符串绕过 Registry。

## 11. 国际化与测试

每个动作至少需要：

- 中文和英文动作名称。
- 中文和英文动作说明。
- 分组及 Scope 的展示文本。
- 冲突、保留原因和保存错误的对应文案。

建议测试层次：

1. Registry：ID 唯一、默认绑定合法、最多两组。
2. Scope：重叠和互斥关系正确。
3. Reservation：固定键不能保存，动作自身合法默认值不被误伤。
4. Runtime：上下文优先级、`contextIds`、`handlerContextIds`、IME、repeat 和 fallthrough。
5. Integration：不存在被迁移动作的旧硬编码分支，同一按键只进入一个 Adapter。
6. i18n：中英文键集合一致，所有动作都有展示文案。
7. 浏览器联调：焦点切换、Modal、Popover、xterm、分屏、断线和高延迟场景。

## 12. 提交前检查清单

- 动作是否进入唯一 Registry，而不是组件私有映射。
- 默认绑定是否只存于前端 Registry。
- Scope 是否准确，重叠关系是否经过测试。
- Handler 是否返回了正确的三态结果。
- Focus Adapter 是否带 `data-shortcut-adapter` 和明确 `contextIds`。
- 是否保留未匹配按键的原生行为。
- 是否移除了被替代的旧硬编码分支。
- 菜单和帮助提示是否读取实际绑定。
- 中英文文案和自动测试是否完整。
- 是否避免使用 Electron `globalShortcut`。
- 是否避免新增独立全局 `keydown`。
- 是否避免保存或展示 `"Ctrl+H"` 之类的平台硬编码字符串。

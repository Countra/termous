# 桌面托管浮层

## 模块组织

- `common/contracts/desktop-controls.ts`：展示 DTO、快照校验和控制引用比较。
- `electron/desktopIndicator`：`connection` 负责固定 Core 接口，`windows` 管理生命周期，`geometry` 处理 DIP 定位，`platform` 处理系统差异，`ipc` 限制可信窗口操作，`feedback` 在浮层隐藏后报告收回失败。`runtime` 只装配。
- `electron/desktop-indicator-preload.ts`：独立沙箱构建，仅提供状态与收回接口。
- `entities/desktop-control`：公共标记、橙色样式和只读快照订阅。
- `features/desktop-control`：订阅 Hook 与托管条交互。
- `app/desktop-indicator-surface`：独立 Renderer，不加载主工作区和 Agent Runtime。
- 原 `DesktopAutomationStatus` 保留协议查看、期限和业务包装；收回改用已显示的统一引用。

## 展示层次

系统状态条采用 14px 主状态、12px 桌面／来源说明，以及独立的橙色收回按钮。AI 来源优先展示实际桌面名称，避免重复技术客户端名称；其他来源保留名称并在超长时省略，完整内容可通过悬停查看。鼠标徽标使用 12px 的“AI 托管”等来源短标签，保持点击穿透。

状态条原生窗口为 392×80 DIP，内容为 376×64 DIP；徽标窗口为 168×40 DIP，内容高度为 30 DIP。窗口内预留边距容纳阴影和焦点轮廓，定位继续使用同一 DIP 工作区算法。深浅主题复用项目字体和颜色，实心橙色按钮分别使用深色／白色文字。收回等待时显示加载图标；减少动画偏好下停止旋转。

软件内托管条复用同一收回按钮样式，并提高状态与倒计时的字号及对比度。展示调整不改变授权、订阅、输入、收回引用或窗口焦点策略。

## 生命周期与平台

系统鼠标保持原样。徽标为点击穿透窗口，状态条提供显式收回按钮；两个窗口都使用 `showInactive`，不主动获取焦点。仅活动的本机控制启动 34ms 定位定时器，坐标未变化不更新窗口，状态条在鼠标所在显示器工作区右下角定位。

Windows、macOS、Linux X11 使用同一视觉实现。macOS 配置跨 Space／全屏可见；Windows 和 macOS 尝试内容保护，Linux 不承诺截图排除。Wayland 按现有能力边界不启动浮层。内容保护不改变后端采集、视频或 HDR 转换。

连接使用全量快照和后端心跳，断线隐藏、重连恢复。窗口崩溃隐藏并重建；所有这些操作都不调用收回。仅状态条主 Frame 可以提交当前本机引用，主进程再次校验并从可信快照构造请求。后端仍须独立校验。

无效快照或连接错误立即清空展示，不等待对端完成关闭握手，也不接受该连接的迟到状态。浏览器订阅在握手期间卸载时复用公共 WebSocket 退役机制。浮层关窗遵循已有退出协调器：已确认退出时不重建，取消退出时继续展示，最终在 `will-quit` 释放连接和 IPC。

## 验证

```text
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build:renderer:app
node scripts/desktop/run-indicator-acceptance.mjs
```

原生验收使用已构建 Renderer 与专用 preload，启动隔离的模拟 Core，不访问真实开发数据、不注入系统输入。检查置顶、不抢焦点、受限 IPC、收回后隐藏、新引用恢复、断线、Renderer 崩溃恢复、取消退出与确认退出。测试产物与 Electron profile 位于工作区 `TEMP/desktop-indicator`，pnpm 缓存保持默认。

组件视觉检查优先使用 In-app Browser。每个平台正式发布前还需实测点击穿透、实际多显示器与混合 DPI、显示器热插拔、macOS Space／全屏、截图保护和正式安装包资源路径；自动测试不能替代这些平台验证。

## 本次验证记录（2026-10-27）

- typecheck、完整 lint、样式检查与架构检查通过。
- 完整 Node 测试 2,616 通过、4 跳过；完整 UI 测试 407 个文件、3,377 个用例通过。随后新增的清理失败反馈回归包含在单独重跑通过的 6 个托管条用例中。
- 正式 Renderer、Electron 主进程及独立沙箱 preload 构建通过；已有 Worker 产物检查通过。
- In-app Browser 检查深色／浅色托管条、AI 徽标及点击收回后的隐藏。
- Windows 原生验收通过，覆盖正式构建的本地文件加载、沙箱、置顶、不主动抢焦点、引用校验、收回、新授权、断线和 Renderer 崩溃恢复；使用模拟 Core，未注入真实键鼠输入。
- macOS、Linux X11、真实多屏与截图排除、正式安装包尚未实测。
- 可读性调整后通过 typecheck、完整 lint／架构检查、4 项合同／定位／IPC 测试和 6 项托管条 UI 回归，重新完成正式构建及 Windows 原生验收。In-app Browser 检查了深浅主题、中英文、长名称与收回后隐藏；记录位于 `TEMP/desktop-indicator-redesign-*.log`。
- 工作区复查修复了退出协调、订阅所有者结束后的通道关闭，以及异常快照等待关闭握手期间残留展示的问题。相关 Go 回归与 race、前端 typecheck／完整 lint／架构检查、正式构建、Windows 原生验收通过；完整 Node 测试 2,623 通过、4 跳过。
- 本次完整 UI 回归为 3,387 通过、1 失败。失败来自原有远控文件用例把“未禁用”误当成“已退出加载态”；补齐等待条件后，该文件与本机审批、托管条共 21 项定向测试通过，未重复运行整个 UI 套件。复查日志位于 `TEMP/desktop-controls-review-*.log`。

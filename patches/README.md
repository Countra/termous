# noVNC 桌面能力补丁

固定依赖 `@novnc/novnc@1.7.0`。唯一补丁已移至相邻 [termous-remote/patches](../../termous-remote/patches/README.md)，本仓库通过 `pnpm-workspace.yaml` 的 `patchedDependencies` 引用并由 lockfile 校验。正常安装时修改依赖源码，不在运行时替换实例方法。上游 MPL-2.0 许可证与源文件声明保持不变。

新增公共扩展：

- `sendPointer(x,y,mask)`：远端绝对像素坐标，不重复应用视口偏移。
- `localInputEnabled`：独立控制 DOM 键鼠／手势捕获及自动尺寸请求；停用时释放旧按键、按钮和延迟移动。授权程序输入仍可发送。
- `desktopState`、`desktopframe`、`captureDesktop(afterSequence,signal)`：完整 FBU 和异步绘制完成后固定画面边界。只在有截图请求时复制像素，使用现有公开 `getImageData()`，不增加每帧全屏复制。

画面序号在同一连接中跨尺寸递增；尺寸变化后首帧完成前对外返回序号 0。这样既能拒绝未完成画面，又能让未固定尺寸代次的 `afterSequence` 请求正确等待新尺寸画面。

业务层只依赖这些扩展及既有公开 API。协议输入和截图逻辑集中在共享仓库 `browser/vnc`，本机 runtime 保留薄适配出口。UI 不访问 noVNC 私有字段；Electron 与 Android WebView 使用同一实现。

升级时先 `pnpm patch @novnc/novnc@<version> --edit-dir <workspace TEMP 中的目录>`，检查 RFB 更新完成／flush、键盘 ungrab、鼠标延迟事件和视口坐标实现，再移植补丁并执行 `pnpm patch-commit <目录>`。不得只修改版本号或移除补丁。

运行 `node scripts/desktop/fixture-server.mjs` 并用 In-app Browser 打开 `http://127.0.0.1:5191/scripts/desktop/fixture.html`；必须验证 Raw、CopyRect、Tight PNG 异步绘制、绝对坐标和截图缩放。Core 完整桥接测试见相邻 backend 仓库 `docs/desktop-service.md`。

执行 UI 测试：`pnpm exec vitest run src/features/remote-desktop src/widgets/remote-desktop-workspace`。测试 noVNC 升级时必须再运行真实浏览器夹具，jsdom 测试无法验证真实 Canvas 绘制顺序。

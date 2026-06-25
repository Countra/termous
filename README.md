# Termous Web

Electron + React + xterm.js 前端工作站。

## 功能范围

- 工作站页：主机上下文、本地终端入口、终端标签、xterm.js 终端、连接状态、当前连接详情。
- 主机页：主机配置、系统 SSH/密码/私钥认证方式、凭据引用、一层跳板机引用、标签和备注。
- 凭据库页：密码、私钥、私钥口令的加密持久化入口和绑定状态。
- 设置页：首版只包含语言切换。
- i18n：简体中文 `zh-CN` 和英文 `en-US`。
- 桌面壳：自定义 Electron 窗口 chrome，去除默认菜单，终端区域优先适配窗口缩放。

## 本地运行

```powershell
pnpm install
pnpm dev --host 127.0.0.1 --port 5173
```

开发联调时需要后端提供：

```powershell
$env:VITE_TERMOUS_API_BASE_URL='http://127.0.0.1:8122'
```

Vite 开发模式默认使用 `dev-token`，与后端本地开发默认值一致。真实 SSH 是后端默认模式；如需使用自定义 token 联调，再显式设置 `VITE_TERMOUS_API_TOKEN`。

长期 dev server 运行请使用 workspace 的 process-manager，不要直接挂起终端进程。

## 验证

```powershell
pnpm lint
.\node_modules\.bin\tsc.CMD --noEmit
pnpm build
```

说明：当前 Windows 环境下 `pnpm exec tsc` / `pnpm exec vite` 可能无法解析本地 `.bin`，可直接调用 `node_modules\.bin` 下的 `.CMD`。

## 安全边界

- Renderer 不暴露裸 `ipcRenderer`。
- preload 只暴露 `termous.getConfig()`、平台信息和固定窗口控制方法。
- 终端输出直接写入 xterm.js，不进入 React 高频 state。
- 前端不保存明文密码、私钥或私钥口令。

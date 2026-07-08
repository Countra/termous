<div align="center">
  <img src="./docs/assets/termous-icon.png" width="96" alt="Termous 图标" />
  <h1>Termous</h1>
  <p><strong>面向服务器管理的现代化 SSH 工作站</strong></p>
  <p>
    <a href="./README.en.md">English</a>
    ·
    <a href="https://github.com/Countra/termous/releases">下载</a>
    ·
    <a href="./docs/CHANGELOG.md">更新日志</a>
    ·
    <a href="https://github.com/Countra/termous/issues">反馈问题</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-5b8cff?style=flat-square" alt="平台支持" />
    <img src="https://img.shields.io/badge/i18n-简体中文%20%7C%20English-5b8cff?style=flat-square" alt="多语言" />
    <img src="https://img.shields.io/badge/SSH-Workstation-5b8cff?style=flat-square" alt="SSH 工作站" />
  </p>
</div>

Termous 把 SSH 连接、主机管理、远程文件、端口转发、系统监控、防火墙和常用命令整合到一个桌面工作台中。它面向经常在多台服务器之间切换的开发者、运维人员和技术团队，目标是减少窗口切换、降低误操作，并让每一次连接都带着完整上下文。

## 为什么选择 Termous

| 痛点 | Termous 的解决方式 |
| --- | --- |
| 主机、凭据、终端和文件工具分散 | 用一个工作站统一管理连接、文件和运维操作 |
| 多个 SSH 会话容易混乱 | 通过会话标签、颜色、固定、复制和分屏保持清晰上下文 |
| 远程文件操作不够顺手 | 提供 SFTP、拖拽上传下载、目录书签、本地目录映射和在线查看编辑 |
| 常用命令重复输入 | 用代码片段保存常用命令，一键插入或发送到当前会话 |
| 临时排障缺少集中视图 | 在连接详情中查看系统信息、资源监控、防火墙和端口转发 |

## 快速开始

1. 从 [Releases](https://github.com/Countra/termous/releases) 下载适合当前系统的安装包。
2. 打开 Termous，新增主机并选择密码、私钥、私钥口令或系统 SSH 方式。
3. 点击顶部的“连接”，选择目标主机后进入 SSH 工作站。
4. 在右侧功能区查看主机概览、系统信息、系统监控、防火墙和端口转发。
5. 在“文件”页面管理远程目录、书签、本地目录映射和传输任务。

## 功能亮点

### SSH 工作站

- 多 SSH 会话标签，支持复制、重命名、固定和颜色标记。
- 支持终端分屏，适合并行查看日志、执行命令和对比环境。
- 支持本地 PowerShell / CMD 会话。
- 支持终端字体、字号、行高、字符间距、光标和主题设置。

### 主机与凭据

- 主机分组、标签、收藏、最近使用和在线延迟检测。
- 支持密码、私钥、私钥口令和系统 SSH 方式。
- 支持自定义主机图标、备注、跳板机和平台信息。
- 凭据与主机分离管理，避免在多个主机配置中重复维护敏感信息。

### 远程文件

- SFTP 多会话文件管理。
- 支持上传、下载、移动、删除、重命名和权限设置。
- 支持拖拽上传到当前目录或指定文件夹。
- 支持远程目录书签、本地目录快捷映射和传输历史。
- 支持文本文件在线编辑和图片文件在线预览。

### 运维辅助

- 常用代码片段管理与发送。
- 本地端口转发、远程端口转发和动态代理。
- Linux 系统信息展示。
- CPU、内存、网络和磁盘监控。
- iptables / nftables 防火墙规则管理与持久化辅助。

### 桌面体验

- 自定义窗口、托盘菜单和最小化到托盘。
- 暗色 / 亮色主题。
- 关闭前连接清理提醒。
- 简体中文和英文界面。

## 适合场景

- 日常登录多台 Linux 服务器处理问题。
- 在 SSH 会话和远程文件之间频繁切换。
- 同时观察系统资源、查看配置文件和执行诊断命令。
- 临时配置端口转发或代理通道。
- 希望把常用服务器命令沉淀为可复用片段。

## 安全与隐私

Termous 的定位是本地桌面工作站。它优先把连接和凭据信息保存在用户自己的设备上，并尽量让敏感操作在本地完成。凭据、主机和会话相关能力围绕“本机可控、清晰可见、减少误操作”设计。

## 平台支持

- Windows
- macOS
- Linux

Windows 桌面体验会优先完善，macOS 和 Linux 体验会逐步补齐。

## 获取帮助

- 查看 [更新日志](./docs/CHANGELOG.md) 了解版本变化。
- 通过 [GitHub Issues](https://github.com/Countra/termous/issues) 反馈问题或提出建议。

<div align="center">
  <img src="./docs/assets/termous-icon.png" width="96" alt="Termous icon" />
  <h1>Termous</h1>
  <p><strong>An SSH workstation for connections, files, remote desktops, and AI</strong></p>
  <p>
    <a href="./README.md">简体中文</a>
    ·
    <a href="https://github.com/Countra/termous/releases">Download</a>
    ·
    <a href="./docs/CHANGELOG.md">Changelog</a>
    ·
    <a href="https://github.com/Countra/termous/issues">Issues</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-5b8cff?style=flat-square" alt="Platforms" />
    <img src="https://img.shields.io/badge/i18n-简体中文%20%7C%20English-5b8cff?style=flat-square" alt="Languages" />
    <img src="https://img.shields.io/badge/SSH-Workstation-5b8cff?style=flat-square" alt="SSH workstation" />
  </p>
</div>

Termous brings SSH terminals, RDP / VNC remote desktops, multi-protocol file management, server operations, and an AI assistant into one desktop application. Hosts, connection profiles, and tasks stay connected as you work across servers and access methods.

Core features run locally without a cloud account. Configuration sync and device-to-device remote control are optional, and MCP connects external AI tools to authorized operations.

## Use cases

| Scenario | How Termous helps |
| --- | --- |
| Development and server maintenance | Keep hosts, terminals, file directories, snippets, and port forwarding in one workstation |
| Working across multiple hosts | Split sessions, send commands through the session command console, and inspect each session's output and results |
| Graphical remote tasks | Connect over RDP / VNC, exchange files when needed, and turn repetitive actions into automation workflows |
| AI-assisted troubleshooting | Share connections, terminal selections, or images with the assistant, then inspect and act within granted permissions and approvals |
| Working across devices | Optionally sync connection configuration or access resources explicitly authorized on another trusted device |

## Quick start

1. Download the installer for your platform from [Releases](https://github.com/Countra/termous/releases).
2. Add a host and the SSH, file, or remote desktop profiles you need. Each host can have multiple profiles.
3. Use Connect in the top bar or `+` in the session bar. The workstation, file manager, and remote desktop open their corresponding connection choices.
4. For AI, add a service and model under Settings → Model Services, then choose the default model under Settings → AI Assistant. Associate connections from session menus or send selected terminal text.
5. For cloud sync or remote control, sign in, authorize your device, and confirm the sync scope or remote access permissions.

A host organizes connection profiles and does not require an SSH connection. You can add only an RDP desktop or an independent object-storage profile. File operations, desktop authentication options, and system integrations depend on the selected protocol, configuration, and platform.

## Features

### Hosts and connection profiles

Organize access methods around each host without duplicating its asset information for terminals, files, and desktops.

- Groups, tags, favorites, custom icons, and multiple profiles help distinguish environments and purposes.
- Profiles reference separately managed credentials. SSH supports passwords, private keys and passphrases, jump hosts, and HTTP / SOCKS5 proxies.
- Centralized SSH host-key confirmation and connection keepalive, with protocol-specific authentication and access options for files and desktops.
- The top-bar connection action follows the current workspace. Session-bar `+` menus offer matching profiles, search, and details on hover.

### SSH workstation

- Session tabs and split terminals, with pinning, renaming, color labels, duplication, and search for work across multiple hosts.
- Directory following between the terminal and SFTP reduces repeated navigation when switching to file management.
- Send commands to the current, selected, or all connected sessions through the command console. Inspect separate output, exit codes where available, and interruption state.
- Manage snippets, command completion, and Bash / Zsh / Fish aliases, with alias synchronization across hosts.
- Optional natural-language AI command suggestions are off by default. Suggestions are inserted into the input area for you to review and execute.

### Remote desktops

RDP and VNC use sessions independent of terminals and files, with direct or SSH-tunneled connections as needed.

- Full screen, display scaling, session menus, and connection quality and status information.
- Retained RDP sessions, resumed viewing, and separate viewing and control modes let you continue an existing connection after leaving the page.
- Desktop tools provide file exchange and automation. The file sidebar remembers its latest tab, and the transfer indicator opens progress directly.
- Control-state and pointer indicators show when a desktop is being operated. Local users can reclaim input control.

### Desktop automation

Save repetitive graphical operations as workflows for repeatable desktop tasks and visual regression checks.

- Visually compose pointer actions, keystrokes, text input, image matching, conditions, and loops, with parameters for reuse.
- Select coordinates or create image templates from a desktop screenshot. Zoom, pan, move and resize selections, and undo or redo selection edits.
- Validate and save workflow versions before running, then pause, resume, step through, or cancel execution to investigate problems.
- Inspect per-step inputs, results, screenshots, and image templates in run history, with controls to expand or collapse all details.
- Edit and inspect runs in a separate window, with an entry to the target desktop. Display zoom does not change saved coordinates.

### Files and local mounts

File protocols share browsing, editing, previews, and transfers, with operations enabled according to storage capabilities.

- SFTP, S3 / MinIO, WebDAV, FTP / FTPS, and SMB. SFTP uses an associated SSH profile; other protocols can have independent access configuration.
- Text editing, image previews, bookmarks, and directory-size calculation. Linux file-name search can use an optional remote component.
- Cross-connection copies, distribution to multiple targets, and batch rename with previews reduce repetitive transfers and organization work.
- Centralized progress, results, and failure details, plus drag-and-drop uploads. Windows also supports system file copy and paste and RDP file clipboard integration.
- Mount file profiles as local drives or directories, with read-only access, automatic startup, synchronization, reconnection, and unmounting.
- Persistent mount caching downloads content on demand, with configurable capacity and reserved disk space. It reuses downloaded content without providing offline access.

Mounts require separately installed WinFsp on Windows, FUSE3 on Linux, or macFUSE on macOS. The application provides environment checks and status information.

### Server operations and networking

- Linux resource monitoring and processes, alongside systemd services, scheduled tasks for the current user, and iptables / nftables firewalls.
- Docker resources organized into containers, images, volumes, and networks, with search, details, common start and stop actions, logs, and container terminals.
- Image-tag management, creation and deletion of volumes and bridge networks, and container network attachment and detachment.
- Local and remote port forwarding and dynamic proxies, with saved profiles, automatic connection on Core startup, status, traffic, and failure details.

### AI assistant and MCP

The assistant works with actual connection resources to explain output, investigate problems, manage files, and perform authorized maintenance tasks.

- Custom model services and model selection, with text, image attachments, terminal selections, and references to SSH, files, desktops, and automation workflows.
- Concurrent conversations, queued messages, reordering, editing of pending messages, and task cancellation. SSH commands use coordinated execution queues.
- Context compaction, searchable history, groups, pinned and archived conversations, and model usage. Open the assistant in a separate window and return it to the main interface.
- Tool activity retains progress, results, and approval information so you can review commands, target resources, and operation scope before granting access.
- External AI tools use authorized capabilities through MCP, with permissions and approval policies managed per client. Installing skills does not grant access.
- Bundled [Termous Skills](https://github.com/Countra/termous-skills) cover connections, files, server operations, desktops, and automation. Install them from MCP settings for Codex, Claude Code, or a custom directory.

### Device-to-device remote control

Continue working with resources shared by another Termous device without copying all of that device's connection configuration to the controller.

- Access authorized terminals, files, and RDP / VNC desktops between trusted devices on the same account, switching workspaces in a separate remote window.
- The host device defines access to host profiles, file directories, and desktop capabilities. Local directories require explicit authorization, and remote access is off by default.
- Separately enable access to the host device's AI assistant, using its model configuration and tool permissions. Conversations become available when the host assistant is ready.
- Desktop viewing and input control are separate. Local users can reclaim input control and inspect connection and transfer status.

### Cloud account and configuration sync

- Optional account and QR sign-in, profile management, two-factor authentication, and trusted devices, alongside local features that need no account.
- Preview and confirm differences between local and cloud configuration when first enabling sync. Subsequent changes can sync automatically within the confirmed scope. Signing in or authorizing a device does not automatically upload local configuration.
- End-to-end encrypted configuration, with personal recovery keys, approval from another trusted device, and optional managed cloud recovery.
- Uses the official cloud service by default, with support for another compatible service. Remote file contents, AI conversations, and machine-local settings are outside configuration sync.

See [Cloud accounts and sync](./docs/cloud-account.md) for details.

### Notifications, auditing, and desktop experience

- A message center for task results, pending approvals, and cloud account notices, with navigation back to relevant tasks.
- System notifications follow your preferences when no Termous window has focus. Switching between the main window and child windows does not trigger them.
- Local AI and MCP auditing with filters, search, approvals, task results, and related events. Ordinary manual operations are outside the audit scope.
- Settings open in a dialog that preserves your workspace. Pages requiring explicit saving use a consistent page-level save action and protect unsaved changes.
- Light and dark themes, configurable shortcuts, Chinese and English UI, tray support, in-app updates, and startup progress and module status.
- Encrypted `.tobp` configuration backups with full or selective restore. Exit checks for unsynchronized mount changes help protect pending writes.

## Security and privacy

- Credentials use protected local storage. SSH host-key checks, MCP permissions, and operation approvals govern access.
- AI conversations, selected attachments, and relevant tool results are sent to your configured model service. Conversation history is stored locally.
- Cloud sync is independent of local features and backups. Optional managed cloud recovery gives the service the ability to recover data keys; enable it according to your needs.
- Remote access follows the host device's permissions. Operation records may contain commands or paths; review sensitive content before sharing them.

## Platforms

| Platform | Packages |
| --- | --- |
| Windows x64 | `.exe` |
| macOS x64 / arm64 | `.dmg`, `.zip` |
| Linux x64 | `.AppImage` |

Windows is the primary platform, with macOS and Linux support continuing to improve. Some system integrations depend on the platform and runtime environment.

## Documentation and feedback

- [Changelog](./docs/CHANGELOG.md)
- [Frontend architecture](./docs/frontend-architecture.md) · [AI runtime](./docs/electron-agent-architecture.md) · [Desktop automation](./docs/remote-desktop-workflows.md)
- [GitHub Issues](https://github.com/Countra/termous/issues)

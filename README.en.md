<div align="center">
  <img src="./docs/assets/termous-icon.png" width="96" alt="Termous icon" />
  <h1>Termous</h1>
  <p><strong>A modern SSH workstation for server management</strong></p>
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

Termous brings SSH connections, hosts and credentials, remote files, server operations, network forwarding, and reusable commands into one desktop workspace. It is built for developers, operators, and technical teams who move between many servers every day, with a focus on less context switching, fewer mistakes, and clear context across terminals, files, and host state.

## Why Termous

| Problem | How Termous Helps |
| --- | --- |
| Hosts, credentials, terminals, and file tools are scattered | Manage connections, files, and remote operations from one workstation |
| Complex networks require several connection tools | Configure a jump host or HTTP / SOCKS5 proxy per host and share the route across SSH, SFTP, and forwarding |
| Multiple SSH sessions are hard to track | Keep context clear with tabs, colors, pinning, duplication, and split panes |
| Terminals and remote files require constant switching | Use SFTP, directory following, bookmarks, and the workstation file panel in the same session |
| Common commands and server actions are repeated | Use snippets, Shell aliases, and integrated process, service, and Docker management |

## Quick Start

1. Download the installer for your platform from [Releases](https://github.com/Countra/termous/releases).
2. Open Termous, add a credential and host, then configure a jump host or connection proxy when needed.
3. Click "Connect" in the top bar and choose the target host to enter the SSH workstation.
4. Use the right-side workspace for files, system information, monitoring, processes, services, Docker, firewall, port forwarding, aliases, and snippets.
5. When you need more space, use the standalone "Files" page for remote directories, bookmarks, local download locations, and transfers.

## Highlights

### SSH Workstation

- Multiple SSH session tabs with duplication, renaming, pinning, and color labels.
- Terminal split panes for logs, commands, and environment comparisons.
- Context-aware smart completion from enabled aliases, safe single-line snippets, persisted remote history, and directory candidates for `cd` / `pushd`.
- Completion inserts a candidate without executing it; Tab always remains available for the remote Shell's native completion.
- Terminal search and a context-aware menu for copy, find, paste, opening supported HTTP/HTTPS links, and locating remote paths in the workstation file panel.
- Bidirectional directory following between the terminal and workstation file panel, with compact remote bookmarks.
- Local PowerShell / CMD sessions on Windows.
- Terminal font, size, line height, letter spacing, cursor, and theme settings.

### Hosts, Credentials, And Connection Proxies

- Host groups, tags, favorites, recent hosts, and latency checks.
- Password and private-key authentication, including encrypted private keys associated with passphrase credentials.
- Custom host icons, notes, jump hosts, and platform information.
- Per-host unauthenticated HTTP or SOCKS5 proxies, with no automatic direct fallback after a proxy failure.
- One host-key trust flow shared by SSH, jump hosts, SFTP, and port forwarding.
- Credentials are managed separately from hosts to avoid repeating sensitive data.

### Remote Files And Directory Following

- Multi-session SFTP file management.
- Upload, download, move, delete, rename, and permission management.
- Drag uploads into the current directory or a specific folder.
- Remote bookmarks, local download locations, and a transfer list with live progress.
- Online text file editing and image preview.
- Bidirectional directory sync between the terminal and workstation file panel, with the last successful directory preserved and manual recovery available after a disconnect.

### Server Operations

- Linux system information.
- CPU, memory, network, and disk monitoring.
- Linux process browsing, search, and termination.
- systemd service state, controls, and logs.
- Docker container state, controls, details, and logs.
- iptables / nftables firewall rule management and persistence assistance.

### Commands And Networking

- Reusable snippets with groups, variables, and send-to-session actions.
- Termous-managed command aliases for Bash, Zsh, and Fish.
- Completion indexes are warmed asynchronously after SSH is ready, never scan remote `$PATH`, and cannot block terminal, SFTP, or directory-following workflows when a provider fails.
- Local forwarding, remote forwarding, and dynamic proxy.
- Running forwards expose connection counts, cumulative traffic, live send/receive rates, restart, and stop actions.

### Data, Security, And Desktop Experience

- Custom desktop window, tray menu, and minimize to tray.
- Dark and light themes.
- In-app update checks, downloads, and installation.
- Encrypted `.tobp` backups with full, merge, and selective restore modes.
- Connection cleanup reminder before closing.
- Simplified Chinese and English UI.

## Use Cases

- Log in to multiple Linux servers during daily work.
- Switch frequently between SSH sessions and remote files.
- Monitor resources, manage processes and services, read configuration files, and run diagnostics.
- Create temporary port forwards or proxy channels.
- Save common server commands as reusable snippets or remote Shell aliases.

## Security And Privacy

Termous is designed as a local desktop workstation. Credentials are managed by a local Vault, and SSH host identity is verified through a unified fingerprint trust flow. Encrypted backups do not export the current device's Vault master key, and downloaded updates are verified before installation. Connection proxies currently accept only unauthenticated HTTP and SOCKS5 endpoints so proxy credentials do not enter host configuration, logs, or backups. Smart completion keeps bounded remote history and directory indexes only in memory for the current SSH session; they are never written to the local database, backups, LocalStorage, or logs, and are released when the session closes.

## Platform Support

- Windows
- macOS
- Linux

The Windows desktop experience is polished first, with macOS and Linux support improving over time.

## Help And Support

- Read the [changelog](./docs/CHANGELOG.md) for release updates.
- Use [GitHub Issues](https://github.com/Countra/termous/issues) to report problems or suggest improvements.

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

Termous brings SSH connections, host management, remote files, port forwarding, system monitoring, firewall tools, and reusable commands into one desktop workspace. It is built for developers, operators, and technical teams who move between many servers every day, with a focus on less context switching, fewer mistakes, and clearer connection state.

## Why Termous

| Problem | How Termous Helps |
| --- | --- |
| Hosts, credentials, terminals, and file tools are scattered | Manage connections, files, and operations from one workstation |
| Multiple SSH sessions are hard to track | Keep context clear with tabs, colors, pinning, duplication, and split panes |
| Remote file work is slower than it should be | Use SFTP, drag-and-drop transfers, bookmarks, local path mappings, and online viewing or editing |
| Common commands are typed repeatedly | Save commands as snippets and insert or send them to the active session |
| Troubleshooting lacks a single view | Inspect host details, system information, monitoring, firewall rules, and port forwarding together |

## Quick Start

1. Download the installer for your platform from [Releases](https://github.com/Countra/termous/releases).
2. Open Termous, add a host, and choose password, private key, private key passphrase, or system SSH authentication.
3. Click "Connect" in the top bar and choose the target host to enter the SSH workstation.
4. Use the right-side workspace to inspect overview, system information, monitoring, firewall, and port forwarding.
5. Use the "Files" page to manage remote directories, bookmarks, local path mappings, and transfers.

## Highlights

### SSH Workstation

- Multiple SSH session tabs with duplication, renaming, pinning, and color labels.
- Terminal split panes for logs, commands, and environment comparisons.
- Local PowerShell / CMD sessions.
- Terminal font, size, line height, letter spacing, cursor, and theme settings.

### Hosts And Credentials

- Host groups, tags, favorites, recent hosts, and latency checks.
- Password, private key, private key passphrase, and system SSH modes.
- Custom host icons, notes, jump hosts, and platform information.
- Credentials are managed separately from hosts to avoid repeating sensitive data.

### Remote Files

- Multi-session SFTP file management.
- Upload, download, move, delete, rename, and permission management.
- Drag uploads into the current directory or a specific folder.
- Remote bookmarks, local path shortcuts, and transfer history.
- Online text file editing and image preview.

### Operations

- Reusable command snippets.
- Local forwarding, remote forwarding, and dynamic proxy.
- Linux system information.
- CPU, memory, network, and disk monitoring.
- iptables / nftables firewall rule management and persistence assistance.

### Desktop Experience

- Custom desktop window, tray menu, and minimize to tray.
- Dark and light themes.
- Connection cleanup reminder before closing.
- Simplified Chinese and English UI.

## Use Cases

- Log in to multiple Linux servers during daily work.
- Switch frequently between SSH sessions and remote files.
- Monitor resources while reading configuration files and running diagnostics.
- Create temporary port forwards or proxy channels.
- Save common server commands as reusable snippets.

## Security And Privacy

Termous is designed as a local desktop workstation. It keeps connection data and credentials on the user's own device whenever possible, and it is built around local control, visible state, and reducing accidental operations.

## Platform Support

- Windows
- macOS
- Linux

The Windows desktop experience is polished first, with macOS and Linux support improving over time.

## Help And Support

- Read the [changelog](./docs/CHANGELOG.md) for release updates.
- Use [GitHub Issues](https://github.com/Countra/termous/issues) to report problems or suggest improvements.

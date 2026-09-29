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

Termous brings SSH terminals, VNC remote desktops, hosts and credentials, multi-protocol file management and local mounts, server operations, and an AI assistant into one desktop workstation. It helps developers and operators keep connections, files, and tasks organized across servers, and can work with external AI tools through MCP.

## Why Termous

| Problem | How Termous Helps |
| --- | --- |
| Hosts, credentials, terminals, and file tools are scattered | Manage connections, files, and remote operations in one workstation |
| One host has several accounts or access methods | Save separate SSH, file, and remote desktop configurations and choose the one you need |
| Files are spread across servers, object storage, and shares | Manage SFTP, S3 / MinIO, WebDAV, FTP / FTPS, and SMB together, with optional local mounts |
| Complex networks require several connection tools | Configure a jump connection or HTTP / SOCKS5 proxy for SSH and reuse the route for associated SFTP access and forwarding |
| Multiple SSH sessions are hard to track | Keep context clear with tabs, colors, pinning, duplication, and split panes |
| Terminals and remote files require constant switching | Use SFTP, directory following, bookmarks, and the workstation file panel in the same session |
| The same diagnostics must run on several servers | Send once to the current, selected, or all connected sessions and review each result separately |
| Common commands and server actions are repeated | Reduce repetitive work with snippets, command aliases, scheduled tasks, and remote operations panels |
| Troubleshooting requires copying information between servers and AI tools | Associate SSH or file connections from session tabs, send selected terminal text to the built-in AI assistant, or authorize external tools through MCP |

## Quick start

1. Download the installer or AppImage for your platform from [Releases](https://github.com/Countra/termous/releases).
2. Enter the host details on the Hosts page, optionally configure SSH or a remote desktop, and save. You can also save a host without a connection. Then add the required file engine in the connection configuration tab; SFTP uses an associated SSH profile, while other file engines have their own connection settings.
3. Click "Connect" in the top bar, choose a host and a specific connection, and open a terminal, file session, or remote desktop.
4. The SSH workstation provides files, monitoring, processes, services, Docker, firewall, and other tools on the right. Use the bottom session command console for several connected sessions, or the standalone Files page for directories, search, and transfers.
5. To use the AI assistant, complete its initial setup, add a model provider under Settings → AI Assistant, and choose a model. Right-click a terminal or file session tab and choose "Ask Agent" to associate it with a new conversation or search for an existing one, then enter your question. To connect an external AI tool, create a client under Settings → MCP and copy its connection configuration.
6. To access remote files through Explorer or other local applications, select a file profile on the mounts page, check the driver environment, and choose a drive letter or empty directory. Manage local cache settings under Settings → Mounts.
7. Reopen the feature tour at any time to learn about connections, file management, mounts, caching, auditing, and skill installation.

## Highlights

### SSH workstation

- Multiple session tabs with duplication, renaming, pinning, and color labels.
- Terminal split panes with draggable proportions for logs, commands, and environment comparisons.
- The bottom session command console can run a single-line shell command across the current, selected, or all connected SSH sessions, with output and available exit codes shown per session.
- Interrupt one or all targets. Collapsing the console does not interrupt a task, and its height can be adjusted by dragging.
- Context-aware smart completion combines Termous-managed aliases, safe single-line snippets, remote command history, current-directory suggestions, and Bash commands. Each source can be enabled or disabled independently.
- Completion inserts a candidate without executing it; Tab always remains available for the remote shell's native completion.
- Optional AI command completion uses the default model from AI settings to turn a natural-language request into a single-line command and explanation. Copy or insert a candidate, generate another, or cancel generation. Enable this option in terminal settings; it is off by default, and you confirm execution after insertion.
- Terminal search and a context-aware menu for copy, find, paste, opening supported HTTP/HTTPS links, and locating remote paths in the workstation file panel.
- Bidirectional directory following between the terminal and workstation file panel, with compact remote bookmarks.
- Local PowerShell / CMD sessions on Windows.
- Terminal font, size, line height, letter spacing, cursor, and theme settings, plus an SSH-terminal smooth scrolling option.

### Hosts and connection configurations

- Host groups, tags, favorites, recent hosts, and SSH reachability and latency checks.
- Multiple SSH, file, and remote desktop configurations per host, with a separate default for each access method. S3, WebDAV, FTP, and SMB file profiles do not require SSH.
- Create a host without a connection or with only a remote desktop. Switching between host details and connection configuration during creation does not save early.
- SSH password and private-key authentication, including encrypted private keys associated with passphrase credentials.
- The host icon library supports batch import, preview, search, renaming, and drag reordering. Icons in use cannot be deleted.
- Hosts support notes, platform information, and icons. Each SSH connection can use its own account, jump connection, and proxy.
- Unauthenticated HTTP or SOCKS5 connection proxies, with no automatic direct fallback after a proxy failure.
- One host-key trust flow shared by SSH, jump hosts, SFTP, and port forwarding.
- Credentials are managed separately from hosts to avoid repeating sensitive data.

### VNC remote desktops

- Connect to and switch between desktop sessions in a dedicated remote desktop workspace.
- Connect through an SSH tunnel or directly to a target IP. A direct desktop connection does not require SSH configuration.
- Save VNC passwords, use full screen, adjust image quality, and reconnect after a disconnect.
- The currently supported protocol is VNC; RDP is not supported.

### Multi-protocol files and directory following

- SFTP, S3 / MinIO, WebDAV, FTP / FTPS, and SMB share multi-session file management, text editing, image preview, and transfers.
- FTP supports plain connections, explicit TLS, and implicit TLS. SMB uses NTLMv2 username/password authentication with an optional domain and a workspace directory inside a share; no system SMB client is required.
- Upload, download, move, delete, and rename files. Permission management, batch rename, search, and other actions depend on the current engine's capabilities.
- Drag uploads into the current directory or a specific folder and choose which conflicting files to overwrite.
- Copy files and directories across file connections and storage engines, including other independent file sessions on the same host, with distribution to several targets, destination selection, progress, cancellation, and results for each target.
- Advanced batch renaming with combined rules, result previews, name conflict checks, and saved presets.
- Linux remote file-name search with a search directory, literal / wildcard / regular expression matching, filters, and navigation to results. Installation guidance is available when a required component is missing.
- Remote bookmarks, local download locations, and a transfer list with live progress. Directory details can calculate total size when supported, with cancellation and recalculation.
- Online text file editing and image preview.
- Copy remote file paths and identify file sessions and transfers started through MCP.
- Bidirectional directory sync between the terminal and its associated SFTP file panel, with the last successful directory preserved and manual recovery available after a disconnect.

### Local mounts and caching

- Mount a file profile as a Windows drive or a macOS / Linux directory, with temporary mounts, saved configurations, read-only access, automatic startup, sync, reconnect, and unmount. Failed entries offer restart, close, or recovery according to retained resources.
- A file profile may have multiple read-only mounts and at most one writable mount. Windows requires WinFsp 2.1+, Linux requires FUSE3, and macOS requires macFUSE and system approval. The page provides environment diagnostics; application packages do not bundle these system drivers.
- Content is downloaded on demand into a local disk cache. Verified content can be reused after remounting or restarting Core when the connection identity and remote version match. Opening a large file may fall back to a full download when an FTP or other server does not support range reads.
- Sequential writes can upload while caching, with local buffering bounded by transfer progress. Complex random edits or unsupported streaming uploads use compatible writeback. The page reports accepted, transferred, and pending bytes and separates body transfer from final publication.
- Completion in the system copy window does not always mean remote flushing, object commit, or replacement has finished. Ordinary copies within a mount transfer data through local reads and writes, without a server-side copy guarantee. S3 rename/move uses copy-then-delete, depends on server performance, and is not atomic.
- Settings → Mounts controls the cache directory, total capacity, and reserved disk space, and shows usage and cleanup for unused cache. Changes apply on the next Core startup. The cache does not provide offline access or recover unpublished changes after a crash.
- Normal exit, updates, and configuration restore coordinate synchronization. Failures retain an error and offer retry, return to the application, or explicit discard. Mounts are not intended for databases or virtual-machine disks that require full local-filesystem semantics.

### Server operations

- Linux system information.
- Overall CPU trends and live per-core usage, plus memory, network, and disk monitoring.
- Linux process browsing, search, and termination.
- systemd service state, controls, and logs.
- Docker container state, controls, details, and logs.
- iptables / nftables firewall rule management and persistence assistance.
- Scheduled task (Crontab) management for the current SSH user, with common schedules, Cron expressions, and an advanced raw Crontab editor. It switches to read-only when the server can read but cannot safely update the task list, and clearly reports missing permissions or concurrent edit conflicts.

### Commands and networking

- Reusable snippets with groups, variables, and send-to-session actions.
- Termous-managed aliases for Bash, Zsh, and Fish, with serial synchronization of selected aliases to multiple configured hosts.
- Synchronization shows progress and results per host, skips shell mismatches, and supports cancellation or reopening an active task.
- Local forwarding, remote forwarding, and dynamic proxy.
- Running forwards expose connection counts, cumulative traffic, live send/receive rates, restart, and stop actions.
- Saved forwards can connect automatically when Core starts. This is off by default; initial connection failures are shown without automatic retries.
- Connection settings include SSH keepalive and automatic recovery for background port forwards, with retry progress and an option to stop recovery.

### AI assistant

- Connect a custom model service, manage its model catalog, and choose models and run settings per conversation. A working model service must be configured separately.
- Follow streamed replies, reasoning, tool execution, and approval progress, and stop tasks when needed.
- Temporary model request failures are retried automatically up to three times, with reconnection status and the error reason shown. If a streamed response is interrupted, the partial output remains in history while the response is regenerated; completed tool operations are not repeated by the retry.
- Attach text or images and paste images. Send selected terminal text from its context menu to a new or specified conversation; the selection is attached with its source information.
- The "Ask Agent" action on terminal and file session tabs supports conversation search and pinned indicators. Passing a connection only establishes a reference; it does not prefill or send a question, or overwrite an existing draft.
- Each conversation can reference one SSH session and one file configuration at the same time. Replacing a reference of the same type requires confirmation; inspect, replace, or remove either independently while preserving drafts, attachments, and history.
- Type ASCII `/` directly at the start of the composer or immediately after an ASCII space in existing text to open the Renderer's local slash commands: `/session` binds an existing ready SSH session or the file profile represented by a file session; `/profile` selects a saved SSH or file profile, binding file profiles directly and associating SSH Profiles without connecting by default. Enable "connect on association" in Agent settings to establish the SSH connection asynchronously. This SSH Profile policy applies consistently to slash selection and replacement from a resource card; `/session` always binds the selected live session. `/compact` schedules context compaction before the next newly submitted message without changing already queued messages. Use the arrow keys, Enter, and stepwise Escape to navigate. A command fragment is consumed locally only after the action is accepted; these commands do not invoke an MCP Tool or Skill and never enter the model prompt.
- When an SSH reference becomes unavailable, use "Recover connection" in its card details to connect with the original SSH configuration and update the reference once ready. Host-key confirmation, cancellation, and retry are supported. Existing queued messages are preserved and paused; resume the queue manually afterward. Recovery does not replay historical commands.
- File references use a saved file configuration, and the assistant operates through its own file session. Closing or disconnecting the original file tab does not invalidate the reference. Replace or remove it if the configuration is deleted or its host/SSH configuration association becomes invalid.
- Add messages while a task runs, reorder or edit pending messages, or choose immediate execution.
- Rename, group, pin, search, reorder, archive, and restore conversations. New messages do not change your manual ordering.
- Automatically compact long conversations while preserving the complete chat history. The default threshold is 80%, adjustable from 50% to 95%; you can also request compaction before the next send and view its status, before-and-after usage, and duration.
- Recall the last 10 inputs while keeping arrow-key cursor navigation during editing or multiline input. Copy message Markdown and view dates, response duration, and token usage.
- Context occupancy and cumulative token usage are shown separately. After switching models, an unevaluated context retains the previous result for reference and updates on a subsequent send.

### MCP and external AI tools

- Manage the service and clients under Settings → MCP, assign permissions to each tool, regenerate tokens, or remove access.
- Supported operations cover SSH commands, system and process management, systemd, Docker, scheduled tasks, file management, port forwarding, and snippets.
- File tools use `termous.files.*` names and `files:*` permissions. Existing client configuration is migrated automatically; external tool calls must use the new names.
- File deletion requires the separate `files:delete` permission, previews the scope before execution under the client's approval policy, and supports asynchronous tasks, per-item results, and cancellation. Upgrading does not automatically grant deletion access to existing external clients.
- Approve operations individually or allow a trusted client to run without per-operation approval. Granted permissions and host-key confirmation still apply.
- Use the address and client token provided in Settings and keep Termous running. The address may change after an application restart; use the current address shown there.
- [Termous Skills](https://github.com/Countra/termous-skills) provides workflows already included with the built-in AI assistant. Under Settings → MCP → Authorized clients, choose Install skills, select a client type, and pick a project or home directory. Codex uses `.agents/skills` beneath that directory; Claude Code uses `.claude/skills`. Custom directory installs directly into the selected directory. Review the final path and existing items before installing: existing skills are skipped by default, and explicit replacement overwrites each matching folder. Configure MCP connectivity and permissions separately.

### Audit center

- Review tool calls, approvals, and background task results from the built-in AI assistant and external MCP clients, with combined filters, keyword search, details, and related events.
- Records are stored separately on the local device, with a default retention of 90 days. Settings → Audit provides a recording switch, maximum retention days, and an optional record limit. Older records beyond either limit are pruned in background batches; history stays available when recording is disabled.
- Ordinary manual operations are not recorded. Audit records and local audit settings are excluded from configuration backups.
- Command-execution auditing retains the original command, including authentication arguments embedded in it. File bodies, conversation bodies, and full command output are excluded from audit details.

### Data, security, and desktop experience

- Custom desktop window, tray menu, and minimize to tray.
- Packaged Windows and macOS applications offer an off-by-default launch-at-login setting. Application startup is controlled separately from automatic connection of saved mounts and forwards.
- Dark and light themes.
- Shortcut settings can search actions, record keys, detect conflicts, and restore defaults for common terminal, smart completion, file list, and remote editor actions.
- In-app update checks, downloads, and installation.
- The startup window shows database checks and upgrades, with diagnostics retained on failure. Open About from the Help menu to view application information.
- Encrypted `.tobp` backups with full, merge, and selective restore modes.
- A reusable feature tour covering multi-engine file connections, mounts and caching, auditing, skill installation, and key settings.
- Connection cleanup reminders and protection for unsynchronized mount changes before closing.
- Simplified Chinese and English UI.

## Use cases

- Log in to multiple Linux servers during daily work.
- Switch frequently between SSH sessions and remote files.
- Monitor resources, manage processes and services, read configuration files, and run diagnostics.
- Run one-off diagnostics across connected servers and compare output and available exit codes in one place.
- Manage recurring tasks for the current SSH user or synchronize the same managed aliases across hosts using the same Shell family.
- Create temporary port forwards or proxy channels.
- Save common server commands as reusable snippets or remote Shell aliases.
- Manage multiple accounts and desktop connections for a host, or distribute files to several hosts.
- Use the AI assistant to investigate server problems and act within the selected session and approval permissions.

## Security and privacy

Termous is a desktop workstation that runs locally. Credentials are kept in secure storage on the device, and SSH host identity is verified through a unified fingerprint trust flow. Encrypted backups do not export the device's master key, and downloaded updates are verified before installation.

- When using the AI assistant, conversation content, selected attachments, and relevant tool results are sent to your configured model service. Conversation history is stored locally, and model service keys are encrypted on the device.
- AI command completion sends your request, current input, and shell, directory, and platform information to the default model service. It does not create a conversation task or persist the request and generated results.
- External MCP clients have separate tokens and manually granted permissions. The built-in AI assistant automatically receives the current MCP capabilities and has its own approval setting, which upgrades preserve. Skipping per-operation approval does not bypass host-key confirmation or permission checks.
- Connection proxies accept only unauthenticated HTTP and SOCKS5 endpoints so proxy credentials do not enter host configuration, logs, or backups.
- The session command console sends only to SSH sessions confirmed at an idle prompt and locks their terminal input while a task runs. Command text and results are not written to the database, backups, or logs.
- Smart completion keeps a limited amount of remote history and directory index data only in memory for the current SSH session. It is released when the session closes and is not persisted to local data, backups, or logs.
- When a scheduled task has concurrent changes or an uncertain write result, Termous stops and reports the issue instead of overwriting the existing configuration.
- Alias synchronization follows existing credential, proxy, jump-host, and host-fingerprint trust settings, and validates configuration before writing.

## Platform support

- Windows x64: `.exe` installer
- macOS x64 / arm64: `.dmg` and `.zip`
- Linux x64: `.AppImage`

Windows is the primary supported platform; the macOS and Linux experience continues to improve.

The Windows installer publishes the installation directory, version, and executable path under the stable `Software\Termous\Install` registry key so Skills and local tools can locate the application. See the [installation discovery contract](./docs/windows-install-discovery.md).

## Help and support

- Read the [changelog](./docs/CHANGELOG.md) for release updates.
- Use [GitHub Issues](https://github.com/Countra/termous/issues) to report problems or suggest improvements.

### Optional cloud account and sync

The bottom-left entry shows your avatar and name, or “Local” when signed out. Its upward menu provides account and settings access. On first entry, sign in or choose to continue offline; the choice is remembered locally. The account page manages authentication, synchronization, trusted devices, and security. Cloud access is unconfigured by default. Signing in never uploads local data automatically: authorize the device, review the differences, and explicitly confirm sync first. Configuration objects use end-to-end encryption; remote file contents, AI conversations, and machine-local settings remain outside sync. Offline features and local backups remain independent.

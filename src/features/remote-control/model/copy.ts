import type { AppLanguage } from '#common/contracts'

const en = {
  title: 'Remote control',
  overview: 'Overview', resources: 'Resources', showSidebar: 'Show resources', hideSidebar: 'Hide resources',
  workspaceTitle: 'Remote workspace', workspaceHint: 'Open a connection or continue a session.',
  startConnection: 'Open a connection', existingSessions: 'Existing sessions', openSession: 'View session',
  allConnections: 'Show all connections', noConnections: 'No connections are available', noResults: 'No matching connections or sessions',
  noSessions: 'No sessions yet', noSessionsHint: 'Open a connection to start a session.',
  startAgent: 'Open AI assistant', agentEntryHint: 'Remote conversations and tools',
  controlledComputer: 'Controlled computer', latency: 'Latency', sendRate: 'Upload speed', receiveRate: 'Download speed',
  connectionPath: 'Connection', transport: 'Transport', security: 'Security', addressFamily: 'Address type', relayTransport: 'Relay transport',
  encrypted: 'Encrypted connection', disconnectHint: 'Disconnecting keeps remote sessions open.',
  closeView: 'Close view', closeViewHint: 'Close the view and keep the session open.',
  remoteSession: 'Created remotely', localSession: 'Created on controlled computer',
  deviceFiles: 'This device', hostFiles: 'Controlled computer', transferHint: 'Select files or folders to download.',
  inputHint: 'Take input control to type.',
  taskCenter: 'Tasks & transfers', activeTasks: 'in progress',
  agentDisabled: 'Enable remote assistant access on the controlled computer.',
  agentUnsupported: 'Remote assistant access is unsupported. Update the controlled computer.',
  agentRestarted: 'The remote assistant restarted. Reconnect to continue.',
  agentChecking: 'Checking assistant access',
  agentResourcesUnavailable: 'Could not load remote resources.',
  agentViewUnavailable: 'Could not update conversation notifications.',
  agentApprovalsUnavailable: 'Could not update approvals. Refresh before making a decision.',
  agentNoApprovals: 'No pending approvals',
  syncUnavailable: 'Refresh failed. Previously loaded content is preserved.',
  contentChanged: 'Content changed. Refresh and try again.',
  quoteAgent: 'Quote selection in AI', agent: 'AI assistant', agentPermission: 'Allow remote AI assistant', agentPermissionHint: 'Allow trusted devices to view all AI conversations and use the existing AI tool permissions.', sessions: 'Sessions', hosts: 'Hosts', files: 'Files', terminal: 'Terminal', split: 'Split view',
  uploadHost: 'Upload from controlled computer', downloadHost: 'Download to controlled computer',
  uploadDevice: 'Upload from this device', downloadDevice: 'Download to this device',
  uploadFolderDevice: 'Upload folder from this device', directoryReplace: 'For folders, choose Keep both or Skip.',
  executeDevice: 'Uses this device', resume: 'Resume', paused: 'Paused', preparing: 'Preparing', publishing: 'Saving file',
  sendingToHost: 'Transferring to controlled computer', writingTarget: 'Writing to destination', confirming: 'Confirming completion',
  executeHost: 'Runs on controlled computer', chooseFolder: 'Choose folder', chooseSource: 'Choose files or folders',
  noRoots: 'Allow a folder on the controlled computer first.', startTransfer: 'Start transfer',
  overwrite: 'If the name exists', autoRename: 'Keep both', skip: 'Skip', replaceFile: 'Replace',
  queued: 'Queued', running: 'Transferring', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted',
  search: 'Find a connection or session', newTerminal: 'Open terminal', newFiles: 'Open files', refresh: 'Refresh',
  direct: 'Direct', relay: 'Cloud relay', connecting: 'Connecting', connected: 'Connected', disconnected: 'Disconnected',
  reconnect: 'Reconnect', recovering: 'Reconnecting', connectionFailed: 'Could not connect', resourcesFailed: 'Could not load resources',
  verifying: 'Verifying device', disconnect: 'Disconnect', close: 'Close', details: 'Connection details',
  empty: 'Choose a connection', emptyHint: 'Only authorized connections are shown.',
  readOnly: 'Read only', takeControl: 'Take input control', releaseControl: 'Release input', controlling: 'You have input control',
  inputBlocked: 'Input is currently controlled elsewhere', gap: 'Some terminal output is no longer available.',
  inputUncertain: 'Input was not confirmed. Refresh input status before continuing.', inputStatus: 'Refresh input status',
  error: 'The operation could not be completed. Refresh and try again.', unavailable: 'Remote control is unavailable.',
  signalingUnavailable: 'Cannot connect to the remote control service. Check your network and try again.',
  signalingRejected: 'The remote control connection was rejected. Check the service configuration and client version.',
  signalingUpgradeRejected: 'The remote control connection upgrade was rejected. Check your proxy settings.',
  serviceUnsupported: 'The cloud service has not enabled remote control or needs an update.',
  loginRequired: 'Your session is no longer valid. Sign in again.', rateLimited: 'Too many requests. Wait a moment and try again.',
  upgradeRequired: 'Update Termous to use remote control.', membershipRequired: 'Check this device’s trust status in account security.',
  hostUnavailable: 'The controlled computer is offline or has not enabled remote control.',
  accountUnavailable: 'Remote control is not ready. Check sign-in and device trust status.',
  trustTitle: 'Verify SSH host key', trust: 'Trust key', replace: 'Replace trusted key', reject: 'Reject', fingerprint: 'Fingerprint',
  previousKey: 'Previous fingerprint', host: 'Host', algorithm: 'Algorithm', closeSession: 'Close session',
  closeSessionHint: 'End this session on the remote computer.',
  newFolder: 'New folder', rename: 'Rename', remove: 'Delete', properties: 'Properties', name: 'Name', size: 'Size', modified: 'Modified',
  permissions: 'Permissions', folder: 'Folder', file: 'File', link: 'Link', parent: 'Parent directory', loadMore: 'Load more',
  deleteTitle: 'Delete selected item?', deleteHint: 'This permanently deletes the item and its contents from this connection.',
  confirm: 'Confirm', cancel: 'Cancel', path: 'Path', tasks: 'Transfers', noTasks: 'No active transfers',
  hostSettings: 'Allow remote control', settingsHint: 'Trusted devices can access terminal and file connections on selected hosts. Save access again after adding or changing connections. Desktop folders are authorized separately.',
  configure: 'Manage access', save: 'Save', allowedHosts: 'Allowed hosts', allowedFolders: 'Desktop folders',
  addRead: 'Add read-only folder', addWrite: 'Add read and write folder', read: 'Read', write: 'Write',
  connect: 'Remote connect', online: 'Online', offline: 'Offline', unknown: 'Status unknown', disabled: 'Remote control off',
  policyChanged: 'Access settings changed. Refresh before saving again.', windowOnly: 'Open the desktop app to use remote control.',
  notTrusted: 'A trusted device is required.', changedProfile: 'Connection changed. Allow access again on the controlled desktop.',
  denied: 'This resource is not permitted.', uncertain: 'The result is not confirmed. Refresh its status before trying again.',
  emptyDirectory: 'This folder is empty', operationPending: 'File operation started', shellNotice: 'Commands use the selected account permissions.',
}
const zh: typeof en = {
  title: '远程控制',
  overview: '概览', resources: '资源', showSidebar: '展开资源栏', hideSidebar: '收起资源栏',
  workspaceTitle: '远程工作台', workspaceHint: '打开连接，或继续已有会话。',
  startConnection: '打开连接', existingSessions: '已有会话', openSession: '查看会话',
  allConnections: '查看全部连接', noConnections: '暂无可用连接', noResults: '未找到匹配的连接或会话',
  noSessions: '暂无会话', noSessionsHint: '打开连接即可创建会话。',
  startAgent: '进入 AI 助手', agentEntryHint: '远端对话与工具',
  controlledComputer: '被控电脑', latency: '延迟', sendRate: '上传速度', receiveRate: '下载速度',
  connectionPath: '连接方式', transport: '传输协议', security: '连接安全', addressFamily: '地址类型', relayTransport: '中继协议',
  encrypted: '加密连接', disconnectHint: '断开连接，远端会话仍保留。',
  closeView: '关闭视图', closeViewHint: '仅关闭视图，保留远端会话。',
  remoteSession: '由远控创建', localSession: '在被控电脑创建',
  deviceFiles: '此设备', hostFiles: '被控电脑', transferHint: '请选择要下载的文件或目录。',
  inputHint: '取得输入权后可输入。',
  taskCenter: '任务与传输', activeTasks: '进行中',
  agentDisabled: '请在被控电脑开启助手远程访问。',
  agentUnsupported: '被控电脑不支持远程助手，请更新应用。',
  agentRestarted: '远端助手已重启，请重新连接。',
  agentChecking: '正在检查助手访问权限',
  agentResourcesUnavailable: '远端资源加载失败。',
  agentViewUnavailable: '会话通知更新失败。',
  agentApprovalsUnavailable: '审批更新失败，请刷新后再处理。',
  agentNoApprovals: '暂无待审批请求',
  syncUnavailable: '刷新失败，已保留上次内容。',
  contentChanged: '内容已变化，请刷新后重试。',
  quoteAgent: '引用选区到 AI', agent: 'AI 助手', agentPermission: '允许远程使用 AI 助手', agentPermissionHint: '允许可信设备查看全部 AI 对话，并沿用此电脑的 AI 工具权限。', sessions: '会话', hosts: '主机', files: '文件', terminal: '终端', split: '并排显示',
  uploadHost: '上传自被控电脑', downloadHost: '下载到被控电脑',
  uploadDevice: '上传自此设备', downloadDevice: '下载到此设备',
  uploadFolderDevice: '上传此设备的目录', directoryReplace: '传输目录时，请选择保留两者或跳过。',
  executeDevice: '使用此设备文件', resume: '继续传输', paused: '已暂停', preparing: '准备中', publishing: '保存文件中',
  sendingToHost: '传输至被控电脑', writingTarget: '写入目标目录', confirming: '正在确认完成',
  executeHost: '在被控电脑执行', chooseFolder: '选择目录', chooseSource: '选择文件或目录',
  noRoots: '请先在被控电脑授权目录。', startTransfer: '开始传输',
  overwrite: '文件重名时', autoRename: '保留两者', skip: '跳过', replaceFile: '替换',
  queued: '排队中', running: '传输中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断',
  search: '搜索连接或会话', newTerminal: '打开终端', newFiles: '打开文件', refresh: '刷新',
  direct: '直连', relay: '云中继', connecting: '连接中', connected: '已连接', disconnected: '已断开',
  reconnect: '重新连接', recovering: '正在恢复连接', connectionFailed: '连接未成功', resourcesFailed: '资源加载失败',
  verifying: '验证设备', disconnect: '断开连接', close: '关闭', details: '连接详情',
  empty: '请选择连接', emptyHint: '仅显示已授权连接。',
  readOnly: '只读', takeControl: '取得输入权', releaseControl: '释放输入权', controlling: '正在控制输入',
  inputBlocked: '输入权正由其他控制者持有', gap: '部分终端输出已不在缓存中。',
  inputUncertain: '输入结果尚未确认，请刷新输入状态后继续。', inputStatus: '刷新输入状态',
  error: '操作未能完成，请刷新后重试。', unavailable: '远程控制暂不可用。',
  signalingUnavailable: '远控服务不可达，请检查网络后重试。',
  signalingRejected: '远控连接被拒绝，请检查服务配置和客户端版本。',
  signalingUpgradeRejected: '远控连接升级被拒绝，请检查代理设置。',
  serviceUnsupported: '云服务尚未开启远控或需要升级。',
  loginRequired: '登录会话已失效，请重新登录。', rateLimited: '请求过于频繁，请稍后重试。',
  upgradeRequired: '请升级 Termous 后使用远程控制。', membershipRequired: '请在账号安全中检查此设备的信任状态。',
  hostUnavailable: '被控电脑已离线或尚未开启远控。',
  accountUnavailable: '远控尚未就绪，请检查登录和设备信任状态。',
  trustTitle: '核对主机密钥', trust: '信任密钥', replace: '替换可信密钥', reject: '拒绝', fingerprint: '指纹',
  previousKey: '原指纹', host: '主机', algorithm: '算法', closeSession: '关闭会话',
  closeSessionHint: '结束被控电脑上的此会话。',
  newFolder: '新建目录', rename: '重命名', remove: '删除', properties: '属性', name: '名称', size: '大小', modified: '修改时间',
  permissions: '权限', folder: '目录', file: '文件', link: '链接', parent: '上级目录', loadMore: '加载更多',
  deleteTitle: '删除所选项目？', deleteHint: '此操作会永久删除该项目及其内容。',
  confirm: '确认', cancel: '取消', path: '路径', tasks: '传输', noTasks: '暂无进行中的传输',
  hostSettings: '允许远程控制', settingsHint: '允许同账号可信设备访问所选主机的终端和文件连接。新增或修改连接后需重新保存授权。电脑目录单独授权。',
  configure: '管理访问范围', save: '保存', allowedHosts: '已授权主机', allowedFolders: '此电脑的目录',
  addRead: '添加只读目录', addWrite: '添加读写目录', read: '读取', write: '写入',
  connect: '远程连接', online: '在线', offline: '离线', unknown: '状态未知', disabled: '远控未开启',
  policyChanged: '访问设置已变化，请刷新后再保存。', windowOnly: '请在桌面应用中使用远程控制。',
  notTrusted: '需要先将此设备设为可信设备。', changedProfile: '连接配置已变化，请在被控电脑重新授权。',
  denied: '此资源未获得访问授权。', uncertain: '操作结果尚未确认，请先刷新状态。',
  emptyDirectory: '此目录为空', operationPending: '文件操作已开始', shellNotice: '按所选账号权限执行命令。',
}
export const remoteCopy = (language: AppLanguage) => language === 'zh-CN' ? zh : en
export type RemoteCopy = typeof en
export function remoteErrorText(copy: RemoteCopy, error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code).toLowerCase() : ''
  if (error && typeof error === 'object' && 'uncertain' in error && error.uncertain) return copy.uncertain
  if (code === 'remote_policy_changed') return copy.policyChanged
  if (code === 'agent_revision_conflict' || code === 'revision_conflict' || code === 'mcp_conflict') return copy.contentChanged
  if (code === 'remote_agent_disabled') return copy.agentDisabled
  if (code === 'remote_agent_unsupported') return copy.agentUnsupported
  if (code === 'remote_agent_restarted') return copy.agentRestarted
  if (code === 'remote_profile_changed') return copy.changedProfile
  if (code === 'remote_signaling_unavailable') return copy.signalingUnavailable
  if (code === 'remote_signaling_rejected') return copy.signalingRejected
  if (code === 'remote_signaling_upgrade_rejected') return copy.signalingUpgradeRejected
  if (code === 'remote_not_supported' || code === 'remote_disabled') return copy.serviceUnsupported
  if (['unauthorized', 'login_required', 'refresh_unconfirmed', 'authentication_required'].includes(code)) return copy.loginRequired
  if (code === 'rate_limited') return copy.rateLimited
  if (code === 'client_upgrade_required') return copy.upgradeRequired
  if (['membership_conflict', 'forbidden', 'device_not_trusted'].includes(code)) return copy.membershipRequired
  if (code === 'remote_host_unavailable') return copy.hostUnavailable
  if (code === 'remote_account_unavailable') return copy.accountUnavailable
  if (code.includes('forbidden')) return copy.denied
  if (code === 'remote_input_locked') return copy.inputBlocked
  if (code === 'remote_directory_replace_unsupported') return copy.directoryReplace
  if (code.includes('unavailable')) return copy.unavailable
  return copy.error
}

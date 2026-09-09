// 仅兼容本地历史中的已知旧工具名称；不会向 MCP 注册旧名称或扩大工具权限。
const legacyFileToolNames = new Map<string, string>([
  ['termous.sftp.sessions.list', 'termous.files.sessions.list'],
  ['termous.sftp.sessions.get', 'termous.files.sessions.get'],
  ['termous.sftp.sessions.connect', 'termous.files.sessions.connect'],
  ['termous.sftp.sessions.reconnect', 'termous.files.sessions.reconnect'],
  ['termous.sftp.sessions.close', 'termous.files.sessions.close'],
  ['termous.sftp.files.list', 'termous.files.list'],
  ['termous.sftp.files.stat', 'termous.files.stat'],
  ['termous.sftp.files.read_text', 'termous.files.read_text'],
  ['termous.sftp.files.save_text', 'termous.files.save_text'],
  ['termous.sftp.files.mkdir', 'termous.files.mkdir'],
  ['termous.sftp.files.rename', 'termous.files.rename'],
  ['termous.sftp.files.chmod', 'termous.files.chmod'],
  ['termous.sftp.transfers.upload', 'termous.files.transfers.upload'],
  ['termous.sftp.transfers.download', 'termous.files.transfers.download'],
  ['termous.sftp.transfers.remote_copy', 'termous.files.transfers.remote_copy'],
  ['termous.sftp.transfers.get', 'termous.files.transfers.get'],
  ['termous.sftp.transfers.cancel', 'termous.files.transfers.cancel'],
  ['termous.sftp.files.batch_rename.presets.list', 'termous.files.batch_rename.presets.list'],
  ['termous.sftp.files.batch_rename.presets.get', 'termous.files.batch_rename.presets.get'],
  ['termous.sftp.files.batch_rename.preview', 'termous.files.batch_rename.preview'],
  ['termous.sftp.files.batch_rename.start', 'termous.files.batch_rename.start'],
  ['termous.sftp.files.batch_rename.get', 'termous.files.batch_rename.get'],
  ['termous.sftp.files.batch_rename.result', 'termous.files.batch_rename.result'],
  ['termous.sftp.files.batch_rename.cancel', 'termous.files.batch_rename.cancel'],
  ['termous.sftp.files.name_search.capability', 'termous.files.name_search.capability'],
  ['termous.sftp.files.name_search.run', 'termous.files.name_search.run'],
  ['termous.sftp.files.delete.preview', 'termous.files.delete.preview'],
  ['termous.sftp.files.delete.start', 'termous.files.delete.start'],
  ['termous.sftp.files.delete.get', 'termous.files.delete.get'],
  ['termous.sftp.files.delete.result', 'termous.files.delete.result'],
  ['termous.sftp.files.delete.cancel', 'termous.files.delete.cancel'],
])

export function canonicalizeMcpFileToolName(name: string): string {
  return legacyFileToolNames.get(name) ?? name
}

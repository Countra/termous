import type { AppConfig } from '#common/contracts'
import type { AliasGateway } from '#features/alias'
import type { AgentSetupGateway } from '#features/agent-setup'
import type { AgentWorkspaceGateway } from '#features/agent-runtime'
import type { CommandDispatchGateway } from '#features/command-dispatch'
import type { FileGateway } from '#features/files'
import type { McpAccessGateway } from '#features/mcp-access'
import { RemoteDesktopClient, type RemoteDesktopGateway } from '#features/remote-desktop'
import type { TerminalGateway } from '#features/terminal'
import type { TermousApiTransport } from '#shared/api'
import { getTermousBridge } from '#shared/bridge'
import type { AppDataSnapshotGateway } from './runtimeGatewayContracts'
import { AliasClient } from './gateways/aliasClient'
import { AgentSetupClient } from './gateways/agentSetupClient'
import { AgentWorkspaceClient } from './gateways/agentWorkspaceClient'
import { CommandDispatchClient } from './gateways/commandDispatchClient'
import { CredentialClient } from './gateways/credentialsClient'
import { CrontabClient } from './gateways/crontabClient'
import { DataPortabilityClient } from './gateways/dataPortabilityClient'
import { DockerClient } from './gateways/dockerClient'
import { FileCatalogClient } from './gateways/fileCatalogClient'
import { FileOperationClient } from './gateways/fileOperationClient'
import { FileRenameClient } from './gateways/fileRenameClient'
import { FileSearchClient } from './gateways/fileSearchClient'
import { FileSessionClient } from './gateways/fileSessionClient'
import { FirewallClient } from './gateways/firewallClient'
import { ForwardClient } from './gateways/forwardsClient'
import { HostKeyClient } from './gateways/hostKeysClient'
import { McpAccessClient } from './gateways/mcpAccessClient'
import { HostClient } from './gateways/hostsClient'
import { ObservabilityClient } from './gateways/observabilityClient'
import { RuntimeClient } from './gateways/runtimeClient'
import { ServiceClient } from './gateways/serviceClient'
import { SessionClient } from './gateways/sessionsClient'
import { SettingsClient } from './gateways/settingsClient'
import { SnippetClient } from './gateways/snippetsClient'
import { TransferClient } from './gateways/transferClient'

type DomainGateway<Client extends TermousApiTransport> = Omit<
  Client,
  keyof TermousApiTransport
>

export interface RuntimeGateways {
  readonly agentSetup: AgentSetupGateway
  readonly agentWorkspace: AgentWorkspaceGateway
  readonly runtime: DomainGateway<RuntimeClient>
  readonly settings: DomainGateway<SettingsClient>
  readonly snippets: DomainGateway<SnippetClient>
  readonly fileCatalog: DomainGateway<FileCatalogClient>
  readonly forwards: DomainGateway<ForwardClient>
  readonly hosts: DomainGateway<HostClient>
  readonly credentials: DomainGateway<CredentialClient>
  readonly hostKeys: DomainGateway<HostKeyClient>
  readonly sessions: DomainGateway<SessionClient>
  readonly alias: DomainGateway<AliasClient> & AliasGateway
  readonly observability: DomainGateway<ObservabilityClient>
  readonly service: DomainGateway<ServiceClient>
  readonly crontab: DomainGateway<CrontabClient>
  readonly docker: DomainGateway<DockerClient>
  readonly firewall: DomainGateway<FirewallClient>
  readonly fileSessions: DomainGateway<FileSessionClient>
  readonly transfers: DomainGateway<TransferClient>
  readonly dataPortability: DomainGateway<DataPortabilityClient>
  readonly files: FileGateway
  readonly terminal: TerminalGateway
  readonly commandDispatch: CommandDispatchGateway
  readonly mcpAccess: McpAccessGateway
  readonly remoteDesktop: RemoteDesktopGateway
  readonly snapshot: AppDataSnapshotGateway
}

export function createRuntimeGatewaysFromConfig(
  config: Partial<AppConfig> = {},
): RuntimeGateways {
  const runtime = new RuntimeClient(config)
  const agentSetup = new AgentSetupClient(config)
  const agentWorkspace = new AgentWorkspaceClient(config)
  const settings = new SettingsClient(config)
  const snippets = new SnippetClient(config)
  const fileCatalog = new FileCatalogClient(config)
  const forwards = new ForwardClient(config)
  const hosts = new HostClient(config)
  const credentials = new CredentialClient(config)
  const hostKeys = new HostKeyClient(config)
  const sessions = new SessionClient(config)
  const aliasClient = new AliasClient(config)
  const commandDispatch = new CommandDispatchClient(config)
  const mcpAccess = new McpAccessClient(config)
  const observability = new ObservabilityClient(config)
  const service = new ServiceClient(config)
  const crontab = new CrontabClient(config)
  const docker = new DockerClient(config)
  const firewall = new FirewallClient(config)
  const fileSessions = new FileSessionClient(config)
  const fileOperations = new FileOperationClient(config)
  const fileRename = new FileRenameClient(config)
  const fileSearch = new FileSearchClient(config)
  const transfers = new TransferClient(config)
  const dataPortability = new DataPortabilityClient(config)
  const remoteDesktop = new RemoteDesktopClient(config)

  return {
    agentSetup,
    agentWorkspace,
    runtime,
    settings,
    snippets,
    fileCatalog,
    forwards,
    hosts,
    credentials,
    hostKeys,
    sessions,
    alias: createAliasGateway(aliasClient),
    observability,
    service,
    crontab,
    docker,
    firewall,
    fileSessions,
    transfers,
    dataPortability,
    files: createFileGateway(
      fileSessions,
      fileOperations,
      transfers,
      fileCatalog,
      fileRename,
      fileSearch,
    ),
    terminal: createTerminalGateway(settings, sessions),
    commandDispatch,
    mcpAccess,
    remoteDesktop,
    snapshot: createAppDataSnapshotGateway({
      settings,
      snippets,
      fileCatalog,
      forwards,
      hosts,
      credentials,
      sessions,
      fileSessions,
      remoteDesktop,
    }),
  }
}

export async function createRuntimeGateways() {
  const bridge = getTermousBridge()
  const runtimeConfig = bridge ? await bridge.getConfig() : {}
  return createRuntimeGatewaysFromConfig(runtimeConfig)
}

function createAliasGateway(
  alias: AliasClient,
): DomainGateway<AliasClient> & AliasGateway {
  return {
    sessionAliases: (sessionId, options) => alias.sessionAliases(sessionId, options),
    sessionAlias: (sessionId, aliasId, options) => (
      alias.sessionAlias(sessionId, aliasId, options)
    ),
    createSessionAlias: (sessionId, input, options) => (
      alias.createSessionAlias(sessionId, input, options)
    ),
    updateSessionAlias: (sessionId, aliasId, input, options) => (
      alias.updateSessionAlias(sessionId, aliasId, input, options)
    ),
    deleteSessionAlias: (sessionId, aliasId, options) => (
      alias.deleteSessionAlias(sessionId, aliasId, options)
    ),
    repairSessionAliasBridge: (sessionId, options) => (
      alias.repairSessionAliasBridge(sessionId, options)
    ),
    refreshSessionAliasTemplate: (sessionId, options) => (
      alias.refreshSessionAliasTemplate(sessionId, options)
    ),
    createSessionAliasSyncTask: (sessionId, input, options) => (
      alias.createSessionAliasSyncTask(sessionId, input, options)
    ),
    activeAliasSyncTask: (options) => alias.activeAliasSyncTask(options),
    aliasSyncTask: (taskId, options) => alias.aliasSyncTask(taskId, options),
    cancelAliasSyncTask: (taskId, options) => alias.cancelAliasSyncTask(taskId, options),
    aliasSyncTaskEventsUrl: (taskId) => alias.aliasSyncTaskEventsUrl(taskId),
  }
}

function createFileGateway(
  sessions: FileSessionClient,
  operations: FileOperationClient,
  transfers: TransferClient,
  catalog: FileCatalogClient,
  rename: FileRenameClient,
  search: FileSearchClient,
): FileGateway {
  return {
    getFileSession: (id) => sessions.getFileSession(id),
    fileSessionEventsUrl: (id) => sessions.fileSessionEventsUrl(id),
    listFileSessionFiles: (fileSessionId, path, options) => (
      sessions.listFileSessionFiles(fileSessionId, path, options)
    ),
    statFileSessionFile: (fileSessionId, path, signal) => (
      sessions.statFileSessionFile(fileSessionId, path, signal)
    ),
    mkdirFileSessionFile: (fileSessionId, path) => (
      sessions.mkdirFileSessionFile(fileSessionId, path)
    ),
    renameFileSessionFile: (fileSessionId, sourcePath, targetPath) => (
      sessions.renameFileSessionFile(fileSessionId, sourcePath, targetPath)
    ),
    chmodFileSessionFile: (fileSessionId, path, mode) => (
      sessions.chmodFileSessionFile(fileSessionId, path, mode)
    ),
    deleteFileSessionFiles: (fileSessionId, paths, recursive) => (
      sessions.deleteFileSessionFiles(fileSessionId, paths, recursive)
    ),
    copyFileSessionFiles: (fileSessionId, sourcePaths, targetDir, overwritePolicy) => (
      sessions.copyFileSessionFiles(fileSessionId, sourcePaths, targetDir, overwritePolicy)
    ),
    moveFileSessionFiles: (fileSessionId, sourcePaths, targetDir, overwritePolicy) => (
      sessions.moveFileSessionFiles(fileSessionId, sourcePaths, targetDir, overwritePolicy)
    ),
    createFileSessionTextReadOperation: (fileSessionId, path, signal) => (
      operations.createFileSessionTextReadOperation(fileSessionId, path, signal)
    ),
    createFileSessionTextSaveOperation: (fileSessionId, body, signal) => (
      operations.createFileSessionTextSaveOperation(fileSessionId, body, signal)
    ),
    createFileSessionImageReadOperation: (fileSessionId, path) => (
      operations.createFileSessionImageReadOperation(fileSessionId, path)
    ),
    fileOperation: (id) => operations.fileOperation(id),
    fileOperationResult: <Result>(id: string) => operations.fileOperationResult<Result>(id),
    fileOperationBlobResult: (id) => operations.fileOperationBlobResult(id),
    cancelFileOperation: (id) => operations.cancelFileOperation(id),
    fileOperationEventsUrl: (fileSessionId) => operations.fileOperationEventsUrl(fileSessionId),
    createLocalFileGrant: (source, paths) => transfers.createLocalFileGrant(source, paths),
    releaseLocalFileGrant: (id) => transfers.releaseLocalFileGrant(id),
    createFileSessionUploadTransfer: (
      fileSessionId,
      localGrantId,
      remoteDir,
      overwritePolicy,
      overwriteItemIds,
    ) => transfers.createFileSessionUploadTransfer(
      fileSessionId,
      localGrantId,
      remoteDir,
      overwritePolicy,
      overwriteItemIds,
    ),
    createFileSessionDownloadTransfer: (
      fileSessionId,
      remotePaths,
      localDir,
      overwritePolicy,
      signal,
    ) => transfers.createFileSessionDownloadTransfer(
      fileSessionId,
      remotePaths,
      localDir,
      overwritePolicy,
      signal,
    ),
    createRemoteCopyTransfer: (input) => transfers.createRemoteCopyTransfer(input),
    retryTransfer: (id) => transfers.retryTransfer(id),
    deleteTransfer: (id) => transfers.deleteTransfer(id),
    localPathMappingChildren: (id, path, signal) => (
      catalog.localPathMappingChildren(id, path, signal)
    ),
    localPathMappingStat: (id, path, signal) => catalog.localPathMappingStat(id, path, signal),
    fileRenamePresets: () => rename.fileRenamePresets(),
    createFileRenamePreset: (input) => rename.createFileRenamePreset(input),
    updateFileRenamePreset: (id, expectedUpdatedAt, input) => (
      rename.updateFileRenamePreset(id, expectedUpdatedAt, input)
    ),
    deleteFileRenamePreset: (id, expectedUpdatedAt) => (
      rename.deleteFileRenamePreset(id, expectedUpdatedAt)
    ),
    previewFileSessionBatchRename: (fileSessionId, input, signal) => (
      rename.previewFileSessionBatchRename(fileSessionId, input, signal)
    ),
    createFileSessionBatchRename: (fileSessionId, input) => (
      rename.createFileSessionBatchRename(fileSessionId, input)
    ),
    fileNameSearchCapability: (fileSessionId, connectionGeneration, signal) => (
      search.fileNameSearchCapability(fileSessionId, connectionGeneration, signal)
    ),
    searchFileSessionNames: (fileSessionId, input, signal) => (
      search.searchFileSessionNames(fileSessionId, input, signal)
    ),
    installFileNameSearch: (fileSessionId, input, signal) => (
      search.installFileNameSearch(fileSessionId, input, signal)
    ),
  }
}

function createTerminalGateway(
  settings: SettingsClient,
  sessions: SessionClient,
): TerminalGateway {
  return {
    terminalFontFileUrl: (id, sha256) => settings.terminalFontFileUrl(id, sha256),
    websocketUrl: (path) => sessions.websocketUrl(path),
    sessionCompletionStatus: (id, options) => sessions.sessionCompletionStatus(id, options),
    querySessionCompletions: (id, query, options) => (
      sessions.querySessionCompletions(id, query, options)
    ),
    refreshSessionCompletions: (id, options) => sessions.refreshSessionCompletions(id, options),
  }
}

function createAppDataSnapshotGateway(gateways: {
  settings: SettingsClient
  snippets: SnippetClient
  fileCatalog: FileCatalogClient
  forwards: ForwardClient
  hosts: HostClient
  credentials: CredentialClient
  sessions: SessionClient
  fileSessions: FileSessionClient
  remoteDesktop: RemoteDesktopClient
}): AppDataSnapshotGateway {
  return {
    settings: () => gateways.settings.settings(),
    terminalFonts: () => gateways.settings.terminalFonts(),
    codeSnippetGroups: () => gateways.snippets.codeSnippetGroups(),
    codeSnippets: () => gateways.snippets.codeSnippets(),
    fileBookmarkGroups: () => gateways.fileCatalog.fileBookmarkGroups(),
    fileBookmarks: () => gateways.fileCatalog.fileBookmarks(),
    localPathMappings: () => gateways.fileCatalog.localPathMappings(),
    hostGroups: () => gateways.hosts.hostGroups(),
    hostIcons: () => gateways.hosts.hostIcons(),
    connectionProxies: () => gateways.hosts.connectionProxies(),
    hosts: () => gateways.hosts.hosts(),
    hostAssets: () => gateways.hosts.hostAssets(),
    hostReachability: () => gateways.hosts.hostReachability(),
    credentials: () => gateways.credentials.credentials(),
    sessions: () => gateways.sessions.sessions(),
    fileSessions: () => gateways.fileSessions.fileSessions(),
    sshAccessProfiles: () => gateways.hosts.sshAccessProfiles(),
    fileAccessProfiles: () => gateways.hosts.fileAccessProfiles(),
    forwardProfiles: () => gateways.forwards.forwardProfiles(),
    forwards: () => gateways.forwards.forwards(),
    remoteDesktopProfiles: () => gateways.hosts.remoteDesktopAccessProfiles(),
    remoteDesktopSessions: () => gateways.remoteDesktop.remoteDesktopSessions(),
  }
}

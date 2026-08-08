import type { AppConfig } from '#common/contracts'
import type { AliasGateway } from '#features/alias'
import type { FileGateway } from '#features/files'
import type { TerminalGateway } from '#features/terminal'
import type { TermousApiTransport } from '#shared/api'
import { getTermousBridge } from '#shared/bridge'
import type { AppDataSnapshotGateway } from './runtimeGatewayContracts'
import { AliasClient } from './gateways/aliasClient'
import { CredentialClient } from './gateways/credentialsClient'
import { DataPortabilityClient } from './gateways/dataPortabilityClient'
import { DockerClient } from './gateways/dockerClient'
import { FileCatalogClient } from './gateways/fileCatalogClient'
import { FileOperationClient } from './gateways/fileOperationClient'
import { FileSessionClient } from './gateways/fileSessionClient'
import { FirewallClient } from './gateways/firewallClient'
import { ForwardClient } from './gateways/forwardsClient'
import { HostKeyClient } from './gateways/hostKeysClient'
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
  readonly docker: DomainGateway<DockerClient>
  readonly firewall: DomainGateway<FirewallClient>
  readonly fileSessions: DomainGateway<FileSessionClient>
  readonly transfers: DomainGateway<TransferClient>
  readonly dataPortability: DomainGateway<DataPortabilityClient>
  readonly files: FileGateway
  readonly terminal: TerminalGateway
  readonly snapshot: AppDataSnapshotGateway
}

export function createRuntimeGatewaysFromConfig(
  config: Partial<AppConfig> = {},
): RuntimeGateways {
  const runtime = new RuntimeClient(config)
  const settings = new SettingsClient(config)
  const snippets = new SnippetClient(config)
  const fileCatalog = new FileCatalogClient(config)
  const forwards = new ForwardClient(config)
  const hosts = new HostClient(config)
  const credentials = new CredentialClient(config)
  const hostKeys = new HostKeyClient(config)
  const sessions = new SessionClient(config)
  const aliasClient = new AliasClient(config)
  const observability = new ObservabilityClient(config)
  const service = new ServiceClient(config)
  const docker = new DockerClient(config)
  const firewall = new FirewallClient(config)
  const fileSessions = new FileSessionClient(config)
  const fileOperations = new FileOperationClient(config)
  const transfers = new TransferClient(config)
  const dataPortability = new DataPortabilityClient(config)

  return {
    runtime,
    settings,
    snippets,
    fileCatalog,
    forwards,
    hosts,
    credentials,
    hostKeys,
    sessions,
    alias: createAliasGateway(aliasClient, hosts),
    observability,
    service,
    docker,
    firewall,
    fileSessions,
    transfers,
    dataPortability,
    files: createFileGateway(fileSessions, fileOperations, transfers, fileCatalog),
    terminal: createTerminalGateway(settings, sessions),
    snapshot: createAppDataSnapshotGateway({
      settings,
      snippets,
      fileCatalog,
      forwards,
      hosts,
      credentials,
      sessions,
      fileSessions,
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
  hosts: HostClient,
): DomainGateway<AliasClient> & AliasGateway {
  return {
    hostIconFileUrl: (iconId) => hosts.hostIconFileUrl(iconId),
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
    createFileSessionUploadTransfer: (
      fileSessionId,
      localGrantId,
      remoteDir,
      overwritePolicy,
    ) => transfers.createFileSessionUploadTransfer(
      fileSessionId,
      localGrantId,
      remoteDir,
      overwritePolicy,
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
    retryTransfer: (id) => transfers.retryTransfer(id),
    deleteTransfer: (id) => transfers.deleteTransfer(id),
    localPathMappingChildren: (id, path, signal) => (
      catalog.localPathMappingChildren(id, path, signal)
    ),
    localPathMappingStat: (id, path, signal) => catalog.localPathMappingStat(id, path, signal),
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
    connectionProxies: () => gateways.hosts.connectionProxies(),
    hosts: () => gateways.hosts.hosts(),
    hostReachability: () => gateways.hosts.hostReachability(),
    credentials: () => gateways.credentials.credentials(),
    sessions: () => gateways.sessions.sessions(),
    fileSessions: () => gateways.fileSessions.fileSessions(),
    forwardProfiles: () => gateways.forwards.forwardProfiles(),
    forwards: () => gateways.forwards.forwards(),
  }
}

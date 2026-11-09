import type { McpClient, AuthProvider } from '@earendil-works/pi-mcp'
import type { IntegrationHostConfig, IntegrationToolDefinition } from '../contracts/integrations.ts'
import type { IntegrationScheduler } from './scheduling.ts'

export interface IntegrationConnection {
  key: string
  generation: string
  client: McpClient
  directory: IntegrationToolDefinition[]
  serial: IntegrationScheduler
  lastUsed: number
  owners: Set<string>
  config: IntegrationHostConfig
  directoryRevision: number
  publishedRevision: number
  retired?:boolean
  close(): Promise<void>
}

export interface IntegrationConnectionOptions {
  installationLease?(config: IntegrationHostConfig, owner: string, release: boolean): Promise<void>
  verifyLaunch?(config: IntegrationHostConfig, signal: AbortSignal): Promise<void>
  ensureSupervised(): Promise<void>
  superviseGroup?(pid: number, release: boolean): Promise<void>
  fetch?: typeof fetch
  environment?: Record<string, string | undefined>
  authProvider?(config: IntegrationHostConfig): AuthProvider
  report?(code:string):void
}

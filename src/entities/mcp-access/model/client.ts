import type { McpScope } from './scopes.ts'

export interface McpClient {
  id: string
  name: string
  enabled: boolean
  approval_bypass: boolean
  scopes: McpScope[]
  host_access_mode: 'all_saved'
  token_prefix: string
  revision: number
  created_at: string
  updated_at: string
  last_used_at?: string
}

export interface McpClientInput {
  name: string
  approval_bypass: boolean
  scopes: McpScope[]
}

export interface McpClientPatch {
  name?: string
  enabled?: boolean
  approval_bypass?: boolean
  scopes?: McpScope[]
}

export interface McpClientUpdateInput {
  name: string
  enabled: boolean
  approval_bypass: boolean
  scopes: McpScope[]
  expected_revision: number
}

export interface McpClientToken {
  client: McpClient
  token: string
}

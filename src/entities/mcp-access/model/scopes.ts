export const mcpScopes = [
  'hosts:read',
  'hosts:probe',
  'sessions:read',
  'sessions:connect',
  'sessions:close',
  'commands:execute',
  'commands:read',
  'commands:interrupt',
  'sftp:read',
  'sftp:connect',
  'sftp:close',
  'sftp:write',
  'sftp:transfer',
  'sftp:cancel',
  'system:read',
  'processes:read',
  'processes:terminate',
  'services:read',
  'services:manage',
  'docker:read',
  'docker:manage',
  'crontab:read',
  'crontab:write',
] as const

export type McpScope = (typeof mcpScopes)[number]

export const defaultMcpScopes: McpScope[] = ['hosts:read', 'sessions:read']

export const approvalRequiredScopes: readonly McpScope[] = [
  'commands:execute',
  'sftp:write',
  'sftp:transfer',
  'processes:terminate',
  'services:manage',
  'docker:manage',
  'crontab:write',
]

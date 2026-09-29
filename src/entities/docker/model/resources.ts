export type DockerResourceKind = 'images' | 'volumes' | 'networks'

export interface DockerResource {
  kind: DockerResourceKind
  id: string
  name: string
  tags?: string[]
  driver?: string
  scope?: string
  size?: string
  created_at?: string
}

export interface DockerResourceQuery {
  query?: string
  offset?: number
  limit?: number
}

export interface DockerResourceList {
  items: DockerResource[]
  total: number
  filtered: number
  offset: number
  limit: number
  collected_at: string
}

export interface DockerResourceDetail {
  resource: DockerResource
  platform?: string
  size_bytes?: number
  mountpoint?: string
  internal: boolean
  attachable: boolean
  subnets?: { subnet: string; gateway?: string }[]
  containers?: { id: string; name: string; ipv4?: string; ipv6?: string }[]
  collected_at: string
}

export interface DockerResourceCreateRequest {
  name: string
  internal?: boolean
}

export type DockerResourceActionRequest =
  | { action: 'remove' }
  | { action: 'tag'; tag: string }
  | { action: 'connect' | 'disconnect'; container: string }

export interface DockerResourceActionResult {
  id: string
  kind: DockerResourceKind
  action: 'create' | DockerResourceActionRequest['action']
  completed_at: string
}

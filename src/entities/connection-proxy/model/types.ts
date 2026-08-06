export type ConnectionProxyType = 'http_connect' | 'socks5'

export interface ConnectionProxy {
  id: string
  name: string
  type: ConnectionProxyType
  url: string
  bound_host_count: number
  created_at?: string
  updated_at?: string
}

export interface ConnectionProxyInput {
  name: string
  type: ConnectionProxyType
  url: string
}

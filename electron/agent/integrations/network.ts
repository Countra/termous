import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici'
import type { LocalNetworkSettings } from '#common/contracts'
import { isIP } from 'node:net'

function noProxy(settings?: LocalNetworkSettings) {
  const values = ['localhost', '.localhost', '127.0.0.1', '::1', '[::1]']
  for (const entry of settings?.bypass ?? []) {
    values.push(entry)
    const host = entry.startsWith('[') ? entry.slice(1, entry.indexOf(']')) : isIP(entry) ? entry : entry.split(':')[0]
    if (!isIP(host) && !host.startsWith('.') && !host.startsWith('*')) values.push(`.${entry}`)
  }
  return values.join(',')
}

// 每个连接持有独立快照，禁止修改全局 dispatcher 或父进程环境。
export function integrationNetwork(settings?: LocalNetworkSettings, implementation?: typeof fetch) {
  if (implementation) return { fetch: implementation, close: async () => undefined }
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: settings?.enabled ? settings.url : '',
    httpsProxy: settings?.enabled ? settings.url : '',
    noProxy: noProxy(settings),
  })
  const request: typeof fetch = (input, init) => proxyFetch(input as Parameters<typeof proxyFetch>[0], {
    ...init, dispatcher,
  } as Parameters<typeof proxyFetch>[1]) as unknown as ReturnType<typeof fetch>
  // 调用方已结束业务请求；销毁空闲及残余流，避免第三方长连接拖住退出。
  return { fetch: request, close: () => dispatcher.destroy() }
}

export function applyIntegrationProxy(environment: Record<string, string>, settings?: LocalNetworkSettings, platform = process.platform) {
  if (!settings?.enabled) return environment
  const values: Record<string, string> = {
    http_proxy: settings.url, https_proxy: settings.url, all_proxy: settings.url,
    no_proxy: noProxy(settings),
    npm_config_proxy: settings.url, npm_config_https_proxy: settings.url,
    npm_config_noproxy: noProxy(settings), node_use_env_proxy: '1',
  }
  const result = Object.fromEntries(Object.entries(environment).filter(([key]) => !(key.toLowerCase() in values)))
  for (const [key, value] of Object.entries(values)) {
    result[key.toUpperCase()] = value
    if (platform !== 'win32') result[key] = value
  }
  return result
}

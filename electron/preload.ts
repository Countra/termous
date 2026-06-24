import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('termous', {
  getConfig: () =>
    Promise.resolve({
      apiBaseUrl: process.env.TERMOUS_API_BASE_URL ?? 'http://127.0.0.1:8122',
      apiToken: process.env.TERMOUS_API_TOKEN ?? (process.env.NODE_ENV === 'development' ? 'dev-token' : ''),
    }),
  platform: process.platform,
})

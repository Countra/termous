import { afterEach, expect, test, vi } from 'vitest'
import { ScreenAnalysisClient } from './client'

afterEach(() => vi.unstubAllGlobals())

test.each(['get', 'list', 'cancel'] as const)('%s 拒绝旧版分析记录', async operation => {
  const record = { id: 'analysis', schema_version: 1 }
  const body = operation === 'list' ? { items: [record], total: 1 } : record
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))
  const client = new ScreenAnalysisClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: '' })
  const request = operation === 'get' ? client.getAnalysis('analysis')
    : operation === 'list' ? client.listAnalyses() : client.cancelAnalysis('analysis')
  await expect(request).rejects.toMatchObject({ code: 'analysis_version_mismatch' })
})

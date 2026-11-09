import assert from 'node:assert/strict'
import test from 'node:test'
import type { IntegrationCorePort } from '../contracts/integrations.ts'
import { IntegrationManager } from './manager.ts'

test('文本媒体类型按完整名称识别，参数和大小写不影响读取，二进制不误解码', async () => {
  const context = { run_id: 'run', session_id: 'session', generation: 1, bearer: 'fixture' }
  let media = ''
  const readContent: IntegrationCorePort['readContent'] = async () => ({ resource: { id:'resource', mime_type:media, object:{sha256:'a'.repeat(64),size_bytes:10} },
    data: Buffer.from('中文🙂').toString('base64'), next_offset:10, done:true })
  const core = { readContent } as IntegrationCorePort
  const manager = new IntegrationManager(core, { ensureSupervised: async () => {} })
  try {
    for (const value of ['text/plain; charset=utf-8', 'Application/JSON; charset=utf-8', 'application/xml', 'application/yaml']) {
      media = value
      const result = await manager.content(context, 'resource', 0)
      assert.equal('text' in result ? result.text : undefined, '中文🙂')
      assert.equal(result.data, undefined)
    }
    for (const value of ['application/json-seq', 'application/xml-dtd', 'application/octet-stream']) {
      media = value
      const result = await manager.content(context, 'resource', 0)
      assert.equal('text' in result, false)
      assert.equal(result.data, undefined)
    }
  } finally { await manager.close() }
})

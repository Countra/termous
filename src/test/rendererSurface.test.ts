import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadRendererSurface,
  resolveRendererSurface,
} from '../app/rendererSurface.ts'

test('仅显式 update surface 加载独立更新界面', () => {
  assert.equal(resolveRendererSurface('?surface=update'), 'update')
  assert.equal(resolveRendererSurface('?surface=main'), 'main')
  assert.equal(resolveRendererSurface('?surface=UPDATE'), 'main')
  assert.equal(resolveRendererSurface(''), 'main')
})

test('surface 分流只调用目标模块加载器', async () => {
  const calls: string[] = []
  const result = await loadRendererSurface('?surface=update', {
    main: async () => {
      calls.push('main')
      return 'main'
    },
    update: async () => {
      calls.push('update')
      return 'update'
    },
  })

  assert.equal(result, 'update')
  assert.deepEqual(calls, ['update'])
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TermousApi,
  TermousApiError,
} from '../api/client'

describe('TermousApiError 运行时身份合同', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('API 错误使用公开导出的唯一错误类实例', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'RESOURCE_CONFLICT',
        message: '资源状态已变化',
        details: { resource: 'alias' },
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 409,
    })))
    const api = new TermousApi({
      apiBaseUrl: 'http://127.0.0.1:8122',
      apiToken: '',
    })

    let caught: unknown
    try {
      await api.health()
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(TermousApiError)
    expect((caught as Error).constructor).toBe(TermousApiError)
    expect(caught).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      details: { resource: 'alias' },
      status: 409,
    })
  })
})

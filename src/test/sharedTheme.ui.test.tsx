import { theme as antdTheme } from 'antd'
import { describe, expect, it } from 'vitest'
import { createAntdTheme } from '#shared/theme'

describe('Ant Design 主题合同', () => {
  it('深浅主题保持既定算法和关键运行时颜色', () => {
    const dark = createAntdTheme('dark')
    const light = createAntdTheme('light')

    expect(dark.algorithm).toBe(antdTheme.darkAlgorithm)
    expect(light.algorithm).toBe(antdTheme.defaultAlgorithm)
    expect(dark.token).toMatchObject({
      colorBgBase: '#0f1116',
      colorPrimary: '#6aa8ff',
      fontSize: 13,
    })
    expect(light.token).toMatchObject({
      colorBgBase: '#f4f5f7',
      colorPrimary: '#1f6feb',
      fontSize: 13,
    })
  })
})

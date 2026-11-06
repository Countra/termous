import { expect, it } from 'vitest'
import { i18n } from '#shared/i18n'
import { analysisError } from './messages'

it('分析提示转换已知错误码，隐藏未知接口详情并保留本地校验文案', () => {
  const t = i18n.getFixedT('zh-CN')
  expect(analysisError('analysis_unavailable', t)).toBe('画面分析暂不可用，请稍后重试')
  expect(analysisError(new Error('analysis_crop_failed'), t)).toBe('无法生成模板图像，请重试')
  expect(analysisError({ code: 'analysis_storage_limit', message: 'internal detail' }, t)).toBe('分析存储已达上限，请清理历史记录')
  expect(analysisError({ code: 'NETWORK_ERROR', message: 'Failed to fetch' }, t)).toBe('连接失败，请稍后重试')
  expect(analysisError({ code: 'REQUEST_TIMEOUT' }, t)).toBe('请求超时，请重试')
  expect(analysisError({ code: 'future_error', message: 'internal detail' }, t)).toBe('操作失败，请重试')
  expect(analysisError('analysis_future_error', t)).toBe('操作失败，请重试')
  expect(analysisError(new Error('analysis_invalid_crop'), t)).toBe(t('analysisCenter.image.invalidCrop'))
  expect(analysisError(new Error('analysis_context_changed'), t)).toBe(t('desktopWorkflow.analysisWorkspace.contextChanged'))
  expect(analysisError(new Error('analysis_copy_failed'), t)).toBe('复制失败，请重试')
  expect(analysisError(new Error('Traceback: internal detail'), t)).toBe('操作失败，请重试')
  expect(analysisError('internal detail', t)).toBe('操作失败，请重试')
  expect(analysisError(null, t)).toBe('操作失败，请重试')
  expect(analysisError('analysis_unavailable', i18n.getFixedT('en-US'))).toBe('Screen analysis is unavailable. Try again later.')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { isScreenAnalysisParameters, screenAnalysisDefaults } from './screen-analysis.ts'

test('画面分析设置拒绝非有限数、缺失字段、非法类型和尺寸步长', () => {
  assert.equal(isScreenAnalysisParameters(screenAnalysisDefaults), true)
  for (const patch of [
    { confidence: 0 }, { confidence: NaN }, { confidence: Infinity }, { image_size: 321 },
    { image_size: 1921 }, { max_detections: 1.5 }, { max_detections: 301 }, { text_confidence: -1 },
    { ocr_enabled: 0 }, { detector_enabled: false, ocr_enabled: false }, { detector_enabled: 1 }, { ocr_max_side: 639 }, { nms_iou: null }, { extra: 1 },
  ]) assert.equal(isScreenAnalysisParameters({ ...screenAnalysisDefaults, ...patch }), false)
  const missing = { ...screenAnalysisDefaults }
  Reflect.deleteProperty(missing, 'image_size')
  assert.equal(isScreenAnalysisParameters(missing), false)
})

test('参数边界合法，关闭 OCR 保留已保存的文字参数', () => {
  assert.equal(isScreenAnalysisParameters({ detector_enabled: true, confidence: 1e-8, image_size: 320, ocr_enabled: false,
    text_confidence: 0, nms_iou: 0, max_detections: 1, ocr_max_side: 640 }), true)
  assert.equal(isScreenAnalysisParameters({ detector_enabled: true, confidence: 1, image_size: 1920, ocr_enabled: true,
    text_confidence: 1, nms_iou: 1, max_detections: 300, ocr_max_side: 1920 }), true)
})

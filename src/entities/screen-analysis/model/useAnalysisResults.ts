import type { AnalysisGateway, AnalysisLayer, AnalysisQuery } from '#common/contracts'
import { useVisibleQuery } from './useVisibleQuery'
import { useEffect, useState } from 'react'

// 同一查询的列表和全量几何一起发布，任何一方失败都不能混入另一版筛选结果。
export function useAnalysisResults(gateway: AnalysisGateway, id: string, layer: AnalysisLayer, filter: AnalysisQuery, cursor?: string, active = true) {
  const key = JSON.stringify([id, layer, filter, cursor])
  const result = useVisibleQuery(key, async parentSignal => {
    const controller = new AbortController()
    const signal = AbortSignal.any([parentSignal, controller.signal])
    const geometryFilter = { ...filter }
    delete geometryFilter.sort; delete geometryFilter.limit; delete geometryFilter.cursor
    const [page, geometry] = await Promise.all([
      layer === 'ocr' ? gateway.analysisSpans(id, { ...filter, cursor, limit: 20 }, signal)
        : gateway.analysisElements(id, { ...filter, cursor, limit: 20 }, signal),
      gateway.analysisGeometry(id, signal, { ...geometryFilter, layer }),
    ]).catch(reason => {
      // 一侧失败后整组结果已不可发布，立即取消另一侧，避免占用独立窗口的读取名额。
      controller.abort()
      throw reason
    })
    return { id, layer, key, page, geometry }
  }, active)
  const [previous, setPrevious] = useState<typeof result.data>()
  useEffect(() => { if (result.data?.key === key) setPrevious(result.data) }, [result.data, key])
  const latest = result.data?.key === key ? result.data : previous
  const current = result.data?.key === key
  const data = active && (!result.error || current) && latest?.id === id && latest.layer === layer ? latest : undefined
  return { ...result, data, loading: (active && !result.error && !current) || result.loading }
}

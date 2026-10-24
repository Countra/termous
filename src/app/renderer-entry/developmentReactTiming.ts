// React 开发构建会将组件属性差异写入 User Timing；浏览器不会自动回收这些记录。
// 消费后仅清理 React 的记录，保留 DevTools 实时跟踪与其他模块的性能测量。
export function installDevelopmentReactTimingCleanup(): () => void {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('measure')) return () => undefined
  const consume = (entries: PerformanceEntry[]) => {
    const names = new Set<string>()
    for (const entry of entries) {
      if (entry.entryType !== 'measure') continue
      const detail: unknown = (entry as PerformanceMeasure).detail
      if (!detail || typeof detail !== 'object' || !('devtools' in detail)) continue
      const metadata = detail.devtools
      if (metadata && typeof metadata === 'object' && (
        'track' in metadata && metadata.track === 'Components ⚛'
        || 'trackGroup' in metadata && metadata.trackGroup === 'Scheduler ⚛'
      )) names.add(entry.name)
    }
    for (const name of names) performance.clearMeasures(name)
  }
  const observer = new PerformanceObserver(list => consume(list.getEntries()))
  observer.observe({ type: 'measure', buffered: true })
  return () => { consume(observer.takeRecords()); observer.disconnect() }
}

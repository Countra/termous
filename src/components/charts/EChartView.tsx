import { useEffect, useRef } from 'react'
import { LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

interface EChartViewProps {
  option: EChartsCoreOption
  className?: string
  theme?: 'dark' | 'light'
}

export function EChartView({ option, className = '', theme = 'dark' }: EChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const resizeFrameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return undefined
    }
    const chart = echarts.init(container, theme)
    chartRef.current = chart
    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => chart.resize())
    })
    observer.observe(container)
    return () => {
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [theme])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: false, lazyUpdate: true })
  }, [option])

  return <div ref={containerRef} className={`echart-view ${className}`.trim()} />
}

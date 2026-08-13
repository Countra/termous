import { act, render } from '@testing-library/react'
import type { EChartsCoreOption } from 'echarts/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chartMocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  init: vi.fn(),
  resize: vi.fn(),
  setOption: vi.fn(),
  use: vi.fn(),
}))

vi.mock('echarts/core', () => ({
  init: chartMocks.init,
  use: chartMocks.use,
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, PieChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  readonly callback: ResizeObserverCallback
  disconnect = vi.fn()
  observe = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  notify() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

import { EChartView } from './EChartView'

describe('共享 EChart 视图合同', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeResizeObserver.instances = []
    chartMocks.init.mockReturnValue({
      dispose: chartMocks.dispose,
      resize: chartMocks.resize,
      setOption: chartMocks.setOption,
    })
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('初始化图表、应用配置，并通过动画帧响应容器尺寸变化', () => {
    let frameCallback: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback
      return 17
    })
    const option = { series: [] } as EChartsCoreOption

    const view = render(<EChartView option={option} theme="dark" className="monitor-time-chart" />)

    expect(chartMocks.init).toHaveBeenCalledWith(view.container.firstElementChild, 'dark')
    expect(chartMocks.setOption).toHaveBeenCalledWith(option, { notMerge: false, lazyUpdate: true })
    expect(FakeResizeObserver.instances[0].observe).toHaveBeenCalledWith(view.container.firstElementChild)

    act(() => FakeResizeObserver.instances[0].notify())
    const pendingFrame = frameCallback as FrameRequestCallback | null
    expect(pendingFrame).not.toBeNull()
    act(() => pendingFrame?.(0))
    expect(chartMocks.resize).toHaveBeenCalledTimes(1)
  })

  it('主题变化时重建实例，并在卸载时释放观察器与图表', () => {
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const firstOption = { series: [] } as EChartsCoreOption
    const view = render(<EChartView option={firstOption} theme="dark" />)
    const firstObserver = FakeResizeObserver.instances[0]

    view.rerender(<EChartView option={firstOption} theme="light" />)

    expect(firstObserver.disconnect).toHaveBeenCalledTimes(1)
    expect(chartMocks.dispose).toHaveBeenCalledTimes(1)
    expect(chartMocks.init).toHaveBeenNthCalledWith(2, view.container.firstElementChild, 'light')
    expect(chartMocks.setOption).toHaveBeenCalledTimes(2)
    expect(chartMocks.setOption).toHaveBeenLastCalledWith(firstOption, { notMerge: false, lazyUpdate: true })

    view.unmount()
    expect(FakeResizeObserver.instances[1].disconnect).toHaveBeenCalledTimes(1)
    expect(chartMocks.dispose).toHaveBeenCalledTimes(2)
    expect(cancelAnimationFrame).not.toHaveBeenCalled()
  })
})

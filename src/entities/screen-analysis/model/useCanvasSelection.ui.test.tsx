import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCanvasSelection } from './useCanvasSelection'
import type { AnalysisGeometry } from '#common/contracts'

const geometry: AnalysisGeometry[] = [
  { id: 0, kind: 'region', bbox_xyxy: [0, 0, 100, 100], center_xy: [49, 49] },
  { id: 7, kind: 'region', bbox_xyxy: [10, 10, 30, 30], center_xy: [19, 19] },
]
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function Fixture({ select, disabled = false, context = 'elements', scale = 1 }: { select: (id: number) => void; disabled?: boolean; context?: string; scale?: number }) {
  const viewport = useRef<HTMLDivElement>(null)
  const selection = useCanvasSelection(geometry, undefined, disabled, scale, context, viewport, select)
  return <div data-testid="viewport" ref={viewport} {...selection.handlers}>
    <div ref={selection.image} data-testid="image" />
    <output data-testid="menu">{selection.menu?.items.map(item => item.id).join(',')}</output>
    <output data-testid="hovered">{selection.hovered}</output>
    {selection.menu && createPortal(<div data-testid="popup">候选菜单</div>, document.body)}
  </div>
}

function pointer(target: HTMLElement, x: number, y: number, move?: [number, number]) {
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: x, clientY: y })
  if (move) fireEvent.pointerMove(target, { pointerId: 1, clientX: move[0], clientY: move[1] })
  fireEvent.pointerUp(target, { pointerId: 1, clientX: x, clientY: y })
}

it('重叠点击提供全部候选；单项直接选中，拖动返回起点也不误选', () => {
  const select = vi.fn()
  render(<Fixture select={select} />)
  const target = screen.getByTestId('image')
  pointer(target, 12, 12)
  expect(screen.getByTestId('menu')).toHaveTextContent('7,0')
  expect(select).not.toHaveBeenCalled()
  pointer(target, 60, 60)
  expect(select).toHaveBeenCalledExactlyOnceWith(0)
  select.mockClear()
  pointer(target, 60, 60, [75, 75])
  expect(select).not.toHaveBeenCalled()
})

it('加载、图层切换和取消清理候选与手势', () => {
  const select = vi.fn()
  const view = render(<Fixture select={select} />)
  pointer(screen.getByTestId('image'), 12, 12)
  view.rerender(<Fixture select={select} disabled />)
  expect(screen.getByTestId('menu')).toBeEmptyDOMElement()
  pointer(screen.getByTestId('image'), 60, 60)
  expect(select).not.toHaveBeenCalled()
  view.rerender(<Fixture select={select} context="ocr" />)
  fireEvent.pointerDown(screen.getByTestId('image'), { button: 0, pointerId: 1, clientX: 60, clientY: 60 })
  fireEvent.pointerCancel(screen.getByTestId('image'), { pointerId: 1 })
  fireEvent.pointerUp(screen.getByTestId('image'), { pointerId: 1, clientX: 60, clientY: 60 })
  expect(select).not.toHaveBeenCalled()
})

it('平移缩放只改变屏幕命中映射，不改变候选的原图坐标', () => {
  const select = vi.fn()
  render(<Fixture select={select} scale={2} />)
  const target = screen.getByTestId('image')
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50 } as DOMRect)
  pointer(target, 124, 74)
  expect(screen.getByTestId('menu')).toHaveTextContent('7,0')
  pointer(target, 220, 170)
  expect(select).toHaveBeenCalledExactlyOnceWith(0)
  expect(geometry[1].center_xy).toEqual([19, 19])
})

it('滚动 Portal 菜单保持候选，滚动画布才清理菜单', () => {
  render(<Fixture select={vi.fn()} />)
  pointer(screen.getByTestId('image'), 12, 12)
  fireEvent.wheel(screen.getByTestId('popup'), { deltaY: 100 })
  expect(screen.getByTestId('menu')).toHaveTextContent('7,0')
  fireEvent.wheel(screen.getByTestId('image'), { deltaY: 100 })
  expect(screen.getByTestId('menu')).toBeEmptyDOMElement()
})

it('点击和窗口失焦取消待执行悬停及未完成手势', async () => {
  vi.useFakeTimers()
  const select = vi.fn()
  render(<Fixture select={select} />)
  const target = screen.getByTestId('image')
  fireEvent.pointerMove(target, { clientX: 60, clientY: 60 })
  pointer(target, 12, 12)
  await act(() => vi.advanceTimersByTimeAsync(20))
  expect(screen.getByTestId('hovered')).toBeEmptyDOMElement()
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 60, clientY: 60 })
  fireEvent.blur(window)
  fireEvent.pointerUp(target, { pointerId: 1, clientX: 60, clientY: 60 })
  expect(select).not.toHaveBeenCalled()
})

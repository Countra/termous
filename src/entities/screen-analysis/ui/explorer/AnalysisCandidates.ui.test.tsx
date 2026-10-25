import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AnalysisCandidates } from './AnalysisCandidates'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('候选菜单取得焦点、键盘高亮，Escape 只关闭菜单', async () => {
  const hover = vi.fn(), close = vi.fn(), select = vi.fn()
  const view = render(<AnalysisCandidates menu={{ x: 10, y: 10, items: [
    { id: 2, kind: 'region', bbox_xyxy: [10, 10, 30, 30], center_xy: [19, 19] },
    { id: 8, kind: 'region', bbox_xyxy: [0, 0, 100, 100], center_xy: [49, 49] },
  ] }} onHover={hover} onClose={close} onSelect={select} />)
  const items = await screen.findAllByRole('menuitem')
  // jsdom 不计算布局，补齐组件库判断可见候选所需的尺寸。
  for (const item of items) vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 32))
  await waitFor(() => expect(items[0]).toHaveFocus())
  expect(hover).toHaveBeenCalledWith(2)
  fireEvent.keyDown(items[0], { key: 'ArrowDown', keyCode: 40, which: 40 })
  await waitFor(() => expect(items[1]).toHaveFocus())
  expect(hover).toHaveBeenCalledWith(8)
  fireEvent.keyDown(items[1], { key: 'Escape', keyCode: 27, which: 27 })
  expect(close).toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
  view.unmount()
})

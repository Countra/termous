import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { SelectControl } from './SelectControl'

test('复用外部标签和说明，保留占位提示与选项禁用语义', async () => {
  const user = userEvent.setup(), onChange = vi.fn()
  render(<>
    <label htmlFor="resolution">接收分辨率</label>
    <p id="resolution-hint">只影响接收画面。</p>
    <SelectControl id="resolution" aria-describedby="resolution-hint" placeholder="选择分辨率"
      options={[{ value: '1080p', label: '1080p', disabled: true }, { value: '720p', label: '720p' }]}
      onChange={onChange} />
  </>)
  const control = screen.getByRole('combobox', { name: '接收分辨率' })
  expect(control).toHaveAccessibleDescription('只影响接收画面。')
  expect(screen.getByText('选择分辨率')).toBeVisible()
  await user.click(control)
  await user.click(screen.getByTitle('1080p'))
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByTitle('720p'))
  expect(onChange.mock.lastCall?.[0]).toBe('720p')
})

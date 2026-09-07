import { ConfigProvider } from 'antd'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DateTimePicker } from './DateTimePicker'

describe('DateTimePicker', () => {
  it('使用本地日期时间格式展示并支持清除', () => {
    const onChange = vi.fn()
    const value = new Date(2026, 7, 22, 14, 35)
    render(
      <ConfigProvider>
        <DateTimePicker
          value={value}
          ariaLabel="开始时间"
          onChange={onChange}
        />
      </ConfigProvider>,
    )

    const input = screen.getByRole('textbox', { name: '开始时间' })
    const root = input.closest('.ant-picker')
    expect(input).toHaveValue('2026-08-22 14:35')
    expect(root?.querySelector('.lucide-calendar-clock')).toBeInTheDocument()

    fireEvent.mouseEnter(root as HTMLElement)
    fireEvent.click(root?.querySelector('.ant-picker-clear') as HTMLElement)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('打开统一主题的 Ant Design 日期时间面板', async () => {
    const onOpenChange = vi.fn()
    render(
      <ConfigProvider>
        <DateTimePicker
          value={null}
          ariaLabel="结束时间"
          size="small"
          popupZIndex={4100}
          onChange={vi.fn()}
          onOpenChange={onOpenChange}
        />
      </ConfigProvider>,
    )

    fireEvent.click(screen.getByRole('textbox', { name: '结束时间' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(true))
    const popup = document.querySelector('.ant-picker-dropdown') as HTMLElement
    expect(popup.querySelector('.ant-picker-panel-container')).toBeInTheDocument()
    expect(popup.className).toContain('compact')
    expect(popup.style.zIndex).toBe('4100')
  })

  it('无效受控值安全回退并保留禁用和错误状态', () => {
    render(
      <ConfigProvider>
        <DateTimePicker
          value={new Date(Number.NaN)}
          ariaLabel="无效时间"
          disabled
          status="error"
          onChange={vi.fn()}
        />
      </ConfigProvider>,
    )

    const input = screen.getByRole('textbox', { name: '无效时间' })
    expect(input).toHaveValue('')
    expect(input).toBeDisabled()
    expect(input.closest('.ant-picker')).toHaveClass(
      'ant-picker-disabled',
      'ant-picker-status-error',
    )
  })
})

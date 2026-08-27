import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CustomSelect } from './CustomSelect.tsx'

describe('CustomSelect', () => {
  it('将校验状态和反馈关联传递给可聚焦控件', () => {
    const view = render(
      <>
        <CustomSelect
          label="SSH route"
          value="primary"
          options={[{ value: 'primary', label: 'Primary SSH' }]}
          status="error"
          aria-invalid
          aria-describedby="route-error"
          onChange={vi.fn()}
        />
        <small id="route-error">Route is unavailable</small>
      </>,
    )

    const select = screen.getByRole('combobox', { name: 'SSH route' })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAttribute('aria-describedby', 'route-error')
    expect(view.container.querySelector('.ant-select-status-error')).toBeInTheDocument()
  })
})

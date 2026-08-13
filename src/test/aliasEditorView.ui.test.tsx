import { Form } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import {
  AliasEditorView,
  type AliasEditorValues,
} from '../features/alias/ui/AliasEditorView'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

function AliasEditorHarness({ editing }: { editing: boolean }) {
  const [form] = Form.useForm<AliasEditorValues>()
  return (
    <AliasEditorView
      form={form}
      controlScope="alias-mode-contract"
      editing={editing}
      saving={false}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />
  )
}

describe('Alias 编辑器模式合同', () => {
  it('使用动态标题、短模式文案和对应操作区分新增与编辑', async () => {
    const user = userEvent.setup()
    const view = render(<AliasEditorHarness editing={false} />)

    const createContext = document.querySelector('[data-editor-mode="create"]')
    expect(createContext).toHaveTextContent('workbench.aliases.title')
    expect(createContext).toHaveTextContent('app.add')
    expect(createContext).toHaveAttribute('data-editor-size', 'default')
    expect(screen.queryByText('workbench.aliases.editorHint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.create' })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'workbench.aliases.name' }), 'deploy')
    expect(createContext).toHaveTextContent('deploy')

    view.rerender(<AliasEditorHarness editing />)

    const editContext = document.querySelector('[data-editor-mode="edit"]')
    expect(editContext).toHaveTextContent('deploy')
    expect(editContext).toHaveTextContent('app.edit')
    expect(editContext).toHaveAttribute('data-editor-size', 'default')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeInTheDocument()
  })
})

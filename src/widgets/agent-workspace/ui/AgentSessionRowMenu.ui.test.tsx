import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contextActionMenuPopupClassName } from '#shared/ui'
import { AgentSessionRow } from './AgentSessionRow.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)

describe('AgentSessionRow menus', () => {
  it.each(['contextMenu', 'more'] as const)('%s 的移组子菜单复用主题样式，菜单移组保留置顶', async (entry) => {
    const onMoveToGroup = vi.fn().mockResolvedValue(undefined)
    const onSelect = vi.fn()
    render(<AgentSessionRow
      session={{ id: 'session', title: 'Conversation', model_id: 'model', model_name: 'Model', updated_at: '', archived: false, pinned: true, group_id: 'current', run_status: 'running' }}
      groups={['current', 'target'].map((id, sort_order) => ({ id, name: id, sort_order, revision: 1, created_at: '', updated_at: '' }))}
      selected disabled={false} busy={false} editing={false} pendingIds={new Set()} queued={false} showGroup search={false}
      execute={async (_key, operation) => { await operation(); return true }}
      onSelect={onSelect} onArchive={vi.fn()} onDelete={vi.fn()} onEditingChange={vi.fn()} onMoveToGroup={onMoveToGroup}
    />)
    if (entry === 'contextMenu') fireEvent.contextMenu(screen.getByRole('listitem'))
    else await userEvent.click(screen.getByRole('button', { name: 'agent.sessions.more' }))
    await userEvent.hover(await screen.findByRole('menuitem', { name: /^agent.sessions.moveToGroup/ }))
    const target = await screen.findByRole('menuitem', { name: 'target' })
    expect(target.closest('.ant-dropdown-menu-submenu-popup')).toHaveClass(contextActionMenuPopupClassName)
    expect(screen.getByRole('menuitem', { name: 'current' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(target)
    expect(onMoveToGroup).toHaveBeenCalledWith('session', 'target')
    expect(onSelect).not.toHaveBeenCalled()
  })
})

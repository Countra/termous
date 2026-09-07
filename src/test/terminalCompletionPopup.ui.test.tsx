import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CompletionItem } from '#entities/session'
import { TerminalCompletionPopup } from '../features/terminal/ui/TerminalCompletionPopup'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      exists: () => true,
    },
    t: (key: string) => key,
  }),
}))

vi.mock('#entities/shortcuts', () => ({
  useShortcutRuntime: () => ({
    labels: new Map(),
  }),
}))

const items: CompletionItem[] = [
  {
    id: 'history:git-status',
    kind: 'command',
    source: 'history',
    label: 'git status',
    insert_text: ' status',
    replace_start_utf16: 3,
    replace_end_utf16: 3,
    sources: ['history'],
  },
  {
    id: 'native:git-switch',
    kind: 'command',
    source: 'native',
    label: 'git switch',
    insert_text: ' switch',
    replace_start_utf16: 3,
    replace_end_utf16: 3,
    sources: ['native'],
  },
]

describe('终端补全候选交互', () => {
  it('鼠标悬停只展示视觉反馈，左键单击仍选择并接受目标候选', () => {
    const onSelectedIndexChange = vi.fn()
    const onAccept = vi.fn()

    render(
      <TerminalCompletionPopup
        id="completion-popup"
        open
        items={items}
        selectedIndex={0}
        position={{
          left: 0,
          top: 0,
          maxWidth: 320,
          maxHeight: 240,
          placement: 'below',
        }}
        themeMode="dark"
        onSelectedIndexChange={onSelectedIndexChange}
        onAccept={onAccept}
      />,
    )

    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')

    expect(listbox).toHaveAttribute('aria-activedescendant', 'completion-popup-option-0')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')

    fireEvent.mouseEnter(options[1])

    expect(onSelectedIndexChange).not.toHaveBeenCalled()
    expect(onAccept).not.toHaveBeenCalled()
    expect(listbox).toHaveAttribute('aria-activedescendant', 'completion-popup-option-0')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')

    fireEvent.mouseDown(options[1], { button: 0 })

    expect(onSelectedIndexChange).toHaveBeenCalledOnce()
    expect(onSelectedIndexChange).toHaveBeenCalledWith(1)
    expect(onAccept).toHaveBeenCalledOnce()
    expect(onAccept).toHaveBeenCalledWith(items[1], 1)
    expect(onSelectedIndexChange.mock.invocationCallOrder[0]).toBeLessThan(
      onAccept.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })
})

import { Palette, Pencil, Pin, PinOff, RotateCcw } from 'lucide-react'
import type { SessionTabPreference } from '../model/sessionTabPreferences'
import { SessionTabMenuItem } from './SessionTabMenuItem'

export function buildSessionTabAppearanceItems(
  preference: SessionTabPreference | undefined,
  t: (key: string) => string,
) {
  return [
    {
      key: 'rename',
      label: <SessionTabMenuItem icon={<Pencil size={15} />} title={t('terminal.tabMenu.rename')} />,
    },
    {
      key: 'pin',
      label: <SessionTabMenuItem icon={preference?.pinned ? <PinOff size={15} /> : <Pin size={15} />}
        title={t(preference?.pinned ? 'terminal.tabMenu.unpin' : 'terminal.tabMenu.pin')} />,
    },
    {
      key: 'color',
      label: <SessionTabMenuItem icon={<Palette size={15} />} title={t('terminal.tabMenu.color')} />,
    },
    {
      key: 'reset',
      disabled: !preference,
      label: <SessionTabMenuItem icon={<RotateCcw size={15} />} title={t('terminal.tabMenu.reset')} />,
    },
  ]
}

import {
  ArrowDownUp,
  Bookmark,
  Bot,
  Cable,
  CircleCheck,
  Compass,
  DatabaseBackup,
  FileCode2,
  FolderOpen,
  FolderDown,
  KeyRound,
  Network,
  PanelRightOpen,
  PlugZap,
  Server,
  ServerCog,
  Settings2,
  ShieldCheck,
  SquareTerminal,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ProductTourStepId } from '../model/productTourSteps.ts'

const stepIcons = {
  welcome: Compass,
  vaultNav: KeyRound,
  vaultActions: Wand2,
  credentialEditor: ShieldCheck,
  hostsNav: Server,
  hostEditor: ServerCog,
  hostConnections: Network,
  topbarConnect: PlugZap,
  workbench: SquareTerminal,
  workbenchTools: PanelRightOpen,
  files: FolderOpen,
  filesBookmarks: Bookmark,
  filesLocalDirectory: FolderDown,
  filesTransfers: ArrowDownUp,
  forwards: Cable,
  snippets: FileCode2,
  settings: Settings2,
  settingsTerminal: SquareTerminal,
  settingsMcp: PlugZap,
  settingsAgent: Bot,
  settingsData: DatabaseBackup,
  finish: CircleCheck,
} satisfies Record<ProductTourStepId, LucideIcon>

export interface ProductTourPopoverDecoration {
  stepId: ProductTourStepId
  titleIcon: HTMLElement
  closeIcon: HTMLElement
  release: () => void
}

interface ProductTourPopoverChromeProps {
  decoration: ProductTourPopoverDecoration | null
}

export function ProductTourPopoverChrome({ decoration }: ProductTourPopoverChromeProps) {
  useEffect(() => () => decoration?.release(), [decoration])

  if (!decoration) {
    return null
  }
  const StepIcon = stepIcons[decoration.stepId]
  return (
    <>
      {createPortal(<StepIcon size={17} strokeWidth={1.9} />, decoration.titleIcon)}
      {createPortal(<X size={16} strokeWidth={2} aria-hidden="true" />, decoration.closeIcon)}
    </>
  )
}

import type { ReactNode } from 'react'
import { Button, Tooltip } from 'antd'
import { Clipboard, Keyboard, Maximize, Minimize, Monitor, MousePointer2, MousePointerBan } from 'lucide-react'
import { SelectControl } from '#shared/ui'
import type { DesktopCopy } from '../../model/desktopCopy'
import styles from './RemoteDesktopToolbar.module.scss'

export function RemoteDesktopToolbar({ copy, label, status, viewing, holdsControl, controlAvailable, working, keyboardAvailable, clipboardAvailable, fit, fullscreen, onControl, onScale, onTool, onFullscreen, files, presentation }: {
  copy: DesktopCopy
  label: string
  status: string
  viewing: boolean
  holdsControl: boolean
  controlAvailable: boolean
  working: boolean
  keyboardAvailable: boolean
  clipboardAvailable: boolean
  fit: boolean
  fullscreen: boolean
  onControl(): void
  onScale(fit: boolean): void
  onTool(tool: 'text' | 'clipboard'): void
  onFullscreen(): void
  files?: ReactNode
  presentation: ReactNode
}) {
  const fullscreenLabel = fullscreen ? copy.exitFullscreen : copy.fullscreen
  return <header className={styles.toolbar} aria-label={copy.desktopControls}>
    <div className={styles.identity}>
      <Monitor size={16} className={styles.monitor} aria-hidden="true" />
      <span className={styles.protocol}>{label}</span>
      <span className={styles.status} data-viewing={viewing} role="status"><i aria-hidden="true" />{status}</span>
    </div>
    <div className={styles.actions}>
      <Button size="small" className={styles.control} type={holdsControl ? 'default' : 'primary'} icon={holdsControl ? <MousePointerBan size={14} /> : <MousePointer2 size={14} />} disabled={!controlAvailable || working} loading={working} onClick={onControl}>{holdsControl ? copy.release : copy.take}</Button>
      <div className={styles.group} role="group" aria-label={copy.inputTools}>
        <Tooltip title={copy.keyboard}><Button size="small" type="text" disabled={!keyboardAvailable || working} icon={<Keyboard size={16} />} aria-label={copy.keyboard} onClick={() => onTool('text')} /></Tooltip>
        <Tooltip title={copy.clipboard}><Button size="small" type="text" disabled={!clipboardAvailable || working} icon={<Clipboard size={16} />} aria-label={copy.clipboard} onClick={() => onTool('clipboard')} /></Tooltip>
        {files}
      </div>
      <div className={styles.group} role="group" aria-label={copy.displayTools}>
        <SelectControl className={styles.scale} size="small" value={fit ? 'fit' : 'actual'} aria-label={copy.displayMode} options={[{ value: 'fit', label: copy.fit }, { value: 'actual', label: copy.actual }]} onChange={mode => onScale(mode === 'fit')} />
        {presentation}
        <Tooltip title={fullscreenLabel}><Button size="small" type="text" icon={fullscreen ? <Minimize size={16} /> : <Maximize size={16} />} aria-label={fullscreenLabel} onClick={onFullscreen} /></Tooltip>
      </div>
    </div>
  </header>
}

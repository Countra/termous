import { Button, Popover, Radio } from 'antd'
import { Info, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { RemoteAccessMode } from '#common/contracts'
import type { RemoteCopy } from '../model/copy'
import styles from './RemoteAccessModeControl.module.scss'

interface Props {
  mode: RemoteAccessMode
  copy: RemoteCopy
  disabled: boolean
  pending: boolean
  onChange(mode: RemoteAccessMode): void
}

export function RemoteAccessModeControl({ mode, copy, disabled, pending, onChange }: Props) {
  return <section className={styles.control} aria-label={copy.accessMode}>
    <div className={styles.heading}>
      <span>{copy.accessMode}</span>
      <Popover trigger={['hover', 'focus']} placement="bottomLeft" content={
        <div className={styles['mode-details']}>
          <section aria-label={copy.fullControl}>
            <h4><ShieldCheck size={16} aria-hidden="true" />{copy.fullControl}</h4>
            <ul><li>{copy.fullControlHint}</li><li>{copy.fullControlExtras}</li></ul>
          </section>
          <section aria-label={copy.customControl}>
            <h4><SlidersHorizontal size={16} aria-hidden="true" />{copy.customControl}</h4>
            <ul><li>{copy.customControlScope}</li><li>{copy.customControlHint}</li></ul>
          </section>
          <p className={styles.boundary}>{copy.accessBoundary}</p>
        </div>
      }>
        <Button type="text" size="small" className={styles['help-trigger']}
          aria-label={`${copy.accessMode} · ${copy.permissionDetails}`} icon={<Info size={14} aria-hidden="true" />} />
      </Popover>
    </div>
    <Radio.Group className={styles.options} value={mode} disabled={disabled} aria-label={copy.accessMode} onChange={event => onChange(event.target.value as RemoteAccessMode)}>
      <Radio className={styles.choice} value="full" aria-label={copy.fullControl}>
        <span className={styles['option-content']}>
          <ShieldCheck size={19} aria-hidden="true" />
          <span><strong>{copy.fullControl}</strong><small>{copy.fullControlSummary}</small></span>
        </span>
      </Radio>
      <Radio className={styles.choice} value="custom" aria-label={copy.customControl}>
        <span className={styles['option-content']}>
          <SlidersHorizontal size={19} aria-hidden="true" />
          <span><strong>{copy.customControl}</strong><small>{copy.customControlSummary}</small></span>
        </span>
      </Radio>
    </Radio.Group>
    {pending ? <p className={styles.pending} role="status">{copy.modePending}</p> : null}
  </section>
}

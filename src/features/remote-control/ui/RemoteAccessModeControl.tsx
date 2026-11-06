import { Radio } from 'antd'
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
      <strong>{copy.accessMode}</strong>
      <Radio.Group value={mode} disabled={disabled} aria-label={copy.accessMode} optionType="button" buttonStyle="solid"
        options={[{ value: 'full', label: copy.fullControl }, { value: 'custom', label: copy.customControl }]}
        onChange={event => onChange(event.target.value as RemoteAccessMode)} />
    </div>
    <p>{mode === 'full' ? copy.fullControlHint : copy.customControlHint}</p>
    {mode === 'full' ? <p>{copy.fullControlBoundary}</p> : null}
    {pending ? <p role="status">{copy.modePending}</p> : null}
  </section>
}

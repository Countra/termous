import { Network } from 'lucide-react'
import { Input, InputNumber } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ForwardMode } from '../../types/domain'

export interface ForwardEndpointDraft {
  bind_host: string
  bind_port: number | null
  target_host: string
  target_port: number | null
}

interface ForwardEditorFieldsProps extends ForwardEndpointDraft {
  mode: ForwardMode
  disabled?: boolean
  compact?: boolean
  idPrefix?: string
  onChange: (patch: Partial<ForwardEndpointDraft>) => void
}

export function ForwardEditorFields({
  mode,
  bind_host,
  bind_port,
  target_host,
  target_port,
  disabled = false,
  compact = false,
  idPrefix = 'forward',
  onChange,
}: ForwardEditorFieldsProps) {
  const { t } = useTranslation()

  return (
    <div className={`forward-editor-fields${compact ? ' is-compact' : ''}`}>
      <div className="forward-editor-endpoint-group">
        <span className="forward-editor-group-label">
          {mode === 'remote' ? t('forwards.route.remoteListen') : t('forwards.route.localListen')}
        </span>
        <div className="forward-editor-field-grid">
          <label className="forward-field">
            <span className="field-label">
              {mode === 'remote' ? t('forwards.remoteBindHost') : t('forwards.localBindHost')}
            </span>
            <Input
              id={`${idPrefix}-bind-host`}
              name={`${idPrefix}-bind-host`}
              disabled={disabled}
              value={bind_host}
              onChange={(event) => onChange({ bind_host: event.target.value })}
            />
          </label>
          <label className="forward-field is-port">
            <span className="field-label">
              {mode === 'remote' ? t('forwards.remoteBindPort') : t('forwards.localBindPort')}
            </span>
            <InputNumber
              id={`${idPrefix}-bind-port`}
              name={`${idPrefix}-bind-port`}
              min={1}
              max={65535}
              disabled={disabled}
              value={bind_port}
              onChange={(value) => onChange({ bind_port: value })}
            />
          </label>
        </div>
      </div>

      {mode === 'dynamic' ? (
        <div className="forwarding-socks-hint">
          <Network size={15} aria-hidden="true" />
          <span>{t('forwards.dynamicHint')}</span>
        </div>
      ) : (
        <div className="forward-editor-endpoint-group">
          <span className="forward-editor-group-label">
            {mode === 'remote' ? t('forwards.route.localTarget') : t('forwards.route.remoteTarget')}
          </span>
          <div className="forward-editor-field-grid">
            <label className="forward-field">
              <span className="field-label">{t('forwards.targetHost')}</span>
              <Input
                id={`${idPrefix}-target-host`}
                name={`${idPrefix}-target-host`}
                disabled={disabled}
                value={target_host}
                onChange={(event) => onChange({ target_host: event.target.value })}
              />
            </label>
            <label className="forward-field is-port">
              <span className="field-label">{t('forwards.targetPort')}</span>
              <InputNumber
                id={`${idPrefix}-target-port`}
                name={`${idPrefix}-target-port`}
                min={1}
                max={65535}
                disabled={disabled}
                value={target_port}
                onChange={(value) => onChange({ target_port: value })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

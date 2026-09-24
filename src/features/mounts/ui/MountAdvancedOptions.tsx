import { Form, Input, InputNumber, Select, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import styles from './Mounts.module.scss'

export function MountAdvancedOptions({ busy }: { busy: boolean }) {
  const { t } = useTranslation()
  return <div className={styles['advanced-fields']}>
    <div className={styles['advanced-identity']}>
      <Form.Item name="volume_name" label={t('mounts.volume')} rules={[
        { max: 32, message: t('mounts.volumeLimit') },
        { pattern: /^[^,=/\\\p{Cc}]*$/u, message: t('mounts.volumeInvalid') },
      ]}>
        <Input maxLength={32} placeholder={t('mounts.volumeDefault')} disabled={busy} />
      </Form.Item>
      <div className={styles['advanced-toggle']}><span>{t('mounts.caseSensitive')}</span><Form.Item name="case_sensitive" valuePropName="checked" noStyle><Switch aria-label={t('mounts.caseSensitive')} disabled={busy} /></Form.Item></div>
    </div>
    <div className={styles['performance-options']}>
      <Form.Item name="directory_ttl_seconds" label={t('mounts.directoryCache')} extra={t('mounts.directoryCacheHint')}
        rules={[{ required: true, type: 'integer', min: 1, max: 3600, message: t('mounts.directoryCacheRange') }]}>
        <InputNumber min={1} max={3600} precision={0} suffix={t('mounts.seconds')} disabled={busy} />
      </Form.Item>
      <Form.Item name="attribute_ttl_seconds" label={t('mounts.refreshInterval')} extra={t('mounts.attributeCheckHint')}
        rules={[{ required: true, type: 'integer', min: 1, max: 300, message: t('mounts.attributeCheckRange') }]}>
        <InputNumber min={1} max={300} precision={0} suffix={t('mounts.seconds')} disabled={busy} />
      </Form.Item>
    </div>
    <Form.Item name="metadata_concurrency" label={t('mounts.metadataConcurrency')} extra={t('mounts.metadataConcurrencyHint')} rules={[{ required: true }]}>
      <Select options={[
        { value: 0, label: t('mounts.concurrencyAuto') },
        ...Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: t('mounts.concurrentRequests', { count: i + 1 }) })),
      ]} disabled={busy} className={`${customSelectStyles.select} termous-select`}
        classNames={{ popup: { root: `${customSelectStyles['select-popup']} termous-select-popup` } }} />
    </Form.Item>
  </div>
}

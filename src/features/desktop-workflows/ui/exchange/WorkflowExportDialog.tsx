import { Alert, Modal, Radio, Space } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowExportLayout } from '#common/contracts'

export function WorkflowExportDialog({ hasAssets, onExport, onClose }: { hasAssets: boolean; onExport: (layout: WorkflowExportLayout) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [layout, setLayout] = useState<WorkflowExportLayout>('zip')
  return <Modal open title={t('desktopWorkflow.exchange.export')} onCancel={onClose} onOk={() => onExport(layout)} okText={t('desktopWorkflow.exchange.export')}>
    <Space orientation="vertical" size="middle">
      <Alert type="info" showIcon title={t('desktopWorkflow.exchange.disclosure')} />
      <Radio.Group value={layout} onChange={event => setLayout(event.target.value)}><Space orientation="vertical">
        <Radio value="zip">{t('desktopWorkflow.exchange.zip')}</Radio>
        <Radio value="directory">{t('desktopWorkflow.exchange.directory')}</Radio>
        <Radio value="json" disabled={hasAssets}>{t('desktopWorkflow.exchange.json')}</Radio>
      </Space></Radio.Group>
    </Space>
  </Modal>
}

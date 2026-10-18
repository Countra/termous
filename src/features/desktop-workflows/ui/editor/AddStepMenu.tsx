import { Button, Dropdown } from 'antd'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { StepKind } from '#entities/desktop-workflow'
import { stepGroups, stepIcons, stepLabel } from '../shared/stepPresentation'
import styles from '../shared/WorkflowOverlays.module.scss'

export function AddStepMenu({ onAdd, compact = false }: { onAdd: (kind: StepKind) => void; compact?: boolean }) {
  const { t } = useTranslation()
  return <Dropdown trigger={['click']} placement="bottomLeft" classNames={{ root: styles.menu }} menu={{
    items: stepGroups.map((group) => ({ type: 'group', key: group.key, label: t(`desktopWorkflow.stepGroups.${group.key}`), children: group.kinds.map((kind) => {
      const Icon = stepIcons[kind]
      return { key: kind, icon: <Icon size={15} />, label: stepLabel(kind, t) }
    }) })),
    onClick: ({ key }) => onAdd(key as StepKind),
  }}>
    <Button size="small" type={compact ? 'text' : 'default'} icon={<Plus size={14} />} aria-label={t('desktopWorkflow.addStep')}>{!compact && t('desktopWorkflow.addStep')}</Button>
  </Dropdown>
}

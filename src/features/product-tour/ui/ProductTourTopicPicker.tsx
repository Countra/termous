import { Modal } from 'antd'
import { ArrowRight, Bot, Check, Cloud, Compass, FolderOpen, Laptop, Monitor, Network, Wrench, Workflow, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProductTourProgress } from '../model/productTourProgress.ts'
import { hasCompletedCurrentProductTour } from '../model/productTourStorage.ts'
import { productTourTopics, type ProductTourTopicId } from '../model/productTourTopics.ts'
import styles from './ProductTourTopicPicker.module.scss'

const icons = { basics: Compass, connections: Network, files: FolderOpen, desktop: Monitor, automation: Workflow, agent: Bot, cloud: Cloud, remote: Laptop, tools: Wrench }

export function ProductTourTopicPicker({ open, progress, completedTopic, onSelect, onClose, afterClose }: {
  open: boolean; progress: ProductTourProgress; completedTopic: ProductTourTopicId | null
  onSelect: (topic: ProductTourTopicId) => void; onClose: () => void; afterClose: () => void
}) {
  const { t } = useTranslation()
  return <Modal open={open} centered width={740} title={t('productTour.menuLabel')} footer={null} destroyOnHidden
    rootClassName={`termous-modal-root ${styles.root}`} classNames={{ body: styles.body }} onCancel={onClose} afterClose={afterClose}
    closable={{ 'aria-label': t('productTour.close') }} closeIcon={<X size={18} aria-hidden="true" />}>
    {completedTopic && <div className={styles.completion} role="status">
      <Check size={16} aria-hidden="true" />
      <span>{t('productTour.topicCompleted', { topic: t(`productTour.topics.${completedTopic}.title`) })}</span>
    </div>}
    <p className={styles.intro}>{t(completedTopic ? 'productTour.continueTopic' : 'productTour.chooseTopic')}</p>
    <div className={styles.topics}>
      {productTourTopics.map(({ id, steps }) => {
        const Icon = icons[id]
        const completed = hasCompletedCurrentProductTour(progress.forTopic(id))
        return <button key={id} type="button" className={styles.topic} data-featured={id === 'basics' || undefined} onClick={() => onSelect(id)}>
          <span className={styles.icon}><Icon size={19} strokeWidth={1.7} aria-hidden="true" /></span>
          <span className={styles.copy}><strong>{t(`productTour.topics.${id}.title`)}</strong><span>{t(`productTour.topics.${id}.description`)}</span></span>
          <span className={styles.meta}>{completed ? <><Check size={13} aria-hidden="true" />{t('productTour.completed')}</> : t('productTour.stepCount', { count: steps.length })}<ArrowRight size={14} aria-hidden="true" /></span>
        </button>
      })}
    </div>
  </Modal>
}

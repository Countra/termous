import { Modal } from 'antd'
import { ArrowRight, Bot, Check, Cloud, Compass, FolderOpen, Laptop, Monitor, Network, Puzzle, SquareTerminal, Wrench, Workflow, X } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProductTourProgress } from '../model/productTourProgress.ts'
import { hasCompletedCurrentProductTour } from '../model/productTourStorage.ts'
import { productTourTopics, type ProductTourTopicId } from '../model/productTourTopics.ts'
import styles from './ProductTourTopicPicker.module.scss'

const icons = { basics: Compass, connections: Network, files: FolderOpen, desktop: Monitor, automation: Workflow, agent: Bot, extensions: Puzzle, cloud: Cloud, remote: Laptop, tools: Wrench }

export function ProductTourTopicPicker({ open, progress, completedTopic, onSelect, onClose, afterClose }: {
  open: boolean; progress: ProductTourProgress; completedTopic: ProductTourTopicId | null
  onSelect: (topic: ProductTourTopicId) => void; onClose: () => void; afterClose: () => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const topics = productTourTopics.map(topic => ({ ...topic, completed: hasCompletedCurrentProductTour(progress.forTopic(topic.id), topic.version) }))
  const basics = topics.find(topic => topic.id === 'basics')!
  return <Modal open={open} centered width={960} title={t('productTour.menuLabel')} destroyOnHidden footer={null}
    rootClassName={`termous-modal-root ${styles.root}`} classNames={{ header: styles.header, body: styles.body }} onCancel={onClose} afterClose={afterClose}
    closable={{ 'aria-label': t('productTour.close') }} closeIcon={<X size={18} aria-hidden="true" />}>
    {completedTopic && <div className={styles.completion} role="status">
      <Check size={16} aria-hidden="true" />
      <span>{t('productTour.topicCompleted', { topic: t(`productTour.topics.${completedTopic}.title`) })}</span>
    </div>}
    <div className={styles.layout}>
      <button type="button" className={styles.starter} onClick={() => onSelect('basics')}
        aria-labelledby={`${id}-basics`} aria-describedby={`${id}-basics-description ${id}-basics-meta`}>
        <span className={styles['starter-icon']}><Compass size={26} strokeWidth={1.5} aria-hidden="true" /></span>
        <strong id={`${id}-basics`} className={styles['starter-title']}>{t('productTour.topics.basics.title')}</strong>
        <span id={`${id}-basics-description`} className={styles['starter-description']}>{t('productTour.topics.basics.description')}</span>
        <span id={`${id}-basics-meta`} className={styles['starter-meta']}>
          <span>{t('productTour.stepCount', { count: basics.steps.length })}</span>
          {basics.completed && <span className={styles.completed}><Check size={12} aria-hidden="true" />{t('productTour.completed')}</span>}
        </span>
        <span className={styles.preview} aria-hidden="true">
          <span className={styles['preview-toolbar']}><i /><i /><i /></span>
          <span className={styles['preview-workspace']}>
            <span className={styles['preview-nav']}><SquareTerminal size={14} /><FolderOpen size={14} /><Bot size={14} /></span>
            <span className={styles['preview-content']}><SquareTerminal size={20} strokeWidth={1.4} /><i /><i /><i /></span>
          </span>
        </span>
        <span className={styles['starter-action']}>{t(basics.completed ? 'productTour.revisitBasics' : 'productTour.startBasics')}<ArrowRight size={16} aria-hidden="true" /></span>
      </button>
      <section className={styles.catalog} aria-labelledby={`${id}-topics`}>
        <h3 id={`${id}-topics`}>{t('productTour.browseTopics')}</h3>
        <div className={styles.topics}>
          {topics.filter(topic => topic.id !== 'basics').map(({ id: topicId, steps, completed }) => {
            const Icon = icons[topicId]
            return <button key={topicId} type="button" className={styles.topic} data-completed={completed || undefined} onClick={() => onSelect(topicId)}
              aria-labelledby={`${id}-${topicId}`} aria-describedby={`${id}-${topicId}-description ${id}-${topicId}-meta`}>
              <span className={styles.icon}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /></span>
              <span className={styles.copy}><strong id={`${id}-${topicId}`}>{t(`productTour.topics.${topicId}.title`)}</strong><span id={`${id}-${topicId}-description`}>{t(`productTour.topics.${topicId}.description`)}</span></span>
              <span id={`${id}-${topicId}-meta`} className={styles.meta}>{completed ? <><Check size={12} aria-hidden="true" />{t('productTour.completed')}</> : t('productTour.stepCount', { count: steps.length })}<ArrowRight size={13} aria-hidden="true" /></span>
            </button>
          })}
        </div>
      </section>
    </div>
  </Modal>
}

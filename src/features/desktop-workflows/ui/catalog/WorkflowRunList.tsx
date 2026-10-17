import { Monitor } from 'lucide-react'
import type { Run } from '#entities/desktop-workflow'
import { runTone } from '../shared/runPresentation'
import styles from './WorkflowRunList.module.scss'

export function WorkflowRunList({ runs, selected, onSelect }: { runs: Run[]; selected?: string; onSelect: (id: string) => void }) {
  return <div className={styles.list}>{runs.map(run => <button type="button" key={run.id} className={styles.item} data-tone={runTone(run.state)} aria-current={selected === run.id ? 'true' : undefined} onClick={() => onSelect(run.id)}>
    <span className={styles.heading}><strong title={run.name}>{run.name}</strong><span className={styles.version}>v{run.version}</span></span>
    <span className={styles.target}><Monitor size={12} /><span title={run.target_name}>{run.target_name || '—'}</span>{run.protocol && <small>{run.protocol.toUpperCase()}</small>}</span>
  </button>)}</div>
}

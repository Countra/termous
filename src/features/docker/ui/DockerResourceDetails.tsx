import { Button } from 'antd'
import { HardDrive, Layers, Link2, Network, Tag, Trash2, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DockerResourceDetail } from '#entities/docker'
import { formatBytes, formatDate } from '#shared/format'
import type { DockerResourceIntent } from './DockerResourceDialog'
import styles from './DockerResources.module.scss'

export function DockerResourceDetails({ detail, busy, onAction }: {
  detail: DockerResourceDetail
  busy: boolean
  onAction: (intent: DockerResourceIntent) => void
}) {
  const { t } = useTranslation()
  const text = (key: string) => t(`workbench.docker.resources.${key}`)
  const item = detail.resource
  const Icon = item.kind === 'images' ? Layers : item.kind === 'volumes' ? HardDrive : Network
  const builtin = item.kind === 'networks' && ['bridge', 'host', 'none'].includes(item.name)
  const fields = [
    [text('created'), formatDate(item.created_at)],
    ...(item.kind === 'images' ? [[text('size'), formatBytes(detail.size_bytes ?? 0)], [text('platform'), detail.platform]] : [[text('driver'), item.driver], [text('scope'), item.scope]]),
    ...(item.kind === 'volumes' ? [[text('mountpoint'), detail.mountpoint]] : []),
    ...(item.kind === 'networks' ? [[text('internal'), detail.internal ? text('yes') : text('no')], [text('attachable'), detail.attachable ? text('yes') : text('no')]] : []),
  ]
  return <>
    <div className={styles['detail-scroll']}>
      <header className={styles['detail-header']}>
        <span className={styles['detail-icon']}><Icon size={21} aria-hidden="true" /></span>
        <div><h3>{item.name}</h3><span>{text(item.kind)}</span></div>
      </header>
      <dl className={styles.facts}>
        {item.kind !== 'volumes' && <div><dt>{text('id')}</dt><dd>
          <details className={styles.identifier}><summary title={item.id}>{item.id.replace(/^sha256:/, '').slice(0, 12)}<span>{text('fullId')}</span></summary><code>{item.id}</code></details>
        </dd></div>}
        {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
      </dl>
      {item.kind === 'images' && <section className={styles['detail-section']}>
        <h4><Tag size={14} aria-hidden="true" />{text('tags')}<span className={styles.count}>{item.tags?.length ?? 0}</span></h4>
        {item.tags?.length ? <div className={styles.tags}>{item.tags.map((tag) => <code key={tag}>{tag}</code>)}</div> : <p>{text('untagged')}</p>}
      </section>}
      {item.kind === 'networks' && <>
        <section className={styles['detail-section']}>
          <h4><Network size={14} aria-hidden="true" />{text('subnets')}</h4>
          {detail.subnets?.length ? detail.subnets.map((subnet) => <div className={styles.subnet} key={`${subnet.subnet}:${subnet.gateway}`}>
            <code>{subnet.subnet}</code><span>{text('gateway')}: {subnet.gateway || '—'}</span>
          </div>) : <p>{text('noSubnets')}</p>}
        </section>
        <section className={styles['detail-section']}>
          <h4>{text('attachedContainers')} <span className={styles.count}>{detail.containers?.length ?? 0}</span></h4>
          {detail.containers?.length ? detail.containers.map((container) => <div className={styles.endpoint} key={container.id}>
            <div><strong>{container.name || container.id.slice(0, 12)}</strong><span>{container.ipv4 || container.ipv6 || container.id.slice(0, 12)}</span></div>
            <Button type="text" danger size="small" disabled={busy} icon={<Unplug size={14} />}
              onClick={() => onAction({ action: 'disconnect', resource: item, container: container.id, containerName: container.name })}>{text('disconnect')}</Button>
          </div>) : <p>{text('noContainers')}</p>}
        </section>
      </>}
    </div>
    <footer className={styles.actions}>
      {item.kind === 'images' && <Button size="small" disabled={busy} icon={<Tag size={14} />} onClick={() => onAction({ action: 'tag', resource: item })}>{text('tag')}</Button>}
      {item.kind === 'networks' && !['host', 'none'].includes(item.name) && <Button size="small" disabled={busy} icon={<Link2 size={14} />} onClick={() => onAction({ action: 'connect', resource: item })}>{text('connect')}</Button>}
      <Button className={styles.remove} size="small" type="text" danger disabled={busy || builtin} icon={<Trash2 size={14} />} onClick={() => onAction({ action: 'remove', resource: item })}>{text('remove')}</Button>
      {builtin && <span>{text('builtin')}</span>}
    </footer>
  </>
}

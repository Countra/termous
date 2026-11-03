import { Image, Pagination } from 'antd'
import { ImageOff, Image as ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowExchangeAsset } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import styles from './WorkflowExchangeDialog.module.scss'

function TemplateImage({ id, asset, gateway }: { id: string; asset: WorkflowExchangeAsset; gateway: WorkflowMediaGateway }) {
  const [source, setSource] = useState<string>()
  const [failed, setFailed] = useState(false)
  const { t } = useTranslation()
  useEffect(() => {
    const abort = new AbortController()
    let url: string | undefined
    setSource(undefined); setFailed(false)
    const load = async () => {
      if (!gateway.importAsset) throw new Error('workflow_asset_unavailable')
      return gateway.importAsset(id, asset.sha256, abort.signal)
    }
    void load().then(blob => {
      if (!abort.signal.aborted) { url = URL.createObjectURL(blob); setSource(url) }
    }).catch(() => { if (!abort.signal.aborted) setFailed(true) })
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url) }
  }, [gateway, id, asset.sha256])
  return <figure className={styles.template}>
    <div className={styles['template-image']}>
      {source && !failed ? <Image src={source} height={88} preview alt={asset.path} onError={() => setFailed(true)} /> : <span role="status" aria-label={t(failed ? 'desktopWorkflow.exchange.imageFailed' : 'desktopWorkflow.exchange.template')}>
        {failed ? <ImageOff size={20} /> : <ImageIcon size={20} />}</span>}
    </div>
    <figcaption><strong title={asset.path}>{asset.path.split('/').slice(-1)[0]}</strong><span>{failed ? t('desktopWorkflow.exchange.imageFailed') : `${asset.width} × ${asset.height}`}</span></figcaption>
  </figure>
}

export function WorkflowImportTemplates({ id, assets, gateway }: { id: string; assets: WorkflowExchangeAsset[]; gateway: WorkflowMediaGateway }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const currentPage = Math.min(page, Math.max(1, Math.ceil(assets.length / 12)))
  return <section className={styles['template-section']}>
    <h3><ImageIcon size={15} />{t('desktopWorkflow.exchange.templates')}<span>{assets.length}</span></h3>
    <div className={styles.templates}>{assets.slice((currentPage - 1) * 12, currentPage * 12).map(asset => <TemplateImage key={`${id}:${asset.path}:${asset.sha256}`} id={id} asset={asset} gateway={gateway} />)}</div>
    {assets.length > 12 && <Pagination size="small" current={currentPage} pageSize={12} total={assets.length} showSizeChanger={false} onChange={setPage} />}
  </section>
}

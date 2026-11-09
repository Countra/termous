import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Spin } from 'antd'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentIntegrationSource, AgentIntegrationsGateway } from '#entities/agent-integrations'
import styles from './AssistantExtensions.module.scss'

export function SkillFilePreview({source,path,gateway}: {source:AgentIntegrationSource;path:string;gateway:AgentIntegrationsGateway}) {
  const {t}=useTranslation()
  const [text,setText]=useState<string>()
  const [url,setURL]=useState<string>()
  const [busy,setBusy]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const download=useRef<AbortController | null>(null)
  const file=source.skill?.files.find(value=>value.path===path)
  const image=Boolean(file && /^image\/(png|jpeg|webp|gif)$/u.test(file.mime_type))
  useEffect(()=>{
    const abort=new AbortController()
    let objectURL:string | undefined
    setText(undefined);setURL(undefined);setError('');setBusy(true);setSaving(false)
    void (async()=>{
      if (!file || !source.skill) return
      if (!image && file.object.size_bytes>512*1024) {setError(t('extensions.previewTooLarge'));return}
      const blob=await gateway.skillFile(source.id,source.skill.version,path,abort.signal,image)
      if (abort.signal.aborted) return
      if (image) { objectURL=URL.createObjectURL(blob);setURL(objectURL) }
      else {
        const content=new TextDecoder('utf-8',{fatal:true}).decode(await blob.arrayBuffer())
        if (content.includes('\0')) throw new Error(t('extensions.binaryFile'))
        if (!abort.signal.aborted) setText(content)
      }
    })().catch(error=>{if (!abort.signal.aborted) setError(error instanceof Error ? error.message : t('extensions.failed'))})
      .finally(()=>{if (!abort.signal.aborted) setBusy(false)})
    return ()=>{abort.abort();download.current?.abort();download.current=null;if(objectURL) URL.revokeObjectURL(objectURL)}
  },[source,file,path,image,gateway,t])
  const save=async()=>{
    if (!source.skill || download.current) return
    const abort=new AbortController();download.current=abort;setSaving(true)
    let objectURL:string | undefined
    try {
      const blob=await gateway.skillFile(source.id,source.skill.version,path,abort.signal)
      abort.signal.throwIfAborted()
      objectURL=URL.createObjectURL(blob)
      const link=document.createElement('a');link.href=objectURL;link.download=path.split('/').pop() || 'skill-file';link.click()
    } catch(error) {if (!abort.signal.aborted) setError(error instanceof Error ? error.message : t('extensions.failed'))}
    finally {if(objectURL) URL.revokeObjectURL(objectURL);if(download.current===abort) download.current=null;if(!abort.signal.aborted)setSaving(false)}
  }
  return <>
    <Spin spinning={busy}><div className={styles.document}>
      {url ? <img className={styles['skill-image']} src={url} alt={path}/> : text !== undefined ? <pre className={styles['skill-text']}>{text}</pre> : !busy && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('extensions.binaryFile')}/>}
    </div></Spin>
    {error && <Alert type="info" title={error}/>}
    <Button icon={<Download size={14}/>} loading={saving} onClick={()=>void save()}>{t('extensions.download')}</Button>
  </>
}

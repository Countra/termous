import { useEffect, useRef, useState } from 'react'
import { browserProductTourProgress, type ProductTourProgress } from '../model/productTourProgress.ts'
import type { ProductTourTopicId } from '../model/productTourTopics.ts'
import { ProductTourController, type ProductTourControllerProps } from './ProductTourController.tsx'
import { ProductTourTopicPicker } from './ProductTourTopicPicker.tsx'

export interface ProductTourGuideProps extends Omit<ProductTourControllerProps, 'completionStore' | 'topic' | 'onFinished'> {
  progress?: ProductTourProgress
}

export function ProductTourGuide({ progress = browserProductTourProgress, ...props }: ProductTourGuideProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [completedTopic, setCompletedTopic] = useState<ProductTourTopicId | null>(null)
  const [session, setSession] = useState<{ topic: ProductTourTopicId; key: number } | null>(null)
  const sequence = useRef(0)
  const manualHandled = useRef(0)
  const active = useRef(false)
  const selected = useRef<ProductTourTopicId | null>(null)
  const autoHandled = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const { manualRequestKey, ready, blocked, onBlocked } = props

  const begin = (topic: ProductTourTopicId) => {
    if (!latest.current.ready || latest.current.blocked) {
      latest.current.onBlocked()
      return
    }
    setSession({ topic, key: ++sequence.current })
  }

  useEffect(() => {
    if (ready) return
    // Core 重启等未就绪期间，旧选择和准备中的会话不应在恢复后继续。
    selected.current = null
    setPickerOpen(false)
    setSession(null)
    setCompletedTopic(null)
  }, [ready])

  useEffect(() => {
    if (manualRequestKey <= manualHandled.current) return
    manualHandled.current = manualRequestKey
    if (!ready || blocked) { onBlocked(); return }
    if (active.current) return
    autoHandled.current = true
    selected.current = null
    setSession(null)
    setCompletedTopic(null)
    setPickerOpen(true)
  }, [manualRequestKey, ready, blocked, onBlocked])

  useEffect(() => {
    if (autoHandled.current || !props.ready || props.blocked || pickerOpen || session || props.manualRequestKey > 0) return
    if (!props.autoStartEligible || !progress.shouldOfferBasics()) { autoHandled.current = true; return }
    const timer = window.setTimeout(() => {
      autoHandled.current = true
      setSession({ topic: 'basics', key: ++sequence.current })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [progress, props.ready, props.blocked, props.autoStartEligible, props.manualRequestKey, pickerOpen, session])

  return <>
    <ProductTourTopicPicker open={pickerOpen} progress={progress} completedTopic={completedTopic}
      onClose={() => { selected.current = null; setPickerOpen(false) }}
      onSelect={(topic) => { selected.current = topic; setPickerOpen(false) }}
      afterClose={() => { const topic = selected.current; selected.current = null; if (topic) begin(topic) }} />
    {session && <ProductTourController {...props} key={session.key} topic={session.topic}
      autoStartEligible={false} manualRequestKey={1} completionStore={progress.forTopic(session.topic)}
      onActiveChange={(value) => {
        active.current = value
        if (value && session.topic === 'basics') progress.markBasicsSeen()
        props.onActiveChange?.(value)
      }} onFinished={(reason) => {
        setSession(null)
        setCompletedTopic(reason === 'completed' ? session.topic : null)
        if (reason === 'completed' || reason === 'skipped') {
          // 关闭与启动失败直接退出；返回列表时仍尊重审批等业务阻塞。
          setPickerOpen(latest.current.ready && !latest.current.blocked)
        }
      }} />}
  </>
}

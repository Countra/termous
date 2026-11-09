import { Input } from 'antd'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function AnalysisSearch({ value, placeholder, onChange }: { value?: string; placeholder: string; onChange: (value?: string) => void }) {
  const [text, setText] = useState(value ?? '')
  const [composing, setComposing] = useState(false)
  const latest = useRef(onChange); latest.current = onChange
  useEffect(() => setText(value ?? ''), [value])
  useEffect(() => {
    if (composing || text === (value ?? '')) return
    const timer = setTimeout(() => latest.current(text || undefined), 250)
    return () => clearTimeout(timer)
  }, [text, composing, value])
  return <Input value={text} prefix={<Search size={14} />} allowClear placeholder={placeholder} aria-label={placeholder}
    onCompositionStart={() => setComposing(true)} onCompositionEnd={e => { setText(e.currentTarget.value); setComposing(false) }} onChange={e => setText(e.target.value)} />
}

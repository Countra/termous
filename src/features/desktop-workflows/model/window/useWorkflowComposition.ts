import { useEffect, useRef } from 'react'

export function useWorkflowComposition() {
  const composing = useRef<EventTarget | null>(null)
  useEffect(() => {
    const start = (event: CompositionEvent) => { composing.current = event.target }
    const end = () => { composing.current = null }
    document.addEventListener('compositionstart', start, true); document.addEventListener('compositionend', end, true)
    return () => { document.removeEventListener('compositionstart', start, true); document.removeEventListener('compositionend', end, true) }
  }, [])
  return () => {
    const input = composing.current
    if (!input) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); input.removeEventListener('compositionend', finish); resolve() }
      const timer = setTimeout(() => { input.removeEventListener('compositionend', finish); reject(new Error('workflow_composition_pending')) }, 30000)
      input.addEventListener('compositionend', finish, { once: true })
    })
  }
}

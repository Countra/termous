import type { AgentWorkspaceProps } from '#widgets/agent-workspace'

export type AgentPresentation = NonNullable<AgentWorkspaceProps['presentation']>

export function waitForAgentComposition(element: HTMLElement | null) {
  const input = element?.querySelector<HTMLTextAreaElement>('textarea[data-agent-composing="true"]')
  if (!input) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); input.removeEventListener('compositionend', finish); resolve() }
    const timer = setTimeout(() => { input.removeEventListener('compositionend', finish); reject(new Error('agent_composition_pending')) }, 30000)
    input.addEventListener('compositionend', finish, { once: true })
  })
}

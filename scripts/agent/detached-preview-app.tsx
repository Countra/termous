import { useMemo, useState } from 'react'
import { Button, Modal } from 'antd'
import { TermousUiProvider } from '#app/ui-runtime'
import { AgentPage } from '#pages/agent'
import { createDetachedFixture } from './detachedFixture.ts'

export function DetachedPreview() {
  const fixture = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const run = params.get('run')
    return createDetachedFixture(params.get('readiness') ?? 'ready', run === 'queued' || run === 'running' ? run : undefined)
  }, [])
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [language, setLanguage] = useState<'zh-CN' | 'en-US'>('zh-CN')
  const [active, setActive] = useState(true)
  const [confirm, setConfirm] = useState<{ resolve: (accepted: boolean) => void }>()
  return <TermousUiProvider theme={theme} language={language}>
    <div style={{ height: '100dvh', display: 'grid', gridTemplateRows: '42px minmax(0, 1fr)', background: 'var(--app-bg)' }}>
      <nav style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '0 12px' }}>
        <strong style={{ color: 'var(--text-primary)', marginRight: 'auto' }}>TERMOUS · 合成数据验收</strong>
        <Button size="small" onClick={() => setActive(value => !value)}>切换页面</Button>
        <Button size="small" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>主题</Button>
        <Button size="small" onClick={() => setLanguage(value => value === 'zh-CN' ? 'en-US' : 'zh-CN')}>语言</Button>
      </nav>
      <div style={{ position: 'relative', minHeight: 0, padding: 12 }}>
        <div style={{ height: '100%', display: active ? 'block' : 'none' }} inert={!active}>
          <AgentPage gateway={fixture.gateway} setupGateway={fixture.setup} enabled active={active} sshResourcesReady
            appearance={{ theme, language }} onOpenSettings={() => setActive(false)}
            onReturnToPage={() => active ? Promise.resolve(true) : new Promise<boolean>(resolve => setConfirm({ resolve }))} />
        </div>
        {!active && <p style={{ color: 'var(--text-primary)' }}>模拟主页面：有未保存的修改</p>}
      </div>
    </div>
    <Modal open={!!confirm} title="离开未保存的页面？" onOk={() => { confirm?.resolve(true); setActive(true); setConfirm(undefined) }}
      onCancel={() => { confirm?.resolve(false); setConfirm(undefined) }} okText="放弃并返回" cancelText="继续编辑" />
  </TermousUiProvider>
}

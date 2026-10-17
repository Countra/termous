import { useMemo, useState } from 'react'
import { Button, Modal } from 'antd'
import { TermousUiProvider } from '#app/ui-runtime'
import { WorkflowWorkspace } from '#features/desktop-workflows'
import { createWorkflowWindowFixture } from './workflow-window-fixture'

// 合成事件源不访问 Core 或真实会话；刷新仍经过产品自己的数据装配逻辑。
window.WebSocket = class { close() {} } as unknown as typeof WebSocket
export function WorkflowWindowPreview() {
  const fixture = useMemo(() => createWorkflowWindowFixture({ history: new URLSearchParams(location.search).has('history') }), [])
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [language, setLanguage] = useState<'zh-CN' | 'en-US'>('zh-CN')
  const [active, setActive] = useState(true)
  const [confirm, setConfirm] = useState<{ resolve: (accepted: boolean) => void }>()
  return <TermousUiProvider theme={theme} language={language}>
    <div style={{ height: '100dvh', display: 'grid', gridTemplateRows: '44px minmax(0, 1fr)', background: 'var(--app-bg)' }}>
      <nav style={{ display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10 }}><strong style={{ color: 'var(--text-primary)', marginRight: 'auto' }}>桌面自动化 · 合成数据验收</strong>
        <Button size="small" onClick={() => setActive(value => !value)}>切换页面</Button>
        <Button size="small" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>主题</Button>
        <Button size="small" onClick={() => setLanguage(value => value === 'zh-CN' ? 'en-US' : 'zh-CN')}>语言</Button>
      </nav>
      <main style={{ position: 'relative', minHeight: 0, padding: 12 }}>
        <div hidden={!active} inert={!active} style={{ height: '100%' }}>
          <WorkflowWorkspace gateway={fixture.gateway} sessions={fixture.sessions} activeSessionId="desktop" profiles={[]} appearance={{ theme, language }} onDirtyChange={() => {}}
            onViewDesktop={() => {}} onReturnToPage={() => active ? Promise.resolve(true) : new Promise<boolean>(resolve => setConfirm({ resolve }))} />
        </div>
        {!active && <p style={{ color: 'var(--text-primary)' }}>模拟主页面：有未保存的修改</p>}
      </main>
    </div>
    <Modal open={!!confirm} title="离开未保存的页面？" okText="放弃并返回" cancelText="继续编辑" onOk={() => { confirm?.resolve(true); setActive(true); setConfirm(undefined) }}
      onCancel={() => { confirm?.resolve(false); setConfirm(undefined) }} />
  </TermousUiProvider>
}

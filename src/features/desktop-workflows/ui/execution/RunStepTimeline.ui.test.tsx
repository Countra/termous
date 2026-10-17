import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Definition, StepResult, WorkflowGateway } from '#entities/desktop-workflow'
import { RunStepTimeline } from './RunStepTimeline'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('#shared/ui', () => ({ ImageThumbnail: () => <span>证据缩略图</span> }))
const base: StepResult = { run_id: 'run', index: 1, step_id: 'repeat-step', occurrence: '1.2', kind: 'capture', state: 'completed', started_at: '2026-10-17T00:00:00Z', finished_at: '2026-10-17T00:00:01Z' }

it('展开执行结果可查看路径和证据，不触发控制请求', () => {
  const onImage = vi.fn()
  const gateway = { asset: vi.fn(), control: vi.fn() } as unknown as WorkflowGateway
  render(<RunStepTimeline steps={[{ ...base, asset_id: 'evidence' }]} gateway={gateway} onImage={onImage} />)
  expect(screen.queryByText('1.2')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  expect(screen.getByText('1.2')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.viewEvidence' }))
  expect(onImage).toHaveBeenCalledWith(expect.objectContaining({ id: 'evidence' }))
  expect(gateway.control).not.toHaveBeenCalled()
})

it('重复步骤按发生序号独立展开，无效时间不显示 NaN', () => {
  const gateway = {} as WorkflowGateway
  render(<RunStepTimeline steps={[{ ...base, started_at: 'invalid' }, { ...base, index: 2, occurrence: '1.3' }]} gateway={gateway} onImage={vi.fn()} />)
  fireEvent.click(screen.getAllByRole('button', { expanded: false })[1]!)
  expect(screen.getByText('1.3')).toBeVisible()
  expect(screen.queryByText('1.2')).not.toBeInTheDocument()
  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
})

it('全局展开与收起应用于后续到达的步骤，单独收起不被事件刷新覆盖', () => {
  const gateway = {} as WorkflowGateway
  const props = { gateway, onImage: vi.fn() }
  const view = render(<RunStepTimeline {...props} steps={[base]} />)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.expandAll' }))
  expect(screen.getByText('1.2')).toBeVisible()
  view.rerender(<RunStepTimeline {...props} steps={[base, { ...base, index: 2, occurrence: '1.3' }]} />)
  expect(screen.getByText('1.3')).toBeVisible()
  fireEvent.click(screen.getAllByRole('button', { expanded: true })[0]!)
  view.rerender(<RunStepTimeline {...props} steps={[{ ...base, state: 'accepted' }, { ...base, index: 2, occurrence: '1.3' }]} />)
  expect(screen.queryByText('1.2')).not.toBeInTheDocument()
  expect(screen.getByText('1.3')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.collapseAll' }))
  view.rerender(<RunStepTimeline {...props} steps={[base, { ...base, index: 2, occurrence: '1.3' }, { ...base, index: 3, occurrence: '1.4' }]} />)
  expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(3)
})

it('步骤详情展示固定版本按键和多行文本，绑定字段不泄露静态值或参数默认值', () => {
  const definition: Definition = { schema_version: 1, parameters: [{ id: 'secret', name: '敏感口令', type: 'string', sensitive: true, default: '不应显示的默认值' }], steps: [
    { id: 'key', name: '提交', kind: 'keyboard.shortcut', action: { codes: ['ControlLeft', 'KeyS'] } },
    { id: 'text', name: '输入', kind: 'keyboard.text', action: { text: '第一行\n第二行' } },
    { id: 'bound', name: '参数输入', kind: 'keyboard.text', action: { text: '不应显示的静态值' }, bindings: { text: 'secret' } },
  ] }
  const steps = definition.steps.map((step, index) => ({ ...base, index: index + 1, step_id: step.id, kind: step.kind }))
  render(<RunStepTimeline steps={steps} definition={definition} gateway={{} as WorkflowGateway} onImage={vi.fn()} />)
  expect(screen.queryByText('第一行 第二行')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.expandAll' }))
  expect(screen.getByText('ControlLeft').tagName).toBe('KBD')
  expect(screen.getByText('KeyS').tagName).toBe('KBD')
  expect(screen.getByText('第一行 第二行')).toHaveTextContent('第一行 第二行')
  expect(screen.getByText('desktopWorkflow.sensitiveReference')).toBeVisible()
  expect(screen.queryByText(/不应显示的/)).not.toBeInTheDocument()
})

it('受控展开状态可交接到重新挂载的视图', () => {
  const changed = vi.fn()
  const props = { steps: [base, { ...base, index: 2, occurrence: '1.3' }], gateway: {} as WorkflowGateway, onImage: vi.fn(), onExpansionChange: changed }
  const view = render(<RunStepTimeline {...props} expansion={{ allExpanded: true, exceptions: ['run:2'] }} />)
  expect(screen.getByText('1.2')).toBeVisible()
  expect(screen.queryByText('1.3')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  expect(changed).toHaveBeenLastCalledWith({ allExpanded: true, exceptions: [] })
  view.unmount()
  render(<RunStepTimeline {...props} expansion={{ allExpanded: true, exceptions: [] }} />)
  expect(screen.getByText('1.2')).toBeVisible()
  expect(screen.getByText('1.3')).toBeVisible()
})

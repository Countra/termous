import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FileAccessProfileEditor } from '../../ui/FileAccessProfileEditor.tsx'
import { getFileAccessProfileEditor } from '../../model/engineEditorRegistry.ts'
import type { FileAccessProfileEditorDraft } from '../../model/types.ts'
import { smbEditor } from './definition.ts'
import { projectFileAccessProfile } from '#entities/file-access-profile'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('SMB 文件配置', () => {
  it('从统一入口创建，秘密与配置分开提交', async () => {
    const save = vi.fn()
    function Harness() {
      const [draft, setDraft] = useState<FileAccessProfileEditorDraft>({ engine: 'sftp', host_id: 'host', name: 'SFTP', ssh_profile_id: '' })
      return <><FileAccessProfileEditor mode="create" draft={draft} sshProfiles={[]} disabled={false} onChange={setDraft} />
        <button onClick={() => save(getFileAccessProfileEditor(draft.engine)?.toCreateInput(draft))}>save</button></>
    }
    render(<Harness />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.access.file.type' }))
    fireEvent.click(await screen.findByText('SMB'))
    for (const [field, value] of Object.entries({ host: '127.0.0.1', share: 'share', username: 'user', password: ' pw ' })) fireEvent.change(screen.getByLabelText(`files.smb.${field}`), { target: { value } })
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'files.smb.advanced' }))
    expect(screen.getByRole('spinbutton')).toHaveValue('445')
    fireEvent.change(screen.getByLabelText('files.smb.domain'), { target: { value: 'DOMAIN' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(save).toHaveBeenCalledWith({ host_id: 'host', name: 'SMB', engine: 'smb', engine_config_version: 1, config: { host: '127.0.0.1', port: 445, share: 'share', username: 'user', domain: 'DOMAIN', root_path: '/' }, secret_values: { password: ' pw ' } })
    expect(screen.queryByText('hosts.access.file.sshProfile')).not.toBeInTheDocument()
  })

  it('编辑保留密码，不在摘要中显示认证信息', () => {
    const profile = { id: 'smb', host_id: 'host', name: 'SMB', engine: 'smb', engine_config_version: 1, config: { host: '::1', port: 445, share: 'data', username: 'user', domain: '', root_path: '/workspace' }, secret_refs: { password: 'ref' }, is_default: false, sort_order: 0, created_at: '', updated_at: '' }
    const draft = smbEditor.editDraft(profile)
    if (!draft || draft.engine !== 'smb') throw new Error('缺少 SMB 草稿')
    expect(smbEditor.validate(draft, [])).toEqual({})
    expect(smbEditor.toPatchInput(draft).secret_values).toEqual({})
    render(<FileAccessProfileEditor mode="edit" draft={draft} sshProfiles={[]} disabled={false} onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('files.smb.configured')).toHaveValue('')
    expect(projectFileAccessProfile(profile).endpoint).toBe('SMB · [::1]:445 / data · /workspace')
    expect(smbEditor.summary(draft, [])).toBe(projectFileAccessProfile(profile).endpoint)
    expect(projectFileAccessProfile(profile).technology.editable).toBe(true)
    expect(projectFileAccessProfile(profile).routeDependency).toBeUndefined()
  })

  it('拒绝路径注入并自动展开高级字段错误', () => {
    const draft = smbEditor.createDraft('host', [])
    if (draft.engine !== 'smb') throw new Error('缺少 SMB 草稿')
    for (const host of ['smb://host', 'host:445', '[::1]:445', 'user@host', 'host/path']) expect(smbEditor.validate({ ...draft, host }, []).host).toBe('invalid')
    for (const share of ['a/b', '..', 'a:b', 'data.', 'data ']) expect(smbEditor.validate({ ...draft, share }, []).share).toBe('invalid')
    for (const root_path of ['/a/../b', '/a//b', '/a:stream', '/a\\b']) expect(smbEditor.validate({ ...draft, root_path }, []).root_path).toBe('invalid')
    expect(smbEditor.validate({ ...draft, username: 'DOMAIN\\user' }, []).username).toBe('invalid')
    render(<FileAccessProfileEditor mode="edit" draft={draft} sshProfiles={[]} disabled={false} errors={{ port: 'invalid' }} onChange={vi.fn()} />)
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
    expect(screen.getByText('files.smb.errors.port')).toBeInTheDocument()
  })

  it('修正高级字段后保持展开和输入焦点，允许手动收起', () => {
    function Harness() {
      const initial = smbEditor.createDraft('host', [])
      if (initial.engine !== 'smb') throw new Error('缺少 SMB 草稿')
      const [draft, setDraft] = useState<FileAccessProfileEditorDraft>({ ...initial, root_path: 'relative' })
      return <FileAccessProfileEditor mode="edit" draft={draft} sshProfiles={[]} errors={smbEditor.validate(draft, [])} disabled={false} onChange={setDraft} />
    }
    render(<Harness />)
    const root = screen.getByLabelText('files.smb.root_path')
    root.focus()
    fireEvent.change(root, { target: { value: '/workspace' } })
    expect(root).toHaveFocus()
    expect(screen.getByRole('button', { name: 'files.smb.advanced' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('files.smb.errors.root_path')).not.toBeInTheDocument()
    expect(screen.getByLabelText('files.smb.root_path')).toHaveValue('/workspace')
    fireEvent.click(screen.getByRole('button', { name: 'files.smb.advanced' }))
    expect(screen.queryByLabelText('files.smb.root_path')).not.toBeInTheDocument()
  })
})

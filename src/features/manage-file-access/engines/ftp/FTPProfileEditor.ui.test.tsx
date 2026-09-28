import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FileAccessProfileEditor } from '../../ui/FileAccessProfileEditor.tsx'
import { getFileAccessProfileEditor } from '../../model/engineEditorRegistry.ts'
import type { FileAccessProfileEditorDraft } from '../../model/types.ts'
import { ftpEditor } from './definition.ts'
import { projectFileAccessProfile } from '#entities/file-access-profile'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('FTP 文件配置', () => {
  it('从统一入口创建，切换加密模式并保留自定义端口', async () => {
    const save = vi.fn()
    function Harness() {
      const [draft, setDraft] = useState<FileAccessProfileEditorDraft>({ engine: 'sftp', host_id: 'host', name: 'SFTP', ssh_profile_id: '' })
      return <><FileAccessProfileEditor mode="create" draft={draft} sshProfiles={[]} disabled={false} onChange={setDraft} />
        <button onClick={() => save(getFileAccessProfileEditor(draft.engine)?.toCreateInput(draft))}>save</button></>
    }
    render(<Harness />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.access.file.type' }))
    fireEvent.click(await screen.findByText('FTP'))
    for (const [field, value] of Object.entries({ host: '127.0.0.1', username: 'user', password: ' pw ' })) fireEvent.change(screen.getByLabelText(`files.ftp.${field}`), { target: { value } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'files.ftp.security' }))
    fireEvent.click(await screen.findByText('files.ftp.securityOptions.implicit_tls'))
    expect(screen.getByRole('spinbutton')).toHaveValue('990')
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2121' } })
    fireEvent.blur(screen.getByRole('spinbutton'))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'files.ftp.security' }))
    fireEvent.click(await screen.findByText('files.ftp.securityOptions.none'))
    expect(screen.getByRole('spinbutton')).toHaveValue('2121')
    expect(screen.getByText('files.ftp.plainHint')).toBeInTheDocument()
    expect(screen.queryByText('hosts.access.file.sshProfile')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(save).toHaveBeenCalledWith({ host_id: 'host', name: 'FTP', engine: 'ftp', engine_config_version: 1, config: { host: '127.0.0.1', port: 2121, security: 'none', username: 'user', root_path: '/' }, secret_values: { password: ' pw ' } })
  })

  it('编辑不回显秘密并提供安全摘要', () => {
    const profile = { id: 'ftp', host_id: 'host', name: 'FTP', engine: 'ftp', engine_config_version: 1, config: { host: 'ftp.example.com', port: 990, security: 'implicit_tls', username: 'user', root_path: '/workspace' }, secret_refs: { password: 'ref' }, is_default: false, sort_order: 0, created_at: '', updated_at: '' }
    const draft = ftpEditor.editDraft(profile)
    if (!draft || draft.engine !== 'ftp') throw new Error('缺少 FTP 草稿')
    expect(ftpEditor.validate(draft, [])).toEqual({})
    expect(ftpEditor.toPatchInput(draft).secret_values).toEqual({})
    render(<FileAccessProfileEditor mode="edit" draft={draft} sshProfiles={[]} disabled={false} onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('files.ftp.configured')).toHaveValue('')
    const projection = projectFileAccessProfile(profile)
    expect(projection.endpoint).toContain('990')
    expect(projection.routeDependency).toBeUndefined()
    expect(projection.technology.editable).toBe(true)
    for (const host of ['::1', '[::1]']) {
      const ipv6 = { ...profile, config: { ...profile.config, host } }
      const ipv6Draft = ftpEditor.editDraft(ipv6)
      if (!ipv6Draft) throw new Error('缺少 IPv6 FTP 草稿')
      expect(projectFileAccessProfile(ipv6).endpoint).toBe('FTPS (TLS) · [::1]:990 · /workspace')
      expect(ftpEditor.summary(ipv6Draft, [])).toBe('FTPS (TLS) · [::1]:990 · /workspace')
    }
  })

  it('校验地址、根目录和协议注入字符', () => {
    const draft = ftpEditor.createDraft('host', [])
    if (draft.engine !== 'ftp') throw new Error('缺少 FTP 草稿')
    for (const host of ['ftp://host', 'host:21', '[::1]:21', '[::1]:', 'user@host', 'host/path', 'bad host']) expect(ftpEditor.validate({ ...draft, host }, []).host).toBe('invalid')
    for (const host of ['::1', '[::1]', 'ftp.example.com', '127.0.0.1']) expect(ftpEditor.validate({ ...draft, host }, []).host).toBeUndefined()
    for (const root_path of ['/a/../b', '/a//b', 'relative', '/a\n']) expect(ftpEditor.validate({ ...draft, root_path }, []).root_path).toBe('invalid')
    expect(ftpEditor.validate({ ...draft, password: 'pw\r\nDELE /x' }, []).password).toBe('invalid')
    expect(ftpEditor.validate({ ...draft, port: 0 }, []).port).toBe('invalid')
  })
})

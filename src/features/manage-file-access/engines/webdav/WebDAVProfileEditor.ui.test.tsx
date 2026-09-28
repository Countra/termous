import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FileAccessProfileEditor } from '../../ui/FileAccessProfileEditor.tsx'
import { getFileAccessProfileEditor } from '../../model/engineEditorRegistry.ts'
import type { FileAccessProfileEditorDraft } from '../../model/types.ts'
import { webdavEditor } from './definition.ts'
import { projectFileAccessProfile } from '#entities/file-access-profile'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('WebDAV 文件配置', () => {
  it('从主机文件类型切换并保存密码，使用统一配置入口', async () => {
    const save = vi.fn()
    function Harness() {
      const [draft, setDraft] = useState<FileAccessProfileEditorDraft>({ engine: 'sftp', host_id: 'host', name: 'SFTP', ssh_profile_id: '' })
      return <>
        <FileAccessProfileEditor mode="create" draft={draft} sshProfiles={[]} disabled={false} onChange={setDraft} />
        <button onClick={() => save(getFileAccessProfileEditor(draft.engine)?.toCreateInput(draft))}>save</button>
      </>
    }
    render(<Harness />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.access.file.type' }))
    fireEvent.click(await screen.findByText('WebDAV'))
    for (const [field, value] of Object.entries({ endpoint: 'http://localhost:18080/dav/', username: 'alice', password: ' pw ' })) {
      fireEvent.change(screen.getByLabelText(`files.webdav.${field}`), { target: { value } })
    }
    expect(screen.getByText('files.webdav.httpHint')).toBeInTheDocument()
    expect(screen.queryByText('hosts.access.file.sshProfile')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(save).toHaveBeenCalledWith({ host_id: 'host', name: 'WebDAV', engine: 'webdav', engine_config_version: 1, config: { endpoint: 'http://localhost:18080/dav/', username: 'alice' }, secret_values: { password: ' pw ' } })
    fireEvent.change(screen.getByLabelText('files.webdav.endpoint'), { target: { value: 'HTTP://localhost:18080/dav/' } })
    expect(screen.getByText('files.webdav.httpHint')).toBeInTheDocument()
  })

  it('编辑保留秘密，密码不会回显，DAV 标识不溢出', () => {
    const profile = { id: 'dav', host_id: 'host', name: 'WebDAV', engine: 'webdav', engine_config_version: 1, config: { endpoint: 'https://example.com/dav/', username: 'alice' }, secret_refs: { password: 'secret-ref' }, is_default: false, sort_order: 0, created_at: '', updated_at: '' }
    const draft = webdavEditor.editDraft(profile)
    if (!draft || draft.engine !== 'webdav') throw new Error('缺少 WebDAV 草稿')
    expect(webdavEditor.validate(draft, [])).toEqual({})
    expect(webdavEditor.toPatchInput(draft).secret_values).toEqual({})
    expect(webdavEditor.toPatchInput({ ...draft, password: ' rotated ' }).secret_values).toEqual({ password: ' rotated ' })
    render(<FileAccessProfileEditor mode="edit" draft={draft} sshProfiles={[]} disabled={false} onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('files.webdav.configured')).toHaveValue('')
    const projection = projectFileAccessProfile(profile)
    expect(projection.technology.shortLabel).toBe('DAV')
    expect(projection.routeDependency).toBeUndefined()
    expect(JSON.stringify(projection)).not.toContain('secret-ref')
  })

  it('拒绝会被 URL 自动清理的异常路径与 Basic 用户名', () => {
    const draft = webdavEditor.createDraft('host', [])
    if (draft.engine !== 'webdav') throw new Error('缺少 WebDAV 草稿')
    for (const endpoint of ['https://host/a/../b', 'HTTPS://host/a/../b', 'https://host/a/%2e%2e/b', 'https://host/a%2fb', 'https://host/a//b', 'https://u:p@host/', 'https://@host/', 'https://host:/', 'https://host:0/', 'https://%68ost/', 'https://host/dav/?', 'https://host/dav/#']) {
      expect(webdavEditor.validate({ ...draft, endpoint }, []).endpoint).toBe('invalid')
    }
    expect(webdavEditor.validate({ ...draft, username: 'a:b' }, []).username).toBe('invalid')
    expect(webdavEditor.validate({ ...draft, endpoint: 'https://host/中文%20目录/' }, []).endpoint).toBeUndefined()
    expect(webdavEditor.validate(draft, []).password).toBe('required')
  })
})

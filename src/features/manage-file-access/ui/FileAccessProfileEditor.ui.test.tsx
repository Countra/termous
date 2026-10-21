import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { FileAccessProfileEditor } from './FileAccessProfileEditor.tsx'
import type { FileAccessProfileEditorDraft } from '../model/types.ts'
import { s3Editor } from '../engines/s3/definition.ts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const sshProfiles: SSHAccessProfile[] = [{
  id: 'ssh-a',
  host_id: 'host-a',
  name: 'Primary SSH',
  address: 'server.example.com',
  port: 22,
  username: 'root',
  auth_method: 'password',
  credential_id: 'credential-a',
  fingerprint_policy: 'confirm_on_change',
  is_default: true,
  sort_order: 0,
  created_at: '2026-09-15T00:00:00Z',
  updated_at: '2026-09-15T00:00:00Z',
}]

const draft = {
  engine: 'sftp' as const,
  host_id: 'host-a',
  name: 'Files',
  ssh_profile_id: 'ssh-a',
}

describe('文件访问配置编辑器', () => {
  it('主机的访问类型可切换 S3，保留归属并直接填写认证材料', async () => {
    const save = vi.fn()
    function EditorHarness() {
      const [value, setValue] = useState<FileAccessProfileEditorDraft>(draft)
      return <>
        <FileAccessProfileEditor mode="create" draft={value} sshProfiles={[]} disabled={false} onChange={setValue} />
        <button onClick={() => save(s3Editor.toCreateInput(value))}>save</button>
      </>
    }
    render(<EditorHarness />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.access.file.type' }))
    fireEvent.click(await screen.findByText('S3 / MinIO'))
    for (const [field, value] of Object.entries({ name: 'MinIO', endpoint: 'https://minio.example', bucket: 'test-bucket', access_key: 'ak', secret_key: ' sk with spaces ' })) {
      fireEvent.change(screen.getByLabelText(`files.s3.${field}`), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(save).toHaveBeenCalledWith({
      host_id: 'host-a', name: 'MinIO', engine: 's3', engine_config_version: 1,
      config: { endpoint: 'https://minio.example', bucket: 'test-bucket', prefix: '', region: '', addressing_style: 'path' },
      secret_values: { access_key: 'ak', secret_key: ' sk with spaces ' }, clear_secret_slots: [],
    })
    expect(screen.queryByText('hosts.access.file.sshProfile')).not.toBeInTheDocument()
  })

  it('编辑 S3 保留主机和秘密引用，Token 只能显式清除', () => {
    const value = s3Editor.editDraft({ id: 's3', host_id: 'host-a', name: 'MinIO', engine: 's3', engine_config_version: 1, config: { endpoint: 'https://minio.example', bucket: 'test-bucket' }, secret_refs: { access_key: 'ak-ref', secret_key: 'sk-ref', session_token: 'token-ref' }, is_default: false, sort_order: 0, created_at: '', updated_at: '' })
    if (!value || value.engine !== 's3') throw new Error('缺少草稿')
    expect(value.host_id).toBe('host-a')
    expect(s3Editor.validate(value, [])).toEqual({})
    expect(s3Editor.toPatchInput(value).secret_values).toEqual({})
    expect(s3Editor.toPatchInput({ ...value, clear_session_token: true }).clear_secret_slots).toEqual(['session_token'])
    expect(s3Editor.validate({ ...value, prefix: 'a/../b' }, []).prefix).toBe('invalid')
    expect(s3Editor.validate({ ...value, endpoint: 'https://user:pass@example.com' }, []).endpoint).toBe('invalid')
    render(<FileAccessProfileEditor mode="edit" draft={value} sshProfiles={[]} disabled={false} onChange={vi.fn()} />)
    expect(screen.getAllByPlaceholderText('files.s3.configured')).toHaveLength(3)
    expect(screen.getByRole('combobox', { name: 'hosts.access.file.type' })).toBeDisabled()
  })
  it('新建时将 Engine 作为访问类型选择项展示', () => {
    render(
      <FileAccessProfileEditor
        mode="create"
        draft={draft}
        sshProfiles={sshProfiles}
        disabled={false}
        onChange={vi.fn()}
      />,
    )

    const engineSelect = screen.getByRole('combobox', { name: 'hosts.access.file.type' })
    expect(engineSelect).toBeEnabled()
    expect(screen.getByText('SFTP')).toBeInTheDocument()
  })

  it('编辑时锁定不可变的 Engine 类型', () => {
    render(
      <FileAccessProfileEditor
        mode="edit"
        draft={draft}
        sshProfiles={sshProfiles}
        disabled={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'hosts.access.file.type' })).toBeDisabled()
  })

  it('S3 的明文提示忽略大小写与首尾空格，错误关联到对应字段', () => {
    const value = s3Editor.createDraft('host-a', [])
    if (value.engine !== 's3') throw new Error('缺少 S3 草稿')
    render(<FileAccessProfileEditor mode="create" draft={{ ...value, endpoint: ' HTTP://minio.example ' }} sshProfiles={[]}
      errors={{ bucket: 'invalid', secret_key: 'required' }} disabled={false} onChange={vi.fn()} />)
    expect(screen.getByText('files.s3.httpHint')).toBeVisible()
    const bucket = screen.getByLabelText('files.s3.bucket')
    expect(bucket).toHaveAttribute('aria-invalid', 'true')
    expect(bucket).toHaveAccessibleDescription('files.s3.errors.bucket')
    expect(screen.getByLabelText('files.s3.secret_key')).toHaveAccessibleDescription('files.s3.requiredSecret')
    expect(screen.getByRole('combobox', { name: 'files.s3.addressing' })).toBeEnabled()
  })

  it('S3 显式清除 Token 时禁用输入，取消后保留尚未提交的内容', () => {
    function Harness() {
      const value = s3Editor.createDraft('host-a', [])
      if (value.engine !== 's3') throw new Error('缺少 S3 草稿')
      const [draft, setDraft] = useState<FileAccessProfileEditorDraft>({ ...value, session_token: 'draft-token', configured_slots: ['session_token'] })
      return <FileAccessProfileEditor mode="edit" draft={draft} sshProfiles={[]} disabled={false} onChange={setDraft} />
    }
    render(<Harness />)
    const token = screen.getByLabelText('files.s3.session_token')
    const clear = screen.getByRole('checkbox', { name: 'files.s3.clearToken' })
    fireEvent.click(clear)
    expect(token).toBeDisabled()
    expect(token).toHaveValue('draft-token')
    fireEvent.click(clear)
    expect(token).toBeEnabled()
    expect(token).toHaveValue('draft-token')
  })

  it('切换协议同步默认名称，并保留自定义名称', async () => {
    function Harness() {
      const [value, setValue] = useState<FileAccessProfileEditorDraft>({ ...draft, name: 'SFTP' })
      return <FileAccessProfileEditor mode="create" draft={value} sshProfiles={sshProfiles} disabled={false} onChange={setValue} />
    }
    render(<Harness />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.access.file.type' }))
    fireEvent.click(await screen.findByText('S3 / MinIO'))
    expect(screen.getByLabelText('files.s3.name')).toHaveValue('S3 / MinIO')
    fireEvent.change(screen.getByLabelText('files.s3.name'), { target: { value: 'Shared files' } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.access.file.type' }))
    fireEvent.click(await screen.findByText('WebDAV'))
    expect(screen.getByLabelText('files.webdav.name')).toHaveValue('Shared files')
  })
})

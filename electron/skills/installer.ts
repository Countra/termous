import { randomUUID } from 'node:crypto'
import fs, { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SkillInstallClient, SkillInstallPlan, SkillInstallPolicy, SkillInstallResult } from '#common/contracts'
import type { AgentSkillBundleSourcePort } from '../agent/skillBundleSource.ts'
import type { AgentSkillBundleSnapshot } from '../agent/skillBundle.ts'
import { resolveAgentSkillManifestResourcePath } from '../agent/skillBundleManifest.ts'
import { canonicalBase, checkDirectory, entryStat, pathsOverlap, prepareTarget, resolveSkillInstallDirectory, SkillInstallFailure, skillInstallError } from './installPaths.ts'

interface PendingInstall {
  plan: SkillInstallPlan
  snapshot: AgentSkillBundleSnapshot
  owner: number
  expires: number
  baseIdentity: string
  identities: Map<string, string | null>
}

const identity = (info: NonNullable<Awaited<ReturnType<typeof entryStat>>>) => `${info.dev}:${info.ino}`

export class SkillInstaller {
  private pending: PendingInstall | null = null
  private operation: Promise<void> | null = null
  private suspended = false
  private readonly source: Pick<AgentSkillBundleSourcePort, 'snapshot'>
  private readonly sourceDirectory: string

  constructor(source: Pick<AgentSkillBundleSourcePort, 'snapshot'>, sourceDirectory: string) {
    this.source = source
    this.sourceDirectory = sourceDirectory
  }

  async prepare(directory: string, client: SkillInstallClient, owner: number): Promise<SkillInstallPlan> {
    const finish = this.beginOperation()
    this.pending = null
    try {
      let snapshot: AgentSkillBundleSnapshot
      try { snapshot = await this.source.snapshot() } catch { throw new SkillInstallFailure('bundle_unavailable') }
      const base = await canonicalBase(directory)
      const baseInfo = await checkDirectory(base)
      if (!baseInfo) throw new SkillInstallFailure('target_changed')
      const target = resolveSkillInstallDirectory(base, client)
      if (pathsOverlap(target, await canonicalBase(this.sourceDirectory))) throw new SkillInstallFailure('unsafe_path')
      await prepareTarget(base, target, false)
      const identities = new Map<string, string | null>()
      const skills: SkillInstallPlan['skills'] = []
      for (const { name } of snapshot.catalog) {
        const info = await checkDirectory(path.join(target, name))
        identities.set(name, info ? identity(info) : null)
        skills.push({ name, exists: Boolean(info) })
      }
      const plan = { id: randomUUID(), client, base_directory: base, target_directory: target, skills }
      this.pending = { plan, snapshot, owner, expires: Date.now() + 10 * 60_000, baseIdentity: identity(baseInfo), identities }
      return structuredClone(plan)
    } finally { finish() }
  }

  async install(planId: string, policy: SkillInstallPolicy, owner: number): Promise<SkillInstallResult> {
    const finish = this.beginOperation()
    try {
      const pending = this.pending
      if (!pending || pending.owner !== owner || pending.plan.id !== planId || pending.expires < Date.now()) {
        throw new SkillInstallFailure('plan_expired')
      }
      // 一次选择只允许提交一次；失败后的重试必须重新检查目录，避免重放过期的覆盖决定。
      this.pending = null
      const { plan } = pending
      const base = await checkDirectory(plan.base_directory)
      if (!base || identity(base) !== pending.baseIdentity) throw new SkillInstallFailure('target_changed')
      await prepareTarget(plan.base_directory, plan.target_directory, true)
      const items: SkillInstallResult['items'] = []
      for (const skill of plan.skills) items.push(await this.installSkill(pending, skill.name, policy))
      return { target_directory: plan.target_directory, items }
    } finally { finish() }
  }

  // 正常退出和更新前等待发布、恢复及清理收尾；更新失败后允许重新启用安装入口。
  async suspend() {
    this.suspended = true
    await this.operation
    this.pending = null
  }

  resume() {
    this.suspended = false
  }

  private beginOperation() {
    if (this.suspended || this.operation) throw new SkillInstallFailure('busy')
    let resolve!: () => void
    this.operation = new Promise<void>((done) => { resolve = done })
    return () => {
      this.operation = null
      resolve()
    }
  }

  private async installSkill(pending: PendingInstall, name: string, policy: SkillInstallPolicy): Promise<SkillInstallResult['items'][number]> {
    const { plan, snapshot } = pending
    const target = path.join(plan.target_directory, name)
    let staging: string | undefined
    let backup: string | undefined
    let published = false
    try {
      await prepareTarget(plan.base_directory, plan.target_directory, false)
      const existing = await checkDirectory(target)
      if (existing && policy === 'skip') return { name, status: 'skipped' }
      if ((existing ? identity(existing) : null) !== pending.identities.get(name)) throw new SkillInstallFailure('target_changed')
      staging = await mkdtemp(path.join(plan.target_directory, '.termous-skill-install-'))
      const incoming = path.join(staging, 'incoming')
      await mkdir(incoming)
      const prefix = `skill://${name}/`
      for (const resource of snapshot.resources.filter((entry) => entry.uri.startsWith(prefix))) {
        const file = resolveAgentSkillManifestResourcePath(incoming, resource.uri.slice(prefix.length))
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, resource.content, { encoding: 'utf8', flag: 'wx' })
      }
      await prepareTarget(plan.base_directory, plan.target_directory, false)
      const latest = await checkDirectory(target)
      if ((latest ? identity(latest) : null) !== pending.identities.get(name)) throw new SkillInstallFailure('target_changed')
      if (latest) {
        const previous = path.join(staging, 'previous')
        await fs.rename(target, previous)
        backup = previous
      }
      await fs.rename(incoming, target)
      published = true
      try { await fs.rm(staging, { recursive: true, force: true }) } catch {
        return { name, status: 'installed', error: 'cleanup_failed', recovery_path: staging }
      }
      return { name, status: 'installed' }
    } catch (error) {
      if (backup && !published) {
        try {
          if (await entryStat(target)) return { name, status: 'failed', error: 'recovery_failed', recovery_path: staging }
          await fs.rename(backup, target)
        } catch { return { name, status: 'failed', error: 'recovery_failed', recovery_path: staging } }
      }
      if (staging) {
        try { await fs.rm(staging, { recursive: true, force: true }) } catch {
          return { name, status: 'failed', error: 'cleanup_failed', recovery_path: staging }
        }
      }
      return { name, status: 'failed', error: skillInstallError(error) }
    }
  }
}

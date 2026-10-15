import { isRecord } from '../contracts/validation.ts'
import { capabilityTools, runtimeCapability, runtimeCapabilityStep } from './runtimeCapabilityCatalog.ts'

export function runtimeToolDependencies(name: string): string[] {
  const capability = runtimeCapability(name)
  return capability ? capabilityTools(capability, runtimeCapabilityStep(name)?.cleanup ?? []) : []
}

export function completedToolResource(name: string, args: unknown, data?: Record<string, unknown>) {
  const rule = runtimeCapabilityStep(name)?.completion
  if (!rule || !isRecord(args) || data && data[rule.flag] !== true) return undefined
  if (rule.fields.some((field) => typeof args[field] !== 'string' && typeof args[field] !== 'number' || args[field] === '')) return undefined
  return rule.fields.map((field) => args[field])
}

export function completedToolGuidance(name: string) {
  const capability = runtimeCapability(name)
  const completion = runtimeCapabilityStep(name)?.completion
  const next = capability && completion ? capabilityTools(capability, [completion.next])[0] : undefined
  return `该资源的释放或关闭已确认完成，重复调用不会创建资源，也不会推进任务。需要新的资源时先用 discover_tools 查找准确操作${next ? ` ${next}` : ''}；清理其他资源必须使用其真实标识。已完成资源不会再次派发清理。`
}

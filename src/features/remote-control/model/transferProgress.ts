// 总进度按两段实际字节汇总；目标提交尚未确认时，不能显示完成百分比。
export function transferPercent(state: string, total: number, received: number, target?: number): number {
  if (state === 'completed') return 100
  if (total <= 0) return 0
  const ratio = (value: number) => Math.max(0, Math.min(1, value / total))
  return Math.min(99, Math.floor(100 * (target === undefined ? ratio(received) : (ratio(received) + ratio(target)) / 2)))
}

export function uploadStage(stage: string, total: number, target: number): 'sendingToHost' | 'writingTarget' | 'confirming' {
  if (['received', 'publishing', 'completed'].includes(stage)) {
    return total > 0 && target >= total || stage === 'completed' ? 'confirming' : 'writingTarget'
  }
  return 'sendingToHost'
}

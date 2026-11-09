import type { ClientIdentity } from '@earendil-works/pi-ai'

// 统一正常请求、摘要及终端补全的产品身份，不继承 SDK 的 Pi 产品归属。
export const runtimeClientIdentity: ClientIdentity = Object.freeze({
  userAgent: Object.freeze({ custom: 'Termous' }),
  attribution: null,
})

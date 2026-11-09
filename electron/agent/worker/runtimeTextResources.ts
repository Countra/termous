import type { TextResourceReference } from '#common/contracts'
import type { RuntimeBootstrap } from '../contracts/runtimeBootstrap.ts'
import type { RuntimeMessageAttachment } from '../contracts/runtimeAttachmentPolicy.ts'

// 文本属于模型必要上下文，启动时逐个读取；网络和持久记录仍只携带资源引用。
// 临时编码由现有附件校验器消费，随后随 bootstrap 释放，不保留另一份附件历史。
export async function materializeRuntimeTextResources(
  bootstrap: RuntimeBootstrap,
  read: (reference: TextResourceReference, signal: AbortSignal) => Promise<string>,
  signal: AbortSignal,
): Promise<RuntimeBootstrap> {
  const messages: RuntimeBootstrap['messages'] = []
  for (const message of bootstrap.messages) {
    signal.throwIfAborted()
    if (!message.attachments.some(attachment => attachment.resource?.kind === 'text')) {
      messages.push(message)
      continue
    }
    const attachments: RuntimeMessageAttachment[] = []
    for (const attachment of message.attachments) {
      if (attachment.resource?.kind !== 'text') { attachments.push(attachment); continue }
      const content = await read(attachment.resource, signal)
      signal.throwIfAborted()
      attachments.push({ id: attachment.id, kind: attachment.kind, mime_type: attachment.mime_type,
        origin: attachment.origin, content_base64: content })
    }
    messages.push({ ...message, attachments })
  }
  return { ...bootstrap, messages }
}

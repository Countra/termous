// 为已有协议夹具补充一次真实发现轮，原夹具继续验证它负责的业务请求。
export function withToolDiscovery(fetcher: typeof globalThis.fetch, names: string[]): typeof globalThis.fetch {
  let discovered = false
  return async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { tools?: Array<{ name?: string; function?: { name?: string } }>; input?: unknown }
    if (discovered || !names.length || !body.tools?.some((tool) => (tool.name ?? tool.function?.name) === 'discover_tools')) return fetcher(input, init)
    discovered = true
    const args = JSON.stringify({ query: names.join(' '), names })
    if (body.input !== undefined) {
      const item = { type: 'function_call', id: 'fc_discovery', call_id: 'call_discovery', name: 'discover_tools', arguments: args, status: 'completed' }
      const events = [
        { type: 'response.created', response: { id: 'resp_discovery' } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'resp_discovery', status: 'completed', output: [item] } },
      ]
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
    }
    const chunk = { id: 'chat_discovery', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_discovery', type: 'function', function: { name: 'discover_tools', arguments: args } }] }, finish_reason: 'tool_calls' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
}

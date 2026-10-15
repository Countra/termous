export function runtimeToolResponse(api: string, name?: string, args = {}, id = name) {
  if (api === 'chat_completions') {
    const delta = name ? { tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: '观察附着已建立' }
    const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: name ? 'tool_calls' : 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  const item = name ? { type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args), status: 'completed' }
    : { type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '观察附着已建立', annotations: [] }] }
  const events = [
    { type: 'response.created', response: { id: 'response' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', ...(name ? { arguments: '' } : { content: [] }) } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'response', status: 'completed', output: [item] } },
  ]
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

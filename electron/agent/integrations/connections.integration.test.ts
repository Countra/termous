import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { IntegrationConnections } from './connections.ts'
import type { IntegrationHostConfig } from '../contracts/integrations.ts'

const executable=process.env.TERMOUS_MCP_FIXTURE
test('stdio 启动失败和初始化前退出返回明确错误，失败项不会占用连接池', async () => {
  const pool = new IntegrationConnections({ensureSupervised: async () => {}, superviseGroup: async () => {}})
  const source = {id:'startup',kind:'mcp' as const,name:'startup',enabled:false,revision:1,secret_configured:false,created_at:'',updated_at:''}
  try {
    // Windows 的命令包装器可能成功启动后退出；不从其 stderr 猜测 ENOENT。
    const missingCommand = process.platform === 'win32' ? /INTEGRATION_INITIALIZATION_EXITED/u : /INTEGRATION_PROCESS_START_FAILED/u
    await assert.rejects(pool.acquire({source:{...source,mcp:{transport:'stdio',command:`${process.execPath}.missing`}},secret:{}},'missing','run'), missingCommand)
    await assert.rejects(pool.acquire({source:{...source,mcp:{transport:'stdio',command:process.execPath,cwd:`${process.execPath}.missing`}},secret:{}},'invalid-cwd','run'), /INTEGRATION_PROCESS_START_FAILED/u)
    await assert.rejects(pool.acquire({source:{...source,mcp:{transport:'stdio',command:process.execPath,args:['-e','process.exit(1)']}},secret:{}},'exited','run'), /INTEGRATION_INITIALIZATION_EXITED/u)
    assert.equal(pool.status().filter(value => value.state === 'failed').length, 3)
  } finally { await pool.close() }
})

test('官方 MCP SDK：HTTP 会话隔离、资源和模板、目录变更、取消', {skip:!executable},async()=>{
  const server=spawn(executable!,[],{stdio:['ignore','pipe','pipe'],windowsHide:true})
  const exited=once(server,'exit')
  const lines=createInterface({input:server.stdout})
  const [url]=await once(lines,'line',{signal:AbortSignal.timeout(10_000)})
  const config:IntegrationHostConfig={source:{id:'fixture',kind:'mcp',name:'fixture',enabled:true,revision:1,mcp:{transport:'http',url:String(url)},secret_configured:false,created_at:'',updated_at:''},secret:{}}
  const pool=new IntegrationConnections({ensureSupervised:async()=>undefined})
  try {
    const first=await pool.acquire(config,'session-a','run-a')
    assert.equal(await pool.acquire(config,'session-a','run-a'),first)
    const second=await pool.acquire(config,'session-b','run-b')
    assert.notEqual(first,second)
    pool.release('run-b')
    second.lastUsed = 1
    pool.release('run-a')
    assert.equal(second.lastUsed, 1, '结束其他 Run 不得重置无关连接的空闲时间')
    await pool.acquire(config,'session-a','run-a')
    const echo=first.directory.find(tool=>tool.name==='echo')!
    const result=await pool.call(first,echo,{text:'fixture'})
    assert.equal(result.content[0].type,'text')
    assert.match(JSON.stringify(result),/fixture/u)
    await assert.rejects(pool.call(first,echo,{text:123}),/ARGUMENTS_INVALID/u)
    const resources=await first.client.listResourcesPage()
    assert.equal(resources.resources[0].uri,'fixture://hello')
    const templates=await first.client.listResourceTemplatesPage()
    assert.equal(templates.resourceTemplates[0].uriTemplate,'fixture://named/{name}')
    const resource=await first.client.readResource('fixture://hello')
    assert.ok('text' in resource.contents[0])
    assert.equal(resource.contents[0].text,'fixture resource')
    const changed=new Promise<void>(resolve=>{const off=first.client.onNotification('notifications/tools/list_changed',()=>{off();resolve()})})
    await pool.call(first,first.directory.find(tool=>tool.name==='change_catalog')!,{})
    await changed
    await assert.rejects(pool.call(first,echo,{text:'stale'}),/TOOL_CHANGED/u)
    let saved=0
    await pool.refresh('run-a',()=>true,async(_config,tools)=>{saved++;assert.ok(tools.some(tool=>tool.name==='echo_next'))})
    assert.equal(saved,1)
    const abort=new AbortController()
    const pending=pool.call(first,first.directory.find(tool=>tool.name==='slow')!,{},abort.signal)
    const cancelled=assert.rejects(pending)
    abort.abort()
    await cancelled
  } finally {await pool.close();lines.close();server.kill();await exited}
})

test('官方 MCP SDK：stdio 在监督完成之后启动，关闭释放子进程',{skip:!executable},async()=>{
  let supervised=0
  const groups=new Set<number>()
  const pool=new IntegrationConnections({ensureSupervised:async()=>{supervised++},superviseGroup:async(pid,release)=>{
    if (release) groups.delete(pid)
    else groups.add(pid)
  }})
  const config:IntegrationHostConfig={source:{id:'stdio',kind:'mcp',name:'stdio',enabled:true,revision:1,mcp:{transport:'stdio',command:executable,args:['--stdio']},secret_configured:false,created_at:'',updated_at:''},secret:{}}
  try {
    const connection=await pool.acquire(config,'session','run')
    assert.equal(supervised,1)
    const result=await pool.call(connection,connection.directory.find(tool=>tool.name==='echo')!,{text:'stdio'})
    assert.match(JSON.stringify(result),/stdio/u)
  } finally {await pool.close()}
  assert.equal(groups.size,0)
})

test('候选失败保留当前连接，候选目录只在激活后进入业务使用', { skip: !executable }, async () => {
  const server = spawn(executable!, [], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const exited = once(server, 'exit')
  const lines = createInterface({ input: server.stdout })
  const [url] = await once(lines, 'line', { signal: AbortSignal.timeout(10_000) })
  const config: IntegrationHostConfig = { source: { id: 'upgrade', kind: 'mcp', name: 'upgrade', enabled: true, revision: 1,
    mcp: { transport: 'http', url: String(url) }, secret_configured: false, created_at: '', updated_at: '' }, secret: {} }
  const pool = new IntegrationConnections({ ensureSupervised: async () => {}, installationLease: async () => {},
    verifyLaunch: async value => { if (value.candidate_id === 'broken') throw new Error('INTEGRATION_CONFIG_CHANGED') } })
  try {
    const current = await pool.acquire(config, 'session', 'run')
    await assert.rejects(pool.acquire({ ...config, candidate_id: 'broken' }, 'session', 'upgrade'))
    assert.equal(current.retired, undefined)
    assert.equal(pool.availability('upgrade', 1, 'session', 'run'), undefined)
    const candidate = await pool.acquire({ ...config, candidate_id: 'candidate' }, 'session', 'upgrade')
    assert.equal(pool.availability('upgrade', 1, 'session', 'upgrade'), 'INTEGRATION_PREPARING')
    assert.equal(await pool.acquire(config, 'session', 'run'), current)
    assert.equal(candidate.retired, undefined)
    candidate.directoryRevision++
    let publications = 0
    await pool.refresh('upgrade', () => true, async () => { publications++ })
    assert.equal(publications, 0, '候选目录不得覆盖已发布目录')
    assert.match(JSON.stringify(await pool.call(current, current.directory.find(tool => tool.name === 'echo')!, { text: 'still-current' })), /still-current/u)
    const published = { ...config, source: { ...config.source, revision: 2 } }
    await pool.promote(candidate, published, 'session')
    assert.equal(current.retired, true)
    assert.equal(pool.availability('upgrade', 2, 'session', 'run'), undefined)
    assert.equal(await pool.acquire(published, 'session', 'run'), candidate)
  } finally { await pool.close(); lines.close(); server.kill(); await exited }
})

test('官方 MCP SDK：并发容量有界、共享连接取消独立、4/8 会话复用及闲置淘汰',{skip:!executable},async()=>{
  const server=spawn(executable!,[],{stdio:['ignore','pipe','pipe'],windowsHide:true})
  const exited=once(server,'exit')
  const lines=createInterface({input:server.stdout})
  const [url]=await once(lines,'line',{signal:AbortSignal.timeout(10_000)})
  const config:IntegrationHostConfig={source:{id:'capacity',kind:'mcp',name:'capacity',enabled:true,revision:1,mcp:{transport:'http',url:String(url)},secret_configured:false,created_at:'',updated_at:''},secret:{}}
  const pool=new IntegrationConnections({ensureSupervised:async()=>undefined})
  try {
    const abort=new AbortController()
    const cancelled=assert.rejects(pool.acquire(config,'shared','cancelled',abort.signal))
    const shared=pool.acquire(config,'shared','owner-shared')
    abort.abort()
    await cancelled
    await shared
    const values=await Promise.allSettled(Array.from({length:20},(_,i)=>pool.acquire(config,`session-${i}`,`owner-${i}`)))
    assert.equal(values.filter(value=>value.status==='fulfilled').length,15)
    assert.equal(pool.status().filter(value => value.state === 'connected').length,16)
    for (const value of values) if (value.status==='rejected') assert.match(String(value.reason),/CONNECTION_CAPACITY/u)
    for (const count of [4,8]) {
      for (let round=0;round<10;round++) await Promise.all(Array.from({length:count},async(_,i)=>{
        const connection=await pool.acquire(config,`session-${i}`,`owner-${i}`)
        const original=values[i]
        assert.equal(original.status,'fulfilled')
        if (original.status==='fulfilled') assert.equal(connection,original.value)
        const result=await pool.call(connection,connection.directory.find(value=>value.name==='echo')!,{text:`${round}:${i}`})
        assert.match(JSON.stringify(result),new RegExp(`${round}:${i}`))
      }))
    }
    pool.release('owner-shared')
    await pool.acquire(config,'replacement','replacement-owner')
    assert.equal(pool.status().filter(value => value.state === 'connected').length,16)
    assert.ok(pool.status().every(value=>value.active===0 && value.queued===0))
  } finally {await pool.close();lines.close();server.kill();await exited}
})

test('关闭失败保留连接占用，后续收尾可以确认退出', { skip: !executable }, async () => {
  const pool = new IntegrationConnections({ ensureSupervised: async () => {}, superviseGroup: async () => {} })
  const config: IntegrationHostConfig = { source: { id: 'cleanup', kind: 'mcp', name: 'cleanup', enabled: true, revision: 1,
    mcp: { transport: 'stdio', command: executable, args: ['--stdio'] }, secret_configured: false, created_at: '', updated_at: '' }, secret: {} }
  try {
    const connection = await pool.acquire(config, 'session', 'owner')
    const close = connection.close
    let attempts = 0
    connection.close = async () => {
      attempts++
      if (attempts === 1) throw new Error('INTEGRATION_PROCESS_UNCONFIRMED')
      await close()
    }
    await assert.rejects(pool.invalidate('cleanup'), /INTEGRATION_PROCESS_UNCONFIRMED/u)
    assert.equal(pool.status()[0].state, 'closing')
    await assert.rejects(pool.acquire(config, 'session', 'another-owner'), /INTEGRATION_RECONNECT_PENDING/u)
    await pool.invalidate('cleanup')
    assert.equal(attempts, 2)
    assert.equal(pool.status()[0].state, 'disconnected')
    assert.equal(pool.availability('cleanup', 1, 'session', 'owner'), 'INTEGRATION_SESSION_LOST')
  } finally { await pool.close() }
})

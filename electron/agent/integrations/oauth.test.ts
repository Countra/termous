import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { IntegrationOAuth } from './oauth.ts'
import type { IntegrationHostConfig } from '../contracts/integrations.ts'
import type { McpOAuthState } from '@earendil-works/pi-mcp/oauth'

test('官方 OAuth 完成 PKCE 登录，并合并并发刷新且保留未返回的 refresh_token',async()=>{
  let base=''
  let refreshes=0
  let verifier=''
  const server=createServer((request,response)=>{
    void (async()=>{
      const chunks:Buffer[]=[]
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body=Buffer.concat(chunks).toString('utf8')
      response.setHeader('content-type','application/json')
      if (request.url?.includes('oauth-protected-resource')) response.end(JSON.stringify({resource:base+'/mcp',authorization_servers:[base]}))
      else if (request.url?.includes('oauth-authorization-server')) response.end(JSON.stringify({issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',registration_endpoint:base+'/register',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']}))
      else if (request.url==='/register') response.end(JSON.stringify({client_id:'fixture',redirect_uris:JSON.parse(body).redirect_uris,token_endpoint_auth_method:'none'}))
      else if (request.url==='/token') {
        const parameters=new URLSearchParams(body)
        if (parameters.get('grant_type')==='refresh_token') {refreshes++;response.end(JSON.stringify({access_token:'new-access',token_type:'Bearer',expires_in:3600}))}
        else {verifier=parameters.get('code_verifier') ?? '';response.end(JSON.stringify({access_token:'old-access',refresh_token:'refresh',token_type:'Bearer',expires_in:3600}))}
      } else {response.statusCode=404;response.end('{}')}
    })().catch(()=>{response.statusCode=500;response.end('{}')})
  })
  server.listen(0,'127.0.0.1')
  await once(server,'listening')
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
  const config:IntegrationHostConfig={source:{id:'fixture',kind:'mcp',name:'fixture',enabled:false,revision:2,mcp:{transport:'http',url:base+'/mcp',auth:'oauth'},secret_configured:false,created_at:'',updated_at:''},secret:{}}
  let state:McpOAuthState | undefined
  const core={beginOAuth:async()=>config,saveOAuth:async(_id:string,_revision:number,next:unknown)=>{state=structuredClone(next) as McpOAuthState}}
  const oauth=new IntegrationOAuth(core)
  try {
    await oauth.login('fixture',1,async address=>{
      const authorization=new URL(address)
      assert.equal(authorization.searchParams.get('code_challenge_method'),'S256')
      const callback=new URL(authorization.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state',authorization.searchParams.get('state')!)
      callback.searchParams.set('code','fixture-code')
      const response=await fetch(callback)
      await response.text()
    })
    assert.ok(verifier.length>=43)
    assert.equal(state?.tokens?.refresh_token,'refresh')
    config.secret.oauth=state
    const auth=oauth.provider(config)
    assert.equal(auth,oauth.provider(config))
    await Promise.all(Array.from({length:5},()=>auth.onUnauthorized!({response:new Response(null,{status:401}),serverUrl:new URL(base+'/mcp'),fetch,token:'old-access'})))
    assert.equal(refreshes,1)
    assert.equal(await auth.token(),'new-access')
    assert.equal(state?.tokens?.refresh_token,'refresh')
    await assert.rejects(auth.onUnauthorized!({response:new Response(null,{status:403,headers:{'www-authenticate':'Bearer error="insufficient_scope"'}}),serverUrl:new URL(base+'/mcp'),fetch,token:'new-access'}),/AUTH_REQUIRED/u)
    assert.equal(refreshes,1)
  } finally {oauth.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})

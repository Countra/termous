import assert from 'node:assert/strict'
import test from 'node:test'
import { oauthFetch, validateOAuthURL } from './oauthBoundary.ts'

test('OAuth 发现不携带凭据，令牌只发往已验证端点且拒绝重定向',async()=>{
  let calls=0
  const fetch=oauthFetch(()=>({serverUrl:'https://mcp.test/',discovery:{authorizationServerUrl:'https://auth.test',authorizationServerMetadata:{issuer:'https://auth.test',authorization_endpoint:'https://auth.test/authorize',token_endpoint:'https://tokens.test/token',response_types_supported:['code']}}}),new AbortController().signal,
    async()=>{calls++;return new Response('{}')})
  await fetch('https://tokens.test/token',{method:'POST',body:new URLSearchParams({refresh_token:'fixture'})})
  await assert.rejects(fetch('https://other.test/token',{method:'POST',body:'fixture'}),/CREDENTIAL_BOUNDARY/u)
  await assert.rejects(fetch('https://auth.test/metadata',{headers:{Authorization:'fixture'}}),/CREDENTIAL_BOUNDARY/u)
  assert.equal(calls,1)
  for (const url of ['file:///tmp/key','http://remote.test/token','https://user:password@auth.test/token']) assert.throws(()=>validateOAuthURL(url))
  const redirect=oauthFetch(()=>undefined,new AbortController().signal,async()=>new Response(null,{status:302,headers:{location:'https://other.test'}}))
  await assert.rejects(redirect('https://auth.test/metadata'),/REDIRECT_REJECTED/u)
})

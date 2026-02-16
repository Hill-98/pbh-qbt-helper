#!/usr/bin/env bun

import { BanIPManager } from './BanIPManager.ts'
import config from './config.ts'
import nftScript from './pbh-qbt-helper.nft.txt'
import { SimpleTokenBucket } from './SimpleTokenBucket.ts'
import { execNftScript, getPeerIp } from './utils.ts'

const ALLOW_POST_PATHS = [
  '/api/v2/auth/login',
  '/api/v2/app/setPreferences',
  '/api/v2/torrents/addTrackers',
  '/api/v2/torrents/removeTrackers',
  '/api/v2/transfer/banPeers',
]
const ALLOW_SET_PREFERENCES_KEYS = [
  'enable_multi_connections_from_same_ip',
  'up_limit',
  'dl_limit',
  'alt_up_limit',
  'alt_dl_limit',
  'limit_utp_rate',
  'limit_lan_peers',
  'scheduler_enabled',
  'banned_IPs',
  'listen_port',
]

const state = {
  manager: new BanIPManager(['inet pbh_qbt_helper ipv4_ban_ips', 'inet pbh_qbt_helper ipv6_ban_ips']),
  tb: new SimpleTokenBucket(10, 3, 1),
}

async function handleBanPeers(req: Request): Promise<Response | null> {
  if (!config.useNftables) {
    return null
  }
  const body = await req.formData()
  const ips = (body.get('peers') as string).split('|').map((peer) => getPeerIp(peer))
  await state.manager.append(ips)
  return new Response(null, { status: 204 })
}

async function handleSetPreferences(req: Request): Promise<Response | null> {
  const body = await req.formData()
  if (!body.has('json')) {
    console.error('setPreferences: disable for no json')
    return new Response(null, { status: 400 })
  }
  const json = JSON.parse(body.get('json') as string)
  // 只允许修改白名单里的项目
  for (const key of Object.keys(json)) {
    if (!ALLOW_SET_PREFERENCES_KEYS.includes(key)) {
      console.error(`setPreferences: disable for key '${key}'`)
      return new Response(null, { status: 403 })
    }
  }
  // 全量封禁
  if ('banned_IPs' in json && config.useNftables) {
    await state.manager.replace((json.banned_IPs as string).split('\n'))
    return new Response(null, { status: 204 })
  }
  return null
}

async function handleSyncTorrentPeers(res: Response): Promise<Response | null> {
  if (!config.useNftables || !res.ok || state.manager.lastAddTime < Date.now() - 60000) {
    return null
  }
  const body = await res.json()
  for (const key of Object.keys(body.peers)) {
    if (state.manager.check(getPeerIp(key))) {
      Reflect.deleteProperty(body.peers, key)
    }
  }
  res.headers.delete('content-length')
  return Response.json(body, { headers: res.headers, status: 200 })
}

const preHandlers: Record<string, (req: Request) => Promise<Response | null>> = {
  'POST:/api/v2/app/setPreferences': handleSetPreferences,
  'POST:/api/v2/transfer/banPeers': handleBanPeers,
}

const postHandlers: Record<string, (res: Response) => Promise<Response | null>> = {
  'GET:/api/v2/sync/torrentPeers': handleSyncTorrentPeers,
}

const serve = Bun.serve({
  hostname: '0.0.0.0',
  port: config.httpPort,
  async fetch(request) {
    const method = request.method.toUpperCase()
    const isPost = method === 'POST'
    const url = new URL(request.url)
    const handlerName = `${method}:${url.pathname}`

    if (method !== 'GET' && method !== 'POST') {
      console.error(`${method} ${url.pathname}: disabled`)
      return new Response(null, { status: 405 })
    }

    if (isPost && !ALLOW_POST_PATHS.includes(url.pathname)) {
      console.error(`${method} ${url.pathname}: disabled`)
      return new Response(null, { status: 403 })
    }

    if (isPost) {
      const cLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10)
      if (cLength > 10485760) {
        console.warn(`${method} ${url.pathname}: request body too big`)
        return new Response(null, { status: 413 })
      }
    }

    if (isPost && !state.tb.tryConsume()) {
      console.warn(`${method} ${url.pathname}: rate limit exceeded`)
      return new Response(null, { status: 429 })
    }

    if (handlerName in preHandlers) {
      try {
        const res = await preHandlers[handlerName](request.clone())
        if (res !== null) {
          return res
        }
      } catch (err) {
        console.error(err)
        return new Response(null, { status: 500 })
      }
    }

    const proxyHeaders = new Headers(request.headers)
    proxyHeaders.delete('accept-encoding')
    proxyHeaders.set('Host', config.qbtEndpoint.host)
    proxyHeaders.set('Origin', config.qbtEndpoint.origin)
    proxyHeaders.set('Referer', config.qbtEndpoint.origin)
    const response = await Bun.fetch(config.qbtEndpoint.origin + url.pathname + url.search, {
      body: await request.arrayBuffer(),
      decompress: false,
      headers: proxyHeaders,
      keepalive: true,
      method,
      signal: AbortSignal.timeout(10000),
    })

    if (handlerName in postHandlers) {
      try {
        const res = await postHandlers[handlerName](response.clone())
        if (res !== null) {
          return res
        }
      } catch (err) {
        console.error(err)
        return new Response(null, { status: 500 })
      }
    }

    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
    })
  },
})

if (config.useNftables) {
  console.warn('importing nftables rules...')
  await execNftScript(
    (nftScript as string)
      .replaceAll('%QBT_PROT%', config.qbtPeerPort.toString())
      .replaceAll('%QBT_CGROUP_LEVEL%', config.qbtCgroupLevel.toString()),
  )
}

console.warn('qbt endpoint:', config.qbtEndpoint.origin)
console.warn(`pbh-qbt-helper started: ${serve.url}`)

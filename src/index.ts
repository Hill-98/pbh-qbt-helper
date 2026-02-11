#!/usr/bin/env bun

import { BlockList } from 'node:net'
import { $ } from 'bun'
import config from './config.ts'
import nftScript from './pbh-qbt-helper.nft.txt'
import { getPeerIp } from './utils.ts'

interface IPSet {
  ipv4: Set<string>
  ipv6: Set<string>
}

const ALLOW_METHODS = ['GET', 'HEAD', 'POST']
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
  banIps: new BlockList(),
}

async function addBanIps(ipSet: IPSet): Promise<void> {
  const nfSets: Record<string, string[]> = {
    ipv4_ban_ips: [],
    ipv6_ban_ips: [],
  }
  ipSet.ipv4.forEach((ip) => {
    nfSets.ipv4_ban_ips.push(ip)
    state.banIps.addAddress(ip, 'ipv4')
  })
  ipSet.ipv6.forEach((ip) => {
    nfSets.ipv6_ban_ips.push(ip)
    state.banIps.addAddress(ip, 'ipv6')
  })
  for (const set of Object.keys(nfSets)) {
    const buffer = Buffer.from(
      nfSets[set].map((ip) => `add element inet pbh_qbt_helper ${set} { ${ip} }`).join('\n'),
      'utf-8',
    )
    if (buffer.length !== 0) {
      try {
        await $`nft -f - < ${buffer}`
      } catch (err) {
        console.error(`add ips to '${set}':`, err)
      }
    }
  }
}

async function cleanBanIps(): Promise<void> {
  await $`nft flush set inet pbh_qbt_helper ipv4_ban_ips`
  await $`nft flush set inet pbh_qbt_helper ipv6_ban_ips`
  state.banIps = new BlockList()
}

function makeIpSet(ips: string[]): IPSet {
  const set: IPSet = { ipv4: new Set(), ipv6: new Set() }
  for (const ip of ips) {
    if (ip.startsWith('0:0:0:0:0:') || ip.includes('::ffff:') || ip.trim() === '') {
      continue
    }
    if (ip.includes('.')) {
      set.ipv4.add(ip)
    } else {
      set.ipv6.add(ip)
    }
  }
  return set
}

async function handleBanPeers(req: Request): Promise<Response | null> {
  if (!config.useNftables) {
    return null
  }
  const body = await req.formData()
  const ips = (body.get('peers') as string).split('|').map((peer) => getPeerIp(peer))
  await addBanIps(makeIpSet(ips))
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
    const ipSet = makeIpSet((json.banned_IPs as string).split('\n'))
    console.warn('add ips with full')
    await cleanBanIps()
    await addBanIps(ipSet)
    return new Response(null, { status: 204 })
  }
  return null
}

async function handleSyncTorrentPeers(res: Response): Promise<Response | null> {
  if (!config.useNftables || !res.ok) {
    return null
  }
  const body = await res.json()
  for (const key of Object.keys(body.peers)) {
    const ip = getPeerIp(key)
    if (state.banIps.check(ip, ip.includes(':') ? 'ipv6' : 'ipv4')) {
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
    const url = new URL(request.url)
    const handlerName = `${method}:${url.pathname}`

    if (!ALLOW_METHODS.includes(method)) {
      console.error(`${method} ${url.pathname}: disabled`)
      return new Response(null, { status: 405 })
    }

    if (method === 'POST' && !ALLOW_POST_PATHS.includes(url.pathname)) {
      console.error(`${method} ${url.pathname}: disabled`)
      return new Response(null, { status: 403 })
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

    const proxyHeaders = new Headers(request.headers.toJSON())
    proxyHeaders.delete('accept-encoding')
    proxyHeaders.set('host', config.qbtEndpoint.host)
    proxyHeaders.set('origin', config.qbtEndpoint.origin)
    proxyHeaders.set('referer', config.qbtEndpoint.origin.concat('/'))
    const response = await Bun.fetch(config.qbtEndpoint.origin + url.pathname + url.search, {
      body: await request.bytes(),
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
  const buffer = Buffer.from(
    (nftScript as string)
      .replaceAll('%QBT_PROT%', config.qbtPeerPort.toString())
      .replaceAll('%QBT_CGROUP_LEVEL%', config.qbtCgroupLevel.toString()),
    'utf-8',
  )
  await $`nft -f - < ${buffer}`
}

console.warn('qbt endpoint:', config.qbtEndpoint.origin)
console.warn(`pbh-qbt-helper started: ${serve.url}`)

#!/usr/bin/env bun

import { BlockList } from 'node:net'
import { $ } from 'bun'
import config from './config.ts'
import nftScript from './pbh-qbt-helper.nft.txt'
import { getPeerIp } from './utils.ts'

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

async function addBanIps(ips: string[]): Promise<void> {
  const ipv4 = []
  const ipv6 = []
  for (const ip of ips) {
    if (ip.startsWith('0:0:0:0') || ip.startsWith('::') || ip.trim() === '') {
      continue
    }
    try {
      if (ip.includes(':')) {
        state.banIps.addAddress(ip, 'ipv6')
        ipv6.push(ip)
      } else {
        state.banIps.addAddress(ip, 'ipv4')
        ipv4.push(ip)
      }
    } catch (err) {
      console.error(`add ip '${ip}':`, err)
    }
  }
  if (ipv4.length !== 0) {
    const buffer = Buffer.from(
      ipv4.map((ip) => `add element inet pbh_qbt_helper ipv4_ban_ips { ${ip} }`).join('\n'),
      'utf-8',
    )
    try {
      await $`nft -f - < ${buffer}`
    } catch (err) {
      console.error(err)
    }
  }
  if (ipv6.length !== 0) {
    const buffer = Buffer.from(
      ipv6.map((ip) => `add element inet pbh_qbt_helper ipv6_ban_ips { ${ip} }`).join('\n'),
      'utf-8',
    )
    try {
      await $`nft -f - < ${buffer}`
    } catch (e) {
      console.error(e)
    }
  }
}

async function cleanBanIps(): Promise<void> {
  await $`nft flush set inet pbh_qbt_helper ipv4_ban_ips`
  await $`nft flush set inet pbh_qbt_helper ipv6_ban_ips`
  state.banIps = new BlockList()
}

const serve = Bun.serve({
  hostname: '0.0.0.0',
  port: config.httpPort,
  async fetch(req) {
    let body: any = null
    const url = new URL(req.url)
    const headers = new Headers(req.headers)
    const method = req.method.toUpperCase()

    if (!ALLOW_METHODS.includes(method)) {
      console.error(`${method} ${url.pathname}: disabled`)
      return new Response(null, { status: 405 })
    }

    if (method === 'POST' && !ALLOW_POST_PATHS.includes(url.pathname)) {
      console.error(`${method} ${url.pathname}: disabled`)
      return new Response(null, { status: 403 })
    }

    // 修改 qbt 设置项
    if (url.pathname.endsWith('/app/setPreferences')) {
      body = await req.formData()
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
        const ips = json.banned_IPs.split('\n')
        await cleanBanIps()
        await addBanIps(ips)
        return new Response(null, { status: 204 })
      }
    }

    // 增量封禁
    if (url.pathname.endsWith('/transfer/banPeers') && config.useNftables) {
      body = await req.formData()
      const ips = ((body.get('peers') as string) ?? '').split('|').map((peer) => getPeerIp(peer))
      await addBanIps(ips)
      return new Response(null, { status: 200 })
    }

    headers.set('host', config.qbtEndpoint.host)
    headers.set('referer', config.qbtEndpoint.origin)
    if (req.bodyUsed) {
      headers.delete('content-length')
      headers.delete('content-type')
    }
    const res = await Bun.fetch(config.qbtEndpoint.origin + url.pathname + url.search, {
      body: req.bodyUsed ? body : req.body,
      headers,
      keepalive: true,
      method,
      signal: AbortSignal.timeout(10000),
    })
    const resHeaders = new Headers()
    resHeaders.set('content-type', res.headers.get('content-type') ?? '')
    resHeaders.set('x-content-type-options', 'nosniff')
    resHeaders.set('x-frame-options', 'SAMEORIGIN')
    resHeaders.set('x-xss-protection', '1; mode=block')

    // PBH 获取 peers 时过滤掉已封禁的 IP，防止触发全量封禁。
    if (url.pathname.endsWith('/sync/torrentPeers') && method === 'GET' && config.useNftables) {
      const body = await res.json()
      for (const key of Object.keys(body.peers)) {
        const ip = getPeerIp(key)
        if (state.banIps.check(ip, ip.includes(':') ? 'ipv6' : 'ipv4')) {
          Reflect.deleteProperty(body.peers, key)
        }
      }
      return new Response(JSON.stringify(body), { headers: resHeaders, status: res.status })
    }
    return new Response(res.body, {
      headers: resHeaders,
      status: res.status,
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

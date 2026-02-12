import { isIP } from 'node:net'
import { $ } from 'bun'

export interface IPSet {
  ipv4: Set<string>
  ipv6: Set<string>
}

export async function execNftScript(script: string): Promise<void> {
  if (script.trim() === '') {
    return
  }
  await $`nft -f - < ${Buffer.from(script, 'utf-8')}`
}

export function getPeerIp(peer: string): string {
  const i = peer.indexOf('[')
  return peer.substring(i + 1, peer.indexOf(i === -1 ? ':' : ']'))
}

export function makeIpSet(ips: string[]): IPSet {
  const set: IPSet = { ipv4: new Set(), ipv6: new Set() }
  for (const ip of ips) {
    if (ip.startsWith('0:0:0:0:0:') || ip.includes('::ffff:') || ip.trim() === '') {
      continue
    }
    const ipType = isIP(ip)
    if (ipType === 4) {
      set.ipv4.add(ip)
    } else if (ipType === 6) {
      set.ipv6.add(ip)
    }
  }
  return set
}

import { isIP } from 'node:net'
import { $ } from 'bun'

export interface BanIPSet {
  ipv4: Set<string>
  ipv6: Set<string>
}

export async function execNftScript(script: string): Promise<void> {
  if (script.trim() === '') {
    return
  }
  await $`nft -f - < ${Buffer.from(script, 'utf-8')}`
}

export function expandIPv6Address(address: string): string[] {
  let result: string[] = []
  if (address.includes('::')) {
    const parts = address.split('::')
    const left = parts[0] ? parts[0].split(':') : []
    const right = parts[1] ? parts[1].split(':') : []
    const zeros = new Array(8 - (left.length + right.length)).fill('0')
    result = [...left, ...zeros, ...right]
  } else {
    result = address.split(':')
  }
  return result.map((value) => (value.length < 4 ? value.padStart(4, '0') : value))
}

export function getPeerIp(peer: string): string {
  const i = peer.indexOf('[')
  return peer.substring(i + 1, peer.indexOf(i === -1 ? ':' : ']'))
}

export function makeBanIpSet(ips: string[]): BanIPSet {
  const set: BanIPSet = { ipv4: new Set(), ipv6: new Set() }
  for (const ip of ips) {
    if (ip.trim() === '') {
      continue
    }
    const ipType = isIP(ip)
    if (ipType === 4) {
      set.ipv4.add(ip)
    } else if (ipType === 6) {
      const v6 = expandIPv6Address(ip)
      if (v6[0] !== '0000') {
        set.ipv6.add(v6.slice(0, 4).join(':').concat('::/64'))
      }
    }
  }
  return set
}

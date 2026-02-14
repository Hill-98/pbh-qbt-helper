import { $ } from 'bun'

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

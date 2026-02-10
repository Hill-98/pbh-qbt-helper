export function getPeerIp(peer: string): string {
  const i = peer.indexOf('[')
  return peer.substring(i + 1, peer.indexOf(i === -1 ? ':' : ']'))
}

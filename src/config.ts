function parseNumber(value?: string): number | undefined {
  if (!value) {
    return undefined
  }
  const n = Number.parseInt(value, 10)
  if (Number.isNaN(n)) {
    throw new Error(`invalid number: ${value}`)
  }
  return n
}

export default {
  httpPort: parseNumber(process.env.HTTP_PORT) ?? 19830,
  qbtCgroupLevel: parseNumber(process.env.QBT_CGROUP_LEVEL) ?? 2,
  qbtEndpoint: URL.parse(process.env.QBT_ENDPOINT ?? 'http://127.0.0.1:8080') ?? new URL('http://127.0.0.1:8080'),
  qbtPeerPort: parseNumber(process.env.QBT_PEER_PORT) ?? 6881,
  useNftables: process.platform === 'linux' && (process.env.USE_NFTABLES ?? 'no').toLowerCase() === 'yes',
}

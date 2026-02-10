const httpPort = Number.parseInt(process.env.HTTP_PORT ?? '19830', 10)
const qbtEndpoint = URL.parse(process.env.QBT_ENDPOINT ?? 'http://127.0.0.1:8080')
const qbtCgroupLevel = Number.parseInt(process.env.QBT_CGROUP_LEVEL ?? '2', 10)
const qbtPeerPort = Number.parseInt(process.env.QBT_PEER_PORT ?? '6881', 10)

export default {
  httpPort: Number.isNaN(httpPort) ? 19830 : httpPort,
  qbtCgroupLevel: Number.isNaN(qbtCgroupLevel) ? 2 : qbtCgroupLevel,
  qbtEndpoint: qbtEndpoint === null ? new URL('http://127.0.0.1:8080') : qbtEndpoint,
  qbtPeerPort: Number.isNaN(qbtPeerPort) ? 6881 : qbtPeerPort,
  useNftables: (process.env.USE_NFTABLES ?? 'no') === 'yes' && process.platform === 'linux',
}

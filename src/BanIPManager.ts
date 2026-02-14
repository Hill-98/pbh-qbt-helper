import type { IPVersion } from 'node:net'
import { BlockList, isIP, isIPv4 } from 'node:net'
import { execNftScript, expandIPv6Address } from './utils.ts'

export type IPVersionMap<T> = Record<IPVersion, T>

export class BanIPManager {
  readonly #blockLists: IPVersionMap<BlockList>
  readonly #ipSets: IPVersionMap<Set<string>>
  readonly #nftNames: Readonly<IPVersionMap<string>>

  #operateLock: Promise<any> = Promise.resolve()

  constructor(nftSets: [string, string]) {
    this.#blockLists = { ipv4: new BlockList(), ipv6: new BlockList() }
    this.#ipSets = this.#makeIpSets([])
    this.#nftNames = Object.freeze({ ipv4: nftSets[0], ipv6: nftSets[1] })
  }

  get ipVersions(): IPVersion[] {
    return ['ipv4', 'ipv6']
  }

  #addToBlockList(value: string | Set<string>, v: IPVersion): void {
    if (typeof value === 'string') {
      const i = value.indexOf('/')
      if (i === -1) {
        this.#blockLists[v].addAddress(value, v)
      } else {
        this.#blockLists[v].addSubnet(value.substring(0, i), Number.parseInt(value.substring(i + 1), 10), v)
      }
      return
    }
    for (const ip of value) {
      this.#addToBlockList(ip, v)
    }
  }

  #makeIpSets(ips: string[]): IPVersionMap<Set<string>> {
    const set: IPVersionMap<Set<string>> = { ipv4: new Set(), ipv6: new Set() }
    for (const ip of ips) {
      const v = isIP(ip)
      if (v === 4) {
        set.ipv4.add(ip)
      } else if (v === 6) {
        const v6 = expandIPv6Address(ip)
        if (v6[0] !== '0000') {
          set.ipv6.add(v6.slice(0, 4).join(':').concat('::/64'))
        }
      }
    }
    return set
  }

  async #operate<T extends (...args: any) => any>(func: T, ...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
    const prevLock = this.#operateLock
    this.#operateLock = new Promise((resolve, reject) => {
      prevLock.finally(() =>
        Promise.try(func.bind(this, ...args))
          .then(resolve)
          .catch(reject),
      )
    })
    return this.#operateLock
  }

  #syncBlockList(v?: IPVersion): void {
    if (v === undefined) {
      for (const v of this.ipVersions) {
        this.#syncBlockList(v)
      }
    } else {
      this.#blockLists[v] = new BlockList()
      this.#addToBlockList(this.#ipSets[v], v)
    }
  }

  async #add(set: Set<string>, v: IPVersion): Promise<void> {
    const str = set.values().toArray().join(',')
    if (str.trim().length === 0) {
      return
    }
    await execNftScript(`add element ${this.#nftNames[v]} { ${str} }`)
    this.#ipSets[v] = this.#ipSets[v].union(set)
  }

  async #append(ips: string[]): Promise<void> {
    const sets = this.#makeIpSets(ips)
    for (const v of this.ipVersions) {
      await this.#add(sets[v], v)
      this.#addToBlockList(sets[v], v)
    }
  }

  async #delete(set: Set<string>, v: IPVersion): Promise<void> {
    const str = set.values().toArray().join(',')
    if (str.trim().length === 0) {
      return
    }
    await execNftScript(`delete element ${this.#nftNames[v]} { ${str} }`)
    for (const ip of set) {
      this.#ipSets[v].delete(ip)
    }
  }

  async #flush(): Promise<void> {
    for (const v of this.ipVersions) {
      await execNftScript(`flush set ${this.#nftNames[v]}`)
      this.#blockLists[v] = new BlockList()
      this.#ipSets[v].clear()
    }
  }

  async #replace(ips: string[]): Promise<void> {
    const sets = this.#makeIpSets(ips)
    if (sets.ipv4.size === 0 && sets.ipv6.size === 0) {
      await this.#flush()
      return
    }
    for (const v of this.ipVersions) {
      const added = sets[v].difference(this.#ipSets[v])
      const deleted = this.#ipSets[v].difference(sets[v])
      await this.#delete(deleted, v)
      await this.#add(added, v)
    }
    this.#syncBlockList()
  }

  append(ips: string[]): Promise<void> {
    return this.#operate(this.#append, ips)
  }

  check(ip: string): boolean {
    const v = isIPv4(ip) ? 'ipv4' : 'ipv6'
    return this.#blockLists[v].check(ip, v)
  }

  replace(ips: string[]): Promise<void> {
    return this.#operate(this.#replace, ips)
  }
}

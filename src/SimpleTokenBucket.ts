export class SimpleTokenBucket {
  readonly #maxTokens: number
  #tokens: number

  constructor(maxTokens: number, seconds: number, perAddTokens: number) {
    this.#maxTokens = maxTokens
    this.#tokens = maxTokens
    setInterval(this.addTokens.bind(this, perAddTokens), seconds * 1000)
  }

  addTokens(n: number): void {
    if (this.#tokens >= this.#maxTokens) {
      return
    }
    this.#tokens = this.#tokens + Math.min(n, this.#maxTokens - this.#tokens)
  }

  tryConsume(): boolean {
    if (this.#tokens <= 0) {
      return false
    }
    this.#tokens = this.#tokens - 1
    return true
  }
}

const DEEPGRAM_KEY = 'cf_deepgram_key'
const ANTHROPIC_KEY = 'cf_anthropic_key'

export function getApiKey(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(DEEPGRAM_KEY) ?? ''
}

export function setApiKey(value: string) {
  window.localStorage.setItem(DEEPGRAM_KEY, value.trim())
}

export function getAnthropicKey(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(ANTHROPIC_KEY) ?? ''
}

export function setAnthropicKey(value: string) {
  window.localStorage.setItem(ANTHROPIC_KEY, value.trim())
}

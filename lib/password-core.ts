import { argon2idAsync } from '@noble/hashes/argon2.js'

/**
 * Pure Argon2id implementation shared by Node.js and the Durable Object.
 * No Node-only imports: it also runs inside workerd.
 *
 * `@node-rs/argon2` ships a native `.node` binary, which Workers cannot load.
 * `@noble/hashes` is a pure-JS Argon2id implementation; the parameters below
 * match what the app used before (m=19456 KiB, t=2, p=1, 32-byte output), and
 * existing PHC strings verify unchanged.
 */

const PARAMS = { t: 2, m: 19456, p: 1, dkLen: 32 } as const
const PHC_PREFIX = '$argon2id$v=19'

type ParsedHash = {
  m: number
  t: number
  p: number
  salt: Uint8Array
  hash: Uint8Array
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=+$/, '')
}

function parsePhc(stored: string): ParsedHash | null {
  const parts = stored.trim().split('$')
  // ['', 'argon2id', 'v=19', 'm=19456,t=2,p=1', salt, hash]
  if (parts.length !== 6 || parts[1] !== 'argon2id' || parts[2] !== 'v=19') return null

  const params: Record<string, number> = {}
  for (const pair of parts[3].split(',')) {
    const [key, raw] = pair.split('=')
    const value = Number(raw)
    if (key && Number.isFinite(value)) params[key] = value
  }
  if (!params.m || !params.t || !params.p) return null

  try {
    const salt = decodeBase64(parts[4])
    const hash = decodeBase64(parts[5])
    if (salt.length === 0 || hash.length === 0) return null
    return { m: params.m, t: params.t, p: params.p, salt, hash }
  } catch {
    return null
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function hashPasswordLocal(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await argon2idAsync(password, salt, PARAMS)
  return `${PHC_PREFIX}$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${encodeBase64(salt)}$${encodeBase64(hash)}`
}

/**
 * Verifies a stored PHC hash. When the account does not exist the caller
 * passes null, and we still run a full derivation so response timing does not
 * reveal whether an email is registered.
 */
export async function verifyPasswordLocal(
  storedHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  const parsed = storedHash ? parsePhc(storedHash) : null

  if (!parsed) {
    await argon2idAsync(password, new Uint8Array(16), PARAMS).catch(() => undefined)
    return false
  }

  const derived = await argon2idAsync(password, parsed.salt, {
    t: parsed.t,
    m: parsed.m,
    p: parsed.p,
    dkLen: parsed.hash.length,
  }).catch(() => null)

  return derived !== null && constantTimeEqual(derived, parsed.hash)
}

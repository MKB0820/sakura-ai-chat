import { getCloudflareContext } from '@opennextjs/cloudflare'
import { hashPasswordLocal, verifyPasswordLocal } from '@/lib/password-core'
import { isCloudflareWorkers } from '@/lib/runtime'

/**
 * Password hashing entry point.
 *
 * On Cloudflare Workers the Argon2 work runs inside a Durable Object
 * (`AuthHasher`), because the Workers Free plan caps normal invocations at
 * 10 ms of CPU while a Durable Object gets 30 s. The main Worker only pays for
 * one RPC round-trip. On Node.js (`next dev`) the same Argon2id code runs
 * locally.
 *
 * The hash format and parameters are unchanged, so existing hashes verify.
 */

type AuthHasherStub = {
  hash(password: string): Promise<string>
  verify(storedHash: string | null, password: string): Promise<boolean>
}

function getHasher(): AuthHasherStub | null {
  try {
    const { env } = getCloudflareContext()
    const namespace = (
      env as unknown as {
        AUTH_HASHER?: {
          idFromName(name: string): unknown
          get(id: unknown): AuthHasherStub
        }
      }
    ).AUTH_HASHER
    if (!namespace) return null
    return namespace.get(namespace.idFromName('auth-hasher'))
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (isCloudflareWorkers()) {
    const hasher = getHasher()
    if (!hasher) {
      throw new Error('AUTH_HASHER Durable Object binding is missing on Workers.')
    }
    return hasher.hash(password)
  }
  return hashPasswordLocal(password)
}

/**
 * Verifies a stored PHC hash. A null hash still burns a real derivation inside
 * the Durable Object (or locally), so timing does not reveal whether an email
 * is registered.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (isCloudflareWorkers()) {
    const hasher = getHasher()
    if (!hasher) {
      throw new Error('AUTH_HASHER Durable Object binding is missing on Workers.')
    }
    return hasher.verify(storedHash ?? null, password)
  }
  return verifyPasswordLocal(storedHash, password)
}

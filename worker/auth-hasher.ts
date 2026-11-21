import { DurableObject } from 'cloudflare:workers'
import { hashPasswordLocal, verifyPasswordLocal } from '../lib/password-core'

/**
 * Argon2id runs here, not in the request handler: Durable Objects get 30 s of
 * CPU per invocation on both Free and Paid plans, while normal Workers Free
 * invocations are limited to 10 ms.
 *
 * A single named instance ("auth-hasher") is used; hashing is CPU-bound and
 * the object does not keep state.
 */
export class AuthHasher extends DurableObject {
  async hash(password: string): Promise<string> {
    return hashPasswordLocal(password)
  }

  async verify(storedHash: string | null, password: string): Promise<boolean> {
    return verifyPasswordLocal(storedHash, password)
  }
}

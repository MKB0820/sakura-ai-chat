import { hash, verify } from '@node-rs/argon2'
import type { Algorithm } from '@node-rs/argon2'

// @node-rs/argon2 ships `Algorithm` as an ambient const enum, which cannot be
// referenced at runtime under `isolatedModules`. 2 === Algorithm.Argon2id.
const ARGON2ID = 2 as Algorithm

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // 19 MiB, OWASP-recommended minimum for Argon2id
  timeCost: 2,
  parallelism: 1,
}

// Hashing a throwaway password once per process; verifying against it when the
// account does not exist keeps response time comparable to a real check, so
// timing does not reveal whether an email is registered.
let dummyHashPromise: Promise<string> | null = null
function getDummyHash() {
  dummyHashPromise ??= hash('dummy-password-for-timing-equalization', ARGON2_OPTIONS)
  return dummyHashPromise
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

export async function verifyPassword(
  storedHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  try {
    return await verify(storedHash ?? (await getDummyHash()), password, ARGON2_OPTIONS)
  } catch {
    return false
  }
}

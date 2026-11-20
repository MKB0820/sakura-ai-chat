import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Secret-at-rest support for provider API keys (local / Node.js only).
 *
 * The ciphertext (AES-256-GCM) lives in `.env.local` as DEEPSEEK_API_KEY_ENC.
 * The 32-byte master key lives OUTSIDE the project, in the user profile
 * (`~/.sakura-chat/master.key`), or in the SAKURA_MASTER_KEY env var.
 *
 * On Cloudflare Workers there is no filesystem and no master key file: the key
 * comes from a Worker secret (`wrangler secret put DEEPSEEK_API_KEY`), which
 * Cloudflare stores encrypted. `getDeepSeekApiKey()` handles both worlds.
 */

const FORMAT_PREFIX = 'v1'
const KEY_BYTES = 32

let cachedMasterKey: Buffer | null = null

export function getMasterKeyDir(): string {
  return path.join(os.homedir(), '.sakura-chat')
}

export function getMasterKeyFile(): string {
  return path.join(getMasterKeyDir(), 'master.key')
}

async function createMasterKey(): Promise<Buffer> {
  const key = randomBytes(KEY_BYTES)
  await fs.mkdir(getMasterKeyDir(), { recursive: true })
  await fs.writeFile(getMasterKeyFile(), `${key.toString('base64')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    await fs.chmod(getMasterKeyFile(), 0o600)
  } catch {
    // Windows: the profile directory is already restricted to the user.
  }
  return key
}

export async function getMasterKey(): Promise<Buffer> {
  if (cachedMasterKey) return cachedMasterKey

  const fromEnv = process.env.SAKURA_MASTER_KEY?.trim()
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64')
    if (key.length !== KEY_BYTES) {
      throw new Error('SAKURA_MASTER_KEY 必须是 32 字节的 base64')
    }
    cachedMasterKey = key
    return key
  }

  try {
    const raw = await fs.readFile(getMasterKeyFile(), 'utf8')
    const key = Buffer.from(raw.trim(), 'base64')
    if (key.length !== KEY_BYTES) {
      throw new Error('master.key 已损坏（需要 32 字节）')
    }
    cachedMasterKey = key
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      cachedMasterKey = await createMasterKey()
      return cachedMasterKey
    }
    throw error
  }
}

/** Encrypts to `v1.<iv>.<tag>.<data>` with base64url parts. */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    FORMAT_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    data.toString('base64url'),
  ].join('.')
}

export async function decryptSecret(packed: string): Promise<string> {
  const parts = packed.trim().split('.')
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) {
    throw new Error('不支持的密钥格式')
  }
  const key = await getMasterKey()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'))
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
  const data = Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64url')),
    decipher.final(),
  ])
  return data.toString('utf8')
}

/**
 * Resolves the DeepSeek key:
 * - Workers: the Worker secret in DEEPSEEK_API_KEY (Cloudflare encrypts it).
 * - Node.js: encrypted DEEPSEEK_API_KEY_ENC first, plaintext as legacy fallback.
 */
export async function getDeepSeekApiKey(): Promise<string | undefined> {
  const plaintext = process.env.DEEPSEEK_API_KEY?.trim()

  if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') {
    return plaintext || undefined
  }

  const encrypted = process.env.DEEPSEEK_API_KEY_ENC?.trim()
  if (encrypted) {
    return decryptSecret(encrypted)
  }
  return plaintext || undefined
}

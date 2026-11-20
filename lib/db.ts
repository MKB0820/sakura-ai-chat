import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'
import { getCloudflareContext } from '@opennextjs/cloudflare'

/**
 * Prisma on Cloudflare Workers always goes through the D1 binding. There is no
 * DATABASE_URL connection string in Workers: the binding is read from the
 * per-request Cloudflare context.
 *
 * The client is resolved lazily on first use (inside the request handler), not
 * at module evaluation time — at startup the request context does not exist
 * yet. `prisma` stays a drop-in PrismaClient so call sites are unchanged.
 */

type Cached = { client: PrismaClient; db: D1Database }

let cached: Cached | null = null

function d1Binding(): D1Database {
  let env: CloudflareEnv | undefined
  try {
    env = getCloudflareContext().env
  } catch (error) {
    throw new Error(
      'Cloudflare 上下文不可用：无法读取 D1 binding。本地开发请确认 next.config.ts 调用了 initOpenNextCloudflareForDev()。',
      { cause: error },
    )
  }

  const db = env?.DB
  if (!db) {
    throw new Error('缺少 D1 binding "DB"：请在 wrangler.jsonc 的 d1_databases 中配置，并执行 wrangler d1 migrations apply。')
  }
  return db
}

function resolveClient(): PrismaClient {
  const db = d1Binding()
  if (cached && cached.db === db) return cached.client
  const client = new PrismaClient({ adapter: new PrismaD1(db) })
  cached = { client, db }
  return client
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = resolveClient()
    const value = Reflect.get(client, property, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

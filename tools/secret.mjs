// Manage the encrypted DeepSeek API key.
//
//   node tools/secret.mjs status    show whether the key is encrypted
//   node tools/secret.mjs migrate   encrypt the plaintext key in .env.local
//   node tools/secret.mjs set       read a key from stdin, encrypt it, save it
//
// Plaintext is never printed. The master key lives in ~/.sakura-chat/master.key
// (or SAKURA_MASTER_KEY), outside the project folder.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encryptSecret, getMasterKeyFile } from '../lib/secret.ts'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const envFile = path.join(projectRoot, '.env.local')

const PLAIN_KEY = 'DEEPSEEK_API_KEY'
const ENC_KEY = 'DEEPSEEK_API_KEY_ENC'

async function readLines() {
  try {
    return (await fs.readFile(envFile, 'utf8')).split(/\r?\n/)
  } catch {
    return []
  }
}

async function writeLines(lines) {
  const content = `${lines.filter((line, i, all) => line !== '' || i < all.length - 1).join('\n').replace(/\n*$/, '')}\n`
  await fs.writeFile(envFile, content, 'utf8')
}

function valueOf(line, key) {
  const prefix = `${key}=`
  if (!line.startsWith(prefix)) return null
  return line.slice(prefix.length).trim().replace(/^"(.*)"$/, '$1')
}

function withoutKey(lines, key) {
  return lines.filter((line) => !line.startsWith(`${key}=`))
}

function upsert(lines, key, value) {
  const next = withoutKey(lines, key)
  next.push(`${key}="${value}"`)
  return next
}

async function masterKeyExists() {
  return fs
    .access(getMasterKeyFile())
    .then(() => true)
    .catch(() => false)
}

async function status() {
  const lines = await readLines()
  const hasPlain = lines.some((line) => valueOf(line, PLAIN_KEY) !== null)
  const hasEnc = lines.some((line) => (valueOf(line, ENC_KEY) ?? '').length > 0)
  console.log(`加密密钥（${ENC_KEY}）：${hasEnc ? '已存在' : '不存在'}`)
  console.log(`明文密钥（${PLAIN_KEY}）：${hasPlain ? '⚠ 仍存在，建议执行 migrate' : '不存在'}`)
  console.log(`主密钥文件：${getMasterKeyFile()}（${(await masterKeyExists()) ? '已存在' : '尚未创建'}）`)
  console.log(
    `主密钥来源：${process.env.SAKURA_MASTER_KEY ? '环境变量 SAKURA_MASTER_KEY' : '主密钥文件'}`,
  )
}

async function applyKey(plaintext, label) {
  if (!plaintext) {
    console.error('没有读到密钥，已取消。')
    process.exitCode = 1
    return
  }
  const encrypted = await encryptSecret(plaintext)
  const lines = upsert(await readLines(), ENC_KEY, encrypted)
  await writeLines(lines)
  console.log(`${label}：已加密写入 .env.local（${ENC_KEY}），明文已移除。`)
  console.log(`主密钥文件：${getMasterKeyFile()}`)
  console.log('重启服务后生效。')
}

async function migrate() {
  const lines = await readLines()
  const plain = lines.map((line) => valueOf(line, PLAIN_KEY)).find((v) => v !== null)
  if (!plain) {
    const already = lines.some((line) => (valueOf(line, ENC_KEY) ?? '').length > 0)
    console.log(already ? '密钥已是加密形式，无需迁移。' : ' .env.local 中没有找到明文密钥。')
    return
  }
  const encrypted = await encryptSecret(plain)
  const next = upsert(withoutKey(lines, PLAIN_KEY), ENC_KEY, encrypted)
  await writeLines(next)
  console.log('迁移完成：明文密钥已加密并移除。')
  console.log(`主密钥文件：${getMasterKeyFile()}`)
  console.log('重启服务后生效。')
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function set() {
  if (process.stdin.isTTY) {
    console.error('请通过管道传入密钥，例如：')
    console.error('  Get-Content key.txt | node tools/secret.mjs set')
    console.error('或直接粘贴后按 Ctrl+Z（Windows）/ Ctrl+D（macOS、Linux）再回车。')
  }
  const plaintext = await readStdin()
  await applyKey(plaintext, '更新密钥')
}

const command = process.argv[2]
if (command === 'status') await status()
else if (command === 'migrate') await migrate()
else if (command === 'set') await set()
else {
  console.log('用法：node tools/secret.mjs <status|migrate|set>')
  process.exitCode = 1
}

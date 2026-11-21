// Cloudflare Worker entry point.
//
// OpenNext generates `.open-next/worker.js` on every build; this thin wrapper
// re-exports it and adds the Argon2 Durable Object class, which must be a
// named export of the entry script. The generated file has no types, so the
// import is intentionally untyped.
import openNextWorker from '../.open-next/worker.js'
import { AuthHasher } from './auth-hasher'

export default openNextWorker
export { AuthHasher }

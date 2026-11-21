// `opennextjs-cloudflare build` generates .open-next/worker.js. Declaring it
// keeps `tsc`/`next build` working in a clean checkout before that file exists.
declare module '*/.open-next/worker.js' {
  const worker: {
    fetch(request: Request, env: unknown, ctx: unknown): Response | Promise<Response>
  }
  export default worker
}

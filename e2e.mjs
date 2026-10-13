// E2E: descarga integrada de motores (UI real → IPC → main → unzip → detección).
// Uso: node e2e.mjs <puerto-cdp> <base-url-esperada>
const port = process.argv[2] ?? '9233'
const expectedBase = process.argv[3]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let page
  for (let i = 0; i < 30 && !page; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    // Evitar la splash: nos quedamos con la página del renderizador.
    page = targets.find((t) => t.type === 'page' && !/splash/i.test(t.url))
    if (!page) await sleep(500)
  }
  if (!page) throw new Error('no page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }

  await send('Runtime.enable')
  // La app ya está en Settings (se lanzó navegarAllSettings) o hay que esperarla.
  const result = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    // Ir a Ajustes si no estamos (clic real en el botón del sidebar).
    for (let i = 0; i < 50; i++) {
      const nav = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Ajustes'))
      if (nav) { nav.click(); break }
      await sleep(200)
    }
    await sleep(400)

    const before = await window.api.binaries.status()

    // Suscribirse a progreso ANTES de pulsar (evento de la UI real).
    window.__ev = []
    window.__unsub = window.api.engines.onProgress((p) => window.__ev.push(p))

    // Clic real en «Descargar» de la fila Pandoc.
    const row = [...document.querySelectorAll('li')].find((li) => li.textContent?.includes('Pandoc'))
    const btn = row?.querySelector('button')
    if (!btn) return JSON.stringify({ error: 'botón Descargar de Pandoc no encontrado', before })
    btn.click()

    // Esperar fase final (done/error).
    const t0 = Date.now()
    while (Date.now() - t0 < 60000) {
      const last = window.__ev[window.__ev.length - 1]
      if (last && (last.phase === 'done' || last.phase === 'error')) break
      await sleep(200)
    }
    const after = await window.api.binaries.status()

    // 404: gs no está en el servidor local → debe dar error HTTP 404.
    window.__ev2 = []
    window.api.engines.onProgress((p) => window.__ev2.push(p))
    const gs = await window.api.engines.download('gs')
    await sleep(1000)

    return JSON.stringify({ before, after, events: window.__ev, gs, gsEvents: window.__ev2 })
  })()`)

  const data = JSON.parse(result)
  console.log(JSON.stringify(data, null, 2))

  const ok =
    data.error === undefined &&
    data.before.pandoc === false &&
    data.events.some((e) => e.phase === 'downloading' && e.percent != null) &&
    data.events.some((e) => e.id === 'pandoc' && e.phase === 'installing') &&
    data.events.filter((e) => e.id === 'pandoc').at(-1)?.phase === 'done' &&
    data.after.pandoc === true &&
    data.gs.ok === false &&
    data.gsEvents.some((e) => e.phase === 'error' && /404/.test(e.error ?? ''))

  const { existsSync } = await import('fs')
  const installed = existsSync('resources/bin/pandoc/pandoc.exe')
  console.log(`archivo instalado en resources/bin/pandoc/pandoc.exe: ${installed}`)
  console.log(ok && installed ? 'E2E=PASS' : 'E2E=FAIL')
  ws.close()
  process.exit(ok && installed ? 0 : 1)
}

main().catch((e) => {
  console.error('E2E error:', e)
  process.exit(1)
})

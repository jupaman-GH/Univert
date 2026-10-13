// E2E REAL (sin servidor local): UI real → IPC → main → descarga de GitHub →
// instalación en resources/bin → detección. También valida el error de motor
// desconocido. Uso: node e2e.mjs <puerto-cdp>
const port = process.argv[2] ?? '9233'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let page
  for (let i = 0; i < 30 && !page; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
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
  const result = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const waitPhase = async (events, id, ms) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        const last = events.filter((e) => e.id === id).at(-1)
        if (last && (last.phase === 'done' || last.phase === 'error')) return last
        await sleep(300)
      }
      return events.filter((e) => e.id === id).at(-1) ?? null
    }

    for (let i = 0; i < 50; i++) {
      const nav = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Ajustes'))
      if (nav) { nav.click(); break }
      await sleep(200)
    }
    await sleep(400)

    const before = await window.api.binaries.status()

    // 1) Clic real en «Descargar» de la fila Pandoc (descarga real de GitHub).
    window.__ev = []
    window.__unsub = window.api.engines.onProgress((p) => window.__ev.push(p))
    const row = [...document.querySelectorAll('li')].find((li) => li.textContent?.includes('Pandoc'))
    const btn = row?.querySelector('button')
    if (!btn) return JSON.stringify({ error: 'botón Descargar de Pandoc no encontrado', before })
    btn.click()
    const pandocLast = await waitPhase(window.__ev, 'pandoc', 300000)
    const afterPandoc = await window.api.binaries.status()

    // 2) ImageMagick vía API (12 MB, mismo camino IPC/main).
    const magick = await window.api.engines.download('magick')
    const magickLast = await waitPhase(window.__ev, 'magick', 300000)
    const afterBoth = await window.api.binaries.status()

    // 3) Motor inexistente: error sin red.
    const bogus = await window.api.engines.download('nope')

    return JSON.stringify({ before, afterPandoc, afterBoth, pandocLast, magickLast, magick, bogus, events: window.__ev })
  })()`)

  const data = JSON.parse(result)
  console.log(JSON.stringify({ ...data, events: `${data.events.length} eventos` }, null, 2))

  const { existsSync } = await import('fs')
  const pandocFile = existsSync('resources/bin/pandoc/pandoc.exe')
  const magickFile = existsSync('resources/bin/magick/magick.exe')

  const ok =
    data.error === undefined &&
    data.before.pandoc === false &&
    data.pandocLast?.phase === 'done' &&
    data.afterPandoc.pandoc === true &&
    data.events.some((e) => e.id === 'pandoc' && e.phase === 'downloading' && e.percent != null) &&
    data.magick.ok === true &&
    data.magickLast?.phase === 'done' &&
    data.afterBoth.magick === true &&
    data.bogus.ok === false &&
    /desconocido/.test(data.bogus.error ?? '')

  console.log(`pandoc.exe instalado: ${pandocFile} | magick.exe instalado: ${magickFile}`)
  console.log(ok && pandocFile && magickFile ? 'E2E=PASS' : 'E2E=FAIL')
  ws.close()
  process.exit(ok && pandocFile && magickFile ? 0 : 1)
}

main().catch((e) => {
  console.error('E2E error:', e)
  process.exit(1)
})

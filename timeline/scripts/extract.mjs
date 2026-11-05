#!/usr/bin/env node
/**
 * Zamienia transkrypt spotkania na mapę myśli osadzoną w czasie.
 *
 *   OPENAI_API_KEY=... npm run extract
 *   LLM_BASE_URL=https://api.cerebras.ai/v1 LLM_MODEL=llama-3.3-70b LLM_API_KEY=... npm run extract
 *
 * Wynik trafia do src/data/mindmap.json — tego samego pliku, którego używa demo.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const BASE_URL = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1'
const API_KEY = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY
const MODEL = process.env.LLM_MODEL ?? 'gpt-4.1'
const TRANSCRIPT = process.env.TRANSCRIPT ?? resolve(root, 'data/transcript.txt')
const CHUNK_SECONDS = 300

const SYSTEM = `Jesteś analitykiem spotkań. Dostajesz fragment transkryptu burzy mózgów z timestampami.
Wyciągnij z niego węzły mapy myśli. Zwróć WYŁĄCZNIE JSON:
{"nodes":[{"id":"kebab-case-id","parent":"id-rodzica-albo-null","kind":"theme|idea|insight|critique|decision|constraint|joke","t":sekundy,"label":"max 7 słów","speaker":"...","quote":"dosłowny cytat","impact":1-3}],
 "links":[{"source":"id","target":"id","kind":"echo|resolves","note":"czemu to się łączy"}]}
Zasady:
- parent=null tylko dla głównych wątków (kind=theme). Każdy inny węzeł ma rodzica.
- t to sekunda, w której myśl padła.
- Węzły z wcześniejszych fragmentów są podane jako kontekst — możesz się do nich podpinać przez parent i links.
- kind=critique dla kontrargumentów, decision dla ustaleń, constraint dla zasad/ograniczeń z zewnątrz.
- impact=3 dla myśli, które zmieniły kierunek rozmowy.
- Nie wymyślaj cytatów.`

function chunk(text) {
  const rows = text.split('\n').filter((row) => /^\s*(\d+\|)?\s*\[\d{2}:\d{2}\]/.test(row))
  const groups = []
  for (const row of rows) {
    const [, mm, ss] = /\[(\d{2}):(\d{2})\]/.exec(row)
    const seconds = Number(mm) * 60 + Number(ss)
    const index = Math.floor(seconds / CHUNK_SECONDS)
    ;(groups[index] ??= []).push(row.replace(/^\s*\d+\|/, '').trim())
  }
  return groups.filter(Boolean).map((rows) => rows.join('\n'))
}

async function complete(messages) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, response_format: { type: 'json_object' } }),
  })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  const payload = await response.json()
  return JSON.parse(payload.choices[0].message.content)
}

/**
 * Tryb offline: nic nie woła, tylko odgrywa fragment po fragmencie mapę, która
 * leży już w repo. Służy do pokazania przebiegu pipeline'u bez klucza API.
 */
async function replayOffline() {
  const baked = JSON.parse(await readFile(resolve(root, 'src/data/mindmap.json'), 'utf8'))
  const chunks = Math.ceil(baked.meta.durationSec / CHUNK_SECONDS)
  console.log(`Tryb offline — odtwarzam gotową mapę (${baked.meta.model}).\n`)
  for (let index = 0; index < chunks; index += 1) {
    const from = index * CHUNK_SECONDS
    const inChunk = baked.nodes.filter((n) => n.t >= from && n.t < from + CHUNK_SECONDS)
    process.stdout.write(`fragment ${index + 1}/${chunks} (${from}s–${from + CHUNK_SECONDS}s)… `)
    await new Promise((done) => setTimeout(done, 350))
    console.log(`+${inChunk.length} węzłów`)
    for (const node of inChunk) console.log(`    ${node.kind.padEnd(10)} ${node.label}`)
  }
  console.log(`\nRazem: ${baked.nodes.length} węzłów, ${baked.links.length} powiązań. Plik bez zmian.`)
}

async function main() {
  if (!API_KEY) {
    console.log('Brak klucza API — uruchamiam tryb offline.')
    console.log('Żeby wygenerować mapę na nowo: OPENAI_API_KEY=… npm run extract')
    console.log('(albo LLM_API_KEY + LLM_BASE_URL + LLM_MODEL dla Cerebrasa/Groka)\n')
    await replayOffline()
    return
  }

  const raw = await readFile(TRANSCRIPT, 'utf8')
  const chunks = chunk(raw)
  const nodes = []
  const links = []

  for (const [index, part] of chunks.entries()) {
    const context = nodes.map((n) => `${n.id} (${n.kind}, ${n.t}s): ${n.label}`).join('\n') || 'brak'
    process.stdout.write(`fragment ${index + 1}/${chunks.length}… `)
    const result = await complete([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Węzły już wyciągnięte:\n${context}\n\nFragment transkryptu:\n${part}` },
    ])
    const fresh = (result.nodes ?? []).filter((n) => !nodes.some((existing) => existing.id === n.id))
    nodes.push(...fresh)
    links.push(...(result.links ?? []))
    console.log(`+${fresh.length} węzłów`)
  }

  const known = new Set(nodes.map((n) => n.id))
  const durationSec = Math.max(...nodes.map((n) => n.t)) + 30

  const existing = JSON.parse(await readFile(resolve(root, 'src/data/mindmap.json'), 'utf8'))
  const output = {
    ...existing,
    meta: { ...existing.meta, durationSec, model: `${MODEL} @ ${BASE_URL}` },
    nodes: nodes
      .map((n) => ({ ...n, parent: n.parent && known.has(n.parent) ? n.parent : null }))
      .sort((a, b) => a.t - b.t),
    links: links.filter((l) => known.has(l.source) && known.has(l.target)),
  }

  await writeFile(resolve(root, 'src/data/mindmap.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(`\nGotowe: ${output.nodes.length} węzłów, ${output.links.length} powiązań.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

// Utilidades para exportar datos a archivos descargables (sin dependencias):
// CSV, y un ZIP "stored" (sin compresión) para empaquetar varios CSV.

/** Convierte filas a CSV (RFC 4180). Objetos/arreglos se serializan como JSON. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  // Columnas = unión de todas las claves (por si algunas filas tienen menos).
  const cols = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k))
      return set
    }, new Set<string>())
  )
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/["\n\r,]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const lines = [cols.join(',')]
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','))
  return lines.join('\r\n')
}

// --- ZIP "stored" (método 0, sin compresión) ---

function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n & 0xffff, true)
  return b
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, true)
  return b
}
function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Empaqueta archivos de texto en un ZIP (sin compresión) y devuelve un Blob. */
export function zipTextFiles(files: { name: string; content: string }[]): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const data = enc.encode(f.content)
    const crc = crc32(data)
    const local = concat([
      u32(0x04034b50), // firma cabecera local
      u16(20), // versión requerida
      u16(0x0800), // flags (nombre en UTF-8)
      u16(0), // método = 0 (stored)
      u16(0),
      u16(0), // hora/fecha
      u32(crc),
      u32(data.length), // tamaño comprimido
      u32(data.length), // tamaño sin comprimir
      u16(nameBytes.length),
      u16(0), // extra
      nameBytes,
    ])
    chunks.push(local, data)
    central.push(
      concat([
        u32(0x02014b50), // firma directorio central
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0), // extra
        u16(0), // comentario
        u16(0), // disco
        u16(0), // atributos internos
        u32(0), // atributos externos
        u32(offset), // offset de la cabecera local
        nameBytes,
      ])
    )
    offset += local.length + data.length
  }

  const centralStart = offset
  let centralSize = 0
  for (const c of central) {
    chunks.push(c)
    centralSize += c.length
  }
  chunks.push(
    concat([
      u32(0x06054b50), // fin del directorio central
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralSize),
      u32(centralStart),
      u16(0), // comentario
    ])
  )

  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}

/** Dispara la descarga de un Blob con el nombre dado. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Minimal but robust CSV parser.
 * Handles: quoted fields, embedded commas, escaped double-quotes (""), CRLF/LF line endings.
 */
export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const lines = splitLines(normalized)
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = parseRow(lines[0]).map(h => h.trim())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i])
    if (values.every(v => v.trim() === '')) continue // skip blank lines
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? '').trim()
    })
    rows.push(row)
  }

  return { headers, rows }
}

/** Split CSV text into logical lines (handles newlines inside quoted fields). */
function splitLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
        current += c
      }
    } else if (c === '\n' && !inQuotes) {
      lines.push(current)
      current = ''
    } else {
      current += c
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Parse a single CSV row into an array of field values. */
function parseRow(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        field += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        fields.push(field)
        field = ''
      } else {
        field += c
      }
    }
  }
  fields.push(field)
  return fields
}

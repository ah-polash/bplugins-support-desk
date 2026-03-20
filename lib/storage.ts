import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')

function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}

export async function saveFile(file: File) {
  ensureDir()
  const ext = path.extname(file.name)
  const uniqueName = `${uuidv4()}${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(UPLOAD_DIR, uniqueName), buffer)
  return {
    url: `/uploads/${uniqueName}`,
    filename: file.name,
    size: file.size,
    mimeType: file.type,
  }
}

export async function saveBuffer(buffer: Buffer, filename: string, mimeType: string) {
  ensureDir()
  const ext = path.extname(filename) || '.bin'
  const uniqueName = `${uuidv4()}${ext}`
  fs.writeFileSync(path.join(UPLOAD_DIR, uniqueName), buffer)
  return {
    url: `/uploads/${uniqueName}`,
    filename,
    size: buffer.length,
    mimeType,
  }
}

export function deleteFile(url: string) {
  const filename = path.basename(url)
  const filePath = path.join(UPLOAD_DIR, filename)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

export function getFilePath(url: string) {
  return path.join(process.cwd(), 'public', url)
}

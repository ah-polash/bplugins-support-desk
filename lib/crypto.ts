import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set')
  // Accept hex (64 chars) or base64 (44 chars) encoded 32-byte key
  if (key.length === 64) return Buffer.from(key, 'hex')
  const buf = Buffer.from(key, 'base64')
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars or 44 base64 chars)')
  return buf
}

/**
 * Encrypt a plaintext string.
 * Returns format: iv:ciphertext:authTag (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`
}

/**
 * Decrypt an encrypted string (iv:ciphertext:authTag format).
 */
export function decrypt(encryptedText: string): string {
  const key = getKey()
  const parts = encryptedText.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted text format')

  const iv = Buffer.from(parts[0], 'hex')
  const encrypted = Buffer.from(parts[1], 'hex')
  const tag = Buffer.from(parts[2], 'hex')

  if (tag.length !== TAG_LENGTH) throw new Error('Invalid auth tag')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

/**
 * Check if a string looks like it's already encrypted (iv:ciphertext:tag format).
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':')
  if (parts.length !== 3) return false
  return /^[0-9a-f]{32}$/.test(parts[0]) && /^[0-9a-f]+$/.test(parts[1]) && /^[0-9a-f]{32}$/.test(parts[2])
}

/**
 * Safely decrypt — returns the original string if it doesn't look encrypted.
 * Useful during migration period.
 */
export function safeDecrypt(value: string): string {
  if (!isEncrypted(value)) return value
  return decrypt(value)
}

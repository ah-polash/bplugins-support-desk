/**
 * Migration script: Encrypt existing plaintext credentials in the database.
 *
 * Run once after deploying the encryption changes:
 *   ENCRYPTION_KEY="your-key" npx tsx scripts/encrypt-credentials.ts
 *
 * Safe to run multiple times — skips already-encrypted values.
 */
import { PrismaClient } from '@prisma/client'
import { encrypt, isEncrypted } from '../lib/crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('Encrypting existing credentials...\n')

  // 1. Email account passwords
  const accounts = await prisma.emailAccount.findMany({ select: { id: true, email: true, password: true } })
  let encryptedAccounts = 0
  for (const account of accounts) {
    if (isEncrypted(account.password)) {
      console.log(`  [skip] EmailAccount ${account.email} — already encrypted`)
      continue
    }
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { password: encrypt(account.password) },
    })
    encryptedAccounts++
    console.log(`  [done] EmailAccount ${account.email} — password encrypted`)
  }

  // 2. App settings (aiApiKey, recaptchaSecretKey)
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
  if (settings) {
    const updates: Record<string, string> = {}

    if (settings.aiApiKey && !isEncrypted(settings.aiApiKey)) {
      updates.aiApiKey = encrypt(settings.aiApiKey)
      console.log(`  [done] AppSettings — aiApiKey encrypted`)
    } else if (settings.aiApiKey) {
      console.log(`  [skip] AppSettings — aiApiKey already encrypted`)
    }

    if (settings.recaptchaSecretKey && !isEncrypted(settings.recaptchaSecretKey)) {
      updates.recaptchaSecretKey = encrypt(settings.recaptchaSecretKey)
      console.log(`  [done] AppSettings — recaptchaSecretKey encrypted`)
    } else if (settings.recaptchaSecretKey) {
      console.log(`  [skip] AppSettings — recaptchaSecretKey already encrypted`)
    }

    if (Object.keys(updates).length > 0) {
      await prisma.appSettings.update({ where: { id: 'singleton' }, data: updates })
    }
  } else {
    console.log('  [skip] No AppSettings found')
  }

  console.log(`\nDone! Encrypted ${encryptedAccounts} email account password(s).`)
}

main()
  .catch((err) => {
    console.error('Migration error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

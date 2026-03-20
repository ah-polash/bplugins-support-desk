/**
 * Email Sync Worker
 * Run with: npx tsx workers/email-sync.ts
 * Or via PM2: pm2 start workers/email-sync.ts --interpreter tsx
 *
 * Also runs auto-close checks once per hour.
 */
import { PrismaClient } from '@prisma/client'
import { syncEmailAccount } from '../lib/imap'
import { runAutoClose } from '../lib/auto-close'

const prisma = new PrismaClient()

let lastAutoCloseRun = 0
const AUTO_CLOSE_INTERVAL = 60 * 60 * 1000 // once per hour

async function run() {
  console.log(`[${new Date().toISOString()}] Starting email sync...`)
  try {
    const accounts = await prisma.emailAccount.findMany({ where: { isActive: true } })
    if (!accounts.length) {
      console.log('No active email accounts found.')
      return
    }
    for (const account of accounts) {
      console.log(`Syncing: ${account.email}`)
      await syncEmailAccount(account.id)
      console.log(`Done: ${account.email}`)
    }
  } catch (err) {
    console.error('Sync error:', err)
  }

  // Run auto-close check once per hour
  const now = Date.now()
  if (now - lastAutoCloseRun >= AUTO_CLOSE_INTERVAL) {
    lastAutoCloseRun = now
    try {
      console.log(`[${new Date().toISOString()}] Running auto-close check...`)
      const result = await runAutoClose()
      if (result.closed > 0) {
        console.log(`[auto-close] Closed ${result.closed} ticket(s), emailed ${result.emailed}, errors ${result.errors}`)
      }
    } catch (err) {
      console.error('[auto-close] Error:', err)
    }
  }
}

async function loop() {
  await run()
  setTimeout(loop, 60 * 1000) // every 60 seconds
}

console.log('Email sync worker started.')
loop().catch(console.error)

process.on('SIGINT', async () => {
  console.log('Shutting down...')
  await prisma.$disconnect()
  process.exit(0)
})

import { prisma } from './db'
import { syncEmailAccount } from './imap'

const SYNC_INTERVAL_MS = 60 * 1000 // 60 seconds

let started = false

export function startEmailSyncLoop() {
  if (started) return
  started = true

  console.log('[email-sync] Background sync started (every 60s)')

  async function run() {
    try {
      const accounts = await prisma.emailAccount.findMany({ where: { isActive: true } })
      if (accounts.length === 0) return

      for (const account of accounts) {
        try {
          await syncEmailAccount(account.id)
          console.log(`[email-sync] Synced: ${account.email}`)
        } catch (err) {
          console.error(`[email-sync] Error syncing ${account.email}:`, err)
        }
      }
    } catch (err) {
      console.error('[email-sync] DB error:', err)
    }
  }

  // Run immediately on startup, then every 60s
  run()
  setInterval(run, SYNC_INTERVAL_MS)
}

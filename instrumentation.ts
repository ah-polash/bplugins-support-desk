/**
 * Next.js Instrumentation Hook
 * Runs once on server startup — starts the background email sync loop.
 * No separate worker process needed.
 */
export async function register() {
  // Only run in Node.js runtime (not Edge), and only on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startEmailSyncLoop } = await import('./lib/email-sync-loop')
    startEmailSyncLoop()
  }
}

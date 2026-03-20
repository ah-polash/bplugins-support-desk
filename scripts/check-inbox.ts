import { ImapFlow } from 'imapflow'
import { prisma } from '../lib/db'

async function main() {
  const a = await prisma.emailAccount.findFirst({ where: { isActive: true } })
  await prisma.$disconnect()
  if (!a) { console.log('No account'); return }

  const client = new ImapFlow({
    host: a.imapHost, port: a.imapPort, secure: a.imapSecure,
    auth: { user: a.username, pass: a.password },
    logger: false, connectionTimeout: 30000,
  })
  client.on('error', (e: Error) => console.error('Error:', e.message))
  await client.connect()

  const lock = await client.getMailboxLock('INBOX')
  try {
    const status = await client.status('INBOX', { messages: true, unseen: true })
    console.log('INBOX:', status)

    // List all messages regardless of date
    let count = 0
    for await (const msg of client.fetch('1:*', { envelope: true, uid: true })) {
      count++
      console.log(`[${msg.uid}] From: ${msg.envelope?.from?.[0]?.address} | Subject: ${msg.envelope?.subject} | Date: ${msg.envelope?.date}`)
    }
    if (count === 0) console.log('INBOX is empty - no messages found')
  } finally {
    lock.release()
  }
  await client.logout()
}
main().catch(console.error)

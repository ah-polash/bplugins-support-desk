/**
 * Freshdesk Backup Import Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Imports a .ndjson backup file (created by export-freshdesk.ts) into the DB.
 * No Freshdesk API calls — works entirely from the local file.
 *
 * Usage:
 *   npm run freshdesk:import -- freshdesk-backup-YYYY-MM-DD.ndjson
 *
 * Options (env vars):
 *   EMAIL_ACCOUNT_ID=<id>   Target inbox (required — get from DB or app UI)
 *   ASSIGNEE_ID=<id>        Assign to this user (optional)
 *   OVERRIDE_EXISTING=true  Re-import tickets that already exist (default: false)
 *
 * Example:
 *   EMAIL_ACCOUNT_ID=clxxx npx tsx scripts/import-freshdesk-backup.ts freshdesk-backup-2026-03-13.ndjson
 */

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import * as dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import type { TicketStatus, Priority } from '@prisma/client'

dotenv.config({ path: path.join(__dirname, '../.env') })

const prisma = new PrismaClient()

const EMAIL_ACCOUNT_ID  = process.env.EMAIL_ACCOUNT_ID || ''
const ASSIGNEE_ID       = process.env.ASSIGNEE_ID || ''
const OVERRIDE_EXISTING = process.env.OVERRIDE_EXISTING === 'true'

function mapStatus(s: number): TicketStatus {
  if (s === 3) return 'PENDING'
  if (s === 4) return 'RESOLVED'
  if (s === 5) return 'CLOSED'
  return 'OPEN'
}

function mapPriority(p: number): Priority {
  if (p === 1) return 'LOW'
  if (p === 3) return 'HIGH'
  if (p === 4) return 'URGENT'
  return 'MEDIUM'
}

async function main() {
  const inputFile = process.argv[2]
  if (!inputFile) {
    console.error('Usage: npm run freshdesk:import -- <backup-file.ndjson>')
    process.exit(1)
  }

  const filePath = path.isAbsolute(inputFile) ? inputFile : path.join(process.cwd(), inputFile)
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  if (!EMAIL_ACCOUNT_ID) {
    // Try to find the first active account
    const account = await prisma.emailAccount.findFirst({ where: { isActive: true } })
    if (!account) {
      console.error('ERROR: Set EMAIL_ACCOUNT_ID env var (or ensure an active email account exists)')
      await prisma.$disconnect()
      process.exit(1)
    }
    console.log(`Using email account: ${account.name} (${account.email})`)
    process.env.EMAIL_ACCOUNT_ID = account.id
  }

  const accountId = process.env.EMAIL_ACCOUNT_ID!
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } })
  if (!account) {
    console.error(`Email account not found: ${accountId}`)
    await prisma.$disconnect()
    process.exit(1)
  }

  console.log(`Freshdesk Backup Import`)
  console.log(`File:     ${filePath}`)
  console.log(`Account:  ${account.name} (${account.email})`)
  console.log(`Override: ${OVERRIDE_EXISTING}`)
  console.log()

  const rl = readline.createInterface({ input: fs.createReadStream(filePath, 'utf8'), crlfDelay: Infinity })

  let total = 0, imported = 0, skipped = 0, errors = 0

  for await (const line of rl) {
    if (!line.trim()) continue
    total++

    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      console.error(`Line ${total}: invalid JSON, skipping`)
      errors++
      continue
    }

    const externalId = `freshdesk-${record.freshdeskId}`
    const fromEmail  = (record.fromEmail as string).toLowerCase()
    const fromName   = (record.fromName as string | null) ?? null
    const status     = mapStatus(record.status as number)
    const priority   = mapPriority(record.priority as number)
    const tags       = Array.isArray(record.tags) ? record.tags as string[] : []
    const createdAt  = record.createdAt ? new Date(record.createdAt as string) : new Date()
    const resolvedRaw = (record.resolvedAt || record.closedAt) as string | null
    const resolvedAt  = resolvedRaw ? new Date(resolvedRaw) : (['RESOLVED', 'CLOSED'].includes(status) ? new Date() : null)

    try {
      // Check for existing ticket
      const existing = await prisma.ticket.findUnique({ where: { messageId: externalId } })

      if (existing && !OVERRIDE_EXISTING) {
        skipped++
        process.stdout.write(`\r  ${imported} imported, ${skipped} skipped, ${errors} errors`)
        continue
      }

      // Upsert contact
      let contactId: string | null = null
      try {
        const contact = await prisma.contact.upsert({
          where:  { email: fromEmail },
          update: { name: fromName || undefined, phone: (record.phone as string) || undefined },
          create: { email: fromEmail, name: fromName, phone: (record.phone as string) || null },
        })
        contactId = contact.id
      } catch { /* ignore contact errors */ }

      let ticketId: string

      if (existing && OVERRIDE_EXISTING) {
        // Update existing ticket and replace messages
        await prisma.ticket.update({
          where: { id: existing.id },
          data: { subject: record.subject as string, status, priority, fromEmail, fromName, tags, resolvedAt, contactId },
        })
        await prisma.message.deleteMany({ where: { ticketId: existing.id } })
        if (ASSIGNEE_ID) await prisma.ticketAssignee.deleteMany({ where: { ticketId: existing.id } })
        ticketId = existing.id
      } else {
        const ticket = await prisma.ticket.create({
          data: {
            subject:       record.subject as string,
            status,
            priority,
            fromEmail,
            fromName,
            messageId:     externalId,
            tags,
            emailAccountId: accountId,
            importSource:  'freshdesk-api',
            contactId,
            createdAt,
            resolvedAt,
          },
        })
        ticketId = ticket.id
      }

      // Create first message (ticket description)
      if (record.descriptionText || record.descriptionHtml) {
        await prisma.message.create({
          data: {
            ticketId,
            body:       (record.descriptionText as string) || '',
            htmlBody:   (record.descriptionHtml as string) || null,
            fromEmail,
            fromName,
            isIncoming: true,
            createdAt,
          },
        })
      }

      // Create conversation messages (skip private notes)
      const conversations = (record.conversations as Array<Record<string, unknown>>) ?? []
      for (const conv of conversations) {
        if (conv.isPrivate) continue
        await prisma.message.create({
          data: {
            ticketId,
            body:       (conv.body as string) ?? '',
            htmlBody:   (conv.htmlBody as string) ?? null,
            fromEmail:  (conv.fromEmail as string) ?? (conv.isIncoming ? fromEmail : 'support@unknown.com'),
            fromName:   null,
            isIncoming: !!conv.isIncoming,
            createdAt:  conv.createdAt ? new Date(conv.createdAt as string) : new Date(),
          },
        })
      }

      // Assign if requested
      if (ASSIGNEE_ID) {
        await prisma.ticketAssignee.upsert({
          where:  { ticketId_userId: { ticketId, userId: ASSIGNEE_ID } },
          update: {},
          create: { ticketId, userId: ASSIGNEE_ID },
        })
      }

      imported++
      process.stdout.write(`\r  ${imported} imported, ${skipped} skipped, ${errors} errors`)
    } catch (err) {
      errors++
      console.error(`\n  Error on ticket ${record.freshdeskId}: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log()
  console.log()
  console.log(`✓ Import complete!`)
  console.log(`  Total in file:  ${total}`)
  console.log(`  Imported:       ${imported}`)
  console.log(`  Skipped:        ${skipped} (already existed)`)
  console.log(`  Errors:         ${errors}`)
  console.log()
  if (skipped > 0 && !OVERRIDE_EXISTING) {
    console.log('Tip: Re-run with OVERRIDE_EXISTING=true to re-import skipped tickets.')
  }

  await prisma.$disconnect()
}

main().catch(async err => {
  console.error('Import failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})

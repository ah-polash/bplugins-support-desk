import { prisma } from './db'

export type SpamRuleType =
  | 'subject_keyword'   // subject contains this word/phrase
  | 'sender_domain'     // sender email domain matches
  | 'sender_email'      // exact sender email match
  | 'body_keyword'      // message body contains this word/phrase
  | 'sender_name'       // sender display name contains this pattern

export const SPAM_RULE_TYPES: { value: SpamRuleType; label: string; description: string }[] = [
  { value: 'subject_keyword', label: 'Subject keyword',  description: 'Flag if subject contains this word or phrase' },
  { value: 'sender_domain',   label: 'Blocked domain',   description: 'Flag all email from this domain (e.g. spam.com)' },
  { value: 'sender_email',    label: 'Blocked email',    description: 'Flag this exact sender email address' },
  { value: 'body_keyword',    label: 'Body keyword',     description: 'Flag if message body contains this word or phrase' },
  { value: 'sender_name',     label: 'Sender name',      description: 'Flag if sender display name contains this pattern' },
]

export interface SpamRuleRecord {
  id: string
  type: SpamRuleType
  value: string
  isActive: boolean
  createdAt: Date
}

export async function getActiveSpamRules(): Promise<SpamRuleRecord[]> {
  const rules = await prisma.spamRule.findMany({ where: { isActive: true } })
  return rules as SpamRuleRecord[]
}

export interface SpamCheckResult {
  isSpam: boolean
  ruleId?: string
  ruleType?: SpamRuleType
  ruleValue?: string
}

export function checkIsSpam(
  rules: SpamRuleRecord[],
  subject: string,
  fromEmail: string,
  fromName: string | null | undefined,
  body: string
): SpamCheckResult {
  const subjectLower = (subject ?? '').toLowerCase()
  const emailLower = (fromEmail ?? '').toLowerCase()
  const nameLower = (fromName ?? '').toLowerCase()
  const bodyLower = (body ?? '').toLowerCase()
  const domain = emailLower.split('@')[1] ?? ''

  for (const rule of rules) {
    const val = rule.value.toLowerCase().trim()
    if (!val) continue

    let matched = false
    switch (rule.type) {
      case 'subject_keyword':
        matched = subjectLower.includes(val)
        break
      case 'sender_domain':
        matched = domain === val || domain.endsWith('.' + val)
        break
      case 'sender_email':
        matched = emailLower === val
        break
      case 'body_keyword':
        matched = bodyLower.includes(val)
        break
      case 'sender_name':
        matched = nameLower.includes(val)
        break
    }

    if (matched) {
      return { isSpam: true, ruleId: rule.id, ruleType: rule.type, ruleValue: rule.value }
    }
  }

  return { isSpam: false }
}

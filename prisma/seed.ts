import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: 'admin@bplugins.com' } })
  if (existing) {
    console.log('Seed already applied.')
    return
  }

  const hashed = await bcrypt.hash('admin123', 10)
  await prisma.user.create({
    data: {
      name: 'Support Admin',
      email: 'admin@bplugins.com',
      password: hashed,
      role: 'SUPPORT_ADMIN',
    },
  })
  console.log('Admin user created: admin@bplugins.com / admin123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

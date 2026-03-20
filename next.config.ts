import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['imapflow', 'nodemailer', 'mailparser', 'bcryptjs'],
}

export default nextConfig

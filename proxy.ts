import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: { signIn: '/login' },
})

export const config = {
  matcher: [
    '/inbox/:path*',
    '/tickets/:path*',
    '/others',
    '/others/:path*',
    '/admin/:path*',
    '/profile',
    '/profile/:path*',
    '/reports',
    '/reports/:path*',
  ],
}

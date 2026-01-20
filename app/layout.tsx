import type { Metadata } from 'next'
import { Space_Mono, DM_Serif_Display } from 'next/font/google'
import './globals.css'

const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-mono',
})

const dmSerif = DM_Serif_Display({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-serif',
})

export const metadata: Metadata = {
  title: 'Paper Mill — PDF Merger',
  description: 'Merge up to 5 PDFs instantly. No uploads, no watermarks.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${spaceMono.variable} ${dmSerif.variable}`}>
      <body>{children}</body>
    </html>
  )
}

import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from 'next/font/google';
import './globals.css';

/**
 * Three faces, three jobs. See docs/DESIGN.md.
 *
 * Numbers get their own face because numbers are the content here — a figure in
 * Plex Mono reads as *a measurement* the instant you see it.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FitCoach',
  description:
    'A fat-loss coach built around your food, your budget and the time you actually have.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f5f0' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1113' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} ${plexMono.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:px-4 focus:py-2"
          style={{ background: 'var(--surface)', color: 'var(--fg)' }}
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}

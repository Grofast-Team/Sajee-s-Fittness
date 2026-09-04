import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * One family, two jobs. See docs/DESIGN.md.
 *
 * Inter carries both the headings (tight tracking, heavier optical weight) and
 * the body. Numbers get tabular figures rather than a separate monospace face:
 * a second and third font download is real time on a slow connection, and the
 * mono only ever bought a texture the interface does not need.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'FitCoach',
  description:
    'A fat-loss coach built around your food, your budget and the time you actually have.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2 focus:shadow-lg"
          style={{ background: 'var(--surface)', color: 'var(--fg)' }}
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}

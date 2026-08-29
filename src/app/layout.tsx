import type { Metadata, Viewport } from 'next';
import { Inter, Lora } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const lora = Lora({ subsets: ['latin'], variable: '--font-lora', display: 'swap' });

export const metadata: Metadata = {
  title: 'FitCoach — your plan, your life',
  description:
    'A personalised fat-loss coach that works around your food, your budget and your schedule.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately not maximum-scale=1: blocking zoom is an accessibility failure.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7fbfc' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1416' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2"
          style={{ background: 'var(--surface)', color: 'var(--fg)' }}
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}

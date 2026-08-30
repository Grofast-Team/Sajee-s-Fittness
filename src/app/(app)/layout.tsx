import Link from 'next/link';
import { Settings } from 'lucide-react';
import { BottomNav } from '@/components/bottom-nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      {/* Settings deliberately lives here rather than in the bottom bar: five
          destinations is the practical ceiling before targets get too narrow to
          hit, and settings is a rare visit compared to the daily five. */}
      <div className="flex justify-end px-4 pt-3">
        <Link
          href="/settings"
          aria-label="Settings"
          className="flex size-11 items-center justify-center rounded-xl transition-colors duration-200"
          style={{ color: 'var(--fg-subtle)' }}
        >
          <Settings size={20} aria-hidden />
        </Link>
      </div>

      <main id="main" className="px-4 pb-8">
        {children}
      </main>

      <BottomNav />
    </div>
  );
}

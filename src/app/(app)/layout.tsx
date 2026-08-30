import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Settings } from 'lucide-react';
import { BottomNav } from '@/components/bottom-nav';
import { needsOnboarding } from '@/lib/data/onboarding-state';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A signed-in user with no plan has not finished setup. Showing them the
  // sample profile — someone else's numbers behind a warning banner — is worse
  // than useless: it looks like the app is broken. Send them to finish instead.
  if (await needsOnboarding()) {
    redirect('/onboarding');
  }

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

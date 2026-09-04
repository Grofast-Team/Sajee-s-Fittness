import { redirect } from 'next/navigation';
import { BottomNav, MobileHeader, Sidebar } from '@/components/app-nav';
import { needsOnboarding } from '@/lib/data/onboarding-state';

/**
 * The application shell.
 *
 * One layout, three shapes. Below 1024px the navigation is a bottom bar with a
 * compact header above the content; from 1024px the bar is replaced by a
 * sidebar. They are never both on screen — two navigations competing is how a
 * responsive app ends up feeling like two apps stitched together.
 *
 * The content column stops at 1280px so text does not stretch into an
 * unreadable line on a 1920px monitor.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A signed-in user with no plan has not finished setup. Showing them the
  // sample profile — someone else's numbers behind a warning banner — is worse
  // than useless: it looks like the app is broken. Send them to finish instead.
  if (await needsOnboarding()) {
    redirect('/onboarding');
  }

  return (
    <div className="min-h-dvh">
      <Sidebar />

      <div className="lg:pl-(--sidebar-w)">
        <MobileHeader />

        <main id="main" className="gutter has-bottom-nav">
          <div className="content-max">{children}</div>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

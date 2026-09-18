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
  // The only thing required before reaching the app at all is the minimal
  // signup step - a name, nothing else. Fitness, Money and every other
  // category are opt-in from Profile, not gated here.
  //
  // Known transitional condition, accepted deliberately: until the Fitness
  // route-group guard in (app)/(fitness)/layout.tsx ships (design spec
  // section 4, a later phase), a user who reaches this point without ever
  // running the Fitness interview can still open /today with no active
  // plan. That guard is the fix - not a check added here - so this gap is
  // accepted as temporary rather than patched in two places that would then
  // both be responsible for the same question.
  if (await needsOnboarding()) {
    redirect('/onboarding-name');
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

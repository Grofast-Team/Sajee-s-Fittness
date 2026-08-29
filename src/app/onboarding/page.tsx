import { Onboarding } from '@/components/onboarding';

export const metadata = { title: 'Set up — FitCoach' };

export default function OnboardingPage() {
  return (
    <main id="main" className="mx-auto min-h-dvh max-w-lg px-4 py-6">
      <Onboarding />
    </main>
  );
}

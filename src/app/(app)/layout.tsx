import { BottomNav } from '@/components/bottom-nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <main id="main" className="px-4 pb-8 pt-5">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

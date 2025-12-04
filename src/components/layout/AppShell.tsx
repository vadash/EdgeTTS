import type { ComponentChildren } from 'preact';
import { Header } from './Header';
import { BottomNav } from './BottomNav';

interface AppShellProps {
  children: ComponentChildren;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-primary text-white flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col pb-20 md:pb-0">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

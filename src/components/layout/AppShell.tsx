import type { ComponentChildren } from 'preact';
import { BottomNav } from './BottomNav';
import { Header } from './Header';

interface AppShellProps {
  children: ComponentChildren;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="h-screen bg-primary text-white flex flex-col overflow-hidden">
      <Header />
      <main className="flex-1 flex flex-col pb-20 md:pb-0 min-h-0 overflow-hidden">{children}</main>
      <BottomNav />
    </div>
  );
}

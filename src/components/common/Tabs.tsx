import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export interface Tab {
  id: string;
  label: string;
  icon?: string;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  children: (activeTab: string) => ComponentChildren;
}

export function Tabs({ tabs, defaultTab, children }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || '');

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  return (
    <div className="flex flex-col h-full">
      <div className="tabs-list">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab-trigger ${activeTab === tab.id ? 'tab-trigger-active' : ''}`}
          >
            {tab.icon && <span className="mr-2">{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-content">{children(activeTab)}</div>
    </div>
  );
}

interface TabPanelProps {
  id: string;
  activeTab: string;
  children: ComponentChildren;
}

export function TabPanel({ id, activeTab, children }: TabPanelProps) {
  if (id !== activeTab) return null;
  return <div className="h-full">{children}</div>;
}

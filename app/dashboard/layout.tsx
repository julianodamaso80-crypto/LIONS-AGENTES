'use client';

import { useState, useEffect } from 'react';
import { TermsAcceptanceModal } from '@/components/TermsAcceptanceModal';

interface ActiveTerms {
  id: string;
  title: string;
  content: string;
  version: string;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [termsOutdated, setTermsOutdated] = useState(false);
  const [activeTerms, setActiveTerms] = useState<ActiveTerms | null>(null);

  useEffect(() => {
    const checkTerms = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.termsOutdated && data.activeTerms) {
            setTermsOutdated(true);
            setActiveTerms(data.activeTerms);
          }
        }
      } catch (error) {
        console.error('Error checking terms:', error);
      }
    };
    checkTerms();
  }, []);

  return (
    <div className="min-h-screen bg-[#2f2f2f]">
      {children}
      {termsOutdated && activeTerms && (
        <TermsAcceptanceModal
          activeTerms={activeTerms}
          onAccepted={() => setTermsOutdated(false)}
        />
      )}
    </div>
  );
}

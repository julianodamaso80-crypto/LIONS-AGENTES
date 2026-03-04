'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { HeroSection } from '@/components/HeroSection';
import Script from 'next/script';

export default function LandingPage() {
  const { setTheme, theme } = useTheme();

  // Force dark mode on mount, restore on unmount
  useEffect(() => {
    const prev = theme;
    setTheme('dark');
    return () => {
      if (prev && prev !== 'dark') {
        setTheme(prev);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <HeroSection />
      <Script
        id="mw"
        src="https://smith-v2-theta.vercel.app/widget.js"
        strategy="afterInteractive"
        onLoad={() => {
          if ((window as any).mw) {
            (window as any).mw('init', { agentId: '652dcdcd-bffb-47cc-9486-7dfc3119e32c' });
          }
        }}
      />
    </>
  );
}

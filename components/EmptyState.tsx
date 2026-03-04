'use client';

import Image from 'next/image';

export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="flex flex-col items-center gap-6 max-w-2xl w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-2xl w-20 h-20 flex items-center justify-center overflow-hidden">
            <Image
              src="/smith-logo.png"
              alt="Smith AI Logo"
              width={80}
              height={80}
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-zinc-900 to-zinc-500 dark:from-white dark:to-gray-400 bg-clip-text text-transparent">
            Smith
          </h1>
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-2xl font-semibold text-foreground">Bem-vindo ao Smith</h2>
          <p className="text-lg text-muted-foreground">Seu assistente pessoal com IA</p>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { clearSession } from '@/lib/session';

export default function CompanySuspendedPage() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
      });

      clearSession();
      router.push('/login');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      clearSession();
      router.push('/login');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <div className="max-w-md w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center">
            <AlertCircle size={40} className="text-red-500" />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-white mb-4">Acesso Suspenso</h1>

        <p className="text-gray-300 mb-6 leading-relaxed">
          A assinatura da sua empresa está suspensa. Entre em contato com o administrador da sua
          empresa para mais informações.
        </p>

        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-300">
            O acesso será restabelecido assim que a situação for regularizada.
          </p>
        </div>

        <Button onClick={handleLogout} className="w-full bg-red-600 hover:bg-red-700 text-white">
          Sair
        </Button>
      </div>
    </div>
  );
}

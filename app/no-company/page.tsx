'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Building2 } from 'lucide-react';
import { clearSession } from '@/lib/session';

export default function NoCompanyPage() {
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
          <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center">
            <Building2 size={40} className="text-blue-500" />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-white mb-4">Empresa Não Vinculada</h1>

        <p className="text-gray-300 mb-6 leading-relaxed">
          Sua conta ainda não está vinculada a nenhuma empresa. Entre em contato com o suporte para
          vincular sua conta.
        </p>

        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-300">
            Entre em contato através do email: suporte@scale.ai
          </p>
        </div>

        <Button onClick={handleLogout} className="w-full bg-red-600 hover:bg-red-700 text-white">
          Sair
        </Button>
      </div>
    </div>
  );
}

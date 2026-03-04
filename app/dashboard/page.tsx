'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UnifiedSidebar } from '@/components/UnifiedSidebar';
import { useUserId } from '@/hooks/useUserId';

export default function DashboardPage() {
  const router = useRouter();
  const { userId } = useUserId();
  const [userName, setUserName] = useState('');

  useEffect(() => {
    // Buscar dados do usuário via API (cookie é enviado automaticamente)
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUserName(
            `${data.user.first_name || ''} ${data.user.last_name || ''}`.trim() || 'Usuário',
          );
        }
      })
      .catch((err) => console.error('Error fetching user:', err));
  }, []);

  return (
    <div className="flex min-h-screen text-white">
      {userId && <UnifiedSidebar userId={userId} />}

      <div className="flex-1 lg:ml-64">
        <div className="p-8">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl font-bold mb-4">Bem-vindo, {userName}!</h1>
            <p className="text-gray-400 mb-8">Sua conta está ativa e pronta para usar.</p>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-semibold mb-4">Recursos disponíveis:</h2>
              <ul className="space-y-2 text-gray-400">
                <li>✅ Chat com IA ilimitado</li>
                <li>✅ Mensagens de texto e voz</li>
                <li>✅ Histórico completo de conversas</li>
                <li>✅ Acesso a todas as funcionalidades</li>
              </ul>
            </div>

            <div className="mt-8">
              <button
                onClick={() => router.push('/dashboard/chat')}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Ir para o Chat
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

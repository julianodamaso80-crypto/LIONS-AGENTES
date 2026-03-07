'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, Mail } from 'lucide-react';
import Image from 'next/image';

export default function PendingApprovalPage() {
  const router = useRouter();

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="w-full max-w-lg px-4">
        <Card className="border-none shadow-lg bg-gray-900/50 backdrop-blur-sm">
          <CardHeader className="flex flex-col items-center space-y-4 pt-8 pb-6">
            <Image
              src="/scale-logo.png"
              alt="Scale AI Logo"
              width={64}
              height={64}
              className="w-16 h-16"
            />
            <div className="flex flex-col items-center space-y-2">
              <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <Clock className="w-8 h-8 text-yellow-400" />
              </div>
              <h1 className="text-2xl font-bold text-white">Aguardando Aprovação</h1>
              <p className="text-center text-gray-400 max-w-md">
                Sua conta foi criada com sucesso! Agora aguarde a aprovação do administrador da sua
                empresa para começar a usar o sistema.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 px-8 pb-8">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex gap-3">
              <Mail className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-400">Você receberá um email</p>
                <p className="text-xs text-gray-400">
                  Quando sua conta for aprovada, enviaremos um email de confirmação para você.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white">Próximos passos:</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-gray-400">
                <li>O administrador da empresa receberá uma notificação</li>
                <li>Sua solicitação será revisada e aprovada</li>
                <li>Você receberá um email quando for aprovado</li>
                <li>Faça login e comece a usar o sistema</li>
              </ol>
            </div>

            <div className="pt-4 space-y-3">
              <Button
                onClick={() => router.push('/login')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Ir para Login
              </Button>
              <Button
                onClick={() => router.push('/')}
                variant="outline"
                className="w-full bg-transparent border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                Voltar para Início
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

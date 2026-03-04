'use client';

import * as React from 'react';
import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mail, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SparklesCore } from '@/components/ui/sparkles';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao enviar código');
        setIsLoading(false);
        return;
      }

      setSuccess(true);

      // Redirect to reset-password page after 2 seconds
      setTimeout(() => {
        router.push(`/reset-password?email=${encodeURIComponent(email)}`);
      }, 2000);
    } catch (err) {
      console.error('Forgot password error:', err);
      setError('Erro ao conectar com o servidor');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-black relative overflow-hidden">
      <div className="fixed inset-0 w-full h-full z-0">
        <SparklesCore
          id="forgot-sparkles"
          background="transparent"
          minSize={0.4}
          maxSize={1}
          particleDensity={60}
          className="w-full h-full"
          particleColor="#3B82F6"
          speed={0.5}
        />
      </div>

      <div className="w-full max-w-md px-4 relative z-10">
        <Card className="border-none shadow-lg bg-gray-900/50 backdrop-blur-sm">
          <CardHeader className="flex flex-col items-center space-y-1.5 pb-4 pt-6">
            <button
              onClick={() => router.push('/login')}
              className="cursor-pointer hover:opacity-80 transition-opacity"
              type="button"
            >
              <Image
                src="/smith-logo.png"
                alt="Smith Logo"
                width={48}
                height={48}
                className="mb-2"
              />
            </button>
            <h2 className="text-xl font-medium text-gray-200">Recuperar Senha</h2>
            <p className="text-sm text-gray-400 text-center">
              Informe seu email para receber o código de recuperação
            </p>
          </CardHeader>

          <CardContent className="pb-6">
            {success ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Mail className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-lg font-medium text-green-400 mb-2">Código Enviado!</h3>
                <p className="text-gray-400 text-sm">
                  Verifique seu email e use o código para redefinir sua senha.
                </p>
                <p className="text-gray-500 text-xs mt-4">Redirecionando...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-400">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-gray-800/50 border-gray-700 text-white placeholder:text-gray-500"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || !email}
                  className="w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    'Enviar Código'
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => router.push('/login')}
                  className="w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mt-4"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Voltar para o login
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

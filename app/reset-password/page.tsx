'use client';

import * as React from 'react';
import { useState, useEffect, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SparklesCore } from '@/components/ui/sparkles';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailFromUrl = searchParams.get('email') || '';

  const [email, setEmail] = useState(emailFromUrl);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [userType, setUserType] = useState<'admin' | 'member' | null>(null);

  useEffect(() => {
    if (emailFromUrl) {
      setEmail(emailFromUrl);
    }
  }, [emailFromUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validations
    if (!email || !code || !newPassword || !confirmPassword) {
      setError('Preencha todos os campos');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('As senhas não conferem');
      return;
    }

    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao redefinir senha');
        setIsLoading(false);
        return;
      }

      setSuccess(true);
      setUserType(data.userType || 'member');

      // Redirect based on user type after 3 seconds
      setTimeout(() => {
        if (data.userType === 'admin') {
          router.push('/admin/login');
        } else {
          router.push('/login');
        }
      }, 3000);
    } catch (err) {
      console.error('Reset password error:', err);
      setError('Erro ao conectar com o servidor');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-black relative overflow-hidden">
      <div className="fixed inset-0 w-full h-full z-0">
        <SparklesCore
          id="reset-sparkles"
          background="transparent"
          minSize={0.4}
          maxSize={1}
          particleDensity={60}
          className="w-full h-full"
          particleColor="#10b981"
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
            <h2 className="text-xl font-medium text-gray-200">Redefinir Senha</h2>
            <p className="text-sm text-gray-400 text-center">
              Digite o código recebido por email e sua nova senha
            </p>
          </CardHeader>

          <CardContent className="pb-6">
            {success ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-lg font-medium text-green-400 mb-2">Senha Alterada!</h3>
                <p className="text-gray-400 text-sm">Sua senha foi redefinida com sucesso.</p>
                <p className="text-gray-500 text-xs mt-4">
                  Redirecionando para o login {userType === 'admin' ? 'administrativo' : ''}...
                </p>
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

                <div className="space-y-2">
                  <Label htmlFor="code" className="text-gray-400">
                    Código de Verificação
                  </Label>
                  <Input
                    id="code"
                    type="text"
                    placeholder="ABC12345"
                    value={code}
                    onChange={(e) =>
                      setCode(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '')
                          .slice(0, 8),
                      )
                    }
                    required
                    maxLength={8}
                    className="bg-gray-800/50 border-gray-700 text-white placeholder:text-gray-500 text-center text-xl tracking-widest font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-gray-400">
                    Nova Senha
                  </Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Mínimo 6 caracteres"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      className="bg-gray-800/50 border-gray-700 text-white placeholder:text-gray-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-gray-400">
                    Confirmar Nova Senha
                  </Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Repita a nova senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="bg-gray-800/50 border-gray-700 text-white placeholder:text-gray-500"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || !email || !code || !newPassword || !confirmPassword}
                  className="w-full bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Redefinindo...
                    </>
                  ) : (
                    'Redefinir Senha'
                  )}
                </Button>

                <div className="flex justify-between mt-4">
                  <button
                    type="button"
                    onClick={() => router.push('/forgot-password')}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Reenviar código
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/login')}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Voltar para o login
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-black">
          <Loader2 className="w-8 h-8 animate-spin text-green-500" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}

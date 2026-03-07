'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, Eye, EyeOff } from 'lucide-react';
import { SparklesCore } from '@/components/ui/sparkles';
import { createAdminSession } from '@/lib/adminSession';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao fazer login');
        setLoading(false);
        return;
      }

      createAdminSession(data.admin); // Mantém o localStorage (backup)

      // Força recarregamento real da página para garantir envio dos cookies
      window.location.href = '/admin';
    } catch (err) {
      console.error('[ADMIN LOGIN] Login error:', err);
      setError('Erro ao processar login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0A0A0A] relative flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 w-full h-full">
        <SparklesCore
          id="admin-sparkles"
          background="transparent"
          minSize={0.4}
          maxSize={1}
          particleDensity={50}
          className="w-full h-full"
          particleColor="#3B82F6"
        />
      </div>

      <div className="relative z-10 w-full max-w-md px-4">
        <Card className="border-[#2D2D2D] bg-[#1A1A1A]/80 backdrop-blur-xl">
          <CardHeader className="space-y-6 pb-6">
            <div className="flex justify-center">
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse"></div>
                <div className="relative w-24 h-24 rounded-full flex items-center justify-center overflow-hidden border-2 border-blue-500/30">
                  <Image
                    src="/scale-logo.png"
                    alt="Scale AI Logo"
                    fill
                    className="object-cover"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-bold text-white tracking-tight">
                Agent Scale AI <span className="text-blue-500">v6.1</span>
              </h1>
              <p className="text-lg font-medium text-blue-400">Painel Administrativo</p>
              <p className="text-sm text-gray-400">Acesso exclusivo para administradores</p>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-200">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@exemplo.com"
                  required
                  disabled={loading}
                  className="bg-[#2D2D2D] border-[#3D3D3D] text-white placeholder:text-gray-500 focus:border-blue-500 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-200">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    disabled={loading}
                    className="bg-[#2D2D2D] border-[#3D3D3D] text-white placeholder:text-gray-500 focus:border-blue-500 pr-10 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <a
                  href="/forgot-password"
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Esqueceu a senha?
                </a>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-medium shadow-lg shadow-blue-900/20 border border-blue-500/20"
              >
                {loading ? 'Entrando...' : 'Entrar como Admin'}
              </Button>
            </form>
          </CardContent>

          <CardFooter>
            <p className="text-xs text-gray-500 text-center w-full">
              Área restrita - Acesso apenas para administradores autorizados
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

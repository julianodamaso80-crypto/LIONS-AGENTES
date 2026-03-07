'use client';

import * as React from 'react';
import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { SparklesCore } from '@/components/ui/sparkles';

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao fazer login');
        setIsLoading(false);
        return;
      }

      if (data.session) {
        localStorage.setItem('scale_user_session', JSON.stringify(data.session));
      }

      router.push('/dashboard/chat');
    } catch (err) {
      console.error('Login error:', err);
      setError('Erro ao conectar com o servidor');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-black relative overflow-hidden">
      <div className="fixed inset-0 w-full h-full z-0">
        <SparklesCore
          id="login-sparkles"
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
        <Card className="border-none shadow-lg pb-0 bg-gray-900/50 backdrop-blur-sm">
          <CardHeader className="flex flex-col items-center space-y-1.5 pb-4 pt-6">
            <button
              onClick={() => router.push('/landing')}
              className="cursor-pointer hover:opacity-80 transition-opacity"
              type="button"
            >
              <Image
                src="/scale-logo.png"
                alt="Scale AI Logo"
                width={48}
                height={48}
                className="w-12 h-12"
              />
            </button>
            <div className="space-y-0.5 flex flex-col items-center">
              <h2 className="text-2xl font-semibold text-white">Bem-vindo de volta</h2>
              <p className="text-gray-400">Entre para acessar sua conta</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-8">
            <form onSubmit={handleSubmit}>
              <div className="space-y-2 mb-4">
                <Label htmlFor="email" className="text-white">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="seu@email.com"
                  className="bg-gray-800/50 border-gray-700 text-white"
                  required
                />
              </div>

              <div className="space-y-2 mb-4">
                <Label htmlFor="password" className="text-white">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••"
                    className="pr-10 bg-gray-800/50 border-gray-700 text-white"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 text-gray-400 hover:bg-transparent hover:text-white"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {error && (
                <div className="p-3 mb-4 bg-red-500/10 border border-red-500/50 rounded-lg">
                  <p className="text-red-400 text-sm font-semibold">{error}</p>
                </div>
              )}

              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="remember"
                    checked={formData.rememberMe}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, rememberMe: checked as boolean })
                    }
                    className="border-gray-600"
                  />
                  <label htmlFor="remember" className="text-sm text-gray-400">
                    Lembrar-me
                  </label>
                </div>
                <a href="/forgot-password" className="text-sm text-blue-400 hover:underline">
                  Esqueceu a senha?
                </a>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex justify-center border-t border-gray-800 !py-4">
            <p className="text-center text-sm text-gray-400">
              Ainda não tem conta?{' '}
              <a href="/register" className="text-blue-400 hover:underline">
                Criar conta gratuita
              </a>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

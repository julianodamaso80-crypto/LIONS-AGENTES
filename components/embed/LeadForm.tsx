'use client';

import { useState } from 'react';
import { Send, User, Mail } from 'lucide-react';

interface LeadFormProps {
  onSubmit: (data: { name: string; email: string }) => Promise<void>;
  isLoading: boolean;
  agentName?: string;
  primaryColor?: string;
}

export function LeadForm({
  onSubmit,
  isLoading,
  agentName,
  primaryColor = '#2563EB',
}: LeadFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});

  const validate = () => {
    const newErrors: { name?: string; email?: string } = {};

    if (!name.trim()) {
      newErrors.name = 'Nome é obrigatório';
    }

    if (!email.trim()) {
      newErrors.email = 'E-mail é obrigatório';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'E-mail inválido';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      await onSubmit({ name: name.trim(), email: email.trim().toLowerCase() });
    }
  };

  return (
    <div className="flex items-center justify-center h-full p-6 bg-gradient-to-b from-gray-50 to-white">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <div
            className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <span className="text-3xl">👋</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Olá! Bem-vindo</h2>
          <p className="text-sm text-gray-500">
            {agentName
              ? `Identifique-se para conversar com ${agentName}`
              : 'Identifique-se para iniciarmos o atendimento'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nome */}
          <div>
            <label htmlFor="lead-name" className="block text-sm font-medium text-gray-700 mb-1.5">
              Seu Nome
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-4 w-4 text-gray-400" />
              </div>
              <input
                id="lead-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                }}
                placeholder="Como prefere ser chamado?"
                className={`block w-full pl-10 pr-3 py-2.5 text-sm rounded-xl border bg-white text-gray-900 ${errors.name
                    ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                    : 'border-gray-200 focus:ring-blue-500 focus:border-blue-500'
                  } placeholder-gray-400 focus:outline-none focus:ring-2 transition-all`}
                disabled={isLoading}
              />
            </div>
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="lead-email" className="block text-sm font-medium text-gray-700 mb-1.5">
              Seu E-mail
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-gray-400" />
              </div>
              <input
                id="lead-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                placeholder="seu@email.com"
                className={`block w-full pl-10 pr-3 py-2.5 text-sm rounded-xl border bg-white text-gray-900 ${errors.email
                    ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                    : 'border-gray-200 focus:ring-blue-500 focus:border-blue-500'
                  } placeholder-gray-400 focus:outline-none focus:ring-2 transition-all`}
                disabled={isLoading}
              />
            </div>
            {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-white rounded-xl transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: primaryColor }}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Iniciando...
              </>
            ) : (
              <>
                Iniciar Conversa
                <Send className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Suas informações são usadas apenas para personalizar o atendimento
        </p>
      </div>
    </div>
  );
}

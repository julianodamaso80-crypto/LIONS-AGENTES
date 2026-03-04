'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ShoppingBag, CreditCard, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UCPCheckoutData {
  type: 'ucp_checkout';
  provider: string;
  shop_domain: string;
  checkout_url: string;
  cart_id?: string;
  line_items?: Array<{
    product_title: string;
    variant_title: string;
    quantity: number;
    price: { amount: string; currency: string };
  }>;
  total?: { amount: string; currency: string };
  action_text?: string;
}

interface CheckoutButtonProps {
  data: UCPCheckoutData;
}

function formatPrice(price: { amount: string; currency: string }): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: price.currency || 'BRL',
  }).format(parseFloat(price.amount));
}

export function CheckoutButton({ data }: CheckoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleCheckout = () => {
    setIsLoading(true);
    if (data.checkout_url) window.open(data.checkout_url, '_blank');
    setTimeout(() => setIsLoading(false), 2000);
  };

  const lineItemsCount = data.line_items?.reduce((acc, item) => acc + item.quantity, 0) || 0;

  return (
    <div className="bg-gradient-to-r from-emerald-900/30 to-emerald-800/20 border border-emerald-700/50 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-500/20 rounded-lg">
          <ShoppingBag className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Carrinho Pronto</h3>
          <p className="text-xs text-zinc-400">
            {lineItemsCount} {lineItemsCount === 1 ? 'item' : 'itens'}
          </p>
        </div>
      </div>

      {data.line_items && data.line_items.length > 0 && (
        <div className="space-y-2 border-t border-emerald-800/50 pt-3">
          {data.line_items.slice(0, 3).map((item, index) => (
            <div key={index} className="flex justify-between items-center text-sm">
              <span className="text-zinc-300 truncate">{item.product_title}</span>
              <span className="text-zinc-300 font-medium ml-3">{formatPrice(item.price)}</span>
            </div>
          ))}
        </div>
      )}

      {data.total && (
        <div className="flex justify-between items-center border-t border-emerald-800/50 pt-3">
          <span className="text-zinc-400 font-medium">Total</span>
          <span className="text-xl font-bold text-emerald-400">{formatPrice(data.total)}</span>
        </div>
      )}

      <Button
        size="lg"
        className="w-full h-12 text-base font-semibold bg-emerald-600 hover:bg-emerald-500"
        onClick={handleCheckout}
        disabled={isLoading || !data.checkout_url}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            Abrindo...
          </>
        ) : (
          <>
            <CreditCard className="h-5 w-5 mr-2" />
            {data.action_text || 'Finalizar Compra'}
            <ExternalLink className="h-4 w-4 ml-2 opacity-60" />
          </>
        )}
      </Button>
    </div>
  );
}

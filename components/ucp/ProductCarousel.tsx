'use client';

import { useRef, useState, useEffect } from 'react';
import { ProductCard } from './ProductCard';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Package, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UCPProduct {
  id: string;
  title: string;
  description?: string;
  handle?: string;
  available: boolean;
  price: { amount: string; currency: string };
  image_url?: string;
  image_alt?: string;
  variants: any[];
  options?: any[];
  has_variants?: boolean;
}

interface ProductCarouselProps {
  products: UCPProduct[];
  shopDomain?: string;
  query?: string;
  onSendMessage?: (message: string) => void;
}

export function ProductCarousel({
  products,
  shopDomain,
  query,
  onSendMessage,
}: ProductCarouselProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const checkScroll = () => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    setCanScrollLeft(container.scrollLeft > 0);
    setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 10);
    const cardWidth = 180;
    setCurrentIndex(Math.round(container.scrollLeft / cardWidth));
  };

  useEffect(() => {
    checkScroll();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScroll);
      window.addEventListener('resize', checkScroll);
      return () => {
        container.removeEventListener('scroll', checkScroll);
        window.removeEventListener('resize', checkScroll);
      };
    }
  }, [products]);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollBy({
      left: direction === 'left' ? -180 : 180,
      behavior: 'smooth',
    });
  };

  // DEBUG
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[ProductCarousel] Received products:', products?.length, products);
    }
  }, [products]);

  if (!products || products.length === 0) {
    return (
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 text-center">
        <Package className="h-12 w-12 text-zinc-600 mx-auto mb-3" />
        <p className="text-zinc-400">Nenhum produto encontrado</p>
        {query && <p className="text-sm text-zinc-500 mt-1">Pesquisa: "{query}"</p>}
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-zinc-900/90 to-zinc-900/70 border border-zinc-700/50 rounded-2xl p-3 space-y-3 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600/20 rounded-lg">
            <ShoppingBag className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {query ? `Resultados para "${query}"` : 'Produtos Disponíveis'}
            </h3>
            <p className="text-[10px] text-zinc-300">
              {products.length} produto{products.length !== 1 ? 's' : ''} encontrado
              {products.length !== 1 ? 's' : ''}
              {shopDomain && (
                <span className="ml-1 text-zinc-400">
                  • {shopDomain.replace('.myshopify.com', '')}
                </span>
              )}
            </p>
          </div>
        </div>

        {products.length > 2 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => scroll('left')}
              disabled={!canScrollLeft}
              className="h-7 w-7 rounded-full border-zinc-700 bg-white text-black hover:bg-zinc-200 disabled:opacity-30 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => scroll('right')}
              disabled={!canScrollRight}
              className="h-7 w-7 rounded-full border-zinc-700 bg-white text-black hover:bg-zinc-200 disabled:opacity-30 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Carousel */}
      <div
        ref={scrollContainerRef}
        className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {products.map((product, index) => (
          <div
            key={product.id || index}
            className="snap-start flex-shrink-0"
            style={{ minWidth: '170px' }}
          >
            <ProductCard
              product={product}
              size="default"
              shopDomain={shopDomain}
              onSendMessage={onSendMessage}
            />
          </div>
        ))}
      </div>

      {/* Pagination Dots */}
      {products.length > 1 && products.length <= 10 && (
        <div className="flex justify-center gap-1.5 pt-1">
          {products.map((_, idx) => (
            <button
              key={idx}
              onClick={() =>
                scrollContainerRef.current?.scrollTo({ left: idx * 180, behavior: 'smooth' })
              }
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                idx === currentIndex ? 'w-6 bg-blue-600' : 'w-1.5 bg-zinc-700 hover:bg-zinc-600',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

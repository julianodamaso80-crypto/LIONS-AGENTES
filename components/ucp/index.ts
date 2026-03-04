// UCP Components - Universal Commerce Protocol
// VERSÃO CORRIGIDA - Parser mais robusto para detectar JSON UCP

export { ProductCard } from './ProductCard';
export { ProductCarousel } from './ProductCarousel';
export { CheckoutButton } from './CheckoutButton';

// Types
export interface UCPProductListData {
  type: 'ucp_product_list';
  provider: string;
  shop_domain: string;
  query?: string;
  products: UCPProduct[];
  display_hint?: 'carousel' | 'grid' | 'list';
  total_found?: number;
}

export interface UCPProductDetailData {
  type: 'ucp_product_detail';
  provider: string;
  shop_domain: string;
  product: UCPProduct;
  display_hint?: 'card';
}

export interface UCPCheckoutData {
  type: 'ucp_checkout';
  provider: string;
  shop_domain: string;
  checkout_url: string;
  cart_id?: string;
  line_items?: UCPLineItem[];
  total?: {
    amount: string;
    currency: string;
  };
  action_text?: string;
}

export interface UCPProduct {
  id: string;
  title: string;
  description?: string;
  description_html?: string;
  handle?: string;
  product_type?: string;
  available: boolean;
  price: {
    amount: string;
    currency: string;
  };
  image_url?: string;
  image_alt?: string;
  images?: Array<{ url: string; alt?: string }>;
  variants: UCPVariant[];
  options?: UCPOption[];
  has_variants?: boolean;
}

export interface UCPVariant {
  id: string;
  title: string;
  available: boolean;
  quantity_available?: number;
  price: {
    amount: string;
    currency: string;
  };
  selected_options: Array<{
    name: string;
    value: string;
  }>;
}

export interface UCPOption {
  name: string;
  values: string[];
}

export interface UCPLineItem {
  product_title: string;
  variant_title: string;
  quantity: number;
  price: {
    amount: string;
    currency: string;
  };
}

// Union type para todos os tipos UCP
export type UCPData = UCPProductListData | UCPProductDetailData | UCPCheckoutData;

/**
 * PARSER ROBUSTO - Detecta conteúdo UCP mesmo com formatação variável
 */
export function parseUCPContent(content: string): UCPData | null {
  if (!content || typeof content !== 'string') return null;

  // 1. Tentar parse direto (caso seja JSON puro)
  try {
    const data = JSON.parse(content.trim());
    if (isValidUCPData(data)) {
      return data as UCPData;
    }
  } catch {
    // Não é JSON puro, continuar tentando
  }

  // 2. Remover markdown code blocks se existirem
  let cleanContent = content;
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanContent = codeBlockMatch[1].trim();
    try {
      const data = JSON.parse(cleanContent);
      if (isValidUCPData(data)) {
        return data as UCPData;
      }
    } catch {
      // Continuar tentando
    }
  }

  // 3. Buscar JSON UCP no meio do texto
  const patterns = [/\{\s*"type"\s*:\s*"ucp_/, /\{\s*'type'\s*:\s*'ucp_/];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const jsonCandidate = extractBalancedJSON(content, match.index || 0);

      if (jsonCandidate) {
        try {
          const normalized = jsonCandidate.replace(/'/g, '"');
          const data = JSON.parse(normalized);
          if (isValidUCPData(data)) {
            return data as UCPData;
          }
        } catch {
          // Continuar tentando
        }
      }
    }
  }

  return null;
}

/**
 * Valida se o objeto é um tipo UCP válido
 */
function isValidUCPData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (typeof obj.type !== 'string') return false;
  if (!obj.type.startsWith('ucp_')) return false;

  switch (obj.type) {
    case 'ucp_product_list':
      return Array.isArray(obj.products);
    case 'ucp_product_detail':
      return obj.product !== undefined;
    case 'ucp_checkout':
      return typeof obj.checkout_url === 'string' || obj.cart_id !== undefined;
    default:
      return true;
  }
}

/**
 * Extrai JSON balanceado a partir de uma posição no texto
 */
function extractBalancedJSON(text: string, startIndex: number): string | null {
  let brackets = 0;
  let inString = false;
  let escapeNext = false;
  let endIndex = -1;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') brackets++;
      else if (char === '}') {
        brackets--;
        if (brackets === 0) {
          endIndex = i;
          break;
        }
      }
    }
  }

  if (endIndex !== -1) {
    return text.substring(startIndex, endIndex + 1);
  }
  return null;
}

/**
 * Extrai UCP data e limpa o texto
 */
export function extractUCPData(content: string): { text: string; data: UCPData | null } {
  if (!content) return { text: '', data: null };

  const data = parseUCPContent(content);
  if (!data) {
    return { text: content, data: null };
  }

  let cleanText = content;

  // Remover code block
  const codeBlockMatch = content.match(/```(?:json)?\s*[\s\S]*?```/);
  if (codeBlockMatch) {
    cleanText = content.replace(codeBlockMatch[0], '').trim();
  } else {
    // Remover JSON inline
    const jsonPatterns = [/\{\s*"type"\s*:\s*"ucp_/, /\{\s*'type'\s*:\s*'ucp_/];
    for (const pattern of jsonPatterns) {
      const match = content.match(pattern);
      if (match && match.index !== undefined) {
        const jsonStr = extractBalancedJSON(content, match.index);
        if (jsonStr) {
          cleanText = content.replace(jsonStr, '').trim();
          break;
        } else {
          // Truncated JSON (streaming in progress) - strip it silently
          cleanText = content.substring(0, match.index).trim();
          break;
        }
      }
    }
  }

  cleanText = cleanText
    .replace(/^\s*[\r\n]+/, '')
    .replace(/[\r\n]+\s*$/, '')
    .trim();
  return { text: cleanText, data };
}

export function isUCPContent(content: string): boolean {
  return parseUCPContent(content) !== null;
}

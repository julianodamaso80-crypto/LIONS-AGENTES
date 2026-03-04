import { insertOne } from './db';

// =============================================
// ENVIRONMENT CHECK
// =============================================
const isDev = process.env.NODE_ENV !== 'production';

// =============================================
// TYPES - SYSTEM ACTION LOGGING
// =============================================
export type ActionType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'SIGNUP'
  | 'PASSWORD_RESET'
  | 'ADMIN_LOGIN'
  | 'ADMIN_LOGOUT'
  | 'USER_APPROVED'
  | 'USER_REJECTED'
  | 'USER_SUSPENDED'
  | 'USER_ACTIVATED'
  | 'USER_UPDATED'
  | 'COMPANY_CREATED'
  | 'COMPANY_UPDATED'
  | 'COMPANY_SUSPENDED'
  | 'COMPANY_ACTIVATED'
  | 'INVITE_GENERATED'
  | 'API_CALL'
  | 'N8N_WEBHOOK_CALL'
  | 'LANGCHAIN_API_CALL'
  | 'ERROR_OCCURRED'
  | 'SESSION_CREATED'
  | 'SESSION_EXPIRED'
  | 'SESSION_INVALID'
  | 'BACKEND_REQUEST'
  | 'BACKEND_ERROR';

export type LogStatus = 'success' | 'error' | 'warning';

export interface LogEntry {
  userId?: string;
  adminId?: string;
  companyId?: string;
  actionType: ActionType;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  status?: LogStatus;
  errorMessage?: string;
}

// =============================================
// SANITIZATION FUNCTIONS (SECURITY)
// =============================================

export function sanitizeEmail(email: string): string {
  if (!email || !email.includes('@')) return '***@***.***';

  const [local, domain] = email.split('@');
  const [domainName, domainExt] = domain.split('.');

  const sanitizedLocal = local.length > 3 ? local.substring(0, 3) + '***' : '***';
  const sanitizedDomain =
    domainName && domainName.length > 3 ? domainName.substring(0, 3) + '***' : '***';

  return `${sanitizedLocal}@${sanitizedDomain}.${domainExt || '***'}`;
}

export function sanitizeIP(ip: string): string {
  if (!ip) return '***';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.***.***`;
  }
  return ip.substring(0, 10) + '***';
}

// =============================================
// SECURE LOGGING (CONSOLE)
// =============================================

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogOptions {
  email?: string;
  ip?: string;
  [key: string]: any;
}

export function secureLog(level: LogLevel, message: string, options?: LogOptions): void {
  const timestamp = new Date().toISOString();

  let sanitizedOptions = options;

  if (!isDev && options) {
    sanitizedOptions = { ...options };

    if (options.email) {
      sanitizedOptions.email = sanitizeEmail(options.email);
    }
    if (options.ip) {
      sanitizedOptions.ip = sanitizeIP(options.ip);
    }

    for (const key of Object.keys(sanitizedOptions)) {
      if (/key|secret|token|password|hash/i.test(key)) {
        sanitizedOptions[key] = '[REDACTED]';
      }
    }
  }

  const logData = sanitizedOptions ? `${message} ${JSON.stringify(sanitizedOptions)}` : message;
  const prefix = `[${timestamp}]`;

  switch (level) {
    case 'error':
      console.error(prefix, logData);
      break;
    case 'warn':
      console.warn(prefix, logData);
      break;
    case 'debug':
      if (isDev) console.log(prefix, '[DEBUG]', logData);
      break;
    default:
      console.log(prefix, logData);
  }
}

export const log = {
  info: (message: string, options?: LogOptions) => secureLog('info', message, options),
  warn: (message: string, options?: LogOptions) => secureLog('warn', message, options),
  error: (message: string, options?: LogOptions) => secureLog('error', message, options),
  debug: (message: string, options?: LogOptions) => secureLog('debug', message, options),
};

// =============================================
// SYSTEM ACTION LOGGING (DATABASE)
// =============================================

export async function logSystemAction(entry: LogEntry): Promise<void> {
  try {
    if (typeof window !== 'undefined') {
      console.log('[LOGGER] Skipping log (client-side):', entry.actionType);
      return;
    }

    const sanitizedDetails =
      !isDev && entry.details ? sanitizeLogDetails(entry.details) : entry.details;

    await insertOne('system_logs', {
      timestamp: new Date().toISOString(),
      user_id: entry.userId || null,
      admin_id: entry.adminId || null,
      company_id: entry.companyId || null,
      action_type: entry.actionType,
      resource_type: entry.resourceType || null,
      resource_id: entry.resourceId || null,
      details: JSON.stringify(sanitizedDetails || {}),
      ip_address: entry.ipAddress || null,
      user_agent: entry.userAgent || null,
      session_id: entry.sessionId || null,
      status: entry.status || 'success',
      error_message: entry.errorMessage || null,
    });
  } catch (error) {
    console.error('[LOGGER] Failed to log action:', error);
  }
}

function sanitizeLogDetails(details: Record<string, any>): Record<string, any> {
  const sanitized = { ...details };

  for (const key of Object.keys(sanitized)) {
    if (/key|secret|token|password|hash/i.test(key)) {
      sanitized[key] = '[REDACTED]';
    }
    if (/email/i.test(key) && typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeEmail(sanitized[key]);
    }
  }

  return sanitized;
}

export function getClientInfo(request: Request): { ipAddress?: string; userAgent?: string } {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ipAddress = forwardedFor?.split(',')[0].trim() || realIp || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;

  return { ipAddress, userAgent };
}

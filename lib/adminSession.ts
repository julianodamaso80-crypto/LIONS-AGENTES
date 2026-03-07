import { AdminUser } from './types';

const ADMIN_SESSION_KEY = 'scale_admin_session';
const ADMIN_SESSION_EXPIRY_HOURS = 8;

export interface AdminSessionData {
  adminId: string;
  email: string;
  name: string;
  expiresAt: string;
  role: 'master' | 'company_admin'; // NOVO: Diferencia Master de Company Admin
  companyId?: string | null; // NOVO: Opcional, só para Company Admin
}

export function createAdminSession(admin: AdminUser): AdminSessionData {
  const expiresAt = new Date(
    Date.now() + ADMIN_SESSION_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const sessionData: AdminSessionData = {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    expiresAt,
    role: admin.role || 'master', // NOVO: Pega do AdminUser ou assume master
    companyId: admin.companyId || null, // NOVO: CompanyId para Company Admin
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(sessionData));
  }

  return sessionData;
}

export function getAdminSession(): AdminSessionData | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const sessionStr = localStorage.getItem(ADMIN_SESSION_KEY);
  if (!sessionStr) {
    return null;
  }

  try {
    const session: AdminSessionData = JSON.parse(sessionStr);

    if (new Date(session.expiresAt) < new Date()) {
      clearAdminSession();
      return null;
    }

    return session;
  } catch {
    clearAdminSession();
    return null;
  }
}

export function clearAdminSession(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  }
}

export function isAdminAuthenticated(): boolean {
  return getAdminSession() !== null;
}

export function requireAdminAuth(): AdminSessionData {
  const session = getAdminSession();
  if (!session) {
    if (typeof window !== 'undefined') {
      window.location.href = '/admin/login';
    }
    throw new Error('Not authenticated as admin');
  }
  return session;
}

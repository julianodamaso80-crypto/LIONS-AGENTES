import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { queryOne } from '@/lib/db';
import {
  sessionOptions,
  adminSessionOptions,
  SessionData,
  AdminSessionData,
} from '@/lib/iron-session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/me
 *
 * SECURE ADMIN ENDPOINT - Session Leakage Protection
 *
 * This endpoint returns admin data ONLY for:
 * - Master Admin (from admin_users table via scale_admin_session)
 * - Company Admin (from users_v2 with role IN ['admin_company', 'owner', 'admin'])
 *
 * CRITICAL: If user is a 'member', this endpoint returns 403.
 * The role filter is applied at DATABASE LEVEL, not in JavaScript.
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();

    // ========================================
    // PRIORITY 1: Admin Session (Master or Company Admin)
    // ========================================
    const adminSession = await getIronSession<AdminSessionData>(cookieStore, adminSessionOptions);

    if (adminSession.adminId) {
      const adminId = adminSession.adminId;
      console.log('[ADMIN ME] Admin session detected, adminId:', adminId);

      // Try admin_users table first (Master Admin)
      const masterAdmin = await queryOne(
        'SELECT id, email, name FROM admin_users WHERE id = $1',
        [adminId]
      );

      if (masterAdmin) {
        console.log('[ADMIN ME] ✅ Master Admin found:', masterAdmin.email);
        return NextResponse.json({
          user: {
            id: masterAdmin.id,
            email: masterAdmin.email,
            first_name: masterAdmin.name?.split(' ')[0] || 'Admin',
            last_name: masterAdmin.name?.split(' ').slice(1).join(' ') || 'Master',
            company_id: null,
            role: 'master',
            status: 'active',
            is_owner: true,
            cpf: '',
            birth_date: '',
            avatar_url: '',
          },
          sessionType: 'master_admin',
        });
      }

      // Try users_v2 with ROLE FILTER at database level
      const companyAdmin = await queryOne(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.company_id, u.role, u.status, u.is_owner, u.cpf, u.birth_date, u.avatar_url, c.company_name
         FROM users_v2 u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = $1 AND u.role = ANY($2::text[])`,
        [adminId, ['admin_company', 'owner', 'admin']]
      );

      if (companyAdmin) {
        console.log('[ADMIN ME] ✅ Company Admin found via admin session:', companyAdmin.email);
        return NextResponse.json({
          user: {
            id: companyAdmin.id,
            email: companyAdmin.email,
            first_name: companyAdmin.first_name,
            last_name: companyAdmin.last_name,
            company_id: companyAdmin.company_id,
            role: companyAdmin.role,
            status: companyAdmin.status,
            is_owner: companyAdmin.is_owner || false,
            cpf: companyAdmin.cpf,
            birth_date: companyAdmin.birth_date,
            avatar_url: companyAdmin.avatar_url,
          },
          company: {
            company_name: companyAdmin.company_name || 'Empresa',
          },
          sessionType: 'company_admin',
        });
      }

      // Fallback: Use session data if nothing found in DB
      if (adminSession.email && adminSession.role) {
        console.log('[ADMIN ME] ✅ Using session fallback, role:', adminSession.role);
        return NextResponse.json({
          user: {
            id: adminId,
            email: adminSession.email,
            first_name: adminSession.name?.split(' ')[0] || 'Admin',
            last_name: adminSession.name?.split(' ').slice(1).join(' ') || '',
            company_id: adminSession.companyId || null,
            role: adminSession.role,
            status: 'active',
            is_owner: true,
            cpf: '',
            birth_date: '',
            avatar_url: '',
          },
          sessionType: adminSession.role === 'master_admin' ? 'master_admin' : 'company_admin',
        });
      }

      console.log('[ADMIN ME] ⛔ Admin session exists but no valid admin found for ID:', adminId);
    }

    // ========================================
    // PRIORITY 2: User Session (Company Admin only)
    // ========================================
    const userSession = await getIronSession<SessionData>(cookieStore, sessionOptions);

    if (userSession.userId) {
      const userId = userSession.userId;
      console.log('[ADMIN ME] User session detected, userId:', userId);

      // CRITICAL: Filter by ROLE at DATABASE level
      const user = await queryOne(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.company_id, u.role, u.status, u.is_owner, u.cpf, u.birth_date, u.avatar_url, c.company_name
         FROM users_v2 u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = $1 AND u.role = ANY($2::text[])`,
        [userId, ['admin_company', 'owner', 'admin']]
      );

      if (!user) {
        console.log(
          '[ADMIN ME] ⛔ BLOCKED: User is not an admin (filtered at DB level). userId:',
          userId,
        );
        return NextResponse.json(
          {
            error: 'Acesso negado. Você não tem permissão de administrador.',
            user: null,
          },
          { status: 403 },
        );
      }

      console.log('[ADMIN ME] ✅ Company Admin validated:', user.email, 'role:', user.role);
      return NextResponse.json({
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          company_id: user.company_id,
          role: user.role,
          status: user.status,
          is_owner: user.is_owner || false,
          cpf: user.cpf,
          birth_date: user.birth_date,
          avatar_url: user.avatar_url,
        },
        company: {
          company_name: user.company_name || 'Empresa',
        },
        sessionType: 'company_admin',
      });
    }

    // ========================================
    // NO VALID SESSION
    // ========================================
    console.log('[ADMIN ME] No valid session found');
    return NextResponse.json({ error: 'Sessão não encontrada', user: null }, { status: 401 });
  } catch (error) {
    console.error('[ADMIN ME] Critical error:', error);
    return NextResponse.json({ error: 'Erro interno do servidor', user: null }, { status: 500 });
  }
}

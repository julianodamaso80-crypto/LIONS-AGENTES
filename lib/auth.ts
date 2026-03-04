import { createClient } from '@supabase/supabase-js';
import { UserV2, AdminUser } from './types';
import bcrypt from 'bcryptjs';

// Client com Service Role para operações de auth (bypassa RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export interface SignupData {
  firstName: string;
  lastName: string;
  cpf: string;
  phone: string;
  email: string;
  birthDate: string;
  password: string;
  termsAccepted: boolean;
  // Invite-related fields
  companyId?: string;
  status?: string;
  role?: string;
  isOwner?: boolean; // NEW: Owner designation for Admin Company
  acceptedTermsVersion?: string | null; // ID of the legal document accepted
}

// =============================================
// PASSWORD HASHING - BCRYPT (NEW STANDARD)
// =============================================

const BCRYPT_COST = 12; // Cost factor for bcrypt (12 is recommended)

/**
 * Hash password using bcrypt (NEW STANDARD)
 * All new passwords should use this function
 */
export async function hashPasswordBcrypt(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Legacy SHA-256 hash (DEPRECATED - only for migration)
 * Keep this for backward compatibility with existing passwords
 */
export async function hashPasswordLegacy(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * DEPRECATED: Use hashPasswordBcrypt instead
 * Keeping for backward compatibility
 */
export async function hashPassword(password: string): Promise<string> {
  // Now uses bcrypt by default for new passwords
  return hashPasswordBcrypt(password);
}

/**
 * Check if a hash is legacy SHA-256 format
 * SHA-256 hashes are exactly 64 hex characters
 * bcrypt hashes start with $2a$ or $2b$ and are ~60 chars
 */
export function isLegacySha256Hash(hash: string): boolean {
  if (!hash) return false;
  // SHA-256 in hex is exactly 64 characters, all lowercase hex
  return hash.length === 64 && /^[a-f0-9]+$/.test(hash);
}

/**
 * Verify password against hash (supports both bcrypt and legacy SHA-256)
 * Returns { valid: boolean, needsMigration: boolean }
 */
export async function verifyPasswordWithMigration(
  password: string,
  hash: string,
): Promise<{ valid: boolean; needsMigration: boolean }> {
  if (!password || !hash) {
    return { valid: false, needsMigration: false };
  }

  // Check if legacy SHA-256 hash
  if (isLegacySha256Hash(hash)) {
    const legacyHash = await hashPasswordLegacy(password);
    const valid = legacyHash === hash;
    return { valid, needsMigration: valid }; // Only migrate if password is valid
  }

  // Otherwise, assume bcrypt
  try {
    const valid = await bcrypt.compare(password, hash);
    return { valid, needsMigration: false };
  } catch {
    return { valid: false, needsMigration: false };
  }
}

/**
 * Simple password verification (for backward compatibility)
 * DEPRECATED: Use verifyPasswordWithMigration for new code
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const result = await verifyPasswordWithMigration(password, hash);
  return result.valid;
}

// =============================================
// PASSWORD STRENGTH VALIDATION
// =============================================

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate password strength
 * Requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 number
 */
export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('Senha deve ter pelo menos 8 caracteres');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Senha deve conter pelo menos 1 letra maiúscula');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Senha deve conter pelo menos 1 letra minúscula');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Senha deve conter pelo menos 1 número');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// =============================================
// SECURE TOKEN GENERATION
// =============================================

/**
 * Generate secure alphanumeric token (8 characters, A-Z + 0-9)
 * ~2.8 trillion combinations
 */
export function generateSecureToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => chars[b % chars.length])
    .join('');
}

export function isValidCPF(cpf: string): boolean {
  const numbers = cpf.replace(/\D/g, '');
  if (numbers.length !== 11) return false;
  if (/^(\d)\1+$/.test(numbers)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(numbers.charAt(i)) * (10 - i);
  }
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(numbers.charAt(9))) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(numbers.charAt(i)) * (11 - i);
  }
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(numbers.charAt(10))) return false;

  return true;
}

export async function createUser(
  data: SignupData,
): Promise<{ user: UserV2 | null; error: string | null }> {
  try {
    const normalizedEmail = data.email.toLowerCase().trim();
    // console.log('[AUTH] Starting createUser process...');

    if (!isValidCPF(data.cpf)) {
      // console.log('[AUTH] CPF validation failed');
      return { user: null, error: 'CPF inválido' };
    }

    const { data: existingEmail, error: emailError } = await supabaseAdmin
      .from('users_v2')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (emailError) {
      console.error('[AUTH] Error checking email:', emailError.message);
      return { user: null, error: `Erro ao verificar email: ${emailError.message}` };
    }

    if (existingEmail) {
      // console.log('[AUTH] Email already exists');
      return { user: null, error: 'Email já cadastrado' };
    }

    const cleanCPF = data.cpf.replace(/\D/g, '');
    const { data: existingCPF, error: cpfError } = await supabaseAdmin
      .from('users_v2')
      .select('id')
      .eq('cpf', cleanCPF)
      .maybeSingle();

    if (cpfError) {
      console.error('[AUTH] Error checking CPF:', cpfError.message);
      return { user: null, error: `Erro ao verificar CPF: ${cpfError.message}` };
    }

    if (existingCPF) {
      // console.log('[AUTH] CPF already exists');
      return { user: null, error: 'CPF já cadastrado' };
    }

    const passwordHash = await hashPassword(data.password);

    const birthDate = data.birthDate.split('/').reverse().join('-');

    const { data: newUser, error } = await supabaseAdmin.rpc('create_user_account', {
      p_email: normalizedEmail,
      p_password_hash: passwordHash,
      p_first_name: data.firstName,
      p_last_name: data.lastName,
      p_cpf: cleanCPF,
      p_phone: data.phone.replace(/\D/g, ''),
      p_birth_date: birthDate,
      p_company_id: data.companyId || null,
      p_status: data.status || 'pending',
      p_role: data.role || 'member',
      p_is_owner: data.isOwner || false, // NEW: Owner designation
      p_accepted_terms_version: data.acceptedTermsVersion || null,
    });

    if (error) {
      console.error('[AUTH] Error creating user in database:', error.message);
      return { user: null, error: `Erro ao criar usuário: ${error.message}` };
    }

    if (!newUser) {
      console.error('[AUTH] No user data returned from function');
      return { user: null, error: 'Erro ao criar usuário: dados não retornados' };
    }

    // console.log('[AUTH] User created successfully');
    return { user: newUser as UserV2, error: null };
  } catch (error) {
    console.error('[AUTH] Unexpected error in createUser:', error);
    return {
      user: null,
      error: `Erro inesperado: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{
  user: UserV2 | null;
  company: { status: string; webhook_url: string; company_name: string } | null;
  error: string | null;
}> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    // SANITIZED LOG
    // console.log('[AUTH] Starting login process for user');

    const { data: user, error } = await supabaseAdmin.rpc('get_user_for_login', {
      p_email: normalizedEmail,
    });

    if (error) {
      console.error('[AUTH] Error fetching user:', error.message);
      return { user: null, company: null, error: 'Email ou senha incorretos' };
    }

    if (!user) {
      // console.log('[AUTH] User not found');
      return { user: null, company: null, error: 'Email ou senha incorretos' };
    }

    // console.log('[AUTH] User found, verifying password...');

    if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
      const lockTimeRemaining = Math.ceil(
        (new Date(user.account_locked_until).getTime() - Date.now()) / 60000,
      );
      return {
        user: null,
        company: null,
        error: `Conta bloqueada. Tente novamente em ${lockTimeRemaining} minutos`,
      };
    }

    if (!user.password_hash) {
      // console.log('[AUTH] No password hash found for user');
      return {
        user: null,
        company: null,
        error: 'Usuário registrado via OAuth. Use o login social',
      };
    }

    // Use verifyPasswordWithMigration to detect hash type and migrate if needed
    const { valid: isValid, needsMigration } = await verifyPasswordWithMigration(
      password,
      user.password_hash,
    );

    // SANITIZED LOG
    // console.log('[AUTH] Password check result:', isValid ? 'Valid' : 'Invalid');

    if (!isValid) {
      const newFailedAttempts = (user.failed_login_attempts || 0) + 1;

      if (newFailedAttempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await supabaseAdmin
          .from('users_v2')
          .update({
            failed_login_attempts: newFailedAttempts,
            account_locked_until: lockUntil,
          })
          .eq('id', user.id);

        return {
          user: null,
          company: null,
          error: 'Conta bloqueada por 15 minutos após 5 tentativas falhas',
        };
      }

      await supabaseAdmin
        .from('users_v2')
        .update({ failed_login_attempts: newFailedAttempts })
        .eq('id', user.id);

      return { user: null, company: null, error: 'Email ou senha incorretos' };
    }

    // =============================================
    // HASH MIGRATION: SHA-256 → bcrypt
    // =============================================
    if (needsMigration) {
      // console.log('[AUTH] 🔄 Migrating password to bcrypt for user:', user.id);
      const newBcryptHash = await hashPasswordBcrypt(password);

      await supabaseAdmin
        .from('users_v2')
        .update({
          password_hash: newBcryptHash,
          password_migrated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      // console.log('[AUTH] ✅ Password migrated to bcrypt successfully');
    }

    await supabaseAdmin
      .from('users_v2')
      .update({
        last_login_at: new Date().toISOString(),
        failed_login_attempts: 0,
        account_locked_until: null,
      })
      .eq('id', user.id);

    let companyData = null;
    if (user.company_id) {
      const { data: company } = await supabaseAdmin
        .from('companies')
        .select('status, webhook_url, company_name')
        .eq('id', user.company_id)
        .maybeSingle();

      if (company) {
        // 🔒 SECURITY: Block login if company is suspended
        if (company.status === 'suspended') {
          return {
            user: null,
            company: null,
            error: 'Sua empresa está suspensa. Entre em contato com o suporte.',
          };
        }
        companyData = company;
      }
    }

    return { user: user as UserV2, company: companyData, error: null };
  } catch (error) {
    console.error('Login error:', error);
    return { user: null, company: null, error: 'Erro ao fazer login' };
  }
}

export async function loginAdmin(
  email: string,
  password: string,
): Promise<{ admin: AdminUser | null; error: string | null }> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    // SANITIZED LOG
    // console.log('[ADMIN AUTH] Starting admin login attempt');

    // ========================
    // TENTATIVA 1: MASTER ADMIN
    // ========================
    // Tenta autenticar como Master Admin (tabela admin_users)
    const { data: masterAdmin, error: masterError } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (!masterError && masterAdmin) {
      // console.log('[ADMIN AUTH] Found in admin_users, verifying password...');

      const { valid: isValidMaster, needsMigration } = await verifyPasswordWithMigration(
        password,
        masterAdmin.password_hash,
      );

      if (isValidMaster) {
        // Migrate to bcrypt if needed
        if (needsMigration) {
          // console.log('[ADMIN AUTH] 🔄 Migrating Master Admin password to bcrypt');
          const newBcryptHash = await hashPasswordBcrypt(password);
          await supabaseAdmin
            .from('admin_users')
            .update({
              password_hash: newBcryptHash,
              password_migrated_at: new Date().toISOString(),
            })
            .eq('id', masterAdmin.id);
          // console.log('[ADMIN AUTH] ✅ Master Admin password migrated');
        }

        // console.log('[ADMIN AUTH] ✅ Master Admin login successful');
        return { admin: masterAdmin as AdminUser, error: null };
      }

      // console.log('[ADMIN AUTH] ❌ Master Admin password invalid');
    } else {
      // console.log('[ADMIN AUTH] Not found in admin_users, trying Company Admin...');
    }

    // ========================
    // TENTATIVA 2: COMPANY ADMIN
    // ========================
    // Se não é Master Admin, tenta Company Admin (tabela users_v2)
    const { data: companyAdmin, error: companyError } = await supabaseAdmin
      .from('users_v2')
      .select('id, email, first_name, last_name, company_id, role, status, password_hash')
      .ilike('email', normalizedEmail)
      .eq('role', 'admin_company')
      .eq('status', 'active')
      .maybeSingle();

    if (companyError) {
      console.error('[ADMIN AUTH] Error fetching company admin: ' + companyError.message);
      return { admin: null, error: 'Email ou senha incorretos' };
    }

    if (!companyAdmin) {
      // console.log('[ADMIN AUTH] ❌ Company Admin not found or not active');
      return { admin: null, error: 'Email ou senha incorretos' };
    }

    // console.log('[ADMIN AUTH] Found Company Admin, verifying password...');

    const { valid: isValidCompany, needsMigration: companyNeedsMigration } =
      await verifyPasswordWithMigration(password, companyAdmin.password_hash);

    if (!isValidCompany) {
      // console.log('[ADMIN AUTH] ❌ Company Admin password invalid');
      return { admin: null, error: 'Email ou senha incorretos' };
    }

    // Migrate to bcrypt if needed
    if (companyNeedsMigration) {
      // console.log('[ADMIN AUTH] 🔄 Migrating Company Admin password to bcrypt');
      const newBcryptHash = await hashPasswordBcrypt(password);
      await supabaseAdmin
        .from('users_v2')
        .update({
          password_hash: newBcryptHash,
          password_migrated_at: new Date().toISOString(),
        })
        .eq('id', companyAdmin.id);
      // console.log('[ADMIN AUTH] ✅ Company Admin password migrated');
    }

    // 🔒 SECURITY: Check if company is suspended
    if (companyAdmin.company_id) {
      const { data: company } = await supabaseAdmin
        .from('companies')
        .select('status')
        .eq('id', companyAdmin.company_id)
        .maybeSingle();

      if (company?.status === 'suspended') {
        return { admin: null, error: 'Sua empresa está suspensa. Entre em contato com o suporte.' };
      }
    }

    // ✅ Company Admin autenticado com sucesso!
    // console.log('[ADMIN AUTH] ✅ Company Admin login successful');

    // Formata no formato AdminUser para compatibilidade
    const adminUser: AdminUser = {
      id: companyAdmin.id,
      email: companyAdmin.email,
      name: `${companyAdmin.first_name} ${companyAdmin.last_name}`,
      password_hash: companyAdmin.password_hash,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Campos extras para Company Admin
      companyId: companyAdmin.company_id,
      role: 'company_admin',
    };

    // SANITIZED LOG
    // console.log('[ADMIN AUTH] Returning Company Admin:', {
    //   id: adminUser.id,
    //   role: adminUser.role,
    //   companyId: adminUser.companyId
    // });

    return { admin: adminUser, error: null };
  } catch (error) {
    console.error('[ADMIN AUTH] Login error:', error);
    return { admin: null, error: 'Erro ao fazer login' };
  }
}

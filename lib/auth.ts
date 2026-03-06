import { query, queryOne, rpc } from './db';
import { UserV2, AdminUser } from './types';
import bcrypt from 'bcryptjs';

// =============================================
// SIGNUP DATA INTERFACE
// =============================================

export interface SignupData {
  firstName: string;
  lastName: string;
  cpf: string;
  phone: string;
  email: string;
  birthDate: string;
  password: string;
  termsAccepted: boolean;
  companyId?: string;
  status?: string;
  role?: string;
  isOwner?: boolean;
  acceptedTermsVersion?: string | null;
}

// =============================================
// PASSWORD HASHING - BCRYPT (NEW STANDARD)
// =============================================

const BCRYPT_COST = 12;

export async function hashPasswordBcrypt(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function hashPasswordLegacy(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export async function hashPassword(password: string): Promise<string> {
  return hashPasswordBcrypt(password);
}

export function isLegacySha256Hash(hash: string): boolean {
  if (!hash) return false;
  return hash.length === 64 && /^[a-f0-9]+$/.test(hash);
}

export async function verifyPasswordWithMigration(
  password: string,
  hash: string,
): Promise<{ valid: boolean; needsMigration: boolean }> {
  if (!password || !hash) {
    return { valid: false, needsMigration: false };
  }

  if (isLegacySha256Hash(hash)) {
    const legacyHash = await hashPasswordLegacy(password);
    const valid = legacyHash === hash;
    return { valid, needsMigration: valid };
  }

  try {
    const valid = await bcrypt.compare(password, hash);
    return { valid, needsMigration: false };
  } catch {
    return { valid: false, needsMigration: false };
  }
}

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

  return { valid: errors.length === 0, errors };
}

// =============================================
// SECURE TOKEN GENERATION
// =============================================

export function generateSecureToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const charsLen = chars.length;
  const maxValid = 256 - (256 % charsLen);
  const result: string[] = [];
  while (result.length < 8) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    Array.from(array).forEach((b) => {
      if (b < maxValid && result.length < 8) {
        result.push(chars[b % charsLen]);
      }
    });
  }
  return result.join('');
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

// =============================================
// CREATE USER
// =============================================

export async function createUser(
  data: SignupData,
): Promise<{ user: UserV2 | null; error: string | null }> {
  try {
    const normalizedEmail = data.email.toLowerCase().trim();

    if (!isValidCPF(data.cpf)) {
      return { user: null, error: 'CPF inválido' };
    }

    // Check email exists
    const existingEmail = await queryOne(
      'SELECT id FROM users_v2 WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail],
    );
    if (existingEmail) {
      return { user: null, error: 'Email já cadastrado' };
    }

    // Check CPF exists
    const cleanCPF = data.cpf.replace(/\D/g, '');
    const existingCPF = await queryOne('SELECT id FROM users_v2 WHERE cpf = $1', [cleanCPF]);
    if (existingCPF) {
      return { user: null, error: 'CPF já cadastrado' };
    }

    const passwordHash = await hashPassword(data.password);
    const birthDate = data.birthDate.split('/').reverse().join('-');

    // Call create_user_account function
    const newUser = await rpc<UserV2>('create_user_account', {
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
      p_is_owner: data.isOwner || false,
      p_accepted_terms_version: data.acceptedTermsVersion || null,
    });

    if (!newUser) {
      return { user: null, error: 'Erro ao criar usuário: dados não retornados' };
    }

    return { user: newUser as UserV2, error: null };
  } catch (error) {
    console.error('[AUTH] Unexpected error in createUser:', error);
    return {
      user: null,
      error: `Erro inesperado: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// =============================================
// LOGIN USER
// =============================================

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

    // Get user for login via RPC
    const user = await rpc<any>('get_user_for_login', { p_email: normalizedEmail });

    if (!user) {
      return { user: null, company: null, error: 'Email ou senha incorretos' };
    }

    // Check account lockout
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
      return {
        user: null,
        company: null,
        error: 'Usuário registrado via OAuth. Use o login social',
      };
    }

    const { valid: isValid, needsMigration } = await verifyPasswordWithMigration(
      password,
      user.password_hash,
    );

    if (!isValid) {
      const newFailedAttempts = (user.failed_login_attempts || 0) + 1;

      if (newFailedAttempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await query(
          'UPDATE users_v2 SET failed_login_attempts = $1, account_locked_until = $2 WHERE id = $3',
          [newFailedAttempts, lockUntil, user.id],
        );
        return {
          user: null,
          company: null,
          error: 'Conta bloqueada por 15 minutos após 5 tentativas falhas',
        };
      }

      await query('UPDATE users_v2 SET failed_login_attempts = $1 WHERE id = $2', [
        newFailedAttempts,
        user.id,
      ]);
      return { user: null, company: null, error: 'Email ou senha incorretos' };
    }

    // Hash migration: SHA-256 → bcrypt
    if (needsMigration) {
      const newBcryptHash = await hashPasswordBcrypt(password);
      await query(
        'UPDATE users_v2 SET password_hash = $1, password_migrated_at = $2 WHERE id = $3',
        [newBcryptHash, new Date().toISOString(), user.id],
      );
    }

    // Update login stats
    await query(
      'UPDATE users_v2 SET last_login_at = $1, failed_login_attempts = 0, account_locked_until = NULL WHERE id = $2',
      [new Date().toISOString(), user.id],
    );

    // Get company data
    let companyData = null;
    if (user.company_id) {
      const company = await queryOne(
        'SELECT status, webhook_url, company_name FROM companies WHERE id = $1',
        [user.company_id],
      );

      if (company) {
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

// =============================================
// LOGIN ADMIN
// =============================================

export async function loginAdmin(
  email: string,
  password: string,
): Promise<{ admin: AdminUser | null; error: string | null }> {
  try {
    const normalizedEmail = email.toLowerCase().trim();

    // ATTEMPT 1: MASTER ADMIN
    const masterAdmin = await queryOne<any>(
      'SELECT * FROM admin_users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail],
    );

    if (masterAdmin) {
      const { valid: isValidMaster, needsMigration } = await verifyPasswordWithMigration(
        password,
        masterAdmin.password_hash,
      );

      if (isValidMaster) {
        if (needsMigration) {
          const newBcryptHash = await hashPasswordBcrypt(password);
          await query(
            'UPDATE admin_users SET password_hash = $1, password_migrated_at = $2 WHERE id = $3',
            [newBcryptHash, new Date().toISOString(), masterAdmin.id],
          );
        }
        return { admin: masterAdmin as AdminUser, error: null };
      }
    }

    // ATTEMPT 2: COMPANY ADMIN
    const companyAdmin = await queryOne<any>(
      `SELECT id, email, first_name, last_name, company_id, role, status, password_hash
       FROM users_v2
       WHERE LOWER(email) = LOWER($1) AND role = 'admin_company' AND status = 'active'`,
      [normalizedEmail],
    );

    if (!companyAdmin) {
      return { admin: null, error: 'Email ou senha incorretos' };
    }

    const { valid: isValidCompany, needsMigration: companyNeedsMigration } =
      await verifyPasswordWithMigration(password, companyAdmin.password_hash);

    if (!isValidCompany) {
      return { admin: null, error: 'Email ou senha incorretos' };
    }

    if (companyNeedsMigration) {
      const newBcryptHash = await hashPasswordBcrypt(password);
      await query(
        'UPDATE users_v2 SET password_hash = $1, password_migrated_at = $2 WHERE id = $3',
        [newBcryptHash, new Date().toISOString(), companyAdmin.id],
      );
    }

    // Check if company is suspended
    if (companyAdmin.company_id) {
      const company = await queryOne('SELECT status FROM companies WHERE id = $1', [
        companyAdmin.company_id,
      ]);
      if (company?.status === 'suspended') {
        return {
          admin: null,
          error: 'Sua empresa está suspensa. Entre em contato com o suporte.',
        };
      }
    }

    const adminUser: AdminUser = {
      id: companyAdmin.id,
      email: companyAdmin.email,
      name: `${companyAdmin.first_name} ${companyAdmin.last_name}`,
      password_hash: companyAdmin.password_hash,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      companyId: companyAdmin.company_id,
      role: 'company_admin',
    };

    return { admin: adminUser, error: null };
  } catch (error) {
    console.error('[ADMIN AUTH] Login error:', error);
    return { admin: null, error: 'Erro ao fazer login' };
  }
}

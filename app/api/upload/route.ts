import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { uploadFile } from '@/lib/storage';

// =============================================
// CONFIGURAÇÕES DE SEGURANÇA
// =============================================
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_BUCKETS = ['chat-media', 'attachments', 'avatars', 'voice-messages'];

const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  'chat-media': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  attachments: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
  avatars: ['image/jpeg', 'image/png', 'image/webp'],
  'voice-messages': ['audio/webm', 'audio/ogg', 'audio/mp3', 'audio/mpeg', 'audio/wav'],
};

/**
 * POST /api/upload
 *
 * Uploads a file to S3-compatible storage (MinIO) with security validations.
 * Requires: smith_user_session OR smith_admin_session cookie
 */
export async function POST(request: NextRequest) {
  try {
    // =============================================
    // AUTHENTICATION CHECK
    // =============================================
    const cookieStore = await cookies();
    const userCookie = cookieStore.get('smith_user_session');
    const adminCookie = cookieStore.get('smith_admin_session');

    if (!userCookie && !adminCookie) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // =============================================
    // PARSE FORM DATA
    // =============================================
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const bucket = (formData.get('bucket') as string) || 'attachments';

    if (!file) {
      return NextResponse.json({ error: 'Arquivo não fornecido' }, { status: 400 });
    }

    // =============================================
    // VALIDAÇÃO: TAMANHO DO ARQUIVO
    // =============================================
    if (file.size > MAX_FILE_SIZE) {
      const maxMB = MAX_FILE_SIZE / 1024 / 1024;
      return NextResponse.json(
        { error: `Arquivo muito grande. Máximo permitido: ${maxMB}MB` },
        { status: 413 },
      );
    }

    // =============================================
    // VALIDAÇÃO: BUCKET PERMITIDO
    // =============================================
    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return NextResponse.json({ error: 'Bucket não permitido' }, { status: 400 });
    }

    // =============================================
    // VALIDAÇÃO: TIPO DE ARQUIVO
    // =============================================
    const allowedTypes = ALLOWED_MIME_TYPES[bucket] || [];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Tipo de arquivo não permitido. Aceitos: ${allowedTypes.join(', ')}` },
        { status: 415 },
      );
    }

    // =============================================
    // UPLOAD FILE TO S3/MINIO
    // =============================================
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { publicUrl, path } = await uploadFile(bucket, buffer, file.type, file.name);

    return NextResponse.json(
      {
        success: true,
        filePath: path,
        publicUrl,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error('[UPLOAD API] Error:', error);
    return NextResponse.json({ error: 'Erro interno ao fazer upload' }, { status: 500 });
  }
}

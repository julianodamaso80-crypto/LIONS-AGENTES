import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

// =============================================
// S3-Compatible Storage (MinIO / AWS S3)
// =============================================

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
      },
      forcePathStyle: true, // Required for MinIO
    });
  }
  return s3Client;
}

// Allowed MIME types per bucket
const BUCKET_CONFIG: Record<string, { maxSize: number; allowedTypes: string[] }> = {
  'chat-media': {
    maxSize: 5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  },
  attachments: {
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
  },
  avatars: {
    maxSize: 2 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  'voice-messages': {
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav'],
  },
};

/**
 * Upload a file to S3-compatible storage
 * Returns public URL
 */
export async function uploadFile(
  bucket: string,
  buffer: Buffer,
  contentType: string,
  originalName?: string,
): Promise<{ publicUrl: string; path: string }> {
  const config = BUCKET_CONFIG[bucket];
  if (!config) {
    throw new Error(`Unknown bucket: ${bucket}`);
  }

  if (buffer.length > config.maxSize) {
    throw new Error(`File size exceeds limit of ${config.maxSize / 1024 / 1024}MB`);
  }

  if (!config.allowedTypes.includes(contentType)) {
    throw new Error(`File type ${contentType} not allowed for bucket ${bucket}`);
  }

  const ext = contentType.split('/')[1] || 'bin';
  const filePath = `${Date.now()}-${randomUUID()}.${ext}`;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: filePath,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    }),
  );

  const baseUrl = process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT || 'http://localhost:9000';
  const publicUrl = `${baseUrl}/${bucket}/${filePath}`;

  return { publicUrl, path: filePath };
}

/**
 * Delete a file from S3-compatible storage
 */
export async function deleteFile(bucket: string, path: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: path,
    }),
  );
}

/**
 * Get a file from S3-compatible storage
 */
export async function getFile(
  bucket: string,
  path: string,
): Promise<Buffer> {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: path,
    }),
  );

  const stream = response.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default { uploadFile, deleteFile, getFile };

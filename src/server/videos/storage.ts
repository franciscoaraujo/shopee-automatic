// Armazenamento de objetos compatível com S3 (SeaweedFS no Docker; serve AWS S3, R2, MinIO…).
// Os arquivos ficam privados: o navegador nunca acessa o bucket diretamente; o site entrega
// os bytes por /api/videos/media com URL assinada (ver signed-url.ts).
import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

export type StorageConfig = { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };

export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION || 'us-east-1',
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
  };
}

export class ObjectStorage {
  private client: S3Client;
  private bucketReady: Promise<void> | null = null;

  constructor(readonly cfg: StorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  // Cria o bucket na primeira escrita, se ainda não existir
  ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket })).catch((err: { name?: string }) => {
          if (err?.name !== 'BucketAlreadyOwnedByYou' && err?.name !== 'BucketAlreadyExists') throw err;
        });
      }
    })().catch((err) => {
      this.bucketReady = null;
      throw err;
    });
    return this.bucketReady;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
  }

  async get(key: string, range?: string): Promise<{ body: Readable; contentType?: string; contentLength?: number; contentRange?: string; partial: boolean }> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, Range: range }));
    return {
      body: r.Body as Readable,
      contentType: r.ContentType,
      contentLength: r.ContentLength,
      contentRange: r.ContentRange,
      partial: !!r.ContentRange,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

const g = globalThis as unknown as { __storage?: ObjectStorage | null };

export function getStorage(): ObjectStorage {
  if (g.__storage === undefined) {
    const cfg = storageConfig();
    g.__storage = cfg ? new ObjectStorage(cfg) : null;
  }
  if (!g.__storage) throw new Error('Armazenamento de vídeos não configurado (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).');
  return g.__storage;
}

export const isStorageConfigured = () => storageConfig() !== null;

// Chaves dos objetos: sempre dentro da pasta da conta
export const videoKey = (accountId: string, projectId: string) => `accounts/${accountId}/videos/${projectId}/video.mp4`;
export const thumbKey = (accountId: string, projectId: string) => `accounts/${accountId}/videos/${projectId}/thumb.jpg`;

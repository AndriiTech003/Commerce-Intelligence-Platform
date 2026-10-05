import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiConfig } from '../../config';

export class ObjectStorage {
  private readonly client: S3Client;
  private readonly presignClient: S3Client;

  constructor(private readonly config: ApiConfig) {
    const credentials = { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY };
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials,
      forcePathStyle: true,
    });
    this.presignClient = new S3Client({
      endpoint: config.S3_PUBLIC_URL,
      region: config.S3_REGION,
      credentials,
      forcePathStyle: true,
    });
  }

  get bucket(): string {
    return this.config.S3_BUCKET;
  }

  key(...parts: string[]): string {
    return `${this.config.S3_KEY_PREFIX}${parts.join('/')}`;
  }

  publicUrl(storageKey: string): string {
    if (/^https?:\/\//.test(storageKey)) return storageKey;
    return `${this.config.S3_PUBLIC_URL.replace(/\/$/, '')}/${this.bucket}/${storageKey}`;
  }

  async presignPut(storageKey: string, contentType: string, expiresIn = 600): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, ContentType: contentType }),
      { expiresIn },
    );
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
      return true;
    } catch {
      return false;
    }
  }

  async put(storageKey: string, body: Buffer | string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: body, ContentType: contentType }),
    );
  }

  async delete(storageKey: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }))
      .catch(() => undefined);
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })).catch(() => undefined);
    }
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    };
    await this.client.send(
      new PutBucketPolicyCommand({ Bucket: this.bucket, Policy: JSON.stringify(policy) }),
    );
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  destroy(): void {
    this.client.destroy();
    this.presignClient.destroy();
  }
}

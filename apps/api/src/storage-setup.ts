import { loadConfig } from './config';
import { ObjectStorage } from './shared/infrastructure/storage';

const config = loadConfig();
const storage = new ObjectStorage(config);
await storage.ensureBucket();
storage.destroy();
console.log(`storage: bucket ${config.S3_BUCKET} ready with public read for product images`);

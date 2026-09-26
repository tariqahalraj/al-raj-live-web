import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to parse key-value pairs from .env or .env.local
function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.resolve(rootDir, file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

async function main() {
  loadEnv();

  const accountId = process.env.R2_ACCOUNT_ID || '51b4d3632d5b3efdc1b98875b4cb637a';
  const bucketName = process.env.R2_BUCKET_NAME || 'alraj-live-ota';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL || 'https://pub-1ef49b55ff214047ba5139361e0a6c3c.r2.dev';

  if (!accessKeyId || !secretAccessKey) {
    console.error('\n❌ Missing Cloudflare R2 Credentials!');
    console.error('Please provide R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in your .env.local file:');
    console.error('\n  R2_ACCOUNT_ID=51b4d3632d5b3efdc1b98875b4cb637a');
    console.error('  R2_BUCKET_NAME=alraj-live-ota');
    console.error('  R2_ACCESS_KEY_ID=your_access_key_id');
    console.error('  R2_SECRET_ACCESS_KEY=your_secret_access_key\n');
    process.exit(1);
  }

  // 1. Run package-ota script to package the bundle
  const versionArg = process.argv[2] || '';
  const notesArg = process.argv[3] || '';
  const isMandatory = process.argv.includes('--mandatory') ? '--mandatory' : '';

  console.log('🔨 Step 1: Packaging OTA bundle...');
  execSync(`tsx scripts/package-ota.ts ${versionArg} "${notesArg}" ${isMandatory}`, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  const otaDir = path.resolve(rootDir, 'ota-release');
  const manifestPath = path.join(otaDir, 'version.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('version.json not found after packaging.');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.version;
  const zipFileName = `bundle-${version}.zip`;
  const zipFilePath = path.join(otaDir, 'bundles', zipFileName);

  if (!fs.existsSync(zipFilePath)) {
    throw new Error(`Bundle zip not found: ${zipFilePath}`);
  }

  // 2. Initialize S3 Client for Cloudflare R2
  console.log('\n☁️  Step 2: Connecting to Cloudflare R2...');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  // 3. Upload bundle zip to R2: bundles/bundle-<version>.zip
  console.log(`📤 Step 3: Uploading bundle: bundles/${zipFileName}...`);
  const zipBuffer = fs.readFileSync(zipFilePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: `bundles/${zipFileName}`,
      Body: zipBuffer,
      ContentType: 'application/zip',
    })
  );
  console.log(`✅ Bundle uploaded: ${publicBaseUrl}/bundles/${zipFileName}`);

  // 4. Upload version.json manifest to R2 root: version.json
  console.log('📤 Step 4: Uploading manifest: version.json...');
  const manifestBuffer = fs.readFileSync(manifestPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: 'version.json',
      Body: manifestBuffer,
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    })
  );
  console.log(`✅ Manifest uploaded: ${publicBaseUrl}/version.json`);

  console.log('\n================================================================');
  console.log(`🎉 OTA UPDATE v${version} SUCCESSFULLY PUBLISHED TO CLOUDFLARE R2!`);
  console.log('================================================================');
  console.log(`🌐 Live Manifest URL : ${publicBaseUrl}/version.json`);
  console.log(`📦 Live Bundle URL   : ${publicBaseUrl}/bundles/${zipFileName}`);
  console.log('📱 Active listener and host apps will receive this update on startup!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Deployment failed:', err.message || err);
  process.exit(1);
});

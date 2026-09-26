import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const otaReleaseDir = path.resolve(rootDir, 'ota-release');
const bundlesDir = path.resolve(otaReleaseDir, 'bundles');

const R2_PUBLIC_BASE_URL = 'https://pub-1ef49b55ff214047ba5139361e0a6c3c.r2.dev';

async function main() {
  console.log('🚀 [OTA Packager] Starting OTA build & packaging for Cloudflare R2...');

  // 1. Resolve version
  const pkgPath = path.resolve(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  let targetVersion = process.argv[2];
  if (!targetVersion || targetVersion.startsWith('--')) {
    targetVersion = pkg.version || '1.0.1';
  }
  targetVersion = targetVersion.replace(/^v/, '');

  const isMandatory = process.argv.includes('--mandatory');
  const notes = process.argv[3] && !process.argv[3].startsWith('--') 
    ? process.argv[3] 
    : `OTA Update v${targetVersion}`;

  console.log(`📦 Target Version: ${targetVersion}`);
  console.log(`📝 Release Notes : ${notes}`);
  console.log(`⚠️  Mandatory     : ${isMandatory}`);

  // 2. Always re-build production bundle to ensure latest changes are included
  console.log('⚙️  Compiling fresh production web bundle...');
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

  // 3. Prepare ota-release directories
  if (!fs.existsSync(otaReleaseDir)) fs.mkdirSync(otaReleaseDir, { recursive: true });
  if (!fs.existsSync(bundlesDir)) fs.mkdirSync(bundlesDir, { recursive: true });

  const zipFileName = `bundle-${targetVersion}.zip`;
  const zipFilePath = path.join(bundlesDir, zipFileName);

  // Remove previous bundle zip if exists
  if (fs.existsSync(zipFilePath)) {
    fs.unlinkSync(zipFilePath);
  }

  // 4. Zip dist/ contents into bundle zip using python3 zipfile
  console.log(`📦 Zipping dist/ to ${zipFilePath}...`);
  const pythonScript = `
import zipfile, os, sys

dist_dir = sys.argv[1]
output_zip = sys.argv[2]

with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(dist_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, dist_dir)
            zipf.write(full_path, rel_path)

print("Zip created successfully.")
`;

  execSync(`python3 -c "${pythonScript.replace(/"/g, '\\"')}" "${distDir}" "${zipFilePath}"`, {
    stdio: 'inherit',
  });

  const zipStats = fs.statSync(zipFilePath);
  const sizeKb = Math.round(zipStats.size / 1024);
  const sizeMb = (zipStats.size / (1024 * 1024)).toFixed(2);
  const sizeFormatted = zipStats.size >= 1024 * 1024 ? `~${sizeMb} MB` : `~${sizeKb} KB`;
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(zipFilePath)).digest('hex');
  console.log(`✅ Bundle created: ${zipFileName} (${sizeFormatted}, ${zipStats.size} bytes) | SHA-256: ${checksum.slice(0, 12)}...`);

  // Default real What's New changes for Tariqah al-Raj OTA updates
  const defaultWhatsNew = [
    'New Over-The-Air (OTA) live update delivery system',
    'Enhanced background live audio stability & reconnection',
    'Real-time listener profile & role synchronization',
    'Refined Tariqah al-Raj spiritual portal UI design',
  ];

  let whatsNew = defaultWhatsNew;
  if (notes && notes.includes('|')) {
    whatsNew = notes.split('|').map((s) => s.trim()).filter(Boolean);
  } else if (notes && !notes.startsWith('OTA Update v')) {
    whatsNew = [notes, ...defaultWhatsNew.slice(1)];
  }

  // 5. Generate version.json manifest
  const manifest = {
    version: targetVersion,
    url: `${R2_PUBLIC_BASE_URL}/bundles/${zipFileName}`,
    checksum,
    sizeBytes: zipStats.size,
    sizeFormatted,
    whatsNew,
    mandatory: isMandatory,
    notes,
    releaseDate: new Date().toISOString(),
  };

  const manifestPath = path.join(otaReleaseDir, 'version.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`✅ Version manifest created: ${manifestPath}`);

  console.log('\n================================================================');
  console.log('🎉 OTA PACKAGE READY FOR CLOUDFLARE R2!');
  console.log('================================================================');
  console.log(`📁 Files generated in: ${otaReleaseDir}`);
  console.log(`   1. version.json`);
  console.log(`   2. bundles/${zipFileName}`);
  console.log('\n📤 HOW TO DEPLOY TO CLOUDFLARE R2:');
  console.log('   In your Cloudflare Dashboard -> R2 -> Bucket "alraj-live-ota":');
  console.log(`   1. Upload "ota-release/version.json" directly to the bucket root.`);
  console.log(`   2. In the bucket, open/create folder "bundles" and upload "${zipFileName}".`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('❌ Failed to package OTA release:', err);
  process.exit(1);
});

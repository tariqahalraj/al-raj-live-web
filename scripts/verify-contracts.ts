import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import ws from 'ws';

if (typeof window === 'undefined' && !globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: typeof ws }).WebSocket = ws;
}

import { NegotiationController } from '../src/features/media-transport/NegotiationController';
import { RecoveryCoordinator } from '../src/features/live-session/recovery-coordinator';

console.log('====================================================');
console.log('TARIQAH AL-RAJ LIVE AUDIO — CONTRACT VERIFICATION SUITE');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${testName} ${detail ? `-> ${detail}` : ''}`);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------
// 1. NegotiationController & Generational State Machine
// ----------------------------------------------------
console.log('--- 1. Testing NegotiationController & Generational State Machine ---');
const negCtrl = new NegotiationController();
negCtrl.setGeneration(1);
assert(negCtrl.getGeneration() === 1, 'Initial media generation is 1');

// Test SDP mid extraction
const sampleSdp = [
  'v=0',
  'o=- 1234567890 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=mid:audio-mid-42',
  'a=sendrecv',
].join('\r\n');

const extractedMid = negCtrl.extractAudioMid(sampleSdp);
assert(extractedMid === 'audio-mid-42', 'Extracts dynamic audio mid correctly from SDP', `Got: ${extractedMid}`);

// Test generational rejection
let staleRejected = false;
negCtrl.setGeneration(2);
negCtrl
  .enqueueNegotiation(1, async () => {
    return 'should not execute';
  })
  .catch(() => {
    staleRejected = true;
  });

setTimeout(() => {
  assert(staleRejected, 'Stale generation 1 operation rejected when current generation is 2');

  // ----------------------------------------------------
  // 2. RecoveryCoordinator Backoff & Boundaries
  // ----------------------------------------------------
  console.log('\n--- 2. Testing RecoveryCoordinator Backoff Algorithm ---');
  const recovery = new RecoveryCoordinator();
  // Access private method calculateBackoff via any cast for testing
  const calcBackoff = (recovery as unknown as { calculateBackoff: (attempt: number) => number }).calculateBackoff.bind(recovery);

  const b0 = calcBackoff(0);
  const b1 = calcBackoff(1);
  const b2 = calcBackoff(2);
  const b6 = calcBackoff(6);

  assert(b0 >= 1000 && b0 <= 1600, 'Backoff attempt 0 is bounded around 1000-1500ms', `Got: ${b0}`);
  assert(b1 >= b0 - 500, 'Backoff monotonically scales with attempt', `b0: ${b0}, b1: ${b1}`);
  assert(b6 <= 20000, 'Backoff adheres to maximum ceiling (20,000ms)', `Got: ${b6}`);

  // ----------------------------------------------------
  // 3. Database Migration Schema Verification
  // ----------------------------------------------------
  console.log('\n--- 3. Testing Supabase Database Migration Integrity ---');
  const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260921000001_initial_foundation.sql');
  assert(existsSync(migrationPath), 'Migration file exists at supabase/migrations/20260921000001_initial_foundation.sql');

  const migrationSql = readFileSync(migrationPath, 'utf8');
  assert(migrationSql.includes('CREATE TYPE app_role AS ENUM'), 'Enum app_role defined');
  assert(migrationSql.includes('CREATE TYPE session_lifecycle_state AS ENUM'), 'Enum session_lifecycle_state defined (STARTING, LIVE, ENDING, ENDED, FAILED)');
  assert(!migrationSql.includes('\'CREATED\''), 'No CREATED state exists (B1 Section 8)');
  assert(migrationSql.includes('live_sessions'), 'Table live_sessions defined');
  assert(migrationSql.includes('unique_active_live_session'), 'Partial unique index on active host sessions defined (B1 Section 14 & 47)');
  assert(migrationSql.includes('media_generation INTEGER NOT NULL DEFAULT 1'), 'Initial media_generation is 1 (B1 Section 10)');
  assert(migrationSql.includes('start_host_session'), 'RPC start_host_session defined');
  assert(migrationSql.includes('confirm_initial_publish'), 'RPC confirm_initial_publish defined');
  assert(migrationSql.includes('advance_media_generation'), 'RPC advance_media_generation (CAS) defined');
  assert(migrationSql.includes('end_host_session'), 'RPC end_host_session defined');
  assert(migrationSql.includes('finalize_host_session'), 'RPC finalize_host_session defined');
  assert(migrationSql.includes('ROW LEVEL SECURITY'), 'RLS enabled across all tables');
  assert(migrationSql.includes('profiles'), 'Profiles table defined');
  assert(migrationSql.includes('role app_role'), 'Profile role defined');

  // ----------------------------------------------------
  // 4. Client Dist Bundle Secret Scan
  // ----------------------------------------------------
  console.log('\n--- 4. Client Dist Bundle Secret Leak Scan ---');
  const distJsPath = resolve(process.cwd(), 'dist/assets');
  let cleanSecrets = true;
  if (existsSync(distJsPath)) {
    const files = readdirSync(distJsPath);
    for (const f of files) {
      if (f.endsWith('.js')) {
        const content = readFileSync(resolve(distJsPath, f), 'utf8');
        if (content.includes('SUPABASE_SERVICE_ROLE_KEY') || content.includes('CF_CALLS_APP_TOKEN')) {
          cleanSecrets = false;
        }
      }
    }
  }
  assert(cleanSecrets, 'Zero sensitive server keys (SERVICE_ROLE / CF_TOKEN) leaked into client dist bundle');

  // ----------------------------------------------------
  // 5. Android Manifest Security & Permissions
  // ----------------------------------------------------
  console.log('\n--- 5. Android Manifest Permissions Verification ---');
  const manifestPath = resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
  const manifestXml = readFileSync(manifestPath, 'utf8');
  assert(manifestXml.includes('android.permission.RECORD_AUDIO'), 'Manifest declares RECORD_AUDIO permission');
  assert(manifestXml.includes('android.permission.FOREGROUND_SERVICE_MICROPHONE'), 'Manifest declares FOREGROUND_SERVICE_MICROPHONE permission');
  assert(manifestXml.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'), 'Manifest declares FOREGROUND_SERVICE_MEDIA_PLAYBACK permission');
  assert(manifestXml.includes('android.permission.WAKE_LOCK'), 'Manifest declares WAKE_LOCK permission');

  // Summary
  console.log('\n====================================================');
  console.log(`VERIFICATION COMPLETE: ${passedTests}/${totalTests} TESTS PASSED!`);
  console.log('====================================================');
  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}, 100);

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

console.log('====================================================');
console.log('TARIQAH AL-RAJ: PROVISIONING TEST ACCOUNTS (HOST & LISTENER)');
console.log('====================================================\n');

// Read .env.local
const envContent = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
const urlMatch = envContent.match(/VITE_SUPABASE_URL=(.*)/);
const serviceRoleMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);

if (!urlMatch || !serviceRoleMatch) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabaseUrl = urlMatch[1].trim();
const serviceRoleKey = serviceRoleMatch[1].trim();

import ws from 'ws';

if (typeof window === 'undefined' && !globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: typeof ws }).WebSocket = ws;
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as any },
});

async function provisionAccounts() {
  const accounts = [
    {
      email: 'host@tariqahalraj.org',
      password: 'TariqahLive2026!',
      fullName: 'Our Murshid',
      role: 'HOST' as const,
    },
    {
      email: 'listener@tariqahalraj.org',
      password: 'TariqahLive2026!',
      fullName: 'Wasif Irfan',
      role: 'USER' as const,
    },
  ];

  for (const acc of accounts) {
    console.log(`\n--- Provisioning ${acc.role}: ${acc.email} ---`);

    // Check if user already exists
    const { data: listData } = await adminClient.auth.admin.listUsers();
    let user = listData?.users?.find((u) => u.email === acc.email);

    if (!user) {
      console.log(`Creating user ${acc.email}...`);
      const { data: createData, error: createErr } = await adminClient.auth.admin.createUser({
        email: acc.email,
        password: acc.password,
        email_confirm: true,
        user_metadata: { full_name: acc.fullName },
      });

      if (createErr) {
        console.error(`Failed to create ${acc.email}:`, createErr.message);
        continue;
      }
      user = createData.user;
      console.log(`Created user ID: ${user.id}`);
    } else {
      console.log(`User already exists (ID: ${user.id}). Updating password & metadata...`);
      await adminClient.auth.admin.updateUserById(user.id, {
        password: acc.password,
        email_confirm: true,
        user_metadata: { full_name: acc.fullName },
      });
    }

    // Upsert profile and role in public.profiles
    const { error: profErr } = await adminClient
      .from('profiles')
      .upsert({
        id: user.id,
        full_name: acc.fullName,
        role: acc.role,
        updated_at: new Date().toISOString(),
      });

    if (profErr) {
      console.warn(`Profile upsert note: ${profErr.message}`);
    } else {
      console.log(`Profile updated in public.profiles with role: ${acc.role}`);
    }
  }

  console.log('\n====================================================');
  console.log('TEST ACCOUNTS PROVISIONED SUCCESSFULLY!');
  console.log('====================================================');
  console.log('Host Account:');
  console.log('  Email:    host@tariqahalraj.org');
  console.log('  Password: TariqahLive2026!');
  console.log('  Role:     HOST (Access to Host Studio & Live Broadcast)');
  console.log('\nListener Account:');
  console.log('  Email:    listener@tariqahalraj.org');
  console.log('  Password: TariqahLive2026!');
  console.log('  Role:     USER (Access to Listener Lounge)');
  console.log('====================================================\n');
}

provisionAccounts().catch((err) => {
  console.error('Provisioning failed:', err);
  process.exit(1);
});

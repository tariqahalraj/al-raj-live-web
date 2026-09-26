import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

const envContent = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
const dbPasswordMatch = envContent.match(/SUPABASE_DB_PASSWORD=(.*)/);
const dbPassword = dbPasswordMatch![1].trim();
const projectRef = 'ahvigqmcpdbyjqcuplhu';

async function check() {
  const client = new Client({
    host: 'aws-1-ap-southeast-2.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const tables = ['profiles', 'live_sessions', 'presence_leases', 'audit_logs'];
  console.log('\n--- VERIFYING ZERO TEST/MOCK DATA ---');
  for (const table of tables) {
    const res = await client.query(`SELECT count(*) FROM public.${table};`);
    console.log(`Table "${table}": ${res.rows[0].count} records`);
  }
  console.log('-------------------------------------\n');
  await client.end();
}

check().catch(console.error);

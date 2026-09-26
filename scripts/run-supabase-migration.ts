import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

console.log('====================================================');
console.log('TARIQAH AL-RAJ: RUNNING SUPABASE DATABASE MIGRATION');
console.log('====================================================\n');

// Read password and config from .env.local
const envContent = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
const dbPasswordMatch = envContent.match(/SUPABASE_DB_PASSWORD=(.*)/);

if (!dbPasswordMatch) {
  console.error('ERROR: SUPABASE_DB_PASSWORD not found in .env.local');
  process.exit(1);
}

const dbPassword = dbPasswordMatch[1].trim();
const projectRef = 'ahvigqmcpdbyjqcuplhu';

async function tryConnect() {
  // Strategy 1: Connection pooler (IPv4 compatible)
  const poolerClient = new Client({
    host: 'aws-1-ap-southeast-2.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('Connecting via Supabase connection pooler (aws-0-ap-southeast-2)...');
    await poolerClient.connect();
    console.log('CONNECTED to database successfully via pooler!');
    return poolerClient;
  } catch (err: unknown) {
    const error = err as Error;
    console.log('Pooler connection note:', error.message);
  }

  // Strategy 2: Direct connection
  const directClient = new Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  console.log('Connecting via direct host (db.ahvigqmcpdbyjqcuplhu.supabase.co)...');
  await directClient.connect();
  console.log('CONNECTED to database successfully via direct host!');
  return directClient;
}

async function run() {
  const client = await tryConnect();

  try {
    // 1. Read and apply initial foundation migration safely
    console.log('\n--- 1. APPLYING INITIAL FOUNDATION MIGRATION SAFELY ---');

    // 2. Read and apply initial foundation migration
    console.log('\n--- 2. APPLYING INITIAL FOUNDATION MIGRATION ---');
    const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260921000001_initial_foundation.sql');
    const migrationSql = readFileSync(migrationPath, 'utf8');

    await client.query(migrationSql);
    console.log('SUCCESS: Migration applied completely!');

    // 3. Verify created tables
    console.log('\n--- 3. VERIFYING CREATED DATABASE OBJECTS ---');
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('Created Tables in public schema:');
    tablesRes.rows.forEach((r) => console.log(`  - ${r.table_name}`));

    // 4. Verify functions / RPCs
    const rpcRes = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      ORDER BY routine_name;
    `);
    console.log('\nCreated Functions / RPCs:');
    rpcRes.rows.forEach((r) => console.log(`  - ${r.routine_name}`));

    console.log('\n====================================================');
    console.log('DATABASE SETUP AND INITIALIZATION 100% COMPLETE!');
    console.log('====================================================');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('Fatal Migration Error:', err);
  process.exit(1);
});

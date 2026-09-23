import { createClient, SupabaseClient } from '@supabase/supabase-js';


const SUPABASE_URL = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
  'https://ahvigqmcpdbyjqcuplhu.supabase.co';

const SUPABASE_ANON_KEY = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFodmlncW1jcGRieWpxY3VwbGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTY3OTgsImV4cCI6MjA4NTUzMjc5OH0.fRGQuX2zc7PnssNa8pufWM7KnCXF80hThAJ45KD6nj0';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const isBrowser = typeof window !== 'undefined';
    const wsTransport = !isBrowser ? (globalThis as unknown as { WebSocket?: unknown }).WebSocket : undefined;
    
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: isBrowser,
        autoRefreshToken: isBrowser,
      },
      ...(isBrowser
        ? {
            realtime: {
              params: {
                eventsPerSecond: 10,
              },
            },
          }
        : wsTransport
        ? {
            realtime: {
              params: {
                eventsPerSecond: 10,
              },
              transport: wsTransport as any,
            },
          }
        : {}),
    });
  }
  return supabaseInstance;
}

export const supabase: SupabaseClient = getSupabaseClient();


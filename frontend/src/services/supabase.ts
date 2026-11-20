import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export async function getCentralAccessToken(): Promise<string | null> {
  const sb = getSupabaseClient();
  if (!sb) {
    return localStorage.getItem('nexus_jwt_token');
  }
  const { data: { session }, error } = await sb.auth.getSession();
  if (error || !session) {
    return null;
  }
  return session.access_token;
}

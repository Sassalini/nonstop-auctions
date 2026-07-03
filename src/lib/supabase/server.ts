import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are not configured yet.");
  }

  return { supabaseUrl, supabaseAnonKey };
}

export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig();
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    },
  });
}

export const getSupabaseServerClient = createSupabaseServerClient;

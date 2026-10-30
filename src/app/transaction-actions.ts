"use server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
export async function transactionAction(action: string, payload: Json) {
 const client = await createSupabaseServerClient();
 const { data: { user } } = await client.auth.getUser();
 if (!user) return { error: "Sign in required" };
 const { data, error } = await client.rpc("transaction_action", { action, payload });
 return error ? { error: error.message } : { data };
}

import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function transactionAccount(next: string) {
 if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect(`/login?next=${encodeURIComponent(next)}`);
 const client = await createSupabaseServerClient();
 const { data: { user } } = await client.auth.getUser();
 if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
 return { client, user };
}

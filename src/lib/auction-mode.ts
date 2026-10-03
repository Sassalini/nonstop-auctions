export function getAuctionDataMode(config: {
  supabaseUrl?: string;
  supabaseKey?: string;
  demoMode?: string;
}): "supabase" | "demo" {
  if (config.supabaseUrl && config.supabaseKey) return "supabase";
  if (config.supabaseUrl || config.supabaseKey) {
    throw new Error("Both Supabase public environment variables must be configured.");
  }
  if (config.demoMode === "true") return "demo";
  throw new Error("Supabase is not configured. Demo mode requires explicit opt-in.");
}

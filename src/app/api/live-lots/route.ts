import { NextResponse } from "next/server";
import { getActiveLotCandidates } from "@/lib/auction-data";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json({ lots: await getActiveLotCandidates() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ lots: [], error: "Live catalogue unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

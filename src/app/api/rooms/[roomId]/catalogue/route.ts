import { NextResponse } from "next/server";
import { getRoomCatalogue } from "@/lib/auction-data";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
 const { roomId } = await params;
 const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
 const headers = { "Cache-Control": "no-store" };
 if (!/^[a-z0-9-]{1,80}$/.test(roomId) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) return NextResponse.json({ error: "Invalid catalogue request." }, { status: 400, headers });
 try {
  const result = await getRoomCatalogue(roomId, page);
  return result ? NextResponse.json(result, { headers }) : NextResponse.json({ error: "Auction room unavailable." }, { status: 404, headers });
 } catch { return NextResponse.json({ error: "Could not load the catalogue. Please retry." }, { status: 503, headers }); }
}

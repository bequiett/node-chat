import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import jwt from "jsonwebtoken";
import { connectMongo } from "@/lib/mongoose";
import { RoomMember } from "@/models/RoomMember";

export const runtime = "nodejs";

const getSecret = () => {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET/NEXTAUTH_SECRET");
  return secret;
};

export async function GET(req: NextRequest) {
  const secret = getSecret();
  const decoded = await getToken({ req, secret });

  const userId = (decoded as any)?.userId ?? decoded?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectMongo();
  const memberships = await RoomMember.find({ userId }).select("roomId").lean<{ roomId: string }[]>();
  const rooms = memberships.map((m) => m.roomId.toString());

  const tokenTtl = process.env.WS_TOKEN_TTL ?? "10m";
  const token = jwt.sign({ sub: userId, userId, rooms }, secret, { expiresIn: tokenTtl });

  return NextResponse.json({
    token,
    userId,
    rooms,
  });
}

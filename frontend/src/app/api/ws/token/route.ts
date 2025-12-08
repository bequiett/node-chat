import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { auth } from "@/auth";
import { connectMongo } from "@/lib/mongoose";
import { RoomMember } from "@/models/RoomMember";
import { User } from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getSecret = () => {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET/NEXTAUTH_SECRET");
  return secret;
};

export async function GET() {
  const secret = getSecret();
  const session = await auth();
  let userId = session?.user?.id;

  if (!userId) {
    // fallback: resolve by email
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await connectMongo();
    const user = await User.findOne({ email }).select("_id").lean<{ _id: any } | null>();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = user._id.toString();
  }

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

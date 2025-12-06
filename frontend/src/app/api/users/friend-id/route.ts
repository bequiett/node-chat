import { NextRequest, NextResponse } from "next/server";
import type { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { User } from "@/models/User";

export const runtime = "nodejs";

const FRIEND_ID_REGEX = /^[a-z0-9_]{3,20}$/;

export async function PATCH(req: NextRequest) {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const body = await req.json().catch(() => null);
  const friendId = (body?.friendId as string | undefined)?.trim().toLowerCase();
  if (!friendId) {
    return NextResponse.json({ error: "friendId is required" }, { status: 400 });
  }

  if (!FRIEND_ID_REGEX.test(friendId)) {
    return NextResponse.json(
      { error: "친구 ID는 3-20자의 영문, 숫자, '_'만 사용할 수 있습니다." },
      { status: 400 },
    );
  }

  await connectMongo();

  const existing = await User.findOne({ friendId }).select("_id").lean<{ _id: Types.ObjectId }>();
  if (existing && existing._id.toString() !== session.userId) {
    return NextResponse.json({ error: "이미 사용 중인 친구 ID입니다." }, { status: 409 });
  }

  await User.findByIdAndUpdate(session.userId, { friendId });

  return NextResponse.json({ friendId });
}

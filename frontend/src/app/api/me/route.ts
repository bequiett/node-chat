import { NextResponse } from "next/server";
import type { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { User } from "@/models/User";

export const runtime = "nodejs";

function randomFriendId() {
  // user_<10-char base36>
  return `user_${Math.random().toString(36).slice(2, 12)}`;
}

type FriendIdDoc = { friendId?: string | null };
type MeDoc = {
  _id: Types.ObjectId;
  displayName: string;
  email: string;
  avatarUrl?: string;
  statusMessage?: string;
  friendId?: string | null;
};

async function ensureFriendId(userId: string, current?: string | null) {
  if (current) return current;

  // fetch once more to avoid regenerating if it was just set by another request
  const existing = await User.findById(userId).select("friendId").lean<FriendIdDoc>();
  if (existing?.friendId) return existing.friendId;

  for (let i = 0; i < 20; i += 1) {
    const candidate = randomFriendId().toLowerCase();
    try {
      const updated = await User.findOneAndUpdate(
        {
          _id: userId,
          $or: [{ friendId: { $exists: false } }, { friendId: null }],
        },
        { friendId: candidate },
        { new: true },
      ).lean<FriendIdDoc>();
      if (updated?.friendId) return updated.friendId;

      // if update matched but friendId exists, return it
      const refreshed = await User.findById(userId).select("friendId").lean<FriendIdDoc>();
      if (refreshed?.friendId) return refreshed.friendId;
    } catch (error: any) {
      if (error?.code === 11000) continue; // duplicate
      throw error;
    }
  }
  throw new Error("친구 ID를 생성하지 못했습니다.");
}

export async function GET() {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  await connectMongo();
  const user = await User.findById(session.userId)
    .select("_id displayName email avatarUrl statusMessage friendId")
    .lean<MeDoc>();

  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let friendId = user.friendId;
  if (!friendId) {
    try {
      friendId = await ensureFriendId(session.userId, user.friendId);
    } catch (error) {
      console.error("[api/me] failed to ensure friendId", error);
      return NextResponse.json(
        { error: "친구 ID를 설정하지 못했습니다. 잠시 후 다시 시도하거나 다시 로그인해주세요." },
        { status: 500 },
      );
    }
  }
  if (!friendId) {
    return NextResponse.json(
      { error: "친구 ID를 설정하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: user._id.toString(),
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    statusMessage: user.statusMessage,
    friendId,
  });
}

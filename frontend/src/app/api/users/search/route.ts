import { NextRequest, NextResponse } from "next/server";
import type { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { User } from "@/models/User";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 30;
const requestsPerUser = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(userId: string) {
  const now = Date.now();
  const entry = requestsPerUser.get(userId);
  if (!entry || entry.resetAt < now) {
    requestsPerUser.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count += 1;
  return false;
}

export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ users: [] });
  if (q.length < 3) {
    return NextResponse.json({ error: "검색어는 최소 3자 이상이어야 합니다." }, { status: 400 });
  }
  if (isRateLimited(session.userId)) {
    return NextResponse.json({ error: "조회 한도를 초과했습니다. 잠시 후 다시 시도하세요." }, { status: 429 });
  }

  await connectMongo();

  const qLower = q.toLowerCase();

  const users = await User.find({
    _id: { $ne: session.userId },
    $or: [
      { displayName: { $regex: `^${q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`, $options: "i" } },
      { email: { $regex: `^${qLower.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`, $options: "i" } },
      { friendId: { $regex: `^${qLower.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`, $options: "i" } },
    ],
  })
    .select("_id displayName email avatarUrl statusMessage publicKey friendId")
    .limit(10)
    .lean<{
      _id: Types.ObjectId;
      displayName: string;
      email: string;
      avatarUrl?: string;
      statusMessage?: string;
      publicKey?: string;
      friendId?: string;
    }[]>();

  return NextResponse.json({
    users: users.map((u) => ({
      id: u._id.toString(),
      displayName: u.displayName,
      email: u.email,
      avatarUrl: u.avatarUrl,
      statusMessage: u.statusMessage,
      publicKey: u.publicKey,
      friendId: u.friendId,
    })),
  });
}

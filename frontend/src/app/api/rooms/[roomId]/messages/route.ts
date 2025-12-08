import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { RoomMember } from "@/models/RoomMember";

export const runtime = "nodejs";

const MAX_CONTENT_LENGTH = 4000;

async function ensureMembership(roomId: string, userId: string) {
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
  }

  await connectMongo();

  const membership = await RoomMember.exists({ roomId, userId });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const denied = await ensureMembership(roomId, session.userId);
  if (denied) return denied;

  // No server-side message history is stored; return empty history by design.
  return NextResponse.json({ messages: [] });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  const session = await requireAuth();
  if ("response" in session) return session.response;

  const denied = await ensureMembership(roomId, session.userId);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const rawContent = (body?.content as string | undefined)?.trim();
  const clientMessageId = (body?.messageId as string | undefined)?.trim();

  if (!rawContent) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (rawContent.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: `content too long (max ${MAX_CONTENT_LENGTH})` }, { status: 400 });
  }

  const messageId = clientMessageId || crypto.randomUUID();

  // Accept but intentionally do not persist message content to the database.
  return NextResponse.json({
    message: {
      id: messageId,
      senderId: session.userId,
      sentAt: new Date(),
    },
    persisted: false,
  });
}

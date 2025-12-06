import { NextRequest, NextResponse } from "next/server";
import mongoose, { type Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import { connectMongo } from "@/lib/mongoose";
import { RoomMember } from "@/models/RoomMember";
import { Message } from "@/models/Message";
import { ChatRoom } from "@/models/ChatRoom";

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

  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

  const messages = await Message.find({ roomId })
    .sort({ sentAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  return NextResponse.json({
    messages: messages
      .map((m) => ({
        id: m.messageId,
        content: m.content,
        senderId: m.senderId.toString(),
        sentAt: m.sentAt,
      }))
      .reverse(), // return newest-first but keep chronological order in array
  });
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

  const existing = await Message.findOne({ messageId, roomId }).lean<{
    messageId: string;
    content: string;
    senderId: Types.ObjectId;
    sentAt: Date;
  }>();
  if (existing) {
    return NextResponse.json({
      message: {
        id: existing.messageId,
        content: existing.content,
        senderId: existing.senderId.toString(),
        sentAt: existing.sentAt,
      },
      reused: true,
    });
  }

  const message = await Message.create({
    messageId,
    roomId,
    senderId: session.userId,
    content: rawContent,
    sentAt: new Date(),
  });

  const previewText = rawContent.slice(0, 200);
  await ChatRoom.findByIdAndUpdate(roomId, {
    lastMessageMeta: {
      messageId,
      sentAt: message.sentAt,
      senderId: session.userId,
      previewText,
    },
  }).lean();

  return NextResponse.json({
    message: {
      id: message.messageId,
      content: message.content,
      senderId: session.userId,
      sentAt: message.sentAt,
    },
    reused: false,
  });
}

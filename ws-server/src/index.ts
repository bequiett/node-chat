import { WebSocketServer, WebSocket } from "ws";
import jwt, { type JwtPayload } from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";

// Minimal .env loader so local secrets are picked up without extra deps
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    const lines = fs.readFileSync(fullPath, "utf8").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!key || key in process.env) continue;
      process.env[key] = value;
    }
  }
}

loadEnv();

const port = Number(process.env.WS_PORT ?? 4001);
const ttlSeconds = Number(process.env.WS_TTL_SECONDS ?? 60 * 5);
const authSecret = process.env.AUTH_SECRET ?? process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET;
const heartbeatIntervalMs = Number(process.env.WS_HEARTBEAT_INTERVAL_MS ?? 25_000);
const maxPayloadBytes = Number(process.env.WS_MAX_PAYLOAD_BYTES ?? 16_384); // 16KB default
const maxBufferedMessages = Number(process.env.WS_MAX_BUFFERED_MESSAGES ?? 1_000);

type IncomingMessage =
  | { type: "AUTH"; token: string }
  | { type: "ROOM_JOIN"; roomId: string }
  | { type: "ROOM_LEAVE"; roomId: string }
  | { type: "NEW_MESSAGE"; roomId: string; messageId?: string; payload: unknown }
  | { type: "MESSAGE_ACK"; messageId: string }
  | { type: "FRIEND_NOTIFY"; targetUserId: string; payload: unknown };

type OutgoingMessage =
  | { type: "AUTH_OK"; userId: string }
  | { type: "ERROR"; message: string }
  | { type: "ROOM_JOINED"; roomId: string }
  | { type: "ROOM_LEFT"; roomId: string }
  | { type: "FRIEND_NOTIFY"; payload: unknown }
  | {
      type: "NEW_MESSAGE";
      message: {
        roomId: string;
        messageId: string;
        senderId: string;
        payload: unknown;
        sentAt: string;
      };
    }
  | { type: "MESSAGE_DELIVERED"; messageId: string; userId: string };

type ClientContext = {
  socket: WebSocket;
  userId: string;
  rooms: Set<string>;
  allowedRooms: Set<string>;
};

type BufferedMessage = {
  roomId: string;
  senderId: string;
  messageId: string;
  payload: unknown;
  sentAt: number;
  deliveredTo: Set<string>;
  timeout: NodeJS.Timeout;
};

const clients = new Map<WebSocket, ClientContext>();
const rooms = new Map<string, Set<ClientContext>>();
const messageBuffer = new Map<string, BufferedMessage>();

function send(socket: WebSocket, data: OutgoingMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function broadcastToRoom(roomId: string, data: OutgoingMessage, exclude?: WebSocket) {
  const members = rooms.get(roomId);
  if (!members) return;
  for (const member of members) {
    if (member.socket.readyState !== WebSocket.OPEN) continue;
    if (exclude && member.socket === exclude) continue;
    send(member.socket, data);
  }
}

function verifyToken(token?: string | null): { userId: string; allowedRooms: Set<string> } | null {
  if (!token || !authSecret) {
    if (!authSecret) {
      console.warn("[ws] missing AUTH_SECRET/JWT_SECRET/NEXTAUTH_SECRET");
    }
    return null;
  }
  try {
    const decoded = jwt.verify(token, authSecret) as JwtPayload | string;
    let userId: string | undefined;
    let allowedRooms: string[] = [];

    if (typeof decoded === "string") {
      userId = decoded;
    } else {
      userId = (decoded.sub as string) ?? (decoded.userId as string);
      if (Array.isArray((decoded as any).rooms)) {
        allowedRooms = (decoded as any).rooms.filter((id: unknown) => typeof id === "string");
      }
    }

    if (!userId) return null;

    const allowed = new Set<string>(allowedRooms);
    // always allow personal notification room
    allowed.add(userId);

    return { userId, allowedRooms: allowed };
  } catch (error) {
    console.warn("[ws] invalid token", error);
    return null;
  }
}

function joinRoom(ctx: ClientContext, roomId: string) {
  if (!roomId) return send(ctx.socket, { type: "ERROR", message: "roomId required" });
  if (!ctx.allowedRooms.has(roomId)) {
    return send(ctx.socket, { type: "ERROR", message: "forbidden room" });
  }
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId)!.add(ctx);
  ctx.rooms.add(roomId);
  send(ctx.socket, { type: "ROOM_JOINED", roomId });
  deliverBufferedMessages(ctx, roomId);
}

function leaveRoom(ctx: ClientContext, roomId: string) {
  const members = rooms.get(roomId);
  members?.delete(ctx);
  ctx.rooms.delete(roomId);
  send(ctx.socket, { type: "ROOM_LEFT", roomId });
  if (members && members.size === 0) rooms.delete(roomId);
}

function bufferMessage(record: Omit<BufferedMessage, "timeout" | "deliveredTo">): BufferedMessage | null {
  if (messageBuffer.size >= maxBufferedMessages) {
    console.warn("[ws] buffer full, dropping message", record.messageId);
    return null;
  }
  const timeout = setTimeout(() => {
    messageBuffer.delete(record.messageId);
  }, ttlSeconds * 1000);

  const buffered = {
    ...record,
    deliveredTo: new Set<string>(),
    timeout,
  };

  messageBuffer.set(record.messageId, buffered);
  return buffered;
}

function deliverBufferedMessages(ctx: ClientContext, roomId: string) {
  for (const buffered of messageBuffer.values()) {
    if (buffered.roomId !== roomId) continue;
    if (buffered.deliveredTo.has(ctx.userId)) continue;
    const payload: OutgoingMessage = {
      type: "NEW_MESSAGE",
      message: {
        roomId: buffered.roomId,
        messageId: buffered.messageId,
        senderId: buffered.senderId,
        payload: buffered.payload,
        sentAt: new Date(buffered.sentAt).toISOString(),
      },
    };
    send(ctx.socket, payload);
    buffered.deliveredTo.add(ctx.userId);
  }
}

function handleIncoming(ctx: ClientContext, raw: WebSocket.RawData) {
  let msg: IncomingMessage;
  try {
    msg = JSON.parse(raw.toString()) as IncomingMessage;
  } catch (error) {
    console.error("[ws] failed to parse message", error);
    return send(ctx.socket, { type: "ERROR", message: "invalid json" });
  }

  switch (msg.type) {
    case "ROOM_JOIN":
      return joinRoom(ctx, msg.roomId);
    case "ROOM_LEAVE":
      return leaveRoom(ctx, msg.roomId);
    case "NEW_MESSAGE": {
      if (!msg.roomId) return send(ctx.socket, { type: "ERROR", message: "roomId required" });
      if (!ctx.allowedRooms.has(msg.roomId)) {
        return send(ctx.socket, { type: "ERROR", message: "forbidden room" });
      }
      if (!ctx.rooms.has(msg.roomId)) {
        return send(ctx.socket, { type: "ERROR", message: "join the room first" });
      }
      const serialized = JSON.stringify(msg.payload ?? "");
      if (Buffer.byteLength(serialized, "utf8") > maxPayloadBytes) {
        return send(ctx.socket, { type: "ERROR", message: "payload too large" });
      }
      const messageId = msg.messageId ?? crypto.randomUUID();
      const record = bufferMessage({
        roomId: msg.roomId,
        senderId: ctx.userId,
        messageId,
        payload: msg.payload,
        sentAt: Date.now(),
      });
      if (!record) {
        return send(ctx.socket, { type: "ERROR", message: "server busy, try again" });
      }

      const payload: OutgoingMessage = {
        type: "NEW_MESSAGE",
        message: {
          roomId: record.roomId,
          messageId: record.messageId,
          senderId: record.senderId,
          payload: record.payload,
          sentAt: new Date(record.sentAt).toISOString(),
        },
      };

      broadcastToRoom(msg.roomId, payload);
      return;
    }
    case "MESSAGE_ACK": {
      const buffered = messageBuffer.get(msg.messageId);
      if (!buffered) return;
      buffered.deliveredTo.add(ctx.userId);
      const payload: OutgoingMessage = {
        type: "MESSAGE_DELIVERED",
        messageId: buffered.messageId,
        userId: ctx.userId,
      };
      return broadcastToRoom(buffered.roomId, payload);
    }
    case "FRIEND_NOTIFY": {
      if (!msg.targetUserId) return;
      if (!ctx.allowedRooms.has(msg.targetUserId)) {
        return send(ctx.socket, { type: "ERROR", message: "forbidden target" });
      }
      const serialized = JSON.stringify(msg.payload ?? "");
      if (Buffer.byteLength(serialized, "utf8") > maxPayloadBytes) {
        return send(ctx.socket, { type: "ERROR", message: "payload too large" });
      }
      console.log("[ws] friend notify from", ctx.userId, "to", msg.targetUserId, msg.payload);
      return broadcastToRoom(msg.targetUserId, { type: "FRIEND_NOTIFY", payload: msg.payload });
    }
    case "AUTH":
      // already authenticated at connection; ignore explicit AUTH to avoid replay.
      return;
    default:
      send(ctx.socket, { type: "ERROR", message: "unknown message type" });
  }
}

function cleanup(ctx: ClientContext) {
  clients.delete(ctx.socket);
  for (const roomId of ctx.rooms) {
    const members = rooms.get(roomId);
    members?.delete(ctx);
    if (members && members.size === 0) rooms.delete(roomId);
  }
}

function attachHeartbeat(server: WebSocketServer) {
  const tick = () => {
    for (const socket of server.clients) {
      const wsAny = socket as WebSocket & { isAlive?: boolean };
      if (wsAny.isAlive === false) {
        socket.terminate();
        continue;
      }
      wsAny.isAlive = false;
      socket.ping();
    }
  };

  const interval = setInterval(tick, heartbeatIntervalMs);
  server.on("close", () => clearInterval(interval));
}

const wss = new WebSocketServer({ port }, () => {
  console.log(`[ws] server listening on port ${port}`);
  console.log(`[ws] ttl set to ${ttlSeconds}s`);
});

attachHeartbeat(wss);

wss.on("connection", (socket, req) => {
  const params = new URL(req.url ?? "", "http://localhost");
  const token = params.searchParams.get("token");
  const verified = verifyToken(token);

  if (!verified) {
    send(socket, { type: "ERROR", message: "unauthorized" });
    return socket.close(4401, "unauthorized");
  }

  const ctx: ClientContext = {
    socket,
    userId: verified.userId,
    rooms: new Set(),
    allowedRooms: verified.allowedRooms,
  };
  clients.set(socket, ctx);

  const wsAny = socket as WebSocket & { isAlive?: boolean };
  wsAny.isAlive = true;
  socket.on("pong", () => {
    wsAny.isAlive = true;
  });

  // auto-join personal room for direct notifications
  joinRoom(ctx, verified.userId);

  console.log(`[ws] client connected user=${verified.userId}`);
  send(socket, { type: "AUTH_OK", userId: verified.userId });

  socket.on("message", (raw) => handleIncoming(ctx, raw));
  socket.on("close", () => {
    cleanup(ctx);
    console.log(`[ws] client disconnected user=${ctx.userId}`);
  });
});

wss.on("error", (err) => {
  console.error("[ws] server error", err);
});

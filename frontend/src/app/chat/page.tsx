"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { ChatList, type ChatSummary } from "@/components/ChatList";
import { ChatWindow, type ChatMessage } from "@/components/ChatWindow";
import { FriendList, type Friend } from "@/components/FriendList";
import { MessageInput } from "@/components/MessageInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type StorageConfig = {
  retentionDays: number;
  encryptionEnabled: boolean;
};

type RoomResponse = {
  rooms: Array<{
    id: string;
    type: "direct" | "group";
    title?: string;
    peer?: { id: string; displayName?: string; avatarUrl?: string; friendId?: string };
    lastMessageMeta?: {
      messageId?: string;
      sentAt?: string;
      previewText?: string;
      senderId?: string;
    };
    updatedAt?: string;
  }>;
};

export default function ChatPage() {
  const router = useRouter();
  const { status, data: session } = useSession();
  const isAuthenticated = status === "authenticated";
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [activeTab, setActiveTab] = useState<"chats" | "friends">("chats");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const joinedRoomsRef = useRef<Set<string>>(new Set());
  const loadedRoomsRef = useRef<Set<string>>(new Set());
  const [selfId, setSelfId] = useState<string | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    displayName: string;
    email: string;
    avatarUrl?: string;
    friendId?: string;
  } | null>(null);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [friendIdInput, setFriendIdInput] = useState("");
  const [friendIdMessage, setFriendIdMessage] = useState<string | null>(null);
  const [friendIdSaving, setFriendIdSaving] = useState(false);
  const [friendActionMessage, setFriendActionMessage] = useState<string | null>(null);
  const [authErrorHandled, setAuthErrorHandled] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [requests, setRequests] = useState<{
    incoming: { id: string; fromUser: { id: string; displayName: string; avatarUrl?: string } }[];
    outgoing: { id: string; toUser: { id: string; displayName: string; avatarUrl?: string } }[];
  }>({ incoming: [], outgoing: [] });
  const [showRequests, setShowRequests] = useState(false);
  const messagesLoadedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const [storageConfig, setStorageConfig] = useState<StorageConfig>({
    retentionDays: 30,
    encryptionEnabled: true,
  });

  const storageKey = (userId: string) => `chatMessages:${userId}`;
  const settingsKey = "chatStorageSettings";

  const sanitizeRetentionDays = (value: number) => {
    if (!Number.isFinite(value)) return 30;
    return Math.min(365, Math.max(1, Math.round(value)));
  };

  const loadStoredConfig = (): StorageConfig => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(settingsKey) : null;
      if (!raw) return { retentionDays: 30, encryptionEnabled: true };
      const parsed = JSON.parse(raw) as Partial<StorageConfig>;
      return {
        retentionDays: sanitizeRetentionDays(parsed.retentionDays ?? 30),
        encryptionEnabled: parsed.encryptionEnabled !== false,
      };
    } catch {
      return { retentionDays: 30, encryptionEnabled: true };
    }
  };

  const persistConfig = (cfg: StorageConfig) => {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(cfg));
    } catch {
      // ignore
    }
    setStorageConfig(cfg);
  };

  const encodeBase64 = (buffer: ArrayBuffer | ArrayBufferLike) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer as ArrayBuffer)));
  const decodeBase64 = (text: string): Uint8Array =>
    Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  const getOrCreateKey = async (userId: string) => {
    if (typeof window === "undefined" || !window.crypto?.subtle) return null;
    const keyId = `chatEncKey:${userId}`;
    let raw: Uint8Array;
    const existing = localStorage.getItem(keyId);
    if (existing) {
      raw = decodeBase64(existing);
    } else {
      raw = new Uint8Array(32);
      crypto.getRandomValues(raw);
      localStorage.setItem(keyId, encodeBase64(raw.buffer));
    }
    const keyMaterial: ArrayBuffer =
      raw.buffer instanceof ArrayBuffer ? raw.buffer : new Uint8Array(raw).buffer;
    return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", true, ["encrypt", "decrypt"]);
  };

  const encryptPayload = async (userId: string, payload: unknown) => {
    const key = await getOrCreateKey(userId);
    if (!key || typeof window === "undefined" || !window.crypto?.subtle) return null;
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    return { iv: encodeBase64(iv.buffer), data: encodeBase64(encrypted) };
  };

  const decryptPayload = async (userId: string, record: { iv: string; data: string }) => {
    const key = await getOrCreateKey(userId);
    if (!key || typeof window === "undefined" || !window.crypto?.subtle) return null;
    const iv = decodeBase64(record.iv);
    const data = decodeBase64(record.data);
    const ivBuffer: ArrayBuffer = iv.buffer instanceof ArrayBuffer ? iv.buffer : new Uint8Array(iv).buffer;
    const dataBuffer: ArrayBuffer =
      data.buffer instanceof ArrayBuffer ? data.buffer : new Uint8Array(data).buffer;
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuffer }, key, dataBuffer);
    return JSON.parse(new TextDecoder().decode(decrypted));
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/login?redirect=/chat");
    }
  }, [router, status]);

  useEffect(() => {
    setAuthChecked(isAuthenticated);
  }, [isAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setStorageConfig(loadStoredConfig());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRooms = async () => {
      try {
        if (!isAuthenticated) return;
        const res = await fetch("/api/rooms");
        if (!res.ok) throw new Error("채팅방을 불러오지 못했습니다");
        const data = (await res.json()) as RoomResponse;
        if (cancelled) return;

        const mapped: ChatSummary[] = data.rooms.map((room) => ({
          id: room.id,
          type: room.type,
          name:
            room.title ||
            room.peer?.displayName ||
            room.peer?.friendId ||
            (room.type === "direct" ? "Direct Chat" : "Group chat"),
          avatar: room.peer?.avatarUrl,
          lastMessage: room.lastMessageMeta?.previewText || "새 대화를 시작하세요",
          timestamp: room.lastMessageMeta?.sentAt
            ? new Date(room.lastMessageMeta.sentAt).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "",
        }));

        setChats(mapped);
        setSelectedChatId(mapped[0]?.id ?? null);
        setFetchError(null);
      } catch (error) {
        if (cancelled) return;
        setFetchError(error instanceof Error ? error.message : "목록을 불러오지 못했습니다");
      }
    };

    loadRooms();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      try {
        if (!isAuthenticated) return;
        const res = await fetch("/api/me");
        if (res.status === 401 || res.status === 404) {
          if (!authErrorHandled) {
            setAuthErrorHandled(true);
            alert("사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.");
            await signOut({ callbackUrl: "/" });
          }
          return;
        }
        if (!res.ok) throw new Error("프로필을 불러오지 못했습니다");
        const data = await res.json();
        if (cancelled) return;
        setProfile({
          displayName: data.displayName,
          email: data.email,
          avatarUrl: data.avatarUrl,
          friendId: data.friendId,
        });
        setFriendIdInput(data.friendId ?? "");
        // once auth is confirmed, fetch friend requests
        fetchFriendRequests();
      } catch (error) {
        if (cancelled) return;
        setFetchError(error instanceof Error ? error.message : "프로필을 불러오지 못했습니다");
      }
    };
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [authErrorHandled, isAuthenticated]);

  useEffect(() => {
    if (!authChecked) return;
    let activeSocket: WebSocket | null = null;
    let aborted = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (aborted) return;
      const attempt = reconnectAttemptsRef.current;
      const delay = Math.min(30_000, 1000 * 2 ** attempt);
      reconnectAttemptsRef.current = attempt + 1;
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect(true);
      }, delay);
    };

    const connect = async (isRetry = false) => {
      try {
        const res = await fetch("/api/ws/token");
        if (!res.ok) throw new Error("WS 인증 실패 (로그인 필요)");
        const data = (await res.json()) as { token: string; userId?: string };
        if (aborted) return;

        setSelfId(data.userId ?? null);
        const baseUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001";
        const ws = new WebSocket(`${baseUrl}?token=${encodeURIComponent(data.token)}`);
        activeSocket = ws;

        ws.onopen = () => {
          reconnectAttemptsRef.current = 0;
          setSocket(ws);
          setWsError(null);
        };
        ws.onerror = () => {
          setWsError("WebSocket 연결 오류");
        };
        ws.onclose = () => {
          if (!aborted) {
            setSocket(null);
            setWsError("WebSocket 연결이 종료되었습니다. 다시 연결 중...");
            scheduleReconnect();
          }
        };
        if (!isRetry) {
          setWsError(null);
        }
      } catch (error) {
        setWsError(error instanceof Error ? error.message : "WS 연결 실패");
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      aborted = true;
      clearReconnectTimer();
      activeSocket?.close();
    };
  }, [authChecked]);

  useEffect(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const roomsToJoin = chats.map((c) => c.id);
    roomsToJoin.forEach((roomId) => {
      if (!joinedRoomsRef.current.has(roomId)) {
        socket.send(JSON.stringify({ type: "ROOM_JOIN", roomId }));
        joinedRoomsRef.current.add(roomId);
      }
    });
  }, [socket, chats]);

  useEffect(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !selectedChatId) return;
    socket.send(JSON.stringify({ type: "ROOM_JOIN", roomId: selectedChatId }));
  }, [socket, selectedChatId]);

  useEffect(() => {
    const roomId = selectedChatId;
    const currentUserId = selfId ?? session?.user?.id ?? null;
    if (!roomId || !authChecked || !currentUserId) return;
    if (loadedRoomsRef.current.has(roomId)) return;

    let cancelled = false;
    const loadHistory = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/messages?limit=200`);
        if (!res.ok) throw new Error("메시지 기록을 불러오지 못했습니다");
        const data = await res.json();
        if (cancelled) return;
        const chatMeta = chats.find((c) => c.id === roomId);
        const mapped: ChatMessage[] = (data.messages as any[]).map((m) => {
          const ts = m.sentAt ? new Date(m.sentAt) : new Date();
          const senderId =
            typeof m.senderId === "string"
              ? m.senderId
              : typeof m.senderId === "object" && m.senderId !== null && "toString" in m.senderId
                ? String(m.senderId)
                : "";
          return {
            id: String(m.id ?? m.messageId ?? crypto.randomUUID()),
            content: String(m.content ?? ""),
            sender: senderId === currentUserId ? "user" : "other",
            timestamp: ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
            senderName: senderId === currentUserId ? undefined : chatMeta?.name,
            senderAvatar: senderId === currentUserId ? undefined : chatMeta?.avatar,
            sentAt: ts.getTime(),
          };
        });

        setMessages((prev) => {
          const existing = prev[roomId] ?? [];
          const merged = new Map<string, ChatMessage>();
          [...existing, ...mapped].forEach((msg) => merged.set(msg.id, msg));
          const sorted = Array.from(merged.values()).sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0));
          return { ...prev, [roomId]: sorted };
        });

        loadedRoomsRef.current.add(roomId);
      } catch (error) {
        if (cancelled) return;
        toast.error("메시지 기록을 불러오지 못했습니다", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, authChecked, selfId, session?.user?.id, chats]);

  useEffect(() => {
    if (!socket) return;

    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);

        if (data.type === "NEW_MESSAGE" && data.message) {
          const { roomId, messageId, senderId, payload, sentAt } = data.message as {
            roomId: string;
            messageId: string;
            senderId: string;
            payload: unknown;
            sentAt?: string;
          };

          const chatMeta = chats.find((chat) => chat.id === roomId);
          const content =
            typeof payload === "object" && payload !== null && "text" in payload
              ? String((payload as Record<string, unknown>).text)
              : typeof payload === "string"
                ? payload
                : JSON.stringify(payload);

          const ts = sentAt ? new Date(sentAt) : new Date();
          const timestamp = ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
          const isSelf = senderId === selfId;

          setMessages((prev) => {
            const roomMessages = prev[roomId] ?? [];
            if (roomMessages.some((m) => m.id === messageId)) return prev;
            const nextMessage: ChatMessage = {
              id: messageId,
              content,
              sender: isSelf ? "user" : "other",
              timestamp,
              sentAt: ts.getTime(),
              senderAvatar: !isSelf ? chatMeta?.avatar : undefined,
              senderName: !isSelf ? chatMeta?.name : undefined,
            };
            return {
              ...prev,
              [roomId]: [...roomMessages, nextMessage],
            };
          });

          setChats((prev) =>
            prev.map((chat) => {
              if (chat.id !== roomId) return chat;
              const isUnread = !isSelf && roomId !== selectedChatId;
              return {
                ...chat,
                lastMessage: content,
                timestamp: "방금",
                unread: isUnread ? (chat.unread ?? 0) + 1 : chat.unread,
              };
            }),
          );
        }
      } catch {
        // ignore malformed messages
      }
    };

    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [socket, selfId, selectedChatId, chats]);

  useEffect(() => {
    if (!socket) return;
    const onFriendNotify = () => {
      fetchFriendRequests();
    };
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "FRIEND_NOTIFY") {
          onFriendNotify();
        }
      } catch {
        // ignore
      }
    };
    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [socket]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );

  const persistMessage = async (roomId: string, content: string, messageId: string) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, messageId }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error ?? "메시지를 저장하지 못했습니다");
      }
    } catch (error) {
      toast.error("메시지 저장 실패", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const handleSendMessage = (content: string) => {
    if (!selectedChatId || !selectedChat || !authChecked) return;
    if (socket?.readyState !== WebSocket.OPEN) {
      toast.error("메시지를 보낼 수 없습니다.", {
        description: "연결 상태를 확인한 뒤 다시 시도해주세요.",
      });
      return;
    }

    const messageId = crypto.randomUUID();
    const newMessage: ChatMessage = {
      id: messageId,
      content,
      sender: "user",
      timestamp: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
      sentAt: Date.now(),
    };

    setMessages((prev) => ({
      ...prev,
      [selectedChatId]: [...(prev[selectedChatId] ?? []), newMessage],
    }));

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === selectedChatId
          ? { ...chat, lastMessage: content, timestamp: "방금", unread: undefined }
          : chat,
      ),
    );

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "NEW_MESSAGE",
          roomId: selectedChatId,
          messageId,
          payload: { text: content },
        }),
      );
    }

    void persistMessage(selectedChatId, content, messageId);
  };

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setMobilePanelOpen(false);
    setChats((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, unread: undefined } : chat)));
  };

  const handleDeleteFriend = async (friendId: string) => {
    try {
      const res = await fetch("/api/friends", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: friendId }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error ?? "친구 삭제에 실패했습니다");
      }
      const data = await res.json();
      if (Array.isArray(data.friends)) {
        const mapped = data.friends.map((f: any) => ({
          id: f.id,
          name: f.displayName ?? f.friendId ?? "친구",
          avatar: f.avatarUrl,
          status: "offline" as const,
          roomId: f.roomId,
        }));
        setFriends(mapped);
      } else {
        setFriends((prev) => prev.filter((friend) => friend.id !== friendId));
      }
      // refresh requests/room data
      fetchFriendRequests();
      toast("친구를 삭제했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "친구 삭제에 실패했습니다");
    }
  };

  const handleAddFriend = async (friendId: string) => {
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendId }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error ?? "친구 요청에 실패했습니다");
      }
      const data = await res.json();
      setFriendActionMessage(`친구 요청을 보냈습니다: ${friendId}`);
      toast("친구 요청을 보냈습니다.");
      fetchFriendRequests();
      if (socket?.readyState === WebSocket.OPEN && data.request?.toUserId) {
        socket.send(
          JSON.stringify({
            type: "FRIEND_NOTIFY",
            targetUserId: data.request.toUserId,
            payload: { kind: "request" },
          }),
        );
      }
    } catch (error) {
      setFriendActionMessage(error instanceof Error ? error.message : "친구 요청에 실패했습니다");
      toast.error("친구 요청에 실패했습니다", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const fetchFriendRequests = async () => {
    try {
      const res = await fetch("/api/friends");
      if (!res.ok) return;
      const data = await res.json();
      setRequests({
        incoming: data.incoming ?? [],
        outgoing: data.outgoing ?? [],
      });
      if (Array.isArray(data.friends)) {
        setFriends(
          data.friends.map((f: any) => ({
            id: f.id,
            name: f.displayName ?? f.friendId ?? "친구",
            avatar: f.avatarUrl,
            status: "offline" as const,
            roomId: f.roomId,
          }))
        );
      }
      if (data.incoming?.length === 0 && data.outgoing?.length === 0) {
        setFriendActionMessage(null);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    fetchFriendRequests();
    const id = setInterval(fetchFriendRequests, 60000);
    return () => clearInterval(id);
  }, [authChecked]);

  const handleRetentionChange = (days: number) => {
    const next = {
      ...storageConfig,
      retentionDays: sanitizeRetentionDays(days),
    };
    persistConfig(next);
  };

  const handleEncryptionToggle = (enabled: boolean) => {
    const next = { ...storageConfig, encryptionEnabled: enabled };
    persistConfig(next);
  };

  const handleRequestAction = async (requestId: string, action: "accept" | "reject" | "cancel") => {
    try {
      const res = await fetch("/api/friends", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error ?? "요청 처리 실패");
      }
      const data = await res.json();
      fetchFriendRequests();
      if (action === "accept") {
        const accepted =
          requests.incoming.find((r) => r.id === requestId)?.fromUser ??
          requests.outgoing.find((r) => r.id === requestId)?.toUser;
        if (accepted) {
          setFriends((prev) => {
            const exists = prev.some((f) => f.id === accepted.id);
            const nextFriend: Friend = {
              id: accepted.id,
              name: accepted.displayName,
              avatar: accepted.avatarUrl,
              status: "offline",
              roomId: data.directRoomId,
            };
            return exists ? prev : [nextFriend, ...prev];
          });
        }
      }
      const targetId = (() => {
        const incoming = requests.incoming.find((r) => r.id === requestId)?.fromUser.id;
        const outgoing = requests.outgoing.find((r) => r.id === requestId)?.toUser.id;
        return incoming ?? outgoing;
      })();
      if (socket?.readyState === WebSocket.OPEN && targetId) {
        socket.send(
          JSON.stringify({
            type: "FRIEND_NOTIFY",
            targetUserId: targetId,
            payload: { kind: action },
          }),
        );
      }
      setFriendActionMessage(
        action === "accept"
          ? "친구 요청을 수락했습니다."
          : action === "reject"
            ? "친구 요청을 거절했습니다."
            : "보낸 요청을 취소했습니다.",
      );
      toast(
        action === "accept"
          ? "친구 요청을 수락했습니다."
          : action === "reject"
            ? "친구 요청을 거절했습니다."
            : "보낸 요청을 취소했습니다.",
      );
      setTimeout(() => setFriendActionMessage(null), 8000);
    } catch (error) {
      setFriendActionMessage(error instanceof Error ? error.message : "요청 처리 실패");
      toast.error("요청 처리 실패", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const handleStartChat = (friend: Friend) => {
    if (!friend.roomId) {
      toast.error("채팅방 정보를 불러오지 못했습니다. 친구 요청을 먼저 수락하세요.");
      return;
    }

    const chatId = friend.roomId;

    const hasChat = chats.some((chat) => chat.id === chatId);
    if (hasChat) {
      handleSelectChat(chatId);
      setActiveTab("chats");
      return;
    }

    const newChat: ChatSummary = {
      id: chatId,
      type: "direct",
      name: friend.name,
      avatar: friend.avatar,
      lastMessage: "대화를 시작해보세요",
      timestamp: "방금",
    };

    setChats((prev) => [newChat, ...prev]);
    setMessages((prev) => ({
      ...prev,
      [chatId]: [],
    }));
    setActiveTab("chats");
    setSelectedChatId(chatId);
    setMobilePanelOpen(false);
  };

  useEffect(() => {
    // when friends list arrives, enrich chats with peer info for direct rooms
    if (!friends.length) return;
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.type === "direct") {
          const matched = friends.find((f) => f.roomId === chat.id);
          if (matched) {
            return {
              ...chat,
              name: matched.name,
              avatar: matched.avatar,
            };
          }
        }
        return chat;
      }),
    );
  }, [friends]);

  // no server persistence; messages kept locally (per user) and via WS buffer
  useEffect(() => {
    if (!selfId || messagesLoadedRef.current) return;
    let cancelled = false;
    const load = async () => {
      try {
        const storedSettings = loadStoredConfig();
        setStorageConfig(storedSettings);
        const stored = localStorage.getItem(storageKey(selfId));
        if (!stored) {
          messagesLoadedRef.current = true;
          return;
        }
        const parsed = JSON.parse(stored) as
          | Record<string, ChatMessage[]>
          | { encrypted: true; iv: string; data: string };
        let data: Record<string, ChatMessage[]> | null = null;
        if ((parsed as any)?.encrypted && "iv" in (parsed as any)) {
          const decrypted = await decryptPayload(selfId, parsed as any).catch(() => null);
          if (decrypted && typeof decrypted === "object") {
            data = decrypted as Record<string, ChatMessage[]>;
          }
        } else {
          data = parsed as Record<string, ChatMessage[]>;
        }
        if (!data) {
          messagesLoadedRef.current = true;
          return;
        }
        const cutoff = Date.now() - storedSettings.retentionDays * 24 * 60 * 60 * 1000;
        const filtered = Object.fromEntries(
          Object.entries(data).map(([roomId, msgs]) => [
            roomId,
            msgs.filter((m) => (m.sentAt ?? 0) >= cutoff),
          ]),
        );
        if (!cancelled) {
          setMessages(filtered);
          messagesLoadedRef.current = true;
        }
      } catch {
        messagesLoadedRef.current = true;
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selfId]);

  // Persist messages whenever they change and userId is available
  useEffect(() => {
    if (!selfId) return;
    const cfg = storageConfig ?? { retentionDays: 30, encryptionEnabled: true };
    const save = async () => {
      try {
        const cutoff = Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000;
        const pruned = Object.fromEntries(
          Object.entries(messages).map(([roomId, msgs]) => [
            roomId,
            msgs.filter((m) => (m.sentAt ?? 0) >= cutoff),
          ]),
        );
        if (cfg.encryptionEnabled && typeof window !== "undefined" && window.crypto?.subtle) {
          const encrypted = await encryptPayload(selfId, pruned);
          if (encrypted) {
            localStorage.setItem(
              storageKey(selfId),
              JSON.stringify({ encrypted: true, iv: encrypted.iv, data: encrypted.data }),
            );
            return;
          }
        }
        localStorage.setItem(storageKey(selfId), JSON.stringify(pruned));
      } catch {
        // ignore write errors
      }
    };
    void save();
  }, [messages, selfId, storageConfig]);

  useEffect(() => {
    setChats((prev) => {
      let updated = false;

      const next = prev.map((chat) => {
        const roomMessages = messages[chat.id];
        if (!roomMessages?.length) return chat;

        const last = roomMessages[roomMessages.length - 1];
        const nextTimestamp = last.timestamp || chat.timestamp;
        if (last.content === chat.lastMessage && nextTimestamp === chat.timestamp) {
          return chat;
        }

        updated = true;
        return {
          ...chat,
          lastMessage: last.content,
          timestamp: nextTimestamp,
        };
      });

      return updated ? next : prev;
    });
  }, [messages]);

  const sidebarContent = (
    <div className="flex h-full w-full flex-col">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "chats" | "friends")}>
        <div className="px-2 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="chats" className="flex-1">
              채팅
            </TabsTrigger>
            <TabsTrigger value="friends" className="flex-1">
              친구
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="chats" className="flex-1 overflow-hidden">
          {chats.length ? (
            <ChatList chats={chats} selectedChatId={selectedChatId} onSelectChat={handleSelectChat} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              등록된 채팅방이 없습니다.
            </div>
          )}
        </TabsContent>
        <TabsContent value="friends" className="flex h-[calc(100%-2.5rem)] flex-col overflow-hidden">
          <Card className="m-2">
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">친구 요청</CardTitle>
                  {requests.incoming.length > 0 ? (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-200 px-2 text-xs font-semibold text-amber-800">
                      {requests.incoming.length}
                    </span>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-3 py-1.5"
                  onClick={() => setShowRequests((v) => !v)}
                >
                  {showRequests ? "숨기기" : "보기"}
                </Button>
              </div>
            </CardHeader>
            {showRequests ? (
              <CardContent className="space-y-3">
                <div className="space-y-2 text-xs max-h-40 overflow-y-auto pr-1">
                  {requests.incoming.length === 0 ? (
                    <p className="text-muted-foreground">도착한 요청이 없습니다.</p>
                  ) : (
                    requests.incoming.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between rounded-md border border-border px-2 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{req.fromUser.displayName}</p>
                          <p className="truncate text-muted-foreground">친구 추가 요청</p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="px-3 py-1.5"
                            onClick={() => handleRequestAction(req.id, "accept")}
                          >
                            수락
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-3 py-1.5"
                            onClick={() => handleRequestAction(req.id, "reject")}
                          >
                            거절
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-2 max-h-28 overflow-y-auto pr-1">
                  <p className="text-xs font-semibold">보낸 요청</p>
                  {requests.outgoing.length === 0 ? (
                    <p className="text-muted-foreground text-xs">보낸 요청이 없습니다.</p>
                  ) : (
                    requests.outgoing.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between rounded-md border border-border px-2 py-2 text-xs"
                      >
                        <p className="truncate">
                          {req.toUser.displayName}에게 보낸 요청 (대기)
                        </p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-3 py-1.5"
                          onClick={() => handleRequestAction(req.id, "cancel")}
                        >
                          취소
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            ) : null}
          </Card>
          <Card className="mx-2 mb-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">저장 및 보안</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-muted-foreground">보존 기간 (일)</label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="w-24"
                  value={storageConfig.retentionDays}
                  onChange={(e) => handleRetentionChange(Number(e.target.value))}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-muted-foreground">로컬 암호화 저장</label>
                <input
                  type="checkbox"
                  checked={storageConfig.encryptionEnabled}
                  onChange={(e) => handleEncryptionToggle(e.target.checked)}
                  aria-label="로컬 암호화 저장"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                기본 30일 보존 후 자동 삭제합니다. 암호화 키는 브라우저에만 저장됩니다.
              </p>
            </CardContent>
          </Card>
          <div className="flex-1 overflow-hidden">
            <FriendList
              friends={friends}
              onAddFriend={handleAddFriend}
              onDeleteFriend={handleDeleteFriend}
              onStartChat={handleStartChat}
            />
          </div>
        </TabsContent>
      </Tabs>
      <Card className="m-2 mt-auto">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-sm font-semibold">
              {profile?.displayName?.[0]?.toUpperCase() ?? "나"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{profile?.displayName ?? "나"}</p>
              <p className="truncate text-xs text-muted-foreground">{profile?.friendId ?? "미설정"}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="px-3 py-1.5"
              onClick={() => setShowProfileEdit((v) => !v)}
            >
              설정
            </Button>
          </div>
          {showProfileEdit ? (
            <div className="mt-3 space-y-2 rounded-lg border p-3">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="friend-id-input">
                친구 ID (3-20자, 영문/숫자/_)
              </label>
              <Input
                id="friend-id-input"
                value={friendIdInput}
                onChange={(e) => setFriendIdInput(e.target.value)}
                placeholder="friend-id"
              />
              <div className="flex items-center justify-between gap-2">
                {friendIdMessage ? (
                  <p className="text-xs text-muted-foreground">{friendIdMessage}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">영문/숫자/_ 조합으로 3-20자까지 설정하세요.</p>
                )}
                <Button
                  size="sm"
                  onClick={async () => {
                    setFriendIdSaving(true);
                    setFriendIdMessage(null);
                    try {
                      const res = await fetch("/api/users/friend-id", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ friendId: friendIdInput }),
                      });
                      if (!res.ok) {
                        const error = await res.json().catch(() => null);
                        throw new Error(error?.error ?? "저장에 실패했습니다");
                      }
                      const data = await res.json();
                      setProfile((prev) => (prev ? { ...prev, friendId: data.friendId } : prev));
                      setFriendIdMessage("저장되었습니다.");
                    } catch (error) {
                      setFriendIdMessage(
                        error instanceof Error ? error.message : "저장에 실패했습니다",
                      );
                    } finally {
                      setFriendIdSaving(false);
                    }
                  }}
                  disabled={friendIdSaving}
                >
                  {friendIdSaving ? "저장 중..." : "저장"}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="relative flex h-screen bg-background text-foreground">
      {wsError ? (
        <div className="absolute inset-x-0 top-0 z-10 bg-amber-100 px-4 py-2 text-sm text-amber-900 shadow">
          {wsError}
        </div>
      ) : null}
      <div className="hidden w-80 border-r md:flex">{sidebarContent}</div>

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {selectedChat ? (
          <>
            <div className="border-b p-4 md:hidden">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" aria-label="메뉴 열기" onClick={() => setMobilePanelOpen(true)}>
                  ☰
                </Button>
                <div>
                  <p className="text-sm font-medium">메뉴</p>
                  <p className="text-xs text-muted-foreground">채팅과 친구 관리</p>
                </div>
              </div>
            </div>
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <ChatWindow
                chatName={selectedChat.name}
                chatAvatar={selectedChat.avatar}
                messages={selectedChatId ? messages[selectedChatId] ?? [] : []}
              />
              <MessageInput onSendMessage={handleSendMessage} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p>대화를 선택해주세요</p>
              <p className="mt-2 text-sm">친구 목록에서 채팅을 시작할 수 있습니다</p>
            </div>
          </div>
        )}
      </div>

      {mobilePanelOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="h-full w-80 max-w-full flex-shrink-0 bg-background shadow-xl">
            {sidebarContent}
          </div>
          <Button
            variant="ghost"
            className="flex-1 bg-black/30"
            aria-label="메뉴 닫기"
            onClick={() => setMobilePanelOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

export interface ChatMessage {
  id: string;
  content: string;
  sender: "user" | "other";
  timestamp: string;
  senderName?: string;
  senderAvatar?: string;
  sentAt?: number;
}

interface ChatWindowProps {
  chatName: string;
  chatAvatar?: string;
  messages: ChatMessage[];
  subtitle?: string;
  infoMessage?: string;
}

export function ChatWindow({ chatName, chatAvatar, messages, subtitle, infoMessage }: ChatWindowProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  }, [messages]);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="border-b p-4">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarImage src={chatAvatar} alt={chatName} />
            <AvatarFallback>{chatName?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-lg font-semibold">{chatName}</h2>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        {infoMessage ? (
          <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-3 text-sm text-muted-foreground">
            {infoMessage}
          </div>
        ) : null}
        {messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            아직 메시지가 없습니다. 첫 메시지를 보내보세요!
          </p>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex gap-3", message.sender === "user" && "flex-row-reverse")}
              >
                {message.sender === "other" ? (
                  <Avatar className="h-8 w-8 text-xs">
                    <AvatarImage src={message.senderAvatar} alt={message.senderName ?? chatName} />
                    <AvatarFallback>{message.senderName?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                  </Avatar>
                ) : null}
                <div
                  className={cn(
                    "flex max-w-[70%] flex-col gap-1",
                    message.sender === "user" && "items-end",
                  )}
                >
                  <div
                    className={cn(
                      "rounded-lg px-4 py-2",
                      message.sender === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted",
                    )}
                  >
                    <p className="break-words text-sm">{message.content}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{message.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

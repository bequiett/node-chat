"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { IoSend } from "react-icons/io5";

interface MessageInputProps {
  onSendMessage: (content: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}

const MAX_VISIBLE_LINES = 5;

export function MessageInput({ onSendMessage, disabled, disabledReason }: MessageInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (typeof window === "undefined") return;

    textarea.style.height = "auto";

    const computedStyles = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(computedStyles.lineHeight) || 20;
    const padding =
      (parseFloat(computedStyles.paddingTop) || 0) + (parseFloat(computedStyles.paddingBottom) || 0);
    const minHeight = 40;
    const maxHeight = lineHeight * MAX_VISIBLE_LINES + padding;
    const nextHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [message]);

  const sendMessage = () => {
    if (disabled) return;
    if (!message.trim()) return;
    onSendMessage(message.trim());
    setMessage("");
  };

  return (
    <div className="border-t bg-background p-4">
      <div className="flex items-center gap-3">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          disabled={disabled}
          rows={1}
          placeholder="메시지를 입력하세요..."
          className="flex-1 resize-none rounded-xl text-sm leading-tight"
          style={{ minHeight: "40px" }}
        />

        <Button
          size="icon"
          variant="ghost"
          onClick={sendMessage}
          aria-label="메시지 전송"
          className="h-10 w-10"
          disabled={disabled}
        >
          <IoSend size={18} />
        </Button>
      </div>
      {disabled && disabledReason ? (
        <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p>
      ) : null}
    </div>
  );
}

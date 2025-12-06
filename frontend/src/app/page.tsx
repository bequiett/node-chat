"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { HiShieldCheck, HiGlobeAlt, HiChatBubbleLeftRight } from "react-icons/hi2";
import { ProfileMenu } from "@/components/ProfileMenu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const highlightCards = [
  {
    icon: HiShieldCheck,
    title: "사생활 보호",
    desc: "필요한 만큼만 남기고, 동의 없는 공유는 없습니다.",
  },
  {
    icon: HiGlobeAlt,
    title: "브라우저만으로 사용",
    desc: "설치 없이 바로 접속해 누구와도 대화를 시작하세요.",
  },
  {
    icon: HiChatBubbleLeftRight,
    title: "끊임 없는 채팅",
    desc: "집중을 깨지 않는 알림과 즉각적인 전달로 흐름을 이어갑니다.",
  },
];

export default function LandingPage() {
  const { data: session } = useSession();
  const isLoggedIn = Boolean(session?.user);

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-orange-50 via-pink-50 to-purple-100 text-slate-900">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(255,182,193,0.35),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(167,139,250,0.35),transparent_35%),radial-gradient(circle_at_40%_80%,rgba(52,211,235,0.35),transparent_35%)]" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-16 sm:px-8 lg:py-20">
        <header className="flex items-center justify-between">
          <div className="text-lg font-semibold tracking-tight">NodeChat</div>
          <nav className="flex items-center gap-3 text-sm">
            {isLoggedIn ? (
              <>
                <Button asChild variant="outline" className="h-10 rounded-full border-orange-200 bg-white/70 px-4">
                  <Link href="/chat">채팅으로 이동</Link>
                </Button>
                <ProfileMenu name={session?.user?.name} image={session?.user?.image} />
              </>
            ) : (
              <Button
                asChild
                className="h-10 rounded-full bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 px-4 text-white shadow-lg shadow-pink-300/50 transition hover:shadow-xl"
              >
                <Link href="/auth/login">로그인</Link>
              </Button>
            )}
          </nav>
        </header>

        <section className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-orange-600 shadow-sm shadow-orange-100">
            Secure Chatting
          </div>
          <h1 className="text-4xl font-extrabold leading-tight text-slate-900 md:text-5xl lg:text-6xl">
            안전한 환경에서
            <br />
            대화에만 집중하세요
          </h1>
          <p className="max-w-2xl text-lg text-slate-700">
            간편한 조작, 기록 최소화로 사용자에게 편리한 경험을 제공합니다.
          </p>
          {isLoggedIn ? (
            <Button
              asChild
              className="h-12 rounded-2xl bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 px-6 text-base font-semibold text-white shadow-lg shadow-pink-300/50 transition hover:translate-y-[-2px] hover:shadow-xl"
            >
              <Link href="/chat">채팅 시작하기</Link>
            </Button>
          ) : (
            <Button
              asChild
              className="h-12 rounded-2xl bg-gradient-to-r from-orange-500 via-pink-500 to-purple-600 px-6 text-base font-semibold text-white shadow-lg shadow-pink-300/50 transition hover:translate-y-[-2px] hover:shadow-xl"
            >
              <Link href="/auth/login">로그인하여 시작하기</Link>
            </Button>
          )}
        </section>

        <section className="grid gap-6 rounded-3xl border border-white/60 bg-white/70 p-6 shadow-lg shadow-pink-200/60 backdrop-blur lg:grid-cols-3">
          {highlightCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card
                key={card.title}
                className="border-slate-100 bg-white/90 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
              >
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-100 via-pink-100 to-purple-100 text-orange-700 shadow-inner shadow-pink-100">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-slate-900">{card.title}</p>
                    <p className="text-sm text-slate-600">{card.desc}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      </div>
    </main>
  );
}

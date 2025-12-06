"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <Card className="w-full max-w-md border-slate-200 shadow-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">로그인</CardTitle>
          <p className="text-sm text-muted-foreground">소셜 계정으로 빠르게 로그인하세요.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            className="w-full bg-blue-600 text-white hover:bg-blue-700"
            size="lg"
            onClick={() => signIn("google", { callbackUrl: "/" })}
          >
            Google 계정으로 계속하기
          </Button>
          <Button
            className="w-full bg-slate-900 text-white hover:bg-black"
            size="lg"
            onClick={() => signIn("github", { callbackUrl: "/" })}
          >
            Github 계정으로 계속하기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

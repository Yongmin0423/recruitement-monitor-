import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, newSession, verifyPassword } from "@/lib/auth";

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).host === request.headers.get("host");
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "요청 출처가 다릅니다." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 2048) {
    return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > 2048) return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  let password = "";
  try {
    const data: unknown = JSON.parse(raw);
    if (data && typeof data === "object" && "password" in data && typeof data.password === "string") {
      password = data.password;
    }
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!verifyPassword(password)) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return NextResponse.json({ error: "비밀번호를 확인해 주세요." }, { status: 401 });
  }
  const session = newSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "요청 출처가 다릅니다." }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}

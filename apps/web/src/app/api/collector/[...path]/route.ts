import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

interface RouteContext { params: Promise<{ path: string[] }> }

function permitted(method: string, path: string): boolean {
  if (method === "GET") return path === "searches" || path === "jobs" || path === "status";
  if (method === "POST") return path === "searches" || path === "collect";
  if (method === "PATCH") return /^searches\/[0-9a-f-]{36}$/.test(path) || /^jobs\/saramin\/\d+$/.test(path);
  return false;
}

async function forward(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const route = (await context.params).path.join("/");
  if (!permitted(request.method, route)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 404 });
  const base = process.env.COLLECTOR_URL;
  const token = process.env.COLLECTOR_API_TOKEN;
  if (!base || !token) return NextResponse.json({ error: "수집 서버 연결 설정이 필요합니다." }, { status: 503 });
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin && new URL(origin).host !== request.headers.get("host")) {
    return NextResponse.json({ error: "요청 출처가 다릅니다." }, { status: 403 });
  }
  const url = new URL("/api/" + route, base);
  url.search = new URL(request.url).search;
  const body = request.method === "GET" ? undefined : await request.text();
  if (body && body.length > 16_384) return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  try {
    const response = await fetch(url, {
      method: request.method,
      headers: {
        Authorization: "Bearer " + token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body,
      cache: "no-store",
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "수집 서버에 연결할 수 없습니다." }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;

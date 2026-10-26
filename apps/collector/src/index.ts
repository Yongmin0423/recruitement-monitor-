import { backfillSearch, collectSearch } from "./collector";
import { browserMsLast31Days, createSearch, getSearch, listJobs, listSearches, recentRuns, setSearchEnabled, updateJobState } from "./db";
import { collectionPlanAt } from "./schedule";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function authorized(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = env.APP_API_TOKEN;
  if (!supplied || !expected) return false;
  const a = new TextEncoder().encode(supplied);
  const b = new TextEncoder().encode(expected);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 16_384) {
    throw new RangeError("요청이 너무 큽니다.");
  }
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) throw new RangeError("요청이 너무 큽니다.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value: unknown = length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("JSON 객체가 필요합니다.");
  return value as Record<string, unknown>;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true });
  if (!authorized(request, env)) return json({ error: "인증이 필요합니다." }, 401);

  if (url.pathname === "/api/searches" && request.method === "GET") {
    return json({ searches: await listSearches(env.DB) });
  }
  if (url.pathname === "/api/searches" && request.method === "POST") {
    const input = await bodyJson(request);
    if (typeof input.query !== "string") return json({ error: "검색어가 필요합니다." }, 400);
    const excluded = Array.isArray(input.excludeKeywords)
      ? input.excludeKeywords.filter((value): value is string => typeof value === "string")
      : [];
    const search = await createSearch(env.DB, {
      query: input.query,
      region: typeof input.region === "string" ? input.region : null,
      excludeKeywords: excluded,
    });
    return json({ search }, 201);
  }
  const searchMatch = url.pathname.match(/^\/api\/searches\/([0-9a-f-]{36})$/);
  if (searchMatch && request.method === "PATCH") {
    const input = await bodyJson(request);
    if (typeof input.enabled !== "boolean") return json({ error: "활성화 상태가 필요합니다." }, 400);
    const changed = await setSearchEnabled(env.DB, searchMatch[1], input.enabled);
    return json({ updated: changed }, changed ? 200 : 404);
  }

  if (url.pathname === "/api/jobs" && request.method === "GET") {
    const view = url.searchParams.get("view");
    const allowedViews = ["all", "unread", "saved", "hidden"] as const;
    const selected = allowedViews.find((value) => value === view) ?? "all";
    const searchId = url.searchParams.get("searchId") ?? undefined;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    return json(await listJobs(env.DB, { searchId, view: selected, limit, offset }));
  }
  const jobMatch = url.pathname.match(/^\/api\/jobs\/(saramin)\/(\d+)$/);
  if (jobMatch && request.method === "PATCH") {
    const input = await bodyJson(request);
    const patch: { saved?: boolean; hidden?: boolean; read?: boolean } = {};
    if (typeof input.saved === "boolean") patch.saved = input.saved;
    if (typeof input.hidden === "boolean") patch.hidden = input.hidden;
    if (typeof input.read === "boolean") patch.read = input.read;
    const updated = await updateJobState(env.DB, jobMatch[1], jobMatch[2], patch);
    return json({ updated }, updated ? 200 : 404);
  }

  if (url.pathname === "/api/status" && request.method === "GET") {
    return json({
      browserMsLast31Days: await browserMsLast31Days(env.DB),
      browserBudgetMs: Number(env.APP_BROWSER_BUDGET_MS),
      searches: await listSearches(env.DB),
      runs: await recentRuns(env.DB),
      nextWindow: collectionPlanAt(new Date()),
    });
  }
  if (url.pathname === "/api/collect" && request.method === "POST") {
    const input = await bodyJson(request);
    if (typeof input.searchId !== "string") return json({ error: "검색 조건을 선택하세요." }, 400);
    const search = await getSearch(env.DB, input.searchId);
    if (!search || !search.enabled) return json({ error: "활성화된 검색 조건이 없습니다." }, 404);
    const summary = input.backfill === true
      ? await backfillSearch(env, search)
      : await collectSearch(env, search, 3, input.onlyIfStaleMinutes === 30 ? 1_800_000 : 300_000);
    return json(summary);
  }
  return json({ error: "요청한 기능이 없습니다." }, 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof RangeError || error instanceof SyntaxError) {
        return json({ error: error.message }, 400);
      }
      console.error(JSON.stringify({ event: "api_error", message: error instanceof Error ? error.message : String(error) }));
      return json({ error: "처리 중 오류가 발생했습니다." }, 500);
    }
  },

  async scheduled(controller, env): Promise<void> {
    const plan = collectionPlanAt(new Date(controller.scheduledTime));
    if (!plan.due) return;
    const searches = await listSearches(env.DB, true);
    for (const search of searches) {
      try {
        if (!search.backfill_complete) await backfillSearch(env, search);
        else await collectSearch(env, search, plan.maxPages);
      } catch (error) {
        console.error(JSON.stringify({
          event: "scheduled_collection_error",
          searchId: search.id,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  },
} satisfies ExportedHandler<Env>;

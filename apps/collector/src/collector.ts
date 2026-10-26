import { parse } from "node-html-parser";
import { acquireLock, browserMsLast31Days, getSearch, knownSearchJobIds, releaseLock, storeCards, type SearchRow } from "./db";
import { cutoffDate, isRecentOpen, kstDate, matchesSearch, parseSaraminCard, saraminSearchUrl, type JobCard } from "./saramin";

interface ScrapePayload {
  success: boolean;
  result?: Array<{ selector: string; results: Array<{ html: string; text: string }> }>;
  errors?: Array<{ message?: string }>;
}

export interface CollectionSummary {
  searchId: string;
  status: "success" | "skipped";
  reason?: string;
  pagesRead: number;
  cardsSeen: number;
  newMatches: number;
  browserMs: number;
  initial: boolean;
}

async function readLimitedJson(response: Response, maxBytes = 4_000_000): Promise<unknown> {
  if (!response.body) throw new Error("Browser Run returned an empty body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Browser Run response exceeded size limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function scrapeHtmlPage(query: string, page: number): Promise<{ cards: JobCard[]; browserMs: number }> {
  const response = await fetch(saraminSearchUrl(query, page), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PersonalJobMonitor/1.0)" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error("사람인 검색 HTTP " + response.status);
  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > 4_000_000) throw new Error("검색 페이지가 크기 제한을 넘었습니다.");
  const html = await response.text();
  if (new TextEncoder().encode(html).byteLength > 4_000_000) {
    throw new Error("검색 페이지가 크기 제한을 넘었습니다.");
  }
  const root = parse(html);
  const cards = root.querySelectorAll("#recruit_info_list .item_recruit")
    .map((element) => parseSaraminCard(element.toString()))
    .filter((card): card is JobCard => card !== null);
  return { cards, browserMs: 0 };
}

async function scrapePage(env: Env, query: string, page: number): Promise<{ cards: JobCard[]; browserMs: number }> {
  const started = Date.now();
  let response: Response;
  try {
    response = await env.BROWSER.quickAction("scrape", {
      url: saraminSearchUrl(query, page),
      elements: [{ selector: "#recruit_info_list .item_recruit" }],
      gotoOptions: { waitUntil: "load", timeout: 30_000 },
      waitForSelector: { selector: "#recruit_info_list .item_recruit", timeout: 15_000 },
      cacheTTL: 0,
    });
  } catch (error) {
    if (error instanceof Error && /does not implement the method "quickAction"/.test(error.message)) {
      return scrapeHtmlPage(query, page);
    }
    throw error;
  }
  const measured = Number(response.headers.get("X-Browser-Ms-Used"));
  const browserMs = Number.isFinite(measured) && measured > 0 ? measured : Date.now() - started;
  if (!response.ok) throw new Error("Browser Run HTTP " + response.status);
  const payload = await readLimitedJson(response) as ScrapePayload;
  if (!payload.success || !Array.isArray(payload.result)) {
    throw new Error("Browser Run did not return scrape results");
  }
  const cards: JobCard[] = [];
  for (const element of payload.result[0]?.results ?? []) {
    const card = parseSaraminCard(element.html);
    if (card) cards.push(card);
  }
  return { cards, browserMs };
}
export async function collectSearch(env: Env, search: SearchRow, maxPages: number, minAgeMs = 300_000): Promise<CollectionSummary> {
  const requiredAgeMs = Math.max(300_000, minAgeMs);
  const initial = search.last_success_at === null;
  const lastSuccess = search.last_success_at ? Date.parse(search.last_success_at) : 0;
  if (lastSuccess > Date.now() - requiredAgeMs) {
    return { searchId: search.id, status: "skipped", reason: "최근 5분 안에 이미 확인했습니다.", pagesRead: 0, cardsSeen: 0, newMatches: 0, browserMs: 0, initial };
  }
  const acquired = await acquireLock(env.DB, search.id, Date.now());
  if (!acquired) {
    return { searchId: search.id, status: "skipped", reason: "이 검색을 이미 확인 중입니다.", pagesRead: 0, cardsSeen: 0, newMatches: 0, browserMs: 0, initial };
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let pagesRead = 0;
  let cardsSeen = 0;
  let newMatches = 0;
  let browserMs = 0;
  try {
    await env.DB.prepare(
      "INSERT INTO collection_runs (id, search_id, started_at, status) VALUES (?, ?, ?, 'running')"
    ).bind(runId, search.id, startedAt).run();

    const budgetMs = Number(env.APP_BROWSER_BUDGET_MS);
    const usedBefore = await browserMsLast31Days(env.DB);
    if (!Number.isFinite(budgetMs) || budgetMs <= 0 || usedBefore >= budgetMs) {
      throw new Error("Browser Run 최근 31일 사용 한도에 도달했습니다.");
    }

    const seen = new Set<string>();
    let knownEligibleStreak = 0;
    const excludeKeywords = JSON.parse(search.exclude_keywords_json) as string[];
    for (let page = 1; page <= Math.min(Math.max(maxPages, 1), 3); page++) {
      if (usedBefore + browserMs >= budgetMs) break;
      const scraped = await scrapePage(env, search.query, page);
      browserMs += scraped.browserMs;
      if (scraped.cards.length === 0) {
        if (page === 1) throw new Error("첫 페이지에서 공고 카드를 찾지 못했습니다.");
        break;
      }
      pagesRead++;
      const unique = scraped.cards.filter((card) => {
        if (seen.has(card.sourceId)) return false;
        seen.add(card.sourceId);
        return true;
      });
      cardsSeen += unique.length;
      const today = kstDate(new Date());
      const cutoff = cutoffDate(new Date());
      const matching = unique.filter((card) => isRecentOpen(card, cutoff, today) && matchesSearch(card, {
        query: search.query,
        region: search.region,
        excludeKeywords,
      }));
      const known = await knownSearchJobIds(env.DB, search.id, matching.map((card) => card.sourceId));
      for (const card of matching) {
        knownEligibleStreak = known.has(card.sourceId) ? knownEligibleStreak + 1 : 0;
      }
      newMatches += await storeCards(env.DB, search, matching, new Date().toISOString(), initial);
      if (scraped.cards.length < 40 || knownEligibleStreak >= 10) break;
    }
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE collection_runs SET finished_at = ?, status = 'success', pages_read = ?, cards_seen = ?, new_matches = ?, browser_ms = ? WHERE id = ?"
      ).bind(new Date().toISOString(), pagesRead, cardsSeen, initial ? 0 : newMatches, browserMs, runId),
      env.DB.prepare("UPDATE searches SET last_success_at = ? WHERE id = ?").bind(new Date().toISOString(), search.id),
    ]);
    console.log(JSON.stringify({ event: "collection_success", searchId: search.id, pagesRead, cardsSeen, newMatches, browserMs }));
    return { searchId: search.id, status: "success", pagesRead, cardsSeen, newMatches: initial ? 0 : newMatches, browserMs, initial };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : "알 수 없는 수집 오류";
    await env.DB.prepare(
      "UPDATE collection_runs SET finished_at = ?, status = 'failed', pages_read = ?, cards_seen = ?, new_matches = ?, browser_ms = ?, error = ? WHERE id = ?"
    ).bind(new Date().toISOString(), pagesRead, cardsSeen, newMatches, browserMs, message, runId).run();
    console.error(JSON.stringify({ event: "collection_failed", searchId: search.id, message, browserMs }));
    throw error;
  } finally {
    await releaseLock(env.DB, search.id);
  }
}



export interface BackfillSummary {
  searchId: string;
  pagesRead: number;
  cardsSeen: number;
  addedMatches: number;
  nextPage: number;
  complete: boolean;
  cutoff: string;
  browserMs: number;
}

export async function backfillSearch(env: Env, search: SearchRow): Promise<BackfillSummary> {
  const cutoff = search.backfill_cutoff ?? cutoffDate(new Date());
  if (search.backfill_complete) {
    return { searchId: search.id, pagesRead: 0, cardsSeen: 0, addedMatches: 0, nextPage: search.backfill_next_page, complete: true, cutoff, browserMs: 0 };
  }
  const acquired = await acquireLock(env.DB, search.id, Date.now());
  if (!acquired) throw new Error("이 검색 조건을 이미 확인 중입니다. 잠시 후 다시 시도하세요.");
  const runId = crypto.randomUUID();
  let pagesRead = 0;
  let cardsSeen = 0;
  let addedMatches = 0;
  let browserMs = 0;
  let nextPage = search.backfill_next_page;
  let oldStreak = search.backfill_old_streak;
  let complete = false;
  try {
    await env.DB.prepare("INSERT INTO collection_runs (id, search_id, started_at, status) VALUES (?, ?, ?, 'running')")
      .bind(runId, search.id, new Date().toISOString()).run();
    const budgetMs = Number(env.APP_BROWSER_BUDGET_MS);
    const usedBefore = await browserMsLast31Days(env.DB);
    if (!Number.isFinite(budgetMs) || budgetMs <= 0 || usedBefore >= budgetMs) {
      throw new Error("Browser Run 최근 31일 사용 한도에 도달했습니다.");
    }
    const excludeKeywords = JSON.parse(search.exclude_keywords_json) as string[];
    const today = kstDate(new Date());
    for (let n = 0; n < 3; n++) {
      if (nextPage > 100) throw new Error("검색 결과 100페이지까지 확인했습니다. 수집 범위를 다시 검토해야 합니다.");
      if (usedBefore + browserMs >= budgetMs) break;
      const scraped = await scrapePage(env, search.query, nextPage);
      browserMs += scraped.browserMs;
      if (scraped.cards.length === 0) { complete = true; break; }
      pagesRead++;
      cardsSeen += scraped.cards.length;
      const matches = scraped.cards.filter((card) =>
        isRecentOpen(card, cutoff, today) && matchesSearch(card, {
          query: search.query, region: search.region, excludeKeywords,
        })
      );
      addedMatches += await storeCards(env.DB, search, matches, new Date().toISOString(), true);
      const recentRegistered = scraped.cards.some((card) => card.postingDate && card.postingDate >= cutoff);
      const oldRegistered = scraped.cards.some((card) => card.postingDate && card.postingDate < cutoff);
      oldStreak = !recentRegistered && oldRegistered ? oldStreak + 1 : 0;
      nextPage++;
      if (scraped.cards.length < 40 || oldStreak >= 2) { complete = true; break; }
      await env.DB.prepare(
        "UPDATE searches SET backfill_next_page = ?, backfill_cutoff = ?, backfill_old_streak = ?, last_success_at = ? WHERE id = ?"
      ).bind(nextPage, cutoff, oldStreak, new Date().toISOString(), search.id).run();
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE searches SET backfill_next_page = ?, backfill_cutoff = ?, backfill_old_streak = ?, backfill_complete = ?, last_success_at = ? WHERE id = ?")
        .bind(nextPage, cutoff, oldStreak, complete ? 1 : 0, new Date().toISOString(), search.id),
      env.DB.prepare("UPDATE collection_runs SET finished_at = ?, status = 'success', pages_read = ?, cards_seen = ?, new_matches = 0, browser_ms = ? WHERE id = ?")
        .bind(new Date().toISOString(), pagesRead, cardsSeen, browserMs, runId),
    ]);
    return { searchId: search.id, pagesRead, cardsSeen, addedMatches, nextPage, complete, cutoff, browserMs };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE collection_runs SET finished_at = ?, status = 'failed', pages_read = ?, cards_seen = ?, new_matches = 0, browser_ms = ?, error = ? WHERE id = ?"
    ).bind(new Date().toISOString(), pagesRead, cardsSeen, browserMs, error instanceof Error ? error.message.slice(0, 400) : "알 수 없는 오류", runId).run();
    throw error;
  } finally {
    await releaseLock(env.DB, search.id);
  }
}

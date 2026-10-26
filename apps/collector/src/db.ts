import { deadlineDate, kstDate, cutoffDate, type JobCard } from "./saramin";

export interface SearchRow {
  id: string;
  source: "saramin";
  query: string;
  region: string | null;
  exclude_keywords_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_success_at: string | null;
  backfill_next_page: number;
  backfill_cutoff: string | null;
  backfill_complete: number;
  backfill_old_streak: number;
}

export interface NewSearch {
  query: string;
  region?: string | null;
  excludeKeywords?: string[];
}

export async function listSearches(db: D1Database, enabledOnly = false): Promise<SearchRow[]> {
  const sql = "SELECT * FROM searches" + (enabledOnly ? " WHERE enabled = 1" : "") + " ORDER BY created_at DESC";
  const result = await db.prepare(sql).all<SearchRow>();
  return result.results;
}

export async function getSearch(db: D1Database, id: string): Promise<SearchRow | null> {
  return await db.prepare("SELECT * FROM searches WHERE id = ?").bind(id).first<SearchRow>();
}

export async function knownSearchJobIds(db: D1Database, searchId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(
    "SELECT source_id FROM search_jobs WHERE search_id = ? AND source = 'saramin' AND source_id IN (" + placeholders + ")"
  ).bind(searchId, ...ids).all<{ source_id: string }>();
  return new Set(result.results.map((row) => row.source_id));
}
export async function createSearch(db: D1Database, input: NewSearch): Promise<SearchRow> {
  const query = input.query.trim();
  const region = input.region?.trim() || null;
  const excluded = (input.excludeKeywords ?? []).map((value) => value.trim()).filter(Boolean);
  if (query.length < 2 || query.length > 80) throw new RangeError("검색어는 2~80자로 입력하세요.");
  if (region && region.length > 40) throw new RangeError("지역은 40자 이내로 입력하세요.");
  if (excluded.length > 10 || excluded.some((value) => value.length > 40)) {
    throw new RangeError("제외 키워드는 10개까지, 각 40자 이내로 입력하세요.");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO searches (id, source, query, region, exclude_keywords_json, enabled, created_at, updated_at) VALUES (?, 'saramin', ?, ?, ?, 1, ?, ?)"
  ).bind(id, query, region, JSON.stringify(excluded), now, now).run();
  const created = await getSearch(db, id);
  if (!created) throw new Error("검색 조건 저장에 실패했습니다.");
  return created;
}

export async function setSearchEnabled(db: D1Database, id: string, enabled: boolean): Promise<boolean> {
  const result = await db.prepare(
    "UPDATE searches SET enabled = ?, updated_at = ? WHERE id = ?"
  ).bind(enabled ? 1 : 0, new Date().toISOString(), id).run();
  return result.meta.changes > 0;
}

export async function acquireLock(db: D1Database, searchId: string, nowMs: number): Promise<boolean> {
  const result = await db.prepare(
    "INSERT INTO collection_locks (search_id, expires_at) VALUES (?, ?) ON CONFLICT(search_id) DO UPDATE SET expires_at = excluded.expires_at WHERE collection_locks.expires_at <= ?"
  ).bind(searchId, nowMs + 180_000, nowMs).run();
  return result.meta.changes > 0;
}

export async function releaseLock(db: D1Database, searchId: string): Promise<void> {
  await db.prepare("DELETE FROM collection_locks WHERE search_id = ?").bind(searchId).run();
}

export async function browserMsLast31Days(db: D1Database, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const row = await db.prepare(
    "SELECT COALESCE(SUM(browser_ms), 0) AS used_ms FROM collection_runs WHERE started_at >= ?"
  ).bind(since).first<{ used_ms: number }>();
  return row?.used_ms ?? 0;
}

export async function storeCards(
  db: D1Database,
  search: SearchRow,
  cards: JobCard[],
  now: string,
  isInitial: boolean
): Promise<number> {
  if (cards.length === 0) return 0;
  const statements: D1PreparedStatement[] = [];
  const today = kstDate(new Date(now));
  for (const card of cards) {
    statements.push(db.prepare(
      "INSERT INTO jobs (source, source_id, title, company, region, career, tags, posted_label, posted_at, deadline_label, deadline_date, url, raw_text, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source, source_id) DO UPDATE SET title = excluded.title, company = excluded.company, region = excluded.region, career = excluded.career, tags = excluded.tags, posted_label = excluded.posted_label, posted_at = excluded.posted_at, deadline_label = excluded.deadline_label, deadline_date = excluded.deadline_date, url = excluded.url, raw_text = excluded.raw_text, last_seen_at = excluded.last_seen_at"
    ).bind(card.source, card.sourceId, card.title, card.company, card.region, card.career, card.tags, card.postedLabel, card.postingDate, card.deadlineLabel, deadlineDate(card, today), card.url, card.rawText, now, now));
  }
  for (const card of cards) {
    statements.push(db.prepare(
      "INSERT OR IGNORE INTO search_jobs (search_id, source, source_id, matched_at, is_initial) VALUES (?, ?, ?, ?, ?)"
    ).bind(search.id, card.source, card.sourceId, now, isInitial ? 1 : 0));
  }
  const results = await db.batch(statements);
  return results.slice(cards.length).reduce((total, result) => total + (result.meta.changes > 0 ? 1 : 0), 0);
}

export async function listJobs(
  db: D1Database,
  options: { searchId?: string; view?: "all" | "unread" | "saved" | "hidden"; limit?: number; offset?: number } = {}
): Promise<{ jobs: Record<string, unknown>[]; total: number }> {
  const conditions: string[] = ["j.posted_at >= ?", "(j.deadline_date IS NULL OR j.deadline_date >= ?)"];
  const values: Array<string | number> = [cutoffDate(new Date()), kstDate(new Date())];
  let joins = "";
  if (options.searchId) {
    joins = " JOIN search_jobs sj ON sj.source = j.source AND sj.source_id = j.source_id";
    conditions.push("sj.search_id = ?");
    values.push(options.searchId);
  }
  switch (options.view) {
    case "unread": conditions.push("j.read_at IS NULL AND j.hidden = 0"); break;
    case "saved": conditions.push("j.saved = 1"); break;
    case "hidden": conditions.push("j.hidden = 1"); break;
    default: conditions.push("j.hidden = 0");
  }
  const from = " FROM jobs j" + joins + " WHERE " + conditions.join(" AND ");
  const totalRow = await db.prepare("SELECT COUNT(DISTINCT j.source || ':' || j.source_id) AS total" + from)
    .bind(...values).first<{ total: number }>();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = await db.prepare(
    "SELECT DISTINCT j.*" + from + " ORDER BY j.posted_at DESC, j.first_seen_at DESC LIMIT ? OFFSET ?"
  ).bind(...values, limit, offset).all<Record<string, unknown>>();
  return { jobs: rows.results, total: totalRow?.total ?? 0 };
}
export async function updateJobState(
  db: D1Database,
  source: string,
  sourceId: string,
  patch: { saved?: boolean; hidden?: boolean; read?: boolean }
): Promise<boolean> {
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.saved !== undefined) { fields.push("saved = ?"); values.push(patch.saved ? 1 : 0); }
  if (patch.hidden !== undefined) { fields.push("hidden = ?"); values.push(patch.hidden ? 1 : 0); }
  if (patch.read !== undefined) { fields.push("read_at = ?"); values.push(patch.read ? new Date().toISOString() : null); }
  if (!fields.length) throw new RangeError("변경할 상태가 없습니다.");
  values.push(source, sourceId);
  const result = await db.prepare(
    "UPDATE jobs SET " + fields.join(", ") + " WHERE source = ? AND source_id = ?"
  ).bind(...values).run();
  return result.meta.changes > 0;
}

export async function recentRuns(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(
    "SELECT r.*, s.query, s.source FROM collection_runs r JOIN searches s ON s.id = r.search_id ORDER BY r.started_at DESC LIMIT 30"
  ).all<Record<string, unknown>>();
  return result.results;
}

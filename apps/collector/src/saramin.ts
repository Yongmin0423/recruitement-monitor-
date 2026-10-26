import { parse } from "node-html-parser";

export interface JobCard {
  source: "saramin";
  sourceId: string;
  title: string;
  company: string | null;
  region: string | null;
  career: string | null;
  tags: string | null;
  postedLabel: string | null;
  postingDate: string | null;
  deadlineLabel: string | null;
  url: string;
  rawText: string;
}

export interface SearchFilter {
  query: string;
  region: string | null;
  excludeKeywords: string[];
}

function clean(value: string | undefined | null): string | null {
  const result = value?.replace(/\s+/g, " ").trim() ?? "";
  return result || null;
}

export function kstDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return value("year") + "-" + value("month") + "-" + value("day");
}

export function cutoffDate(date: Date, days = 30): string {
  return kstDate(new Date(date.getTime() - days * 86_400_000));
}

function dateFromLabel(label: string | null): string | null {
  const match = label?.match(/^등록일\s+(\d{2})\/(\d{2})\/(\d{2})/);
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return candidate.toISOString().slice(0, 10);
}

export function deadlineDate(job: JobCard, today: string): string | null {
  const label = job.deadlineLabel ?? "";
  const base = new Date(today + "T00:00:00Z");
  if (label.includes("오늘마감") || /^\d{1,2}시마감$/.test(label)) return today;
  if (label.includes("내일마감")) return new Date(base.getTime() + 86_400_000).toISOString().slice(0, 10);
  const dDay = label.match(/D-(\d+)/i);
  if (dDay) return new Date(base.getTime() + Number(dDay[1]) * 86_400_000).toISOString().slice(0, 10);
  const monthDay = label.match(/~\s*(\d{1,2})\/(\d{1,2})/);
  if (!monthDay || !job.postingDate) return null;
  const posted = new Date(job.postingDate + "T00:00:00Z");
  const month = Number(monthDay[1]);
  const day = Number(monthDay[2]);
  let year = posted.getUTCFullYear();
  const postedMonth = posted.getUTCMonth() + 1;
  if (month < postedMonth && postedMonth - month >= 6) year++;
  const result = new Date(Date.UTC(year, month - 1, day));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) return null;
  return result.toISOString().slice(0, 10);
}

export function isRecentOpen(job: JobCard, cutoff: string, today: string): boolean {
  if (!job.postingDate || job.postingDate < cutoff || job.postingDate > today) return false;
  const label = job.deadlineLabel ?? "";
  if (/^(?:마감|접수마감|채용마감|모집마감|마감됨|종료)/.test(label)) return false;
  const deadline = deadlineDate(job, today);
  return !deadline || deadline >= today;
}

export function saraminSearchUrl(query: string, page: number): string {
  if (page < 1 || page > 100 || !Number.isInteger(page)) throw new RangeError("Invalid search page");
  const url = new URL("https://www.saramin.co.kr/zf_user/search");
  url.searchParams.set("search_area", "main");
  url.searchParams.set("search_done", "y");
  url.searchParams.set("search_optional_item", "n");
  url.searchParams.set("searchType", "search");
  url.searchParams.set("searchword", query);
  url.searchParams.set("recruitSort", "reg_dt");
  url.searchParams.set("recruitPage", String(page));
  url.searchParams.set("recruitPageCount", "40");
  return url.toString();
}

export function parseSaraminCard(html: string): JobCard | null {
  const root = parse(html);
  const link = root.querySelector(".job_tit a[href*='rec_idx=']");
  const href = link?.getAttribute("href");
  if (!href) return null;
  const sourceId = new URL(href, "https://www.saramin.co.kr").searchParams.get("rec_idx");
  const title = clean(link?.getAttribute("title") ?? link?.innerText);
  if (!sourceId || !/^\d+$/.test(sourceId) || !title) return null;

  const condition = root.querySelectorAll(".job_condition > span").map((span) => clean(span.innerText));
  const career = condition.find((value) => value && /신입|경력|무관/.test(value)) ?? null;
  const company = clean(root.querySelector(".corp_name a")?.innerText);
  const region = condition[0] ?? null;
  const tags = clean(root.querySelector(".job_sector")?.innerText.replace(/(?:등록일|수정일)\s*\d{2}\/\d{2}\/\d{2}.*/, ""));
  const postedLabel = clean(root.querySelector(".job_day")?.innerText);
  const deadlineLabel = clean(root.querySelector(".job_date .date")?.innerText);
  const rawText = clean(root.innerText)?.slice(0, 2000) ?? title;

  return {
    source: "saramin", sourceId, title, company, region, career, tags,
    postedLabel, postingDate: dateFromLabel(postedLabel), deadlineLabel,
    url: "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=" + sourceId,
    rawText,
  };
}

export function matchesSearch(job: JobCard, filter: SearchFilter): boolean {
  // The source search already uses the keyword, including posting details absent from the list card.
  if (filter.region && !(job.region ?? "").includes(filter.region)) return false;
  const text = job.rawText.toLocaleLowerCase("ko");
  if (filter.excludeKeywords.some((term) => term && text.includes(term.toLocaleLowerCase("ko")))) return false;
  return true;
}

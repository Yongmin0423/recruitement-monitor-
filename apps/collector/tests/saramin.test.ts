import assert from "node:assert/strict";
import test from "node:test";
import { cutoffDate, deadlineDate, isRecentOpen, matchesSearch, parseSaraminCard, saraminSearchUrl } from "../src/saramin.ts";

const card = `<div class="area_job">
  <h2 class="job_tit"><a title="AI 네이티브 풀스택 엔지니어" href="/zf_user/jobs/relay/view?view_type=search&amp;rec_idx=55394019&amp;search_uuid=temporary">AI 네이티브 풀스택 엔지니어</a></h2>
  <div class="job_date"><span class="date">~ 11/25(수)</span></div>
  <div class="job_condition"><span><a>서울</a> <a>마포구</a></span><span>경력 3~10년</span><span>대졸↑</span></div>
  <div class="job_sector"><a>백엔드/서버개발</a>, <a>API</a><span class="job_day">등록일 26/10/26</span></div>
</div><div class="area_corp"><strong class="corp_name"><a>(주)예시회사</a></strong></div>`;

test("extracts stable ID and list fields from a real card shape", () => {
  const job = parseSaraminCard(card);
  assert.ok(job);
  assert.equal(job.sourceId, "55394019");
  assert.equal(job.company, "(주)예시회사");
  assert.equal(job.region, "서울 마포구");
  assert.equal(job.career, "경력 3~10년");
  assert.equal(job.postingDate, "2026-10-26");
  assert.equal(deadlineDate(job, "2026-10-26"), "2026-11-25");
  assert.equal(isRecentOpen(job, "2026-09-26", "2026-10-26"), true);
  assert.equal(job.url, "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=55394019");
  assert.equal(matchesSearch(job, { query: "백엔드", region: "서울", excludeKeywords: [] }), true);
  assert.equal(matchesSearch(job, { query: "백엔드", region: "부산", excludeKeywords: [] }), false);
});

test("rejects cards without a public posting ID", () => {
  assert.equal(parseSaraminCard("<h2 class='job_tit'><a>광고</a></h2>"), null);
});

test("builds a registration-date search URL without changing the query", () => {
  const url = new URL(saraminSearchUrl("백엔드 개발", 2));
  assert.equal(url.searchParams.get("searchword"), "백엔드 개발");
  assert.equal(url.searchParams.get("recruitSort"), "reg_dt");
  assert.equal(url.searchParams.get("recruitPage"), "2");
});

test("keeps the source keyword result and excludes old, edited-only or expired cards", () => {
  const job = parseSaraminCard(card);
  assert.ok(job);
  assert.equal(matchesSearch(job, { query: "프론트엔드", region: null, excludeKeywords: [] }), true);
  assert.equal(isRecentOpen(job, "2026-10-27", "2026-10-27"), false);
  const edited = parseSaraminCard(card.replace("등록일 26/10/26", "수정일 26/10/26"));
  assert.ok(edited);
  assert.equal(isRecentOpen(edited, "2026-09-26", "2026-10-26"), false);
  const expired = parseSaraminCard(card.replace("~ 11/25(수)", "~ 10/25(일)"));
  assert.ok(expired);
  assert.equal(isRecentOpen(expired, "2026-09-26", "2026-10-26"), false);
  const priorMonth = parseSaraminCard(card.replace("~ 11/25(수)", "~ 09/25(금)"));
  assert.ok(priorMonth);
  assert.equal(isRecentOpen(priorMonth, "2026-09-26", "2026-10-26"), false);
  assert.equal(cutoffDate(new Date("2026-10-26T00:00:00+09:00")), "2026-09-26");
});

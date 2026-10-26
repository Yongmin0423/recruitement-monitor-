"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Search = { id:string; query:string; region:string|null; enabled:number; last_success_at:string|null; backfill_next_page:number; backfill_complete:number; backfill_cutoff:string|null };
type Job = { source:string; source_id:string; title:string; company:string|null; region:string|null; career:string|null; tags:string|null; posted_label:string|null; posted_at:string|null; deadline_label:string|null; url:string; first_seen_at:string; hidden:number; saved:number; read_at:string|null };
type Status = { browserMsLast31Days:number; browserBudgetMs:number; runs:{ started_at:string; status:string; cards_seen:number }[] };
type View = "all"|"unread"|"saved"|"hidden";
const views: { id:View; label:string }[] = [{id:"all",label:"전체"},{id:"unread",label:"읽지 않음"},{id:"saved",label:"저장"},{id:"hidden",label:"숨김"}];
function date(value:string|null) { return value ? new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "아직 확인 전"; }
async function api<T>(path:string, options?:RequestInit):Promise<T> {
  const response = await fetch("/api/collector/"+path,{cache:"no-store",...options});
  const data:unknown = await response.json();
  if (!response.ok) throw new Error(data && typeof data==="object" && "error" in data ? String(data.error) : "요청에 실패했습니다.");
  return data as T;
}
export default function Dashboard() {
  const [searches,setSearches]=useState<Search[]>([]);
  const [jobs,setJobs]=useState<Job[]>([]);
  const [total,setTotal]=useState(0);
  const [status,setStatus]=useState<Status|null>(null);
  const [view,setView]=useState<View>("all");
  const [selected,setSelected]=useState("");
  const [query,setQuery]=useState("");
  const [region,setRegion]=useState("");
  const [exclude,setExclude]=useState("");
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [loaded,setLoaded]=useState(false);
  const checkedOnOpen=useRef(false);
  const refresh=useCallback(async()=>{
    try {
      const params=new URLSearchParams({view,limit:"100",offset:"0"}); if(selected) params.set("searchId",selected);
      const [s,j,st]=await Promise.all([api<{searches:Search[]}>("searches"),api<{jobs:Job[];total:number}>("jobs?"+params),api<Status>("status")]);
      setSearches(s.searches);setJobs(j.jobs);setTotal(j.total);setStatus(st);setError("");
    } catch(e) { setError(e instanceof Error?e.message:"목록을 불러오지 못했습니다."); }
    finally { setLoaded(true); }
  },[view,selected]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>{void refresh();},60000);return()=>window.clearInterval(timer);},[refresh]);
  useEffect(()=>{
    if (checkedOnOpen.current) return;
    checkedOnOpen.current=true;
    void (async()=>{
      try {
        const result=await api<{searches:Search[]}>("searches");
        const now=Date.now();
        const stale=result.searches.filter(search=>
          search.enabled && search.backfill_complete &&
          (!search.last_success_at || now-Date.parse(search.last_success_at)>=30*60*1000)
        );
        let checked=0;
        let newMatches=0;
        for (const search of stale) {
          const summary=await api<{status:string;newMatches:number}>("collect",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({searchId:search.id,onlyIfStaleMinutes:30})
          });
          if (summary.status==="success") { checked++;newMatches+=summary.newMatches; }
        }
        if (checked>0) {
          await refresh();
          setNotice("접속 시 최신 공고 확인 완료 · 새 공고 "+newMatches+"건");
        }
      } catch(e) {
        setError(e instanceof Error?e.message:"접속 시 자동 확인에 실패했습니다.");
      }
    })();
  },[refresh]);  async function add(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy("add");setError("");setNotice("");
    try {
      const created=await api<{search:Search}>("searches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:query.trim(),region:region.trim(),excludeKeywords:exclude.split(",").map(x=>x.trim()).filter(Boolean)})});
      setQuery("");setRegion("");setExclude("");await refresh();await runBackfill(created.search.id);
    } catch(e) {setError(e instanceof Error?e.message:"검색 조건을 추가하지 못했습니다.");}
    finally {setBusy("");}
  }
  async function runBackfill(searchId:string) {
    setBusy("backfill:"+searchId);setError("");
    try {
      for (let step=0;step<40;step++) {
        const result=await api<{pagesRead:number;addedMatches:number;nextPage:number;complete:boolean}>("collect",{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchId,backfill:true})
        });
        if (!result.complete && result.pagesRead===0) throw new Error("수집을 진행하지 못했습니다. 사용량 한도를 확인해 주세요.");
        setNotice(result.complete
          ? "최근 한 달 공고 수집 완료"
          : "최근 한 달 공고 수집 중 · "+(result.nextPage-1)+"페이지 확인");
        await refresh();
        if (result.complete) return;
      }
      throw new Error("수집 범위가 너무 넓습니다. 잠시 후 이어서 진행하세요.");
    } catch(e) {setError(e instanceof Error?e.message:"지난 공고를 불러오지 못했습니다.");}
    finally {setBusy("");}
  }
  async function loadMore() {
    setBusy("more");
    try {
      const params=new URLSearchParams({view,limit:"100",offset:String(jobs.length)});
      if(selected) params.set("searchId",selected);
      const result=await api<{jobs:Job[];total:number}>("jobs?"+params);
      setJobs(current=>[...current,...result.jobs]);setTotal(result.total);
    } catch(e) {setError(e instanceof Error?e.message:"공고를 더 불러오지 못했습니다.");}
    finally {setBusy("");}
  }  async function toggle(search:Search) {
    setBusy(search.id);
    try {await api("searches/"+search.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!search.enabled})});await refresh();}
    catch(e) {setError(e instanceof Error?e.message:"상태를 바꾸지 못했습니다.");} finally {setBusy("");}
  }
  async function collect(search:Search) {
    setBusy("collect:"+search.id);setNotice("");setError("");
    try {
      const result=await api<{status:string;reason?:string;newMatches:number;initial:boolean}>("collect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchId:search.id})});
      setNotice(result.status==="skipped" ? result.reason??"이번 확인은 건너뛰었습니다." : result.initial ? "첫 확인을 마쳤습니다. 다음부터 새 공고를 구분합니다." : "확인 완료 · 새 공고 "+result.newMatches+"건");
      await refresh();
    } catch(e) {setError(e instanceof Error?e.message:"공고를 확인하지 못했습니다.");} finally {setBusy("");}
  }
  async function update(job:Job,patch:{saved?:boolean;hidden?:boolean;read?:boolean}) {
    setBusy(job.source+job.source_id);
    try {await api("jobs/"+job.source+"/"+job.source_id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});await refresh();}
    catch(e) {setError(e instanceof Error?e.message:"공고 상태를 바꾸지 못했습니다.");} finally {setBusy("");}
  }
  async function logout(){await fetch("/api/session",{method:"DELETE"});window.location.href="/login";}
  const last=status?.runs[0],hours=(status?.browserMsLast31Days??0)/3600000,budget=(status?.browserBudgetMs??0)/3600000;
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">◎</span><div><strong>채용 레이더</strong><small>PERSONAL JOB MONITOR</small></div></div>
      <div className="sidebar-group"><p className="sidebar-label">검색 조건 <span>{searches.length}</span></p>{searches.length===0&&<p className="sidebar-empty">첫 조건을 추가해 주세요.</p>}
        {searches.map(s=><button key={s.id} className={"search-link "+(selected===s.id?"active":"")} onClick={()=>setSelected(selected===s.id?"":s.id)}><i className={"source-dot "+(!s.enabled?"off":"")}/><span><strong>{s.query}</strong><small>{s.region||"전국"} · 사람인</small></span></button>)}
      </div><div className="sidebar-bottom"><span>한국 시간 기준 자동 확인</span><button onClick={logout}>로그아웃</button></div></aside>
    <main className="main-area"><header className="topbar"><div><span className="eyebrow">MY JOB RADAR</span><h1>내 채용공고</h1><p>원하는 조건을 저장하고 새로 올라온 공고를 확인하세요.</p></div><div className="topbar-actions"><span className="live-pill"><i/> 개인용</span><button className="ghost-button" onClick={()=>void refresh()}>새로고침</button></div></header>
      {error&&<div className="alert error" role="alert">{error}</div>}{notice&&<div className="alert success" role="status">{notice}</div>}
      <section className="overview"><div className="metric"><span>검색 조건</span><strong>{searches.filter(s=>s.enabled).length}<small>개 활성</small></strong><p>사람인 검색부터 연결</p></div><div className="metric"><span>현재 목록</span><strong>{total}<small>건</small></strong><p>최근 30일 · 진행 중 공고</p></div><div className="metric"><span>마지막 확인</span><strong className="metric-date">{date(last?.started_at??null)}</strong><p>{last?(last.status==="failed"?"확인 실패":last.cards_seen+"건 확인"):"검색 조건을 추가하세요"}</p></div><div className="metric"><span>Browser Run 사용량</span><strong>{hours.toFixed(2)}<small> / {budget.toFixed(0)}시간</small></strong><div className="usage-track"><i style={{width:Math.min(100,budget?hours/budget*100:0)+"%"}}/></div></div></section>
      <section className="content-grid"><div className="content-main"><div className="section-heading"><div><span className="eyebrow">POSTINGS</span><h2>채용공고</h2></div><span className="muted">등록일 최신순 · {jobs.length}/{total}건 표시</span></div><div className="tabs" role="tablist">{views.map(v=><button key={v.id} role="tab" aria-selected={view===v.id} className={view===v.id?"selected":""} onClick={()=>setView(v.id)}>{v.label}</button>)}</div><div className="job-list">
        {!loaded&&<p className="empty-state">공고를 불러오는 중입니다…</p>}{loaded&&jobs.length===0&&<div className="empty-state"><span className="empty-icon">◌</span><strong>아직 표시할 공고가 없습니다</strong><p>검색 조건을 추가한 뒤 첫 확인을 실행해 보세요.</p></div>}
        {jobs.map(j=><article key={j.source+":"+j.source_id} className={"job-card "+(j.read_at?"read":"")}><div className="job-top"><span className="source-tag">사람인</span><span className="job-time">등록 {j.posted_at??"날짜 미확인"}</span></div><a className="job-title" href={j.url} target="_blank" rel="noopener noreferrer" onClick={()=>{if(!j.read_at)void update(j,{read:true});}}>{j.title} <span>↗</span></a><div className="job-company">{j.company||"회사 정보 없음"}</div><div className="job-meta"><span>{j.region||"지역 미표시"}</span>{j.career&&<span>{j.career}</span>}{j.posted_label&&<span>{j.posted_label}</span>}{j.deadline_label&&<span>마감 {j.deadline_label}</span>}</div>{j.tags&&<p className="job-tags">{j.tags}</p>}<div className="job-actions"><button disabled={!!busy} onClick={()=>void update(j,{saved:!j.saved})}>{j.saved?"★ 저장됨":"☆ 저장"}</button><button disabled={!!busy} onClick={()=>void update(j,{read:!j.read_at})}>{j.read_at?"읽지 않음":"읽음 표시"}</button><button disabled={!!busy} onClick={()=>void update(j,{hidden:!j.hidden})}>{j.hidden?"숨김 해제":"숨기기"}</button></div></article>)}{jobs.length<total&&<button className="load-more" disabled={!!busy} onClick={()=>void loadMore()}>공고 더 보기 ({total-jobs.length}건 남음)</button>}</div></div>
      <div className="rail"><section className="panel"><div className="panel-heading"><span className="eyebrow">NEW SEARCH</span><h2>검색 조건 추가</h2></div><p className="panel-description">직무 키워드와 지역을 입력하세요. 사람인 최신 공고를 주기적으로 확인합니다.</p><form className="search-form" onSubmit={add}><label htmlFor="query">직무·키워드</label><input id="query" value={query} onChange={e=>setQuery(e.target.value)} placeholder="예: 프론트엔드" minLength={2} maxLength={80} required/><label htmlFor="region">지역 <span>선택</span></label><input id="region" value={region} onChange={e=>setRegion(e.target.value)} placeholder="예: 서울" maxLength={40}/><label htmlFor="exclude">제외 키워드 <span>선택</span></label><input id="exclude" value={exclude} onChange={e=>setExclude(e.target.value)} placeholder="예: 인턴, 계약직"/><button className="primary-button" disabled={!!busy}>조건 추가 <span>→</span></button></form></section>
      <section className="panel"><div className="panel-heading"><span className="eyebrow">SAVED SEARCHES</span><h2>확인 설정</h2></div>{searches.length===0?<p className="panel-description">등록된 조건이 없습니다.</p>:searches.map(s=><div className="search-control" key={s.id}><div><strong>{s.query}</strong><small>{s.region||"전국"} · 마지막 {date(s.last_success_at)}</small></div>{!s.backfill_complete&&<small>지난 30일 수집 {Math.max(0,s.backfill_next_page-1)}페이지 완료</small>}<div className="control-buttons">{!s.backfill_complete&&<button disabled={!!busy||!s.enabled} onClick={()=>void runBackfill(s.id)}>{busy==="backfill:"+s.id?"불러오는 중…":"지난 30일 채우기"}</button>}<button disabled={!!busy||!s.enabled} onClick={()=>void collect(s)}>{busy==="collect:"+s.id?"확인 중…":"지금 확인"}</button><button className={s.enabled?"enabled":""} disabled={!!busy} onClick={()=>void toggle(s)}>{s.enabled?"켜짐":"꺼짐"}</button></div></div>)}</section>
      <section className="panel schedule-panel"><span className="eyebrow">SCHEDULE</span><h2>자동 확인 시간</h2><p>평일 08:00, 09:00–17:00 매시간, 19:00, 21:00<br/>주말 10:00, 16:00, 22:00</p><small>한국 시간 기준 · 야간에는 쉬어갑니다.</small></section></div></section>
    </main></div>;
}

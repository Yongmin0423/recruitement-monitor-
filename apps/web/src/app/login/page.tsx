"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        setError(data.error ?? "로그인할 수 없습니다.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-shell">
    <section className="login-card">
      <div className="brand-mark">◎</div>
      <p className="eyebrow">MY JOB RADAR</p>
      <h1>새 공고를<br />놓치지 않도록.</h1>
      <p className="muted">내가 정한 조건의 채용공고를 한곳에서 확인합니다.</p>
      <form onSubmit={submit} className="login-form">
        <label htmlFor="password">비밀번호</label>
        <input id="password" type="password" autoComplete="current-password" value={password}
          onChange={(event) => setPassword(event.target.value)} required />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "확인 중…" : "들어가기"}</button>
      </form>
      <p className="login-foot">개인용 채용공고 모니터</p>
    </section>
  </main>;
}

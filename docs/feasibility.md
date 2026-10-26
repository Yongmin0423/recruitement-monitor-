# 채용공고 수집 가능성 검증

검증일: 2026-10-26 (한국시간)

## 결론

Cloudflare 계정의 Browser Run Playground에서 **다섯 사이트 모두 공개 검색 또는 목록 페이지의 공고 링크를 실제로 추출했다.** 별도 로그인, API 신청, LLM 호출 없이 Browser Run의 Scrape Quick Action과 CSS 선택자를 사용했다. 이는 소량의 단발 검증 결과이며, 장기 운영 안정성이나 사이트별 수집 허용을 보증하지 않는다.

| 사이트 | Cloudflare 실측 | 주요 설정과 주의점 |
| --- | --- | --- |
| [사람인](https://www.saramin.co.kr/zf_user/search?searchword=%EB%B0%B1%EC%97%94%EB%93%9C) | 등록일순 백엔드 검색에서 **고유 공고 ID 40개**와 제목·링크 추출. 같은 조건으로 2회 실행하니 40개 ID와 순서가 모두 동일 | 선택자 h2 a[href*="rec_idx="]. 검색어와 무관한 제목도 포함되어 로컬 필터 필요 |
| [잡코리아](https://www.jobkorea.co.kr/Search/?stext=%EB%B0%B1%EC%97%94%EB%93%9C&tabType=recruit&ord=RegDtDesc) | 등록일순 백엔드 검색에서 **고유 공고 ID 21개** 추출 | 선택자 a[href*="/Recruit/GI_Read/"]. 로고와 제목 링크의 중복, 광고 공고 처리 필요 |
| [리멤버](https://career.rememberapp.co.kr/job/postings) | 백엔드 검색 URL에서 **고유 공고 ID 66개**와 카드 텍스트 추출 | Network Idle 2 대기가 필요했다. 추천/고연봉 영역의 검색어 무관 공고도 섞여 검색 결과 영역 선택 또는 로컬 필터 필요 |
| [원티드](https://www.wanted.co.kr/wdlist?country=all&job_sort=job.latest_order&years=-1) | 최신순 목록에서 **고유 공고 ID 20개**와 카드 텍스트 추출 | Network Idle 2 대기가 필요했다. 기본 Load에서는 공고 0개. 직무·지역 필터의 Cloudflare 실행은 추가 검증 필요 |
| [링크드인 공개 검색](https://www.linkedin.com/jobs/search/?keywords=backend&location=South%20Korea&sortBy=DD) | Backend·South Korea 검색에서 **고유 공고 ID 60개**와 제목·링크 추출 | Cloudflare에서는 공개 검색 결과를 받았지만 일반 로그인 전 브라우저는 authwall로 이동했다. 지역·정렬 조건 정확성과 반복 안정성 추가 검증 필요 |

링크드인은 기존의 보류 판정을 **조건부 수집 후보**로 변경한다. 한 환경에서 성공했다고 계속 접근 가능하다고 가정하지 않는다.

## 반복 조회 확인

- 사람인: Cloudflare Browser Run에서 같은 검색을 두 번 실행했다. 각 40개 고유 ID가 완전히 같고 순서도 같았다. 따라서 공고 ID 기반 중복 제거의 최소 동작을 확인했다.
- 원티드: 일반 브라우저에서 최신순 첫 20건을 새로고침하니 20개 ID와 순서가 같았다. Cloudflare에서는 한 차례 성공했다.
- 다른 사이트는 Cloudflare 반복 조회를 아직 하지 않았다.

## 추출 방식과 해석

이번 실험은 LLM을 사용하지 않았다. CSS 선택자로 목록의 링크와 텍스트를 추출했다. 제목·회사·위치·경력은 사이트별 카드 구조를 정확히 선택하고 결과를 표준 필드로 매핑하는 작업이 남아 있다. 목록만으로 부족한 필드에 한해서 신규 공고에만 AI 추출을 적용하는 설계를 유지한다.

Cloudflare의 Scrape Quick Action은 브라우저가 사이트를 열고 CSS 요소의 텍스트, HTML, 속성을 반환한다. [Cloudflare 공식 문서](https://developers.cloudflare.com/browser-run/quick-actions/scrape-endpoint/)도 동적 페이지에서 기본 로딩 완료 시점보다 늦게 데이터가 나타날 수 있으므로 로딩 대기 설정을 권장한다. 이번 원티드·리멤버의 0건 결과는 Network Idle 2 설정 후 해결됐다. 다만 결과에는 해당 검색 목록 외 추천 영역이 섞일 수 있다.

## 비용에 반영할 점

이번 검증은 Browser Run Quick Actions 10회를 실행했고 AI 추출은 호출하지 않았다. 2026-10-26 Cloudflare 대시보드에는 월 누적 브라우저 사용 0.02시간(약 1.2분), 청구 사용량 추가 비용 $0.00으로 표시됐다. 이 값은 계정 전체의 현재 표시값이며 기존 Workers Paid 월 구독료는 별개다. [Cloudflare 공식 요금표](https://developers.cloudflare.com/browser-run/pricing/)에 따르면 Quick Actions는 브라우저 시간으로만 과금된다. Workers Paid에는 월 10시간이 포함되고 초과분은 시간당 $0.09다. 정확한 월 비용은 각 사이트의 반복 실행 시간을 계측하고 계정의 다른 Browser Run 사용량을 합산해야 한다. 현재 기획서의 10~30초/페이지 가정은 아직 실측 평균으로 교체할 수 없다.

## 남은 검증과 구현 순서

1. **사람인 1개 검색 조건**으로 Worker 수집기를 구현한다. 40개 ID의 재조회가 검증됐으므로 첫 구현 대상에 적합하다.
2. 검색 결과 영역의 카드에서 제목·회사·지역·경력·공고 ID를 구조화한다. 광고 및 검색어 무관 공고를 구분한다.
3. D1에 출처+공고 ID로 중복 방지 키를 저장하고, 재조회에서 신규만 감지한다.
4. 나머지 4곳에 카드 선택자와 로컬 필터를 적용한 뒤 두 차례 이상 반복 측정한다.
5. 사이트별 실제 브라우저 시간, 오류율, 결과 반영 지연을 기록해 알림 주기와 월 비용을 다시 계산한다.
6. 각 사이트의 이용약관·robots 규칙·요청 제한을 확인하고 이에 맞는 실행 주기를 정한다.

현재 검증은 **공개 목록의 기술적 추출 가능성**까지 완료했다. 장기 안정성, 접근 조건, 전체 필드 정확도, 배포 후 비용은 다음 단계다.

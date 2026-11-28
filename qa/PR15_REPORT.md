# PR15 · Flight Readiness

기준선은 PR #14를 포함한 main `c04e74b`입니다. 이 PR의 빌드 이름은 `v4.0.0-rc.1`입니다. 아래 최종 검증이 필요한 상태에서 정식 출시, 운영 배포 또는 성능 기준 충족을 선언하지 않습니다.

## 재현과 증거

- `node --test tests/*.test.js`에서 기준선 단위 검사 75건을 확인했습니다. 변경분의 전체 회귀 및 최신 실행 결과는 [PR #15 검사](https://github.com/teamprotofelix/asteria_bridge/pull/15/checks)에서 확인합니다.
- `python tests/release_pr15.py`는 Chromium 실 HTTP에서 root와 `/asteria/`를 열고 CSP·PWA 스코프와 네레이드 오프라인 재실행을 검사합니다. 가상 시계로 32구역과 왕복 10회를 확인합니다. 데스크톱/모바일 캡처, 같은 네레이드 구역의 Ultra/Compatibility 캡처와 `integration.json`을 남깁니다.
- 성능 기록은 ANGLE SwiftShader에서 UI 준비까지의 경과 시간, 시작 시 받은 응답 바이트, 화면별 90개 rAF 간격의 p50/p95입니다. GPU 실행 시간이나 실제 FPS 보장은 아닙니다. 서버는 localhost, 장치 배율 1이며 캐시가 비어 있는 새 브라우저 컨텍스트에서 측정합니다.
- `python tests/release_pr15.py --seconds 1800` 또는 `--seconds 7200`으로 실제 시간 자동 관측을 별도 진행합니다. `soak.json`에 구역, DOM 수, 리스너 수, JS 힙과 브라우저 태스크 누적 시간을 기록합니다. CPU 사용률, 오디오 노드, VRAM 검증과 실기기 시험은 별개입니다.
- `python scripts/package_release.py`의 ZIP, CRC 확인, 파일별 해시 목록과 ZIP SHA-256은 [Actions 산출물](https://github.com/teamprotofelix/asteria_bridge/actions) `asteria-v4-release-review`에 게시합니다. ZIP을 실제로 풀어 `python tests/release_pr15.py --archive-smoke --root <extracted>`로 실행합니다.

## 기능별 확인 기준

**회귀 게이트**는 아래에 적은 스크립트의 이번 커밋 실행 상태를 반영합니다. 이전 커밋의 PASS를 이번 커밋에 전용하지 않습니다. **미검증**은 별도 장치나 계측이 필요한 항목입니다.

| ID | 항목 | 증거 또는 남은 범위 |
|---|---|---|
| B01 | 기존 32구역·30개 3D | `release_pr15.py`의 구역별 도착·렌더 모드 및 `browser_smoke.py`의 그룹·코드 |
| B02 | 360°, 접근, 순회, 지도, 사건, 마리, 음향 | `browser_smoke.py` |
| B03 | OOM, context loss, 에셋/시작 실패, retry | `browser_smoke.py`의 강제 실패 검증 |
| B04 | 정적 root·하위 경로 | `release_pr15.py` 및 추출본 스모크 |
| B05 | 320×568, 390×844, 768×1024, 844×390, 1440×900, 1920×1080, 2560×1440 | `release_pr15.py`의 핵심 버튼·가로 넘침, 데스크톱·모바일 캡처 |
| B06 | 키보드·초점·동작 줄이기 | 도움말 모달과 Esc, `browser_smoke.py`, `command_pr13.py`, `marie_pr11.py` |
| V01 | 32구역 에셋·출처 | `tests/assets.test.js`, [출처](../ASSET_LICENSES.md), 구역별 렌더 |
| V02 | 고유 배경과 대표 5개 고해상도 | [PR09의 비교 캡처](PR09_REPORT.md), `quality_pr9.py`의 실제 에셋 요청, 네레이드 비교 캡처 |
| V03 | 6종 프리셋·반복 안정성 | `quality_pr9.py`, `release_pr15.py` 왕복 10회. 실측 VRAM은 미검증 |
| V04 | 광원·대기·고리·렌즈 | [PR09 아트 검수](PR09_REPORT.md), `browser_smoke.py`의 고리 통과·관측. 실제 천체 물리 재현은 범위 밖 |
| R01 | 실내 충돌과 착석 20회 | `bridge_pr10.py` |
| R02 | 문·조명·음향·mute | `bridge_pr10.py`, `browser_smoke.py` |
| M01 | 실모델·행동과 애니메이션 | `marie_pr11.py`, `marie.test.js`, 실제 Chromium 마리 캡처 |
| M02 | 순찰·충돌·워프·경보 우선순위 | `marie_pr11.py`, `marie.test.js` |
| M03 | 드론 및 차 요청 취소·중복·복구 | `marie_pr11.py`, `marie.test.js` |
| F01 | 6DOF·독립 시점 | `flight_pr12.py`, `flight.test.js` |
| F02 | 관성·충돌·자동 항법 | `flight_pr12.py`, `flight.test.js` |
| F03 | 워프 실패·지도·방문 기록 | `flight_pr12.py`, `browser_smoke.py` |
| E01 | 21종 사건과 응답 | `events.test.js`, `flight_pr12.py`, `browser_smoke.py` |
| E02 | 일식·일출·위성·고리 조건 | `events.test.js`, `flight.test.js`, `flight_pr12.py`의 시뮬레이션 기하 |
| I01 | 로컬 명령·확인·실패 분리 | `marie-command.test.js`, `command_pr13.py` |
| I02 | 외부 응답 검증·429·timeout | `marie-command.test.js`, 격리된 HTTPS 응답을 쓰는 `command_pr13.py` |
| I03 | 비밀정보와 기본 네트워크 | 대상 소스와 배포 텍스트에서 일반적인 토큰/비밀키 패턴 미검출. 기본 HTTP 요청 출처 및 차단 정책 검사, 사용자 승인 HTTPS 응답 테스트 |
| P01 | 저장 동의·기존 기록·백업 | `voyage-store.test.js`, `voyage_pr14.py`의 네 동의 조합과 다중 탭 |
| P02 | 오프라인 파일·업데이트 | `voyage_pr14.py`와 `release_pr15.py` |
| P03 | 사용자 지정 항로 | `voyage_pr14.py`의 3개 항로, 종료, 일시정지, 실패 회복 |
| Q01 | 실제 브라우저 회귀 | Chromium 및 SwiftShader. Firefox·WebKit은 미검증 |
| Q02 | 30분·2시간 관측 | 가속 회귀와 실제 시간 시험을 분리. 실기기, 2시간 및 오디오 노드 지속 사용은 미검증 |
| Q03 | 실기기 성능 | 미검증. SW 렌더 수치는 `integration.json` 참조. VRAM 실측 없음 |
| Q04 | ZIP·롤백·CNAME | CRC, SHA-256, root·하위 경로 추출본 실행, 기존 CNAME. 배포·롤백 절차는 [README](../README.md) |

Ultra 큐브의 4096px RGBA 6면은 밉맵·다른 텍스처를 제외한 이론값으로 384 MiB입니다. 대표 5개 구역에 적용되고 다른 27개 구역은 Low/Medium 에셋을 사용합니다. 시뮬레이션 기하와 거리 SU는 가상 단위입니다. 충분한 실기기 검증이 이뤄질 때까지 60fps 데스크톱·30fps 모바일 목표의 달성을 판정하지 않습니다.

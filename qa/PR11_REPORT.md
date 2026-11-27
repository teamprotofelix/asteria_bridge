# PR11 · Living Marie

기준 main `07796c447c9358ece87ffdfd1fbd57c238e5dad2`, PR #10 병합 후.

| 영역 | 구현·검사 |
|---|---|
| 캐릭터 | 16관절, 12클립, 흑백 제복·머리 장식·트레이와 잔. 가까운 위치에서 상세 모델, 먼 위치에서 경량 메시 |
| 렌더 | WebGL 함교의 실제 깊이 검사, 구역 조명 반영, 근거리 조작에서 자세 확인 |
| 행동 | 점검·순찰·관측·동행·보고·휴식·위험 감시·항해 감시·차·드론을 우선순위에 따라 전환 |
| 동선 | PR10의 구역·문·콘솔 충돌을 사용하는 A*와 선분 검사, 카메라와 간격 유지, 경로가 막히면 대기 |
| 차 | 준비·트레이·수령 단계, 경보나 항해 중 대기 후 재개, 중복 요청 방지 |
| 드론 | 출격·조사·귀환·취소와 2D 관측창 연출, 신호 교체·워프 시 세션 폐기, 모의 결과 표기 |
| 폴백 | Canvas 지원 요청과 보고, 동작 줄이기에서 보행 및 연속 동작 중지, 숨긴 탭에서 업무 시간 정지 |

## 에셋과 재현

- [검토용 4방향 렌더](pr11/turnaround.webp)
- [해상도별 에셋 및 해시](../assets/crew/manifest.json)
- WebGL의 런타임 메시와 GLB는 `marie-rig.js`에서 같은 기하와 재질을 생성합니다. GLB는 독립 검토와 편집용입니다. 애플리케이션은 GLB를 별도로 다운로드하지 않습니다.
- `node assets/build_marie.cjs`로 원본을 재현합니다. 두 GLB는 Blender 4.3용 내장 glTF 가져오기 도구로 확인할 수 있습니다. `blender -b --python assets/render_marie_review.py`는 상세 모델을 네 각도에서 렌더합니다.

## 검사

- `node --test tests/*.test.js`
- `python tests/marie_pr11.py`는 실제 HTTP WebGL과 모바일 Canvas에서 동행, 동작 줄이기, 위험 중 차 예약, 드론 취소와 신호 교체를 확인합니다. 자세와 함교 장면 및 60프레임 측정치를 Actions의 `marie-pr11-captures`에 저장합니다.
- `python tests/browser_smoke.py`, `python tests/quality_pr9.py`, `python tests/bridge_pr10.py`는 기존 기능을 검증합니다. 관련 이전 기준선은 PR #10의 통과 실행을 참조하며 이번 작업에서 해당 이전 커밋을 별도로 재실행하지 않았습니다.

상세 GLB는 27,534 삼각형, 경량 GLB는 9,636 삼각형입니다. 비인덱스 WebGL 정점 버퍼는 각각 약 3.15 MiB와 1.10 MiB입니다. 이 값은 전체 VRAM 사용량과 다릅니다. 프레임 측정은 960×650 Chromium SwiftShader의 전체 장면입니다. 실기기, 캐릭터 단독 렌더 비용, 포토리얼 재질, 연속 가중치 스키닝과 완전한 발 IK는 이 단계에서 검증하거나 구현하지 않았습니다.

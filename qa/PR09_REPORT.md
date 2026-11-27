# PR09 검증 기록

기준 main `85ee12d15708b284609bd3e9091c129a7ab1c991`, 의존 PR #8. 대상 브랜치 `v4/09-visuals`. GitHub PR의 헤드 및 자동 생성 diff가 검토 대상입니다.

## 변경 사항

| 파일 | 변경 |
|---|---|
| `assets/build_v4.py`, `assets/v4/` | 32개 구역의 별·성운·은하 방향장, 두 행성 표면, 대표 5종 8K 원본 및 품질별 실제 WebP |
| `sky-assets.js`, `app.js` | 상대 경로 지연 로드, 면별 순차 디코딩, 실제 크기 검증, 실패 시 등급 하향, 출항 전 취소 |
| `space.js` | 구역별 주광원, 지구형 구름·반사·야간 발광, 입체 유적 모듈, 타원형 파편, 광구 변화 |
| `index.html`, `style.css` | 그래픽 품질 선택, 에셋·렌더 해상도·FPS·텍스처 수·사유 표시 |
| `tests/` | 해시·패킹·품질 요청·취소·전체 구역 회전 및 화면 재현 |

## 증거

- [대표 5종 전후 비교](pr09/before-after.webp)
- [32개 구역 접촉시트](pr09/all-sectors.webp)
- [데스크톱 품질 창](pr09/desktop-quality.png) 및 [모바일 품질 창](pr09/mobile-quality.png)
- [프레임·텍스처 측정 원시 기록](pr09/measurements.json)

Chromium SwiftShader로 31회 연속 구역 전환 중 실제 생성·해제된 WebGL 텍스처를 추적했습니다. 시작과 종료 시 렌더 모드를 확인하고, 32개 구역의 프레임이 서로 달라야 검사가 통과합니다. 활성·최대 텍스처는 각각 3개입니다. 명시적 RGBA 면 크기는 512/1024/2048/4096일 때 큐브 하나당 6/24/96/384 MiB입니다. 디코더와 하드웨어의 실제 VRAM은 따로 측정해야 합니다.

프레임 시간은 실제 RAF 간격 60개에서 p50/p95를 계산했습니다. PC와 모바일 수치는 로컬 Chromium 소프트웨어 렌더링 및 모바일 뷰포트 에뮬레이션 결과입니다.

## QA 기록

| ID | 결과 |
|---|---|
| B01 | PASS · 32개 구역, 30개 WebGL 3D, 2개 WebGL 360°, 접촉시트 확인 |
| B02–B03 | Chromium 기존 기능 회귀와 강제 OOM·컨텍스트 손실·초기 재시도 검사. 별도로 실제 큐브 실패 하향 및 출항 취소 검증 |
| B04 | PASS · 상대 경로로 정적 서버 루트 및 하위 경로 부팅 |
| B05 | PASS · 그래픽 품질 UI를 320×568, 390×844, 768×1024, 844×390, 1440×900, 1920×1080, 2560×1440에서 열고 닫음 |
| B06 | 품질·취소는 키보드와 기본 대화상자 포커스를 사용. 전체 조작 회귀는 브라우저 검사에 포함 |
| V01 | PASS · 32개 배경과 81개 바이너리 SHA-256 대조 |
| V02 | 부분 검증 · 전 구역 캡처 및 대표 5개 전후 비교. 모든 구역에 대해 극점·밴딩 수동 판독은 미실행 |
| V03 | PASS · 여섯 프리셋을 실행. 1920×900 Low 740×347, Medium 1080×506, High 1600×750, Ultra 1920×900. 단계별 실제 자산 요청 및 텍스처 추적 확인 |
| V04 | 부분 검증 · 샘플 장면 및 기존 관측 회귀 검사. 모든 물리적 현상의 정량 검증은 범위 밖 |

## 재현

```sh
pip install playwright==1.62.0 pillow numpy
python -m playwright install chromium
node --test tests/events.test.js tests/assets.test.js
python tests/browser_smoke.py
python tests/quality_pr9.py
python tests/layout_pr9.py
git worktree add --detach ../baseline 85ee12d15708b284609bd3e9091c129a7ab1c991
python tests/visuals_pr9.py --baseline ../baseline --output qa/pr09
python assets/build_v4.py   # 신규 생성은 assets/v4가 없는 별도 작업 사본에서 실행
```

설치된 Chromium을 쓰려면 `CHROMIUM_BIN`에 실행 파일 경로를 지정합니다. 라이선스와 앱 로드 대상은 [에셋 출처](../ASSET_LICENSES.md) 및 [manifest](../assets/v4/manifest.json)를 확인합니다.

## 범위와 제한

- 30개 실시간 장면과 2개 360° 구역이 Chromium에서 동작합니다. Compatibility는 기존 WebGL 파노라마이며 WebGL 오류 시 Canvas로 전환됩니다. 필수 파노라마 요청 실패 시 출발지에 머뭅니다.
- 32개 모두 512/1024px 면입니다. 고해상도 2048/4096px 면 및 직접 샘플링한 8192×4096 원본은 대표 5종에 적용했습니다. 모든 구역의 별은 구역별 시드로 생성됩니다. 16K 원본 및 전 구역의 High/Ultra는 포함하지 않았습니다.
- 신규 4096×2048 알베도는 Nereid와 Gaia에 적용했습니다. 다른 구역은 manifest에 표시한 기존 표면을 사용합니다. 구름·야간 조명·반사를 포함한 추가 재질은 셰이더 근사입니다. 별도 normal/height/PBR 지도, 파편 메시 LOD 및 실제 천체 물리는 미구현입니다.
- 메모리는 활성 텍스처 수와 디코딩 해상도로 평가했습니다. 실기기 및 별도의 GPU VRAM 계측은 미실행입니다.
- 정적 서버 테스트를 위 명령으로 재현할 수 있습니다. GitHub Actions 실행은 코드 검사와 구분해 기록합니다.

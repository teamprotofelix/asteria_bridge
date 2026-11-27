# PR10 · Habitable Bridge

- 기준 main `644eff1850fdded96f29cff9c5c4ff7d8e46b4fd`, PR #9 병합 기준.
- `bridge-layout.js`는 함교·연결 통로·라운지의 보행 경계, 기물 충돌, 좌석·문·콘솔 위치와 마리용 웨이포인트를 포함합니다.
- `bridge-room.js`는 동일 좌표를 사용하는 절차형 메시와 금속·직물·발광 셰이더입니다. 기존 깊이 검사 및 투명 창 합성을 사용합니다.
- `app.js`는 기존 360° 시야와 보행·착석 자세를 관리합니다. 상태가 바뀌면 `#bridge`에서 `asteria:bridge`(seat, stand, hatch)를 발행합니다.
- `bridge-audio.js`는 기존 Web Audio 그래프에서 위치와 거리에 따른 스테레오 팬과 감쇠를 계산합니다. 기본 OFF와 숨김 탭 음소거는 유지합니다.

| 항목 | 검사 |
|---|---|
| 보행, 기물, 경계, 문, 카메라 | `node --test tests/bridge-layout.test.js`, `python tests/bridge_pr10.py` |
| 착석 20회, 출입문 끼임 방지, 좌석 워프 복귀, 모바일 상호작용, 광원 | `python tests/bridge_pr10.py` |
| 기존 360°, 마리, 음향과 GPU 폴백 | `python tests/browser_smoke.py` |
| 기존 그래픽 품질 6종 | `python tests/quality_pr9.py` |

GitHub Actions의 **bridge-pr10-captures** 아티팩트에 실제 정적 HTTP 렌더링을 저장합니다. 정면, 우현, 후방, 함장석, 라운지, 야간, 솔라리스, 모바일 함장석을 포함합니다. PR에서 실행 상태를 확인할 수 있습니다.

준비 시 로컬 실행 환경을 사용할 수 없어 기준선 브라우저를 재실행하지 못했습니다. 실제 모바일 기기, GPU 프레임 시간·VRAM 및 스피커의 음질은 미검증입니다. 재질은 절차식이며 별도 2K~4K 재질 맵, 물리 유리 반사·동적 그림자는 포함하지 않습니다.

"""Exercise Living Marie through WebGL and capture the actual bridge renderer."""
import json
import math
import os
from pathlib import Path

from browser_smoke import (
    ROOT, QuietHandler, Thread, ThreadingHTTPServer, expect, partial,
    sync_playwright, test_marie_mobile_fallback,
)

OUTPUT = Path(os.environ.get("MARIE_CAPTURE_DIR", "marie-pr11-captures"))
CLOCK = """
let callbacks = [], now = performance.now();
Object.defineProperty(performance, 'now', {value: () => now});
window.requestAnimationFrame = callback => { callbacks.push(callback); };
window.advanceCrew = (count, milliseconds = 1000) => {
    for (let i = 0; i < count; i++) {
        now += milliseconds;
        const next = callbacks;
        callbacks = [];
        for (const callback of next) callback(now);
    }
};
window.crewUniform = name => {
    const gl = document.querySelector('#roomView').getContext('webgl');
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    return Array.from(gl.getUniform(program, gl.getUniformLocation(program, name)));
};
"""


def advance(page, frames, milliseconds=1000):
    page.evaluate("([count,ms]) => advanceCrew(count,ms)", [frames, milliseconds])


def draw_turn(page, dx, dy=0):
    page.mouse.move(490, 210)
    page.mouse.down()
    page.mouse.move(490 + dx, 210 + dy)
    page.mouse.up()
    advance(page, 1, 20)


def actor_shot(page, filename, *, reset=True):
    if reset:
        page.keyboard.press("r")
        advance(page, 1, 50)
    overlay = page.add_style_tag(content="""
      .console,.eventcontrols,.viewhud,#eventBanner,#viewHint,#bridgeInterior,#toast,.topbar,footer {
        visibility:hidden !important; pointer-events:none !important;
      }
      body { user-select:none; }
    """)
    x, y, z, _ = page.evaluate("crewUniform('actorPose')")
    ex, ey, ez = page.evaluate("crewUniform('eye')")
    yaw = math.degrees(math.atan2(x-ex, z-ez))
    pitch = math.degrees(math.atan2(y+.89-ey, math.hypot(x-ex,z-ez)))
    for _ in range(math.ceil(abs(yaw)/39)):
        step = min(39, abs(yaw)) * (1 if yaw > 0 else -1)
        draw_turn(page, -step/.19)
        yaw -= step
    for _ in range(math.ceil(abs(pitch)/29)):
        step = min(29, abs(pitch)) * (1 if pitch > 0 else -1)
        draw_turn(page, 0, step/.19)
        pitch -= step
    page.screenshot(path=OUTPUT / filename)
    overlay.evaluate("node => node.remove()")
    if reset:
        page.keyboard.press("r")
        advance(page, 1, 35)


def movement(page, key, frames):
    page.keyboard.down(key)
    advance(page, frames, 118)
    page.keyboard.up(key)


def verify_actions(browser, url):
    page = browser.new_page(service_workers="block", viewport={"width": 960, "height": 650})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(CLOCK)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=25_000)
    advance(page, 1)
    initial = page.evaluate("crewUniform('actorPose')")
    assert len(page.evaluate("crewUniform('skin[0]')")) == 16
    actor_shot(page, "console-inspection.png")
    advance(page, 9)
    expect(page.locator("#marieBrief")).to_have_text("함교 순찰")
    assert page.evaluate("crewUniform('actorPose')[2]") < initial[2] - 1
    actor_shot(page, "patrol.png")

    page.click("#marieOpen")
    follow = page.locator("#marieFollow")
    report = page.locator("#marieReport")
    follow.click()
    expect(follow).to_have_attribute("aria-pressed", "true")
    page.click("#marieClose")
    page.keyboard.press("v")
    advance(page, 5)
    expect(page.locator("#marieBrief")).to_have_text("함장님 동행")
    x, _, z, _ = page.evaluate("crewUniform('actorPose')")
    assert 1.18 <= (x*x+z*z)**.5 <= 1.65, (x, z)
    page.click("#marieOpen")
    follow.click()
    expect(follow).to_have_attribute("aria-pressed", "false")
    tea = page.locator("#marieTea")
    tea.click()
    expect(tea).to_be_disabled()
    page.click("#marieClose")
    page.select_option("#eventSelect", "asteroid")
    page.click("#eventBtn")
    advance(page, 3)
    expect(page.locator("#marieBrief")).to_have_text("위험 감시")
    actor_shot(page, "alert.png")
    page.evaluate("""
      Object.defineProperty(document, 'hidden', {value:true, configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));
    """)
    advance(page, 25)
    page.evaluate("""
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    """)
    page.click("#eventDismiss")
    page.click("#marieOpen")
    expect(tea).to_be_disabled()
    expect(page.locator("#marieActivity")).to_have_text("차 준비 중")
    advance(page, 13)
    expect(tea).to_have_text("차 받기")
    page.click("#marieClose")
    advance(page, 1)
    actor_shot(page, "tea-service.png")
    page.click("#marieOpen")
    tea.click()
    expect(report).to_contain_text("차를 올려두었습니다")
    page.click("#marieClose")

    page.select_option("#eventSelect", "signal")
    page.click("#eventBtn")
    page.click("#marieOpen")
    page.click("#marieDrone")
    advance(page, 1)
    expect(page.locator("#marieDronePhase")).to_contain_text("신호 조사")
    page.click("#marieDroneCancel")
    expect(report).to_contain_text("조사를 취소")
    page.click("#marieDrone")
    page.click("#marieClose")
    advance(page, 2)
    page.screenshot(path=OUTPUT / "drone-survey.png")
    page.click("#eventDismiss")
    page.click("#eventBtn")
    page.click("#marieOpen")
    advance(page, 5)
    expect(report).to_contain_text("파견을 제안")
    page.click("#marieDrone")
    advance(page, 5)
    expect(report).to_contain_text("모의 데이터")
    expect(page.locator("#marieDronePhase")).to_contain_text("귀환 완료")
    assert not errors, errors
    page.close()


def capture_closeup(browser, url):
    page = browser.new_page(service_workers="block", viewport={"width": 960, "height": 650}, reduced_motion="reduce")
    page.add_init_script(CLOCK)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=25_000)
    advance(page, 2)
    page.keyboard.press("v")
    movement(page, "w", 7)
    movement(page, "d", 4)
    actor_shot(page, "crew-closeup.png", reset=False)
    position = page.evaluate("crewUniform('actorPose').slice(0,3)")
    page.click("#marieOpen")
    page.click("#marieTea")
    advance(page, 10)
    expect(page.locator("#marieTea")).to_have_text("차 받기")
    assert page.evaluate("crewUniform('actorPose').slice(0,3)") == position
    page.close()


def frame_measurement(browser, url):
    page = browser.new_page(service_workers="block", viewport={"width": 960, "height": 650})
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=25_000)
    data = page.evaluate("""async () => {
      const frame = () => new Promise(requestAnimationFrame);
      const durations = [];
      let previous = await frame();
      for (let i=0;i<60;i++) {
        const now = await frame();
        durations.push(now-previous);
        previous=now;
      }
      durations.sort((a,b)=>a-b);
      const canvas = document.querySelector('#roomView');
      const gl = canvas.getContext('webgl');
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return {viewport:[innerWidth,innerHeight],room:[canvas.width,canvas.height],
        renderer:extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        frames:durations.length,p50Ms:durations[29],p95Ms:durations[56]};
    }""")
    (OUTPUT / "frame-time.json").write_text(json.dumps(data, indent=2) + "\n")
    print(json.dumps(data), flush=True)
    page.close()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=ROOT.parent)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    executable_path=os.environ.get("CHROMIUM_BIN"),
                    args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
                )
                url = f"http://127.0.0.1:{server.server_port}/{ROOT.name}/"
                verify_actions(browser, url)
                capture_closeup(browser, url)
                test_marie_mobile_fallback(browser, url)
                frame_measurement(browser, url)
                browser.close()
        finally:
            server.shutdown()
    print("PASS: Living Marie rendering, following, tea safety, drone lifecycle, reduced motion and mobile Canvas")


if __name__ == "__main__":
    main()

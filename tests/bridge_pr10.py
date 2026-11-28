"""Exercise and capture the habitable bridge at a real static HTTP origin."""
import os
from pathlib import Path

from browser_smoke import (
    ROOT, QuietHandler, Thread, ThreadingHTTPServer, expect, partial, room_eye,
    sync_playwright, travel,
)

OUTPUT = Path(os.environ.get("BRIDGE_CAPTURE_DIR", "bridge-pr10-captures"))


def move(page, key, frames):
    page.keyboard.down(key)
    page.evaluate("count => stepBridge(count)", frames)
    page.keyboard.up(key)


def frame(page):
    page.evaluate("stepBridge(1)")


def room_uniform(page, name):
    return page.locator("#roomView").evaluate("""(canvas, name) => {
        const gl = canvas.getContext('webgl');
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        return Array.from(gl.getUniform(program, gl.getUniformLocation(program, name)));
    }""", name)


def verify_habitable_bridge(browser, url, mobile):
    page = browser.new_page(service_workers="block",
        viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900},
        is_mobile=mobile, has_touch=mobile, reduced_motion="reduce",
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""
        let clock = performance.now(), pending;
        Object.defineProperty(performance, 'now', {value: () => clock});
        window.requestAnimationFrame = callback => { pending = callback; };
        window.stepBridge = count => {
            for (let i = 0; i < count; i++) pending(clock += 118);
        };
        window.bridgeEvents = [];
        document.addEventListener('DOMContentLoaded', () => {
            document.querySelector('#bridge').addEventListener('asteria:bridge',
                event => bridgeEvents.push(event.detail));
        });
    """)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=20_000)
    frame(page)
    interaction = page.locator("#bridgeAction")
    walk = page.locator("#walkToggle")
    camera = page.locator("#viewMode")
    walk.click()
    expect(interaction).to_have_text("함장석 착석")
    assert interaction.bounding_box()["height"] >= 44
    if mobile:
        interaction.tap()
        frame(page)
        expect(camera).to_have_text("SEATED")
        page.screenshot(path=OUTPUT / "mobile-captain.png")
        interaction.tap()
        expect(camera).to_have_text("WALK")
        assert not errors, errors
        page.close()
        return

    initial_tint = room_uniform(page, "windowTint")
    page.screenshot(path=OUTPUT / "front.png")
    for _ in range(20):
        page.keyboard.press("f")
        frame(page)
        expect(camera).to_have_text("SEATED")
        eye = room_eye(page)
        assert eye and abs(eye[0] + 1.65) < .001
        page.keyboard.press("f")
        frame(page)
        expect(camera).to_have_text("WALK")
        assert room_eye(page) == [0, 0, 0]
    assert page.evaluate("bridgeEvents.filter(event => event.type === 'seat').length") == 20
    page.keyboard.press("f")
    frame(page)
    page.screenshot(path=OUTPUT / "captains-seat.png")
    page.keyboard.press("f")
    page.keyboard.press("Escape")
    frame(page)
    move(page, "d", 8)
    page.screenshot(path=OUTPUT / "starboard.png")
    page.keyboard.press("r")
    frame(page)

    walk.click()
    move(page, "w", 20)
    assert 2.3 < room_eye(page)[2] < 2.6
    page.keyboard.press("r")
    frame(page)
    move(page, "s", 19)
    assert -5.2 < room_eye(page)[2] < -4.6
    expect(interaction).to_have_text("후방 출입문 닫기")
    interaction.click()
    expect(page.locator("#toast")).to_contain_text("통로가 비면")
    move(page, "s", 7)
    assert room_eye(page)[2] < -6
    move(page, "d", 3)
    expect(interaction).to_have_text("라운지 착석")
    interaction.click()
    frame(page)
    expect(camera).to_have_text("SEATED")
    page.screenshot(path=OUTPUT / "aft-lounge.png")
    page.keyboard.press("Escape")
    expect(camera).to_have_text("MANUAL")
    frame(page)
    assert room_eye(page) == [0, 0, 0]

    move(page, "d", 16)
    page.screenshot(path=OUTPUT / "aft-hatch.png")
    page.keyboard.press("r")
    walk.click()
    lights = page.locator("#bridgeLights")
    lights.click()
    frame(page)
    expect(lights).to_have_attribute("aria-pressed", "true")
    assert room_uniform(page, "bridgeLighting")[0] < .3
    page.screenshot(path=OUTPUT / "night.png")
    lights.click()
    interaction.click()
    expect(camera).to_have_text("SEATED")
    page.select_option("#destinationSelect", "5")
    page.click("#travel")
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE", timeout=20_000)
    page.evaluate("stepBridge(40)")
    expect(page.locator("#destinationName")).to_have_text("SOLARIS")
    expect(camera).to_have_text("MANUAL")
    assert room_eye(page) == [0, 0, 0]
    assert room_uniform(page, "windowTint") != initial_tint
    page.screenshot(path=OUTPUT / "solaris-light.png")
    assert not errors, errors
    page.close()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=ROOT.parent)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/{ROOT.name}/"
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    executable_path=os.environ.get("CHROMIUM_BIN"),
                    args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
                )
                verify_habitable_bridge(browser, url, mobile=True)
                verify_habitable_bridge(browser, url, mobile=False)
                browser.close()
        finally:
            server.shutdown()
    print("PASS: desktop and mobile bridge, 20 seat cycles, console collision, hatch obstruction, lounge and warp recovery")


if __name__ == "__main__":
    main()

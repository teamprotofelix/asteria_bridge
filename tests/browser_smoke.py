import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def boot(browser, url, mode, *, mobile=False, disable_gpu=False, reduced_motion="reduce"):
    viewport = {"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900}
    page = browser.new_page(
        viewport=viewport, is_mobile=mobile, has_touch=mobile, reduced_motion=reduced_motion,
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    if disable_gpu:
        page.add_init_script("""
            const context = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
                return kind.includes('webgl') ? null : context.call(this, kind, ...args);
            };
        """)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text(mode, timeout=20_000)
    page.wait_for_function("document.querySelector('#skyView').width > 300")
    return page, errors


def travel(page, option, name, mode):
    page.select_option("#destinationSelect", str(option))
    page.click("#travel")
    expect(page.locator("#destinationName")).to_have_text(name)
    expect(page.locator("#warp")).to_be_enabled()
    expect(page.locator("#renderMode")).to_have_text(mode)


def snapshot(page):
    return page.evaluate("document.querySelector('#skyView').toDataURL()")


def test_desktop(browser, url):
    page, errors = boot(browser, url, "RENDER / WEBGL 3D")
    approach = page.locator("#approach")
    assert page.evaluate("""() => {
        const scene = AsteriaSpace.scenes.nereid;
        const far = AsteriaSpace.sample(scene, 0, 0);
        const near = AsteriaSpace.sample(scene, 0, 1);
        const center = Array.from(far.spheres.slice(0, 3));
        const offset = eye => eye.map((value, axis) => value - center[axis]);
        const normal = scene.ring.normal;
        const dot = position => position.reduce((sum, value, axis) => sum + value * normal[axis], 0);
        const a = offset(far.eye);
        const b = offset(near.eye);
        const crossing = dot(a) / (dot(a) - dot(b));
        const radius = Math.hypot(...a.map((value, axis) => value + (b[axis] - value) * crossing));
        return crossing > 0 && crossing < 1 && radius > scene.ring.inner && radius < scene.ring.outer;
    }"""), "The Nereid approach route should pass through the actual ring annulus"
    page.click("#roomToggle")
    expect(page.locator("#roomToggle")).to_have_text("함교 OFF")
    approach.fill("0")
    page.wait_for_function("document.querySelector('#approachRead').value === '0%'")
    page.wait_for_timeout(120)
    far = snapshot(page)
    approach.fill("86")
    page.wait_for_function("(far) => document.querySelector('#skyView').toDataURL() !== far", arg=far)
    approach.fill("0")
    page.wait_for_function("(far) => document.querySelector('#skyView').toDataURL() === far", arg=far)

    page.locator("#view").focus()
    page.keyboard.down("d")
    page.wait_for_function("parseFloat(document.querySelector('#heading').textContent) > 20")
    page.keyboard.up("d")
    page.keyboard.down("w")
    page.wait_for_function("parseFloat(document.querySelector('#pitchRead').textContent) > 20")
    page.keyboard.up("w")
    page.keyboard.down("e")
    page.wait_for_function("parseFloat(document.querySelector('#rollRead').textContent) > 20")
    page.keyboard.up("e")
    page.keyboard.press("r")
    expect(page.locator("#heading")).to_have_text("000.0°")

    for n, name, mode in [
        (1, "SELENE", "3D"), (2, "EOS", "3D"), (3, "DEEP SPACE", "360°"),
        (4, "GAIA", "3D"), (5, "SOLARIS", "3D"), (6, "SINGULARITY", "3D"),
        (7, "ASTEROID BELT", "3D"), (8, "NEBULA", "360°"), (0, "NEREID", "3D"),
    ]:
        travel(page, n, name, f"RENDER / WEBGL {mode}")
        print(f"PASS: {name}", flush=True)
        if mode == "3D":
            expect(approach).to_be_visible()
            expect(page.locator("#approachRead")).to_have_text("30%")
        else:
            expect(approach).to_be_hidden()

    page.click("#eventBtn")
    expect(page.locator("#eventName")).to_have_text("유성우")
    page.click("#cinema")
    expect(page.locator("#exitCinema")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#exitCinema")).to_be_hidden()
    page.evaluate("""document.querySelector('#skyView').getContext('webgl')
        .getExtension('WEBGL_lose_context').loseContext()""")
    expect(page.locator("#renderMode")).to_have_text("RENDER / CANVAS 360°")
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    expect(approach).to_be_hidden()
    travel(page, 6, "SINGULARITY", "RENDER / CANVAS 360°")
    assert not errors, errors
    page.close()


def test_mobile(browser, url):
    page, errors = boot(browser, url, "RENDER / WEBGL 3D", mobile=True, reduced_motion="no-preference")
    page.locator('#roomToggle').tap()
    first_frame = snapshot(page)
    page.wait_for_function("(previous) => document.querySelector('#skyView').toDataURL() !== previous", arg=first_frame)
    expect(page.locator("#approach")).to_be_in_viewport()
    expect(page.locator("#travel")).to_be_in_viewport()
    expect(page.locator("#eventBtn")).to_be_in_viewport()
    page.locator("#approach").fill("75")
    expect(page.locator("#approachRead")).to_have_text("75%")
    assert page.evaluate("document.documentElement.scrollWidth") == 390
    assert not errors, errors
    page.close()


def test_fallbacks(browser, url):
    page, errors = boot(browser, url, "RENDER / CANVAS 360°", mobile=True, disable_gpu=True)
    expect(page.locator("#approach")).to_be_hidden()
    travel(page, 4, "GAIA", "RENDER / CANVAS 360°")
    assert not errors, errors
    page.close()

    page = browser.new_page(reduced_motion="reduce")
    page.route("**/gas-4k.webp", lambda route: route.abort())
    page.goto(url)
    page.wait_for_function("document.querySelector('#skyView').width > 300")
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 360°")
    expect(page.locator("#approach")).to_be_hidden()
    travel(page, 4, "GAIA", "RENDER / WEBGL 3D")
    page.close()


def main():
    handler = partial(QuietHandler, directory=ROOT.parent)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/{ROOT.name}/"
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    executable_path=os.environ.get("CHROMIUM_BIN"),
                    args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
                    timeout=30_000,
                )
                test_desktop(browser, url)
                test_mobile(browser, url)
                test_fallbacks(browser, url)
                browser.close()
        finally:
            server.shutdown()
    print("PASS: Desktop and mobile WebGL, nine sectors, reduced motion, context loss, and Canvas fallback")


if __name__ == "__main__":
    main()

"""Release smoke and optional real-time observation on static HTTP."""
import argparse
import json
import os
from pathlib import Path
from statistics import median
from time import monotonic, sleep
from urllib.parse import urlsplit

from browser_smoke import ROOT, QuietHandler, Thread, ThreadingHTTPServer, expect, partial, sync_playwright, wait_for
from flight_pr12 import CLOCK, advance

VIEWPORTS = [(320, 568), (390, 844), (768, 1024), (844, 390),
             (1440, 900), (1920, 1080), (2560, 1440)]
FLAGS = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
VERSION = "4.0.0-rc.1"
SAMPLER = """
async () => {
    const frames = [];
    await new Promise(resolve => {
        let previous;
        const sample = now => {
            if (previous !== undefined) frames.push(now - previous);
            previous = now;
            if (frames.length < 90) requestAnimationFrame(sample);
            else resolve();
        };
        requestAnimationFrame(sample);
    });
    return frames;
}
"""


def stats(values):
    ordered = sorted(values)
    return {"p50_ms": round(median(ordered), 2),
            "p95_ms": round(ordered[(95 * len(ordered) + 99) // 100 - 1], 2)}


def boot(browser, url, *, size=(960, 650), mobile=False, accelerated=False,
         service_workers="block"):
    width, height = size
    page = browser.new_page(viewport={"width": width, "height": height},
                            is_mobile=mobile, has_touch=mobile,
                            reduced_motion="reduce" if accelerated else "no-preference",
                            service_workers=service_workers)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message:
            errors.append(message.text) if message.type == "error" else None)
    requests = []
    page.on("request", lambda request: requests.append(request.url))
    if accelerated:
        page.add_init_script(CLOCK)
    started = monotonic()
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=30000)
    assert VERSION in page.title()
    return page, errors, requests, round((monotonic() - started) * 1000)


def shutdown(page, errors, requests, origin):
    unexpected = [url for url in requests if urlsplit(url).netloc != urlsplit(origin).netloc
                  and urlsplit(url).scheme in ("http", "https")]
    assert not unexpected, unexpected
    assert not errors, errors
    page.context.close()


def performance_check(browser, origin, prefix, output):
    results = []
    for width, height in VIEWPORTS:
        page, errors, requests, startup = boot(browser, origin + prefix,
            size=(width, height), mobile=width <= 844)
        controls = "#mapOpen, #destinationSelect, #travel, #qualityOpen, #voyageOpen, #marieOpen"
        for control in page.locator(controls).all():
            expect(control).to_be_in_viewport()
            expect(control).to_be_enabled()
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        page.locator("#help").focus()
        page.keyboard.press("Enter")
        expect(page.get_by_role("dialog", name="항해 조작 매뉴얼")).to_be_visible()
        page.keyboard.press("c")
        assert page.locator("#cinema").get_attribute("aria-pressed") == "false"
        page.keyboard.press("Escape")
        expect(page.locator("#helpDialog")).to_be_hidden()
        expect(page.locator("#help")).to_be_focused()
        timings = page.evaluate("""() => {
            const entries = [...performance.getEntriesByType('navigation'),
                ...performance.getEntriesByType('resource')];
            return {
                response_body_bytes: entries.reduce((bytes, entry) => bytes + entry.encodedBodySize, 0),
                transfer_bytes: entries.reduce((bytes, entry) => bytes + entry.transferSize, 0)
            };
        }""")
        result = {"viewport": [width, height], "shell": prefix, "startup_ms": startup,
                  **timings, **stats(page.evaluate(SAMPLER)),
                  "canvas": page.locator("#skyView").evaluate("el => [el.width, el.height]")}
        results.append(result)
        print(json.dumps(result), flush=True)
        if (width, height) in ((390, 844), (1920, 1080)):
            page.screenshot(path=output / f"bridge-{width}x{height}.png", animations="disabled")
        if (width, height) == (1920, 1080):
            page.click("#qualityOpen")
            page.select_option("#qualitySelect", "ultra")
            expect(page.locator("#qualityApplied")).to_have_text("Ultra", timeout=25000)
            page.click("#qualityClose")
            page.screenshot(path=output / "nereid-ultra.png", animations="disabled")
            page.click("#qualityOpen")
            page.select_option("#qualitySelect", "compatibility")
            expect(page.locator("#qualityApplied")).to_have_text("Compatibility", timeout=25000)
            page.click("#qualityClose")
            page.screenshot(path=output / "nereid-compatibility.png", animations="disabled")
        shutdown(page, errors, requests, origin)
    return results


def all_sectors(browser, origin, route):
    page, errors, requests, _ = boot(browser, origin + route, accelerated=True)
    advance(page)
    page.keyboard.press("p")
    advance(page)
    expect(page.locator("#viewMode")).to_have_text("PILOT")
    page.click("#help")
    page.keyboard.press("Escape")
    advance(page)
    expect(page.locator("#helpDialog")).to_be_hidden()
    expect(page.locator("#viewMode")).to_have_text("PILOT")
    page.keyboard.press("Escape")
    advance(page)
    expect(page.locator("#viewMode")).to_have_text("MANUAL")
    options = page.locator("#destinationSelect option").evaluate_all(
        "nodes => nodes.map(node => [node.value, node.textContent])")
    assert len(options) == 32
    modes = {}
    for value, description in options[1:] + options[:1]:
        page.select_option("#destinationSelect", value)
        page.click("#travel")
        expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE", timeout=25000)
        advance(page, 1, 4000)
        expect(page.locator("#destinationDesc")).to_have_text(description)
        expect(page.locator("#warp")).to_be_enabled()
        name = page.locator("#destinationName").inner_text()
        assert name not in modes, name
        modes[name] = page.locator("#renderMode").inner_text()
    assert list(modes.values()).count("RENDER / WEBGL 3D") == 30, modes
    assert list(modes.values()).count("RENDER / WEBGL 360°") == 2, modes
    for value, description in (options[1::-1] * 10):
        page.select_option("#destinationSelect", value)
        page.click("#travel")
        expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE", timeout=25000)
        advance(page, 1, 4000)
        expect(page.locator("#destinationDesc")).to_have_text(description)
    shutdown(page, errors, requests, origin)
    print("PASS 32 sectors, 30 WebGL 3D, 2 WebGL 360°, and 10 round trips", flush=True)
    return modes


def scope_test(browser, origin):
    context = browser.new_context()
    for path in ("/", "/asteria/"):
        page = context.new_page()
        page.goto(origin + path)
        expect(page.locator("#marieOpen")).to_be_enabled(timeout=30000)
        policy = page.evaluate("""() => new Promise(resolve => {
            window.addEventListener('securitypolicyviolation',
                event => resolve([event.effectiveDirective, event.blockedURI]), {once: true});
            setTimeout(() => resolve(null), 2000);
            const script = document.createElement('script');
            script.textContent = 'document.body.dataset.inlineScript = "ran"';
            document.head.append(script);
        })""")
        assert policy == ["script-src-elem", "inline"], policy
        assert page.locator("body").get_attribute("data-inline-script") is None
        wait_for(page, "navigator.serviceWorker.controller?.scriptURL === new URL('sw.js', location.href).href",
                 timeout=30000)
        scope = page.evaluate("navigator.serviceWorker.getRegistration().then(item => item.scope)")
        assert scope == origin + path, scope
        context.set_offline(True)
        page.reload()
        expect(page.locator("#destinationName")).to_have_text("NEREID")
        expect(page.locator("#marieOpen")).to_be_enabled(timeout=30000)
        context.set_offline(False)
        page.close()
    context.close()
    print("PASS root and subpath CSP, worker scope and offline boot", flush=True)


def soak(browser, origin, seconds, output):
    page, errors, requests, _ = boot(browser, origin, service_workers="allow")
    page.click("#cinema")
    page.click("#watchStart")
    expect(page.locator("#watchPause")).to_be_visible()
    session = page.context.new_cdp_session(page)
    session.send("Performance.enable")
    started = monotonic()
    checkpoints = []
    while True:
        elapsed = monotonic() - started
        expect(page.locator("#watchPause")).to_be_visible()
        metrics = {row["name"]: row["value"] for row in session.send("Performance.getMetrics")["metrics"]}
        sample = {"seconds": round(elapsed), "sector": page.locator("#destinationName").text_content(),
                  "observation": page.locator("#watchStatus").text_content(),
                  **{key: metrics.get(key) for key in ("JSHeapUsedSize", "Nodes", "JSEventListeners", "TaskDuration")}}
        checkpoints.append(sample)
        (output / "soak.json").write_text(json.dumps(checkpoints, indent=2) + "\n")
        print(json.dumps(sample, ensure_ascii=False), flush=True)
        assert not errors, errors
        if elapsed >= seconds:
            break
        sleep(min(60, seconds - elapsed))
    assert len({row["sector"] for row in checkpoints}) > 1, checkpoints
    session.detach()
    shutdown(page, errors, requests, origin)


class Mounted(QuietHandler):
    def translate_path(self, path):
        if path.startswith("/asteria/"):
            path = path[len("/asteria"):]
        return super().translate_path(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, choices=(0, 1800, 7200), default=0)
    parser.add_argument("--output", type=Path, default=Path("release-evidence"))
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--archive-smoke", action="store_true",
                        help="boot an extracted delivery ZIP in both address layouts")
    args = parser.parse_args()
    args.output.mkdir(exist_ok=True, parents=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Mounted, directory=args.root)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        origin = f"http://127.0.0.1:{server.server_port}"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_BIN"), args=FLAGS)
            if args.seconds:
                soak(browser, origin + "/", args.seconds, args.output)
            elif args.archive_smoke:
                scope_test(browser, origin)
            else:
                items = performance_check(browser, origin, "/", args.output)
                sectors = all_sectors(browser, origin, "/asteria/")
                scope_test(browser, origin)
                report = {"browser": browser.version, "renderer": "Chromium ANGLE SwiftShader",
                          "probes": items, "sectors": sectors, "round_trips": 10}
                (args.output / "integration.json").write_text(json.dumps(report, indent=2) + "\n")
            browser.close()
        server.shutdown()


if __name__ == "__main__":
    main()

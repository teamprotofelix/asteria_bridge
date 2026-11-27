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
    expect(page.locator("#destinationName")).to_have_text(name, timeout=20_000)
    expect(page.locator("#warp")).to_be_enabled(timeout=20_000)
    expect(page.locator("#renderMode")).to_have_text(mode)


def snapshot(page):
    return page.evaluate("document.querySelector('#skyView').toDataURL()")


def test_desktop(browser, url):
    page, errors = boot(browser, url, "RENDER / WEBGL 3D")
    approach = page.locator("#approach")
    expect(page.locator("#approachNear")).to_be_in_viewport(ratio=1)
    expect(page.locator("#approachFar")).to_be_in_viewport(ratio=1)
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

    # Reduced motion jumps directly to each endpoint and still redraws the scene.
    distance = page.locator("#surfaceDistance")
    expect(distance).to_have_text("11.9 SU")
    page.get_by_role("button", name="접근", exact=True).click()
    expect(approach).to_have_value("100")
    expect(distance).to_have_text("0.7 SU")
    page.wait_for_function("(far) => document.querySelector('#skyView').toDataURL() !== far", arg=far)
    page.get_by_role("button", name="이탈", exact=True).click()
    expect(approach).to_have_value("0")
    expect(distance).to_have_text("11.9 SU")
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
            expect(page.locator("#surfaceDistance")).to_contain_text("SU")
            if n == 7:
                expect(page.locator("#rangeLabel")).to_have_text("가장 가까운 소행성")
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
    near = page.locator("#approachNear")
    far = page.locator("#approachFar")
    expect(near).to_be_in_viewport()
    expect(far).to_be_in_viewport()
    near.tap()
    expect(near).to_have_text("정지")
    page.wait_for_function("Number(document.querySelector('#approach').value) > 75")
    near.tap()
    expect(near).to_have_text("접근")
    paused = page.locator("#approach").input_value()
    page.wait_for_timeout(200)
    expect(page.locator("#approach")).to_have_value(paused)
    near.tap()
    expect(page.locator("#approach")).to_have_value("100", timeout=12_000)
    expect(near).to_have_attribute("aria-disabled", "true")
    far.tap()
    expect(far).to_have_text("정지")
    page.locator("#approach").fill("50")
    expect(far).to_have_text("이탈")
    expect(page.locator("#approachRead")).to_have_text("50%")
    far.tap()
    page.select_option("#destinationSelect", "3")
    page.tap("#travel")
    expect(far).to_have_text("이탈")
    expect(far).to_be_disabled()
    expect(page.locator("#destinationName")).to_have_text("DEEP SPACE")
    expect(page.locator("#approachControl")).to_be_hidden()
    assert page.evaluate("document.documentElement.scrollWidth") == 390
    assert not errors, errors
    page.close()


def room_eye(page):
    return page.locator("#roomView").evaluate("""canvas => {
        const gl = canvas.getContext('webgl');
        const program = gl?.getParameter(gl.CURRENT_PROGRAM);
        const eye = program && gl.getUniformLocation(program, 'eye');
        return eye ? Array.from(gl.getUniform(program, eye)) : null;
    }""")


def test_bridge_walk(browser, url):
    page, errors = boot(browser, url, "RENDER / WEBGL 3D")
    walk = page.locator("#walkToggle")
    expect(walk).to_be_enabled()
    page.wait_for_function("document.querySelector('#roomView').width > 300")
    assert room_eye(page) == [0, 0, 0]
    room = page.locator("#roomView")
    assert room.evaluate("""canvas => {
        const gl = canvas.getContext('webgl');
        const center = new Uint8Array(4), lower = new Uint8Array(4);
        gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, center);
        gl.readPixels(canvas.width >> 1, 10, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, lower);
        return center[3] === 0 && lower[3] === 255;
    }"""), "The room must have a transparent window and an opaque deck"
    room_frame = room.evaluate("canvas => canvas.toDataURL()")
    outside = snapshot(page)
    page.keyboard.press("v")
    expect(walk).to_have_attribute("aria-pressed", "true")
    page.keyboard.down("w")
    page.wait_for_timeout(500)
    page.keyboard.up("w")
    assert room_eye(page)[2] > .15
    assert room.evaluate("canvas => canvas.toDataURL()") != room_frame
    assert snapshot(page) == outside

    page.keyboard.down("Space")
    page.wait_for_timeout(500)
    page.keyboard.up("Space")
    assert .15 < room_eye(page)[1] <= .651
    page.keyboard.down("Shift")
    page.wait_for_timeout(900)
    page.keyboard.up("Shift")
    assert -.651 <= room_eye(page)[1] < 0
    page.keyboard.down("e")
    page.wait_for_function("parseFloat(document.querySelector('#rollRead').textContent) > 15")
    page.keyboard.up("e")
    page.keyboard.press("c")
    expect(walk).to_have_attribute("aria-pressed", "false")
    expect(page.locator("#exitCinema")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#exitCinema")).to_be_hidden()
    page.keyboard.press("r")
    page.wait_for_function("document.querySelector('#rollRead').textContent === '+0.0°'")
    assert room_eye(page) == [0, 0, 0]

    walk.click()
    page.click("#roomToggle")
    expect(walk).to_have_attribute("aria-pressed", "false")
    expect(page.locator("#roomToggle")).to_have_text("함교 OFF")
    walk.click()
    expect(page.locator("#roomToggle")).to_have_text("함교 ON")
    travel(page, 3, "DEEP SPACE", "RENDER / WEBGL 360°")
    expect(walk).to_have_attribute("aria-pressed", "false")
    expect(walk).to_be_enabled()
    walk.click()
    page.evaluate("""document.querySelector('#roomView').getContext('webgl')
        .getExtension('WEBGL_lose_context').loseContext()""")
    expect(page.locator("#renderMode")).to_have_text("RENDER / CANVAS 360°")
    expect(walk).to_be_disabled()
    expect(walk).to_have_attribute("aria-pressed", "false")
    page.set_viewport_size({"width": 768, "height": 620})
    expect(walk).to_be_in_viewport(ratio=1)
    expect(page.locator("#travel")).to_be_in_viewport(ratio=1)
    assert not errors, errors
    page.close()


def test_bridge_mesh_fallback(browser, url):
    page = browser.new_page(reduced_motion="reduce")
    page.add_init_script("""
        const shaderSource = WebGLRenderingContext.prototype.shaderSource;
        WebGLRenderingContext.prototype.shaderSource = function(shader, source) {
            return shaderSource.call(this, shader, source.includes('attribute vec3 tint;')
                ? 'forced bridge shader failure' : source);
        };
    """)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D")
    expect(page.locator("#walkToggle")).to_be_disabled()
    page.wait_for_function("document.querySelector('#roomView').width > 300")
    assert room_eye(page) is None
    page.close()


def test_bridge_touch(browser, url):
    page, errors = boot(browser, url, "RENDER / WEBGL 3D", mobile=True)
    walk = page.locator("#walkToggle")
    walk.tap()
    expect(walk).to_have_attribute("aria-pressed", "true")
    expect(page.get_by_role("button", name="상승", exact=True)).to_be_in_viewport()
    expect(page.get_by_role("button", name="오른쪽 롤", exact=True)).to_be_in_viewport()
    button = page.get_by_role("button", name="오른쪽", exact=True)
    bounds = button.bounding_box()
    center = {"x": bounds["x"] + bounds["width"]/2, "y": bounds["y"] + bounds["height"]/2}
    touch = page.context.new_cdp_session(page)
    touch.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [center]})
    page.wait_for_timeout(500)
    touch.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    assert room_eye(page)[0] > .15
    walk.tap()
    expect(walk).to_have_attribute("aria-pressed", "false")
    assert not errors, errors
    page.close()


def test_expanded_sectors(browser, url):
    page, errors = boot(browser, url, "RENDER / WEBGL 3D")
    expect(page.locator("#sectorCount")).to_have_text("32개")
    expect(page.locator("#destinationSelect option")).to_have_count(32)
    assert page.locator("#destinationSelect optgroup").evaluate_all(
        "groups => groups.map(group => [group.label, group.children.length])"
    ) == [["기존 탐사 구역", 9], ["항성계", 5], ["외계 행성", 8], ["심우주", 5], ["미지 문명", 5]]

    for option, title, code in [(10, "KALLISTO", "ST-02"), (17, "CRYON", "PL-04"),
                                (25, "UNDERTOW", "DS-04"), (27, "HALO GATE", "CX-01")]:
        travel(page, option, title, "RENDER / WEBGL 3D")
        expect(page.locator("#routeCode")).to_have_text(code)
        expect(page.locator("#surfaceDistance")).to_contain_text("SU")

    tour = page.locator("#tourBtn")
    phase = page.locator("#tourPhase")
    expect(tour).to_be_enabled()
    tour.click()
    for text in ["1/4 접근", "2/4 관측", "3/4 선회", "4/4 이탈", "순회 완료"]:
        expect(phase).to_have_text(text, timeout=12_000)
    expect(page.locator("#approach")).to_have_value("0")
    tour.click()
    expect(phase).to_have_text("1/4 접근")
    page.locator("#approach").fill("42")
    expect(phase).to_have_text("순회 중단")
    expect(page.locator("#approach")).to_have_value("42")
    tour.click()
    page.locator("#view").focus()
    page.keyboard.down("d")
    expect(phase).to_have_text("순회 중단")
    page.keyboard.up("d")
    assert not errors, errors
    page.close()


def test_animated_tour(browser, url):
    page = browser.new_page(viewport={"width": 780, "height": 580})
    page.add_init_script("""
        let pending, now = performance.now();
        window.requestAnimationFrame = callback => { pending = callback; };
        window.stepTour = count => {
            // Keep real draws and advance the frame clock independently of GPU speed.
            for (let i = 0; i < count; i++) pending(now += 110);
        };
        window.readEye = () => {
            const gl = document.querySelector('#skyView').getContext('webgl');
            const program = gl.getParameter(gl.CURRENT_PROGRAM);
            return Array.from(gl.getUniform(program, gl.getUniformLocation(program, 'eye')));
        };
    """)
    page.goto(url)
    tour = page.locator("#tourBtn")
    phase = page.locator("#tourPhase")
    slider = page.locator("#approach")
    expect(tour).to_be_enabled(timeout=20_000)
    page.evaluate("stepTour(1)")
    tour.click()
    page.evaluate("stepTour(18)")
    assert 30 < int(slider.input_value()) < 83
    page.evaluate("stepTour(15)")
    expect(phase).to_have_text("2/4 관측")
    page.evaluate("stepTour(22)")
    expect(phase).to_have_text("3/4 선회")
    before = page.evaluate("readEye()")
    page.evaluate("stepTour(25)")
    after = page.evaluate("readEye()")
    assert abs(before[0] - after[0]) > .5
    expect(slider).to_have_value("83")
    page.evaluate("stepTour(14)")
    expect(phase).to_have_text("4/4 이탈")
    page.evaluate("stepTour(33)")
    expect(phase).to_have_text("순회 완료")
    expect(slider).to_have_value("0")
    page.close()


def test_dynamic_events(browser, url):
    page, errors = boot(browser, url, "RENDER / WEBGL 3D")
    event_select = page.locator("#eventSelect")
    banner = page.locator("#eventBanner")
    expect(event_select.locator("option")).to_have_count(14)
    expect(event_select.locator('option[value="portal"]')).to_be_disabled()
    expect(event_select.locator('option[value="ring"]')).to_be_disabled()

    event_select.select_option("eclipse")
    page.click("#eventBtn")
    expect(page.locator("#eventName")).to_have_text("개기일식")
    page.click("#eventAction")
    expect(page.locator("#eventDescription")).to_contain_text("5초 연장")
    expect(page.locator("#eventAction")).to_be_hidden()
    page.click("#eventDismiss")
    expect(banner).to_be_hidden()

    page.click("#randomEvent")
    page.locator("#approach").fill("78")
    expect(page.locator("#eventName")).to_have_text("고리 통과")
    expect(banner).to_be_visible()
    page.click("#randomEvent")
    travel(page, 27, "HALO GATE", "RENDER / WEBGL 3D")
    expect(banner).to_be_hidden()
    expect(page.locator("#shield")).to_have_text("100%")
    expect(event_select.locator('option[value="eclipse"]')).to_be_disabled()

    event_select.select_option("portal")
    page.click("#eventBtn")
    expect(page.locator("#eventName")).to_have_text("차원 포탈")
    page.click("#eventAction")
    expect(page.locator("#eventDescription")).to_contain_text("10초")
    assert not errors, errors
    page.close()


def test_navigation_map(browser, url):
    page, errors = boot(browser, url, "RENDER / WEBGL 3D")
    opener = page.locator("#mapOpen")
    dialog = page.locator("#mapDialog")
    opener.click()
    expect(dialog).to_be_visible()
    assert page.locator("#mapClose").bounding_box()["width"] < 100
    assert page.locator("#mapReset").bounding_box()["width"] < 100
    expect(page.locator("#mapNodes button")).to_have_count(32)
    expect(page.locator("#mapCurrent")).to_have_text("NEREID")
    expect(page.locator("#mapSummary")).to_have_text("1 / 32 방문")
    expect(page.locator("#mapTravel")).to_be_disabled()
    target = page.locator('[data-sector="halogate"]')
    page.wait_for_function("document.querySelector('[data-sector=halogate]').style.left !== ''")
    original = target.evaluate("(node) => node.style.left")
    page.locator("#mapPlot").focus()
    page.keyboard.press("ArrowRight")
    page.wait_for_function(
        "(left) => document.querySelector('[data-sector=halogate]').style.left !== left", arg=original
    )
    page.click("#mapReset")
    page.select_option("#mapFilter", "relic")
    assert page.locator("#mapNodes button:visible").count() == 6
    target.click()
    expect(target).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#mapSelected")).to_have_text("HALO GATE")
    expect(page.locator("#destinationSelect")).to_have_value("27")
    expect(page.locator("#mapVisitState")).to_have_text("미탐사")

    page.route("**/deep-front.webp", lambda route: route.abort())
    page.click("#mapTravel")
    expect(page.locator("#mapStatus")).to_contain_text("로드 실패", timeout=20_000)
    expect(page.locator("#mapCurrent")).to_have_text("NEREID")
    expect(page.locator("#mapSummary")).to_have_text("1 / 32 방문")
    page.unroute("**/deep-front.webp")
    page.click("#mapTravel")
    expect(page.locator("#mapFlightProgress")).to_be_visible(timeout=20_000)
    expect(page.locator("#mapTravel")).to_be_disabled()
    expect(page.locator("#mapCurrent")).to_have_text("NEREID")
    page.wait_for_function("document.querySelector('#mapFlightProgress').value > 0")
    expect(page.locator("#mapCurrent")).to_have_text("HALO GATE", timeout=20_000)
    expect(target).to_have_attribute("aria-current", "location")
    expect(page.locator("#mapSummary")).to_have_text("2 / 32 방문")
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()
    expect(opener).to_be_focused()

    page.reload()
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=20_000)
    page.select_option("#destinationSelect", "27")
    opener.click()
    expect(page.locator("#mapSelected")).to_have_text("HALO GATE")
    expect(page.locator("#mapVisitState")).to_have_text("방문 완료")
    expect(page.locator("#mapCurrent")).to_have_text("NEREID")
    assert not errors, errors
    page.close()


def test_navigation_map_mobile(browser, url):
    page, errors = boot(browser, url, "RENDER / CANVAS 360°", mobile=True, disable_gpu=True)
    page.locator("#mapOpen").tap()
    expect(page.locator("#mapDialog")).to_be_visible()
    page.select_option("#mapFilter", "star")
    page.locator('[data-sector="helion"]').tap()
    expect(page.locator("#mapSelected")).to_have_text("HELION")
    expect(page.locator("#mapTravel")).to_be_enabled()
    page.locator("#mapZoomIn").tap()
    page.locator("#mapReset").tap()
    page.locator("#mapClose").tap()
    expect(page.locator("#mapDialog")).to_be_hidden()
    expect(page.locator("#destinationSelect")).to_have_value("9")
    assert not errors, errors
    page.close()


def test_bridge_audio(browser, url):
    page = browser.new_page(reduced_motion="reduce")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""
        const Audio = window.AudioContext;
        window.bridgeAudioTest = {contexts: 0, gains: [], oscillators: [], loops: 0};
        window.AudioContext = class extends Audio {
            constructor() { super(); bridgeAudioTest.contexts++; }
            createGain() {
                const node = super.createGain();
                bridgeAudioTest.gains.push(node);
                if (!bridgeAudioTest.analyser) {
                    const analyser = this.createAnalyser();
                    node.connect(analyser);
                    bridgeAudioTest.analyser = analyser;
                }
                return node;
            }
            createOscillator() {
                const node = super.createOscillator();
                bridgeAudioTest.oscillators.push(node);
                return node;
            }
            createBufferSource() { bridgeAudioTest.loops++; return super.createBufferSource(); }
        };
        window.audioRms = () => {
            const analyser = bridgeAudioTest.analyser;
            const data = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(data);
            return Math.sqrt(data.reduce((sum,v) => sum + v*v, 0) / data.length);
        };
    """)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=20_000)
    assert page.evaluate("bridgeAudioTest.contexts") == 0
    page.click("#sound")
    expect(page.locator("#sound")).to_have_attribute("aria-pressed", "true")
    assert page.evaluate("bridgeAudioTest.contexts") == 1
    assert page.evaluate("bridgeAudioTest.loops") == 1
    page.wait_for_function("audioRms() > .002")
    page.locator("#speed").fill("95")
    page.wait_for_function("bridgeAudioTest.oscillators[0].frequency.value > 58")
    count = page.evaluate("bridgeAudioTest.oscillators.length")
    page.click("#walkToggle")
    page.keyboard.down("s")
    page.wait_for_function("""() => {
        const gl = document.querySelector('#roomView').getContext('webgl');
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        const offset = gl.getUniformLocation(program, 'hatchOffset');
        return offset && gl.getUniform(program, offset) > 1;
    }""")
    page.keyboard.up("s")
    assert page.evaluate("""count => bridgeAudioTest.oscillators.slice(count)
        .some(node => node.type === 'triangle' && node.frequency.value >= 120 && node.frequency.value <= 245)""", count)
    page.click("#cinema")
    page.click("#watchStart")
    expect(page.locator("#watchSound")).to_have_attribute("aria-pressed", "true")
    page.wait_for_function("bridgeAudioTest.gains[4].gain.value > .035")
    page.evaluate("""
        Object.defineProperty(document, 'hidden', {configurable: true, value: true});
        document.dispatchEvent(new Event('visibilitychange'));
    """)
    page.wait_for_function("bridgeAudioTest.gains[0].gain.value < .012")
    page.evaluate("""
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
    """)
    page.click("#watchSound")
    expect(page.locator("#watchSound")).to_have_attribute("aria-pressed", "false")
    page.wait_for_function("audioRms() < .002")
    assert not errors, errors
    page.close()


def test_automatic_observation(browser, url):
    page = browser.new_page(
        viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, reduced_motion="reduce",
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""
        let pending, clock = performance.now();
        Object.defineProperty(performance, 'now', {value: () => clock});
        window.requestAnimationFrame = callback => { pending = callback; };
        window.watchStep = count => { for (let i = 0; i < count; i++) pending(clock += 1000); };
    """)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=20_000)
    page.evaluate("watchStep(1)")
    page.tap("#roomToggle")
    page.tap("#cinema")
    page.tap("#watchStart")
    expect(page.locator("#bridge")).to_have_class("route-available cinematic watching")
    expect(page.locator("#exitCinema")).to_have_text("자동 관측 종료")
    expect(page.locator(".viewhud")).to_be_hidden()
    expect(page.locator("#watchNext")).to_be_in_viewport()
    page.evaluate("watchStep(44)")
    expect(page.locator("#watchNext")).to_be_enabled()
    page.evaluate("""
        Object.defineProperty(document, 'hidden', {configurable: true, value: true});
        document.dispatchEvent(new Event('visibilitychange'));
        watchStep(50);
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
        watchStep(1);
    """)
    expect(page.locator("#watchNext")).to_be_enabled()
    page.evaluate("watchStep(1)")
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE", timeout=20_000)
    page.evaluate("watchStep(4)")
    expect(page.locator("#destinationName")).to_have_text("GAIA")
    page.tap("#watchNext")
    page.evaluate("watchStep(1)")
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE", timeout=20_000)
    page.evaluate("watchStep(4)")
    expect(page.locator("#destinationName")).to_have_text("HALO GATE")

    blocked = []
    page.route("**/nebula-front.webp", lambda route: blocked.append(route))
    with page.expect_request("**/nebula-front.webp"):
        page.tap("#watchNext")
        page.evaluate("watchStep(1)")
    expect(page.locator("#flightStatus")).to_have_text("항로 계산 중")
    page.tap("#exitCinema")
    blocked[0].continue_()
    expect(page.locator("#flightStatus")).to_have_text("순항 항해 중", timeout=20_000)
    expect(page.locator("#roomToggle")).to_have_text("함교 OFF")
    expect(page.locator(".viewhud")).to_be_visible()
    page.evaluate("watchStep(50)")
    expect(page.locator("#destinationName")).to_have_text("HALO GATE")
    assert not errors, errors
    page.close()


def test_marie_bridge(browser, url):
    page = browser.new_page(viewport={"width": 780, "height": 580})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""
        let callbacks = [], now = performance.now();
        Object.defineProperty(performance, 'now', {value: () => now});
        window.requestAnimationFrame = callback => { callbacks.push(callback); };
        window.marieStep = count => {
            for (let i = 0; i < count; i++) {
                now += 1000;
                const frame = callbacks;
                callbacks = [];
                for (const callback of frame) callback(now);
            }
        };
        window.mariePosition = () => {
            const gl = document.querySelector('#roomView').getContext('webgl');
            const program = gl.getParameter(gl.CURRENT_PROGRAM);
            return Array.from(gl.getUniform(program, gl.getUniformLocation(program, 'actorPose')));
        };
    """)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=20_000)
    page.evaluate("marieStep(1)")
    initial = page.evaluate("mariePosition()")
    page.evaluate("marieStep(9)")
    expect(page.locator("#marieBrief")).to_have_text("함교 순찰")
    moved = page.evaluate("mariePosition()")
    assert moved[2] < initial[2] - 1

    page.locator("#destinationSelect").select_option("1")
    page.click("#marieOpen")
    report = page.locator("#marieReport")
    expect(report).to_contain_text("NEREID → SELENE")
    page.click("#marieClose")
    page.click("#mapOpen")
    page.evaluate("marieStep(1)")
    page.locator('[data-sector="gaia"]').click()
    page.click("#mapClose")
    page.click("#marieOpen")
    expect(report).to_contain_text("NEREID → GAIA")
    expect(report).to_contain_text("GA-21")
    page.click("#marieClose")
    page.click("#travel")
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE", timeout=20_000)
    page.click("#marieOpen")
    expect(report).to_contain_text("GAIA로 출항")
    page.evaluate("marieStep(4)")
    expect(report).to_contain_text("GAIA 도착")
    page.click("#marieClose")

    page.select_option("#eventSelect", "asteroid")
    page.click("#eventBtn")
    expect(page.locator("#marieBrief")).to_have_text("위험 감시")
    page.click("#marieOpen")
    expect(report).to_contain_text("소행성 근접 통과")
    expect(page.locator("#marieTea")).to_be_disabled()
    page.click("#marieClose")
    page.click("#eventDismiss")

    page.select_option("#eventSelect", "signal")
    page.click("#eventBtn")
    page.click("#marieOpen")
    expect(report).to_contain_text("드론 파견을 제안")
    page.click("#marieDrone")
    page.evaluate("marieStep(5)")
    expect(report).to_contain_text("GAIA 조사 완료")
    expect(page.locator("#marieDrone")).to_be_disabled()
    page.click("#marieClose")
    page.click("#eventDismiss")

    page.click("#eventBtn")
    page.click("#marieOpen")
    page.click("#marieDrone")
    page.click("#marieClose")
    page.click("#eventDismiss")
    page.click("#marieOpen")
    expect(report).to_contain_text("드론을 귀환")
    page.evaluate("marieStep(100)")
    expect(page.locator("#marieActivity")).to_have_text("차 준비 중")
    page.evaluate("marieStep(8)")
    expect(report).to_contain_text("차가 준비되었습니다")
    page.click("#marieTea")
    expect(report).to_contain_text("차를 올려두었습니다")
    assert not errors, errors
    page.close()


def test_marie_mobile_fallback(browser, url):
    page, errors = boot(browser, url, "RENDER / CANVAS 360°", mobile=True, disable_gpu=True)
    page.locator("#marieOpen").tap()
    expect(page.locator("#marieDialog")).to_be_visible()
    page.locator("#marieStatus").tap()
    expect(page.locator("#marieReport")).to_contain_text("계기판 상태 정상")
    page.locator("#marieTea").tap()
    expect(page.locator("#marieActivity")).to_have_text("차 준비 중")
    page.keyboard.press("Escape")
    expect(page.locator("#marieDialog")).to_be_hidden()
    assert not errors, errors
    page.close()


def test_fallbacks(browser, url):
    page, errors = boot(browser, url, "RENDER / CANVAS 360°", mobile=True, disable_gpu=True)
    expect(page.locator("#approach")).to_be_hidden()
    travel(page, 4, "GAIA", "RENDER / CANVAS 360°")
    travel(page, 27, "HALO GATE", "RENDER / CANVAS 360°")
    expect(page.locator("#tourBtn")).to_be_hidden()
    assert not errors, errors
    page.close()

    page = browser.new_page(reduced_motion="reduce")
    page.route("**/gas-4k.webp", lambda route: route.abort())
    page.route("**/nereid-surface.webp", lambda route: route.abort())
    page.goto(url)
    page.wait_for_function("document.querySelector('#skyView').width > 300")
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 360°")
    expect(page.locator("#approach")).to_be_hidden()
    travel(page, 4, "GAIA", "RENDER / WEBGL 3D")
    page.close()



def test_upload_failure(browser, url):
    for target in ("surface", "room", "destination"):
        page = browser.new_page(reduced_motion="reduce")
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script("""
            window.failUpload = %s;
            const gl = WebGLRenderingContext.prototype;
            const texImage2D = gl.texImage2D;
            const getError = gl.getError;
            const failures = new WeakSet();
            gl.texImage2D = function (target, ...args) {
                const layer = target === this.TEXTURE_2D ? 'surface'
                    : this.canvas.id === 'roomView' ? 'room' : 'sky';
                if (layer === window.failUpload) {
                    window.failUpload = null;
                    failures.add(this);
                    return;
                }
                return texImage2D.call(this, target, ...args);
            };
            gl.getError = function () {
                return failures.delete(this) ? this.OUT_OF_MEMORY : getError.call(this);
            };
        """ % repr(target))
        page.goto(url)
        if target == "destination":
            expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D")
            page.evaluate("window.failUpload = 'sky'")
            travel(page, 8, "NEBULA", "RENDER / CANVAS 360°")
        expect(page.locator("#renderMode")).to_have_text("RENDER / CANVAS 360°")
        expect(page.locator("#approach")).to_be_hidden()
        page.wait_for_function("""() => {
            const sky = document.querySelector('#skyView');
            if (sky.width <= 300) return false;
            return sky.getContext('2d').getImageData(0, 0, sky.width, sky.height).data
                .some((channel, index) => channel > 0 && index % 4 !== 3);
        }""")
        assert page.evaluate("window.failUpload === null")
        travel(page, 3, "DEEP SPACE", "RENDER / CANVAS 360°")
        assert not errors, errors
        page.close()


def test_startup_retry(browser, url):
    page = browser.new_page(reduced_motion="reduce")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    attempts = []

    def fail_twice(route):
        attempts.append(route.request.url)
        if len(attempts) <= 2:
            route.abort()
        else:
            route.continue_()

    page.route("**/bridge-front.webp*", fail_twice)
    page.goto(url)
    page.evaluate("window.samePage = true")
    retry = page.locator("#retryStartup")
    for _ in range(2):
        expect(page.locator("#startupStatus")).to_have_text("관측창 에셋을 불러오지 못했습니다.")
        expect(page.locator("#travel")).to_be_disabled()
        retry.click()
    expect(page.locator("#startupPanel")).to_be_hidden()
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D")
    assert page.evaluate("window.samePage === true")
    assert len(attempts) == 3 and all("?retry=" in url for url in attempts[1:])
    travel(page, 1, "SELENE", "RENDER / WEBGL 3D")
    assert not errors, errors
    page.close()


def test_adaptive_quality(browser, url):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""
        // Drive frame pacing independently of the software GPU. Other cases
        // exercise actual draws; this one checks the canvas resolution.
        let pendingFrame;
        let time = performance.now();
        window.requestAnimationFrame = callback => { pendingFrame = callback; };
        WebGLRenderingContext.prototype.drawArrays = () => {};
        window.advanceFrames = (count, milliseconds) => {
            for (let frame = 0; frame < count; frame++) {
                time += milliseconds;
                pendingFrame(time);
            }
            return document.querySelector('#skyView').width;
        };
    """)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D")
    assert page.evaluate("advanceFrames(1, 16.67)") == 1080
    assert page.evaluate("advanceFrames(25, 34)") == 864
    assert 1080 < page.evaluate("advanceFrames(335, 16.67)") <= 1440
    expect(page.locator("#approach")).to_be_visible()
    assert not errors, errors
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
                test_bridge_walk(browser, url)
                test_bridge_mesh_fallback(browser, url)
                test_bridge_touch(browser, url)
                print("PASS: 3D bridge, movement, mode transitions, touch and mesh fallback", flush=True)
                test_expanded_sectors(browser, url)
                test_animated_tour(browser, url)
                print("PASS: 32 destinations, sector groups and observation tour", flush=True)
                test_dynamic_events(browser, url)
                print("PASS: dynamic events, automatic ring passage and response controls", flush=True)
                test_navigation_map(browser, url)
                test_navigation_map_mobile(browser, url)
                print("PASS: 3D map, warp tracking, failed warp, visit persistence and mobile Canvas", flush=True)
                test_bridge_audio(browser, url)
                test_automatic_observation(browser, url)
                print("PASS: layered audio and automatic observation", flush=True)
                test_marie_bridge(browser, url)
                test_marie_mobile_fallback(browser, url)
                print("PASS: Marie patrol, reports, hazard warnings, drone and tea", flush=True)
                test_fallbacks(browser, url)
                test_upload_failure(browser, url)
                print("PASS: Texture OOM on surface, bridge and destination cubemap", flush=True)
                test_startup_retry(browser, url)
                print("PASS: Repeated startup failure and in-page recovery", flush=True)
                test_adaptive_quality(browser, url)
                print("PASS: Adaptive 3D resolution decrease and recovery above 1080 px", flush=True)
                browser.close()
        finally:
            server.shutdown()
    print("PASS: Desktop and mobile WebGL, nine sectors, reduced motion, context loss, and Canvas fallback")


if __name__ == "__main__":
    main()

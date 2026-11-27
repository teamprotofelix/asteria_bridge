"""Free flight and the 21-event catalog through a real static HTTP origin."""
import os
from pathlib import Path

from browser_smoke import ROOT, QuietHandler, Thread, ThreadingHTTPServer, expect, partial, sync_playwright

OUTPUT = Path(os.environ.get("FLIGHT_CAPTURE_DIR", "flight-pr12-captures"))
CLOCK = """
let current = performance.now(), callbacks=[];
Object.defineProperty(performance,'now',{value:()=>current});
window.requestAnimationFrame = next => {callbacks.push(next);};
window.flightFrames = (count, ms) => {
    for(let i=0;i<count;i++) {
        current+=ms;
        const frame=callbacks;
        callbacks=[];
        for(const draw of frame) draw(current);
    }
};
window.skyUniform = name => {
    const gl=document.querySelector('#skyView').getContext('webgl');
    const program=gl.getParameter(gl.CURRENT_PROGRAM);
    return Array.from(gl.getUniform(program,gl.getUniformLocation(program,name)));
};
"""


def advance(page, frames=1, milliseconds=100):
    page.evaluate("([frames,ms]) => flightFrames(frames,ms)", [frames, milliseconds])


def hold(page, key, frames=13):
    page.keyboard.down(key)
    advance(page, frames)
    page.keyboard.up(key)
    advance(page, 1)


def boot(browser, url, *, mobile=False):
    page = browser.new_page(viewport={"width": 390, "height": 844} if mobile else {"width": 960, "height": 650},
                            is_mobile=mobile, has_touch=mobile, reduced_motion="reduce")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(CLOCK)
    page.goto(url)
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 3D", timeout=25000)
    advance(page)
    return page, errors


def eye(page):
    return page.evaluate("skyUniform('eye')")


def pilot(browser, url):
    page, errors = boot(browser, url)
    start = eye(page)
    page.keyboard.press("p")
    advance(page)
    expect(page.locator("#viewMode")).to_have_text("PILOT")
    expect(page.locator("#approach")).to_be_hidden()
    assert eye(page) == start
    hold(page, "l")
    assert eye(page)[0] > start[0] + .5
    hold(page, "u")
    assert eye(page)[1] > start[1] + .5
    hold(page, "i")
    moved = eye(page)
    assert moved[2] > start[2] + .5
    page.screenshot(path=OUTPUT / "pilot-desktop.png")

    page.click("#flightCamera")
    advance(page)
    orientation = page.evaluate("skyUniform('rot')")
    hold(page,"d",10)
    assert page.evaluate("skyUniform('rot')") == orientation
    page.mouse.move(450,195)
    page.mouse.down()
    page.mouse.move(516,222)
    page.mouse.up()
    advance(page)
    look = page.evaluate("skyUniform('rot')")
    assert look != orientation
    page.click("#flightCamera")
    advance(page)
    assert page.evaluate("skyUniform('rot')") != look
    assert page.evaluate("skyUniform('rot')") != orientation
    page.keyboard.press("Escape")
    advance(page)
    expect(page.locator("#viewMode")).to_have_text("MANUAL")
    expect(page.locator("#approach")).to_be_enabled()

    page.keyboard.press("p")
    advance(page)
    page.locator("#flightAssist").select_option("APPROACH")
    advance(page,120)
    expect(page.locator("#flightGuidance")).to_have_text("관측 거리 유지")
    page.locator("#flightAssist").select_option("ORBIT")
    advance(page,16)
    expect(page.locator("#flightGuidance")).to_have_text("공전 보조")
    page.click("#mapOpen")
    advance(page)
    expect(page.locator("#mapLocalFlight")).to_contain_text("NEREID")
    page.screenshot(path=OUTPUT / "pilot-map.png")
    page.click("#mapClose")
    hold(page,"i",100)
    expect(page.locator("#flightAssist")).to_have_value("IDLE")
    expect(page.locator("#flightGuidance")).to_contain_text("정지")

    page.click("#qualityOpen")
    page.locator("#qualitySelect").select_option("compatibility")
    expect(page.locator("#renderMode")).to_have_text("RENDER / WEBGL 360°")
    page.click("#qualityClose")
    expect(page.locator("#flightToggle")).to_be_disabled()
    expect(page.locator("#flightCapability")).to_contain_text("실시간 3D")
    expect(page.locator("#travel")).to_be_enabled()
    assert not errors, errors
    page.close()


def voyage(browser,url):
    page, errors = boot(browser,url)
    page.keyboard.press("p")
    page.select_option("#destinationSelect","4")
    advance(page)
    original = eye(page)

    pending=[]
    pattern="**/assets/v2/gaia-front.webp"
    page.route(pattern,lambda route:pending.append(route))
    page.click("#flightNavigate")
    advance(page,16)
    expect(page.locator("#flightGuidance")).to_have_text("에셋 준비")
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    page.keyboard.press("Escape")
    expect(page.locator("#travel")).to_be_enabled()
    advance(page)
    expect(page.locator("#flightGuidance")).to_contain_text("출항 취소")
    assert eye(page)==original
    for route in pending:
        route.abort()
    page.unroute(pattern)

    page.route(pattern,lambda route:route.abort())
    page.click("#flightNavigate")
    advance(page,16)
    expect(page.locator("#travel")).to_be_enabled(timeout=20_000)
    advance(page)
    expect(page.locator("#flightGuidance")).to_contain_text("항로 복구")
    assert eye(page)==original
    page.unroute(pattern)

    page.click("#flightNavigate")
    advance(page,16)
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE",timeout=20_000)
    page.keyboard.press("Escape")
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE")
    advance(page,6,1000)
    expect(page.locator("#destinationName")).to_have_text("GAIA")
    expect(page.locator("#flightReadout")).to_contain_text("GAIA")
    expect(page.locator("#flightAssist")).to_have_value("APPROACH")
    assert "gaia" in page.evaluate("JSON.parse(localStorage.getItem('asteria.visited-sectors.v1'))")
    assert not errors, errors
    page.close()


def events(browser,url):
    page,errors=boot(browser,url)
    selector=page.locator("#eventSelect")
    expect(selector.locator("option")).to_have_count(21)
    cases=[
        ("sunset",None,"행성 일몰"),
        ("moonTransit",None,"위성 통과"),
        ("stellarFlare","5","항성 플레어"),
        ("pulsar","26","펄서 빔"),
        ("nebulaTurbulence",None,"성운 난기류"),
        ("fleet",None,"함대 조우"),
        ("docking","27","우주 정거장 접안 요청"),
    ]
    for value, destination, title in cases:
        if destination:
            page.select_option("#destinationSelect", destination)
            page.click("#travel")
            expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE",timeout=20000)
            advance(page,5,1000)
        if value=="stellarFlare":
            expect(selector.locator('[value="stellarFlare"]')).to_be_disabled()
            page.locator("#approach").fill("75")
            advance(page)
        page.select_option("#eventSelect",value)
        page.click("#eventBtn")
        expect(page.locator("#eventName")).to_have_text(title)
        advance(page)
        page.screenshot(path=OUTPUT / (value+".png"))
        page.click("#eventAction")
        expect(page.locator("#eventAction")).to_be_hidden()
        page.click("#eventDismiss")
        expect(page.locator("#eventBanner")).to_be_hidden()
    assert not errors, errors
    page.close()


def mobile(browser,url):
    page,errors=boot(browser,url,mobile=True)
    page.locator("#flightToggle").tap()
    advance(page)
    initial=eye(page)
    stick=page.locator('[data-stick="translation"]')
    expect(stick).to_be_visible()
    pos=stick.bounding_box()
    center={"x":pos["x"]+pos["width"]*.5,"y":pos["y"]+pos["height"]*.5}
    up={**center,"y":center["y"]-23}
    touch=page.context.new_cdp_session(page)
    touch.send("Input.dispatchTouchEvent",{"type":"touchStart","touchPoints":[center]})
    touch.send("Input.dispatchTouchEvent",{"type":"touchMove","touchPoints":[up]})
    advance(page,8)
    touch.send("Input.dispatchTouchEvent",{"type":"touchEnd","touchPoints":[]})
    assert eye(page)[2]>initial[2]+.2
    page.screenshot(path=OUTPUT / "pilot-mobile.png")
    # The synthesized swipe can suppress the next immediate mobile click.
    page.wait_for_timeout(400)
    page.locator("#flightExit").tap()
    expect(page.locator("#viewMode")).to_have_text("MANUAL")
    assert not errors, errors
    page.close()


def main():
    OUTPUT.mkdir(exist_ok=True,parents=True)
    with ThreadingHTTPServer(("127.0.0.1",0),partial(QuietHandler,directory=ROOT.parent)) as server:
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser=playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_BIN"),
                    args=["--enable-unsafe-swiftshader","--use-angle=swiftshader"])
                url=f"http://127.0.0.1:{server.server_port}/{ROOT.name}/"
                pilot(browser,url)
                print("PASS: 6DOF rendering, independent camera, collision, map, compatibility",flush=True)
                voyage(browser,url)
                print("PASS: automated voyage cancellation, load failure and recorded arrival",flush=True)
                events(browser,url)
                print("PASS: seven new events and real response controls",flush=True)
                mobile(browser,url)
                print("PASS: mobile touch translation",flush=True)
                browser.close()
        finally:
            server.shutdown()


if __name__=="__main__":
    main()

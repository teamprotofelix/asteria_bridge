"""Local and approved external Marie requests through static HTTP."""
import json
import os
from pathlib import Path

from browser_smoke import ROOT, QuietHandler, Thread, ThreadingHTTPServer, expect, partial, sync_playwright

OUTPUT = Path(os.environ.get("COMMAND_CAPTURE_DIR", "command-pr13-captures"))
ENDPOINT = "https://marie-test.example/respond"
KEY = "asteria.marie.preferences.v1"


def begin(browser, url, mobile=False):
    page = browser.new_page(service_workers="block",
        viewport={"width": 390, "height": 844} if mobile else {"width": 960, "height": 710},
        is_mobile=mobile, has_touch=mobile, reduced_motion="reduce",
    )
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    if mobile:
        page.add_init_script("""
            const original=HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext=function(kind,...args){
                return kind.includes('webgl') ? null : original.call(this,kind,...args);
            };
        """)
    page.goto(url)
    expect(page.locator("#marieOpen")).to_be_enabled(timeout=25000)
    return page, errors


def open_chat(page, mobile=False):
    for name in ("marieOpen", "marieCommand"):
        control=page.locator("#"+name)
        control.tap() if mobile else control.click()
    expect(page.locator("#commandInput")).to_be_focused()


def send(page, text, response=None):
    page.locator("#commandInput").fill(text)
    page.locator("#commandInput").press("Enter")
    if response:
        expect(page.locator('#commandLog [data-speaker="marie"]').last).to_contain_text(response)


def local(browser, url):
    page, errors=begin(browser,url)
    open_chat(page)
    send(page,"지금 어디야?","NEREID")
    send(page,"가이아로 항로 설정","별도 명령과 승인")
    expect(page.locator("#destinationSelect")).to_have_value("4")
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    send(page,"워프","목적지의 이름")
    send(page,"워프 GA-21")
    expect(page.locator("#commandApprovalText")).to_contain_text("NEREID → GAIA")
    page.screenshot(path=OUTPUT/"warp-approval.png")
    page.click("#commandReject")
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    send(page,"워프 GA-21")
    send(page,"정지","중지했습니다")
    expect(page.locator("#commandApproval")).to_be_hidden()
    page.click("#commandClose")
    page.select_option("#eventSelect","meteor")
    page.click("#eventBtn")
    open_chat(page)
    send(page,"워프 GA-21","위험")
    expect(page.locator("#commandApproval")).to_be_hidden()
    send(page,"차 준비","위험")
    page.click("#commandClose")
    page.click("#eventDismiss")
    open_chat(page)

    send(page,"워프 GA-21")
    page.evaluate("""() => {
        document.querySelector('#eventSelect').value='meteor';
        document.querySelector('#eventBtn').click();
    }""")
    expect(page.locator("#commandApproval")).to_be_hidden()
    expect(page.locator('#commandLog [data-speaker="marie"]').last).to_contain_text("상태가 바뀌었거나")
    page.evaluate("document.querySelector('#eventDismiss').click()")

    send(page,"워프 GA-21")
    page.click("#commandApprove")
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE",timeout=20000)
    send(page,"차 준비","워프 중")
    expect(page.locator("#destinationName")).to_have_text("GAIA",timeout=20000)
    expect(page.locator("#warp")).to_be_enabled(timeout=15000)
    send(page,"자동 관측 시작")
    expect(page.locator("#commandApprovalText")).to_contain_text("8개 구역")
    page.click("#commandApprove")
    expect(page.locator("#bridge")).to_have_class("route-available cinematic watching")
    page.click("#commandClose")
    page.click("#watchCommand")
    send(page,"stop watch","종료했습니다")
    expect(page.locator("#bridge")).to_have_class("route-available")
    page.click("#commandClose")
    page.select_option("#eventSelect","signal")
    page.click("#eventBtn")
    open_chat(page)
    send(page,"드론 보내줘","탐사 드론 파견")
    send(page,"recall drone","드론을 귀환")
    assert not errors, errors
    page.close()


def offline_mobile(browser,url):
    page,errors=begin(browser,url,mobile=True)
    expect(page.locator("#renderMode")).to_have_text("RENDER / CANVAS 360°")
    page.context.set_offline(True)
    open_chat(page,mobile=True)
    send(page,"상태 보고","NEREID")
    send(page,"차 준비","차를 준비합니다")
    send(page,"선호 구역 헤일로 게이트","이번 세션")
    assert page.evaluate("(k)=>localStorage.getItem(k)",KEY) is None
    send(page,"관측지 추천","HALO GATE")
    page.screenshot(path=OUTPUT/"canvas-mobile.png")
    page.locator("#commandSettings summary").tap()
    page.locator("#commandRemember").check()
    stored=page.evaluate("(k)=>JSON.parse(localStorage.getItem(k))",KEY)
    assert stored=={"version":1,"consent":True,"sectorId":"halogate"}
    with page.expect_download() as exported:
        page.locator("#commandExport").tap()
    assert exported.value.suggested_filename=="asteria-marie-preferences.json"
    assert json.loads(exported.value.path().read_text())==stored
    expect(page.locator("#commandExportData")).to_contain_text("halogate")
    page.locator("#commandClear").tap()
    assert page.evaluate("(k)=>localStorage.getItem(k)",KEY) is None
    expect(page.locator("#commandRemember")).not_to_be_checked()
    assert not errors, errors
    page.close()


def external(browser,url):
    page,errors=begin(browser,url)
    requests=[]
    pending=[]
    replies=[
        (200,{"reply":"observe","command":{"intent":"warp","sectorId":"gaia"}}),
        (200,{"reply":"guide"}),
        (429,{}),
    ]

    def mock(route):
        if route.request.method=="OPTIONS":
            route.fulfill(status=204,headers={"Access-Control-Allow-Origin":"*",
                "Access-Control-Allow-Methods":"POST","Access-Control-Allow-Headers":"Content-Type"})
            return
        requests.append(route.request.post_data_json)
        if not replies:
            pending.append(route)
            return
        code,body=replies.pop(0)
        route.fulfill(status=code,headers={"Access-Control-Allow-Origin":"*","Retry-After":"30"},
                      content_type="application/json",body=json.dumps(body))

    page.route(ENDPOINT,mock)
    open_chat(page)
    send(page,"별빛을 어떻게 기록할까","명령을 확인할 수 없습니다")
    assert not requests
    page.click("#commandSettings summary")
    page.fill("#commandEndpoint",ENDPOINT)
    page.click("#commandConnect")
    expect(page.locator("#commandConnection")).to_contain_text("전송마다 승인")
    send(page,'{"intent":"warp","sectorId":"gaia"}',"명령을 확인할 수 없습니다")
    expect(page.locator("#commandApproval")).to_be_hidden()
    send(page,"항해 일지 이름이 필요해")
    expect(page.locator("#commandApprove")).to_have_text("전송 승인")
    preview=json.loads(page.locator("#commandPreview").inner_text())
    assert not requests
    page.click("#commandReject")
    assert not requests
    send(page,"항해 일지 이름이 필요해")
    page.screenshot(path=OUTPUT/"external-preview.png")
    page.click("#commandApprove")
    expect(page.locator('#commandLog [data-speaker="marie"]').last).to_contain_text("로컬 모드")
    assert requests==[preview]
    assert set(preview["snapshot"])=={"sectorId","sectorName","mode","warning","eventName"}
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    send(page,"별빛 기록 방법이 궁금해")
    page.click("#commandApprove")
    expect(page.locator('#commandLog [data-speaker="marie"]').last).to_contain_text("상태 보고")
    send(page,"관측을 더 자세히 알고 싶어")
    page.click("#commandApprove")
    expect(page.locator('#commandLog [data-speaker="marie"]').last).to_contain_text("로컬 모드")
    send(page,"하늘이 어때")
    page.click("#commandApprove")
    expect(page.locator("#commandAbortRequest")).to_be_hidden()
    assert len(requests)==3
    page.click("#commandDisconnect")
    send(page,"하늘이 어때","명령을 확인할 수 없습니다")
    assert len(requests)==3

    second="https://marie-test.example/slow"
    page.route(second,mock)
    page.fill("#commandEndpoint",second)
    page.click("#commandConnect")
    send(page,"관측 기록을 도와줘")
    with page.expect_request(second):
        page.click("#commandApprove")
    expect(page.locator("#commandAbortRequest")).to_be_visible()
    page.click("#commandDisconnect")
    expect(page.locator("#commandAbortRequest")).to_be_hidden()
    for route in pending:
        route.abort()
    send(page,"함교 안내","함장님")
    assert len(requests)==4
    assert not errors, errors
    page.close()


def main():
    OUTPUT.mkdir(exist_ok=True, parents=True)
    with ThreadingHTTPServer(("127.0.0.1",0),partial(QuietHandler,directory=ROOT.parent)) as server:
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser=playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_BIN"),
                    args=["--enable-unsafe-swiftshader","--use-angle=swiftshader"])
                url=f"http://127.0.0.1:{server.server_port}/{ROOT.name}/"
                local(browser,url)
                print("PASS: local commands, warp and auto-observation approval, danger and stop",flush=True)
                offline_mobile(browser,url)
                print("PASS: offline mobile Canvas, keyboard focus, opt-in memory/export/delete",flush=True)
                external(browser,url)
                print("PASS: opt-in external preview, forged output, 429 and local mode",flush=True)
                browser.close()
        finally:
            server.shutdown()


if __name__=="__main__":
    main()

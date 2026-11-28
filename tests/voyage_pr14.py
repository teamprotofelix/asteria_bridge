"""Verify consent, safe route persistence and offline deployment on a static origin."""
import io
import json
import os
from pathlib import Path

from browser_smoke import ROOT, QuietHandler, Thread, ThreadingHTTPServer, expect, partial, sync_playwright
from flight_pr12 import CLOCK, advance
from command_pr13 import open_chat, send

OUTPUT = Path(os.environ.get("VOYAGE_CAPTURE_DIR", "voyage-pr14-captures"))
KEY = "asteria.voyage.v2"
LEGACY = "asteria.visited-sectors.v1"


class WorkerVersions(QuietHandler):
    version = "14.2"
    disconnected = False

    def send_head(self):
        if self.disconnected:
            self.send_error(503)
            return None
        if self.path.split("?")[0].endswith("/sw.js"):
            source = (ROOT / "sw.js").read_text().replace("version='14.2'", "version='" + self.version + "'")
            raw = source.encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            return io.BytesIO(raw)
        return super().send_head()


def ready(page, url):
    page.goto(url)
    expect(page.locator("#marieOpen")).to_be_enabled(timeout=30000)


def open_voyage(page, name="storage"):
    page.click("#voyageOpen")
    section=page.locator('[data-voyage="'+name+'"]')
    if section.get_attribute("open") is None:
        section.locator("summary").click()


def read_store(page):
    return page.evaluate("(key)=>JSON.parse(localStorage.getItem(key))",KEY)


def storage(browser, url):
    context=browser.new_context(service_workers="block",reduced_motion="reduce")
    page=context.new_page()
    errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.add_init_script("(function(){if(!localStorage.getItem('"+LEGACY+"')) localStorage.setItem('"+LEGACY+"','[\"gaia\"]');})()")
    ready(page,url)
    open_voyage(page)
    expect(page.locator("#voyageLegacy")).to_contain_text("1개")
    assert read_store(page) is None
    page.click("#voyageLegacy")
    expect(page.locator("#voyageFeedback")).to_contain_text("합쳤습니다")
    assert read_store(page) is None
    page.locator("#voyageConsent").check()
    expect(page.locator("#voyageStorageStatus")).to_have_text("이 브라우저에 저장 중")
    stored=read_store(page)
    assert set(stored["visitedSectorIds"])=={"nereid","gaia"}

    page.locator("#voyageFile").set_input_files({"name":"broken.json","mimeType":"application/json","buffer":b"{"})
    expect(page.locator("#voyagePreview")).to_contain_text("JSON 형식")
    expect(page.locator("#voyageApply")).to_be_disabled()
    page.locator("#voyageFile").set_input_files({"name":"big.json","mimeType":"application/json","buffer":b"x"*(256*1024+1)})
    expect(page.locator("#voyagePreview")).to_contain_text("256 KB")
    assert read_store(page)==stored

    backup={"schemaVersion":1,"visitedSectorIds":["selene"]}
    page.locator("#voyageFile").set_input_files({"name":"v1.json","mimeType":"application/json","buffer":json.dumps(backup).encode()})
    expect(page.locator("#voyagePreview")).to_contain_text("방문 1개")
    page.click("#voyageApply")
    expect(page.locator("#voyageFeedback")).to_contain_text("백업을 반영")
    assert set(read_store(page)["visitedSectorIds"])=={"nereid","gaia","selene"}
    with page.expect_download() as backup_file:
        page.click("#voyageExport")
    assert json.loads(backup_file.value.path().read_text())==read_store(page)
    page.screenshot(path=OUTPUT/"storage.png")

    another=context.new_page()
    ready(another,url)
    open_voyage(another)
    expect(another.locator("#voyageConsent")).to_be_checked()
    page.click("#voyageConfirmErase")
    page.click("#voyageForget")
    expect(another.locator("#voyageConsent")).not_to_be_checked()
    assert read_store(another) is None
    assert page.evaluate("(key)=>JSON.parse(localStorage.getItem(key))",LEGACY)==["gaia"]
    assert not errors,errors
    context.close()


MARIE_KEY = "asteria.marie.preferences.v1"


def memory_settings(page):
    open_chat(page)
    summary=page.locator("#commandSettings summary")
    if page.locator("#commandSettings").get_attribute("open") is None:
        summary.click()


def set_voyage_consent(page):
    open_voyage(page)
    page.locator("#voyageConsent").check()
    expect(page.locator("#voyageStorageStatus")).to_have_text("이 브라우저에 저장 중")
    page.click("#voyageClose")


def read_marie(page):
    return page.evaluate("(key)=>JSON.parse(localStorage.getItem(key))",MARIE_KEY)


def memory_consent(browser,url):
    for voyage_on,marie_on in [(False,False),(True,False),(False,True),(True,True)]:
        context=browser.new_context(service_workers="block",reduced_motion="reduce",viewport={"width":800,"height":650})
        page=context.new_page()
        ready(page,url)
        if voyage_on:
            set_voyage_consent(page)
        memory_settings(page)
        if marie_on:
            page.locator("#commandRemember").check()
            expect(page.locator("#commandFeedback")).to_contain_text("저장을 켰습니다")
        send(page,"마리, 선호 구역 셀레네","브라우저에 저장" if marie_on else "이번 세션")
        expect(page.locator("#commandMemory")).to_contain_text("SELENE")
        document=read_store(page)
        assert bool(document)==voyage_on
        assert not document or document["mariePreferences"] is None, document
        assert bool(read_marie(page))==marie_on
        page.reload()
        expect(page.locator("#marieOpen")).to_be_enabled(timeout=25000)
        memory_settings(page)
        expect(page.locator("#commandMemory")).to_contain_text("SELENE" if marie_on else "미설정")
        context.close()

    context=browser.new_context(service_workers="block",reduced_motion="reduce",viewport={"width":900,"height":700})
    first=context.new_page()
    ready(first,url)
    set_voyage_consent(first)
    legacy=read_store(first)
    legacy["mariePreferences"]={"sectorId":"halogate"}
    # A record from the earlier PR build must be ignored even before cleanup completes.
    first.evaluate("([key,value])=>localStorage.setItem(key,JSON.stringify(value))",[KEY,legacy])
    first.reload()
    expect(first.locator("#marieOpen")).to_be_enabled(timeout=25000)
    first.wait_for_function("(key)=>JSON.parse(localStorage.getItem(key)).mariePreferences===null",arg=KEY)
    memory_settings(first)
    expect(first.locator("#commandMemory")).to_contain_text("미설정")
    first.locator("#commandRemember").check()
    expect(first.locator("#commandFeedback")).to_contain_text("저장을 켰습니다")
    send(first,"선호 구역 셀레네","브라우저에 저장")
    second=context.new_page()
    ready(second,url)
    memory_settings(second)
    expect(second.locator("#commandMemory")).to_contain_text("SELENE")
    first.locator("#commandRemember").uncheck()
    expect(first.locator("#commandFeedback")).to_contain_text("저장을 껐습니다")
    expect(first.locator("#commandMemory")).to_contain_text("현재 세션만")
    expect(second.locator("#commandMemory")).to_contain_text("미설정")
    expect(second.locator("#commandRemember")).not_to_be_checked()
    assert read_marie(first) is None and read_store(first)["mariePreferences"] is None

    first.click("#commandClose")
    open_voyage(first)
    for mode in ["merge","replace"]:
        first.locator("#voyageFile").set_input_files({"name":"legacy-v2.json","mimeType":"application/json",
            "buffer":json.dumps(legacy).encode()})
        expect(first.locator("#voyagePreview")).to_contain_text("방문")
        first.select_option("#voyageMerge",mode)
        first.click("#voyageApply")
        expect(first.locator("#voyageFeedback")).to_contain_text("백업을 반영")
        assert read_store(first)["mariePreferences"] is None
        assert read_marie(first) is None
    first.click("#voyageClose")
    memory_settings(first)
    first.locator("#commandRemember").check()
    expect(first.locator("#commandFeedback")).to_contain_text("저장을 켰습니다")
    send(first,"선호 구역 가이아","브라우저에 저장")
    first.evaluate("""([key,value])=>{
        localStorage.setItem(key,JSON.stringify(value));
        const remove=Storage.prototype.removeItem;
        Storage.prototype.removeItem=function(key){
            if(key==='asteria.marie.preferences.v1') throw new DOMException('blocked','SecurityError');
            return remove.call(this,key);
        };
        window.restoreStorageRemoval=()=>{Storage.prototype.removeItem=remove;};
    }""",[KEY,legacy])
    first.click("#commandClear")
    expect(first.locator("#commandFeedback")).to_contain_text("삭제하지 못했습니다")
    assert read_marie(first)["sectorId"]=="gaia"
    assert read_store(first)["mariePreferences"] is None
    first.evaluate("restoreStorageRemoval()")
    first.click("#commandClear")
    expect(first.locator("#commandFeedback")).to_contain_text("저장 동의를 삭제했습니다")
    expect(second.locator("#commandMemory")).to_contain_text("미설정")
    assert read_marie(first) is None and read_store(first)["mariePreferences"] is None
    first.reload()
    expect(first.locator("#marieOpen")).to_be_enabled(timeout=25000)
    memory_settings(first)
    expect(first.locator("#commandMemory")).to_contain_text("미설정")
    context.close()


def custom(browser,url):
    page=browser.new_page(service_workers="block",reduced_motion="reduce",viewport={"width":960,"height":720})
    errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.add_init_script(CLOCK)
    ready(page,url)
    advance(page)
    page.click("#cinema")
    page.click("#watchEditor")
    fields=page.locator("#voyageStops input")
    for i,value in enumerate([60,180,30]):
        fields.nth(i).fill(str(value))
    page.select_option("#voyageView","captain")
    page.screenshot(path=OUTPUT/"custom-route.png")
    page.click("#voyageStart")
    advance(page,1,1000)
    expect(page.locator("#watchStatus")).to_contain_text("60초")
    page.click("#watchPause")
    advance(page,72,1000)
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    expect(page.locator("#watchStatus")).to_have_text("일시정지")
    page.click("#watchPause")
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'))")
    advance(page,72,1000)
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    page.evaluate("delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))")
    page.click("#watchNext")
    advance(page,1,1000)
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE",timeout=20000)
    advance(page,4,1000)
    expect(page.locator("#destinationName")).to_have_text("GAIA")
    expect(page.locator("#watchStatus")).to_contain_text("180초")
    page.route("**/deep-front.webp",lambda route:route.abort())
    with page.expect_request("**/deep-front.webp"):
        page.click("#watchNext")
        advance(page,1,1000)
    expect(page.locator("#flightStatus")).to_have_text("순항 항해 중")
    with page.expect_request("**/deep-front.webp"):
        advance(page,3,1000)
    expect(page.locator("#watchStatus")).to_contain_text("로드 실패")
    expect(page.locator("#destinationName")).to_have_text("GAIA")
    page.unroute("**/deep-front.webp")
    page.click("#watchNext")
    advance(page,1,1000)
    expect(page.locator("#exitCinema")).to_be_hidden()
    expect(page.locator("#destinationName")).to_have_text("GAIA")
    page.reload()
    expect(page.locator("#marieOpen")).to_be_enabled(timeout=22000)
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    expect(page.locator("#exitCinema")).to_be_hidden()

    # Two additional custom plans independently exercise finite repeats and explicit termination.
    for view, repeat, duration in [("exterior","2",30),("lounge","0",45)]:
        page.click("#cinema")
        page.click("#watchEditor")
        rows=page.locator("#voyageStops li")
        while rows.count()>1:
            rows.last.get_by_role("button", name="삭제").click()
        rows.first.locator("select").select_option("nereid")
        rows.first.locator("input").fill(str(duration))
        page.select_option("#voyageView",view)
        page.locator("#voyageRepeat").fill(repeat)
        page.click("#voyageStart")
        advance(page,1,1000)
        expect(page.locator("#watchStatus")).to_contain_text(str(duration)+"초")
        expect(page.locator("#roomToggle")).to_have_text("함교 OFF" if view=="exterior" else "함교 ON")
        advance(page,duration,1000)
        expect(page.locator("#exitCinema")).to_be_visible()
        if repeat=="2":
            advance(page,duration,1000)
        else:
            page.click("#exitCinema")
        expect(page.locator("#exitCinema")).to_be_hidden()
    assert not errors,errors
    page.close()


def offline(browser,url):
    context=browser.new_context(reduced_motion="reduce",viewport={"width":390,"height":844},is_mobile=True,has_touch=True)
    page=context.new_page()
    errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    ready(page,url)
    page.wait_for_function("navigator.serviceWorker.controller !== null",timeout=30000)
    cdp=context.new_cdp_session(page)
    manifest=cdp.send("Page.getAppManifest")
    parsed=json.loads(manifest["data"])
    assert parsed["display"]=="standalone" and parsed["scope"]=="./"
    assert not manifest["errors"],manifest["errors"]
    assert page.evaluate("caches.keys().then(keys=>keys.every(name=>!name.includes(':pack:')))")

    WorkerVersions.version="14.3"
    page.evaluate("navigator.serviceWorker.getRegistration().then(reg=>reg.update())")
    page.wait_for_function("navigator.serviceWorker.getRegistration().then(reg=>!!reg.waiting)",timeout=25000)
    page.click("#warp")
    expect(page.locator("#modeLabel")).to_have_text("WARP DRIVE")
    open_voyage(page,"offline")
    expect(page.locator("#voyageApplyUpdate")).to_be_disabled()
    expect(page.locator("#voyageApplyUpdate")).to_be_enabled(timeout=12000)
    with page.expect_navigation():
        page.click("#voyageApplyUpdate")
    expect(page.locator("#marieOpen")).to_be_enabled(timeout=22000)
    page.wait_for_function("caches.keys().then(keys=>keys.some(name=>name.endsWith('shell:14.3')) && keys.every(name=>!name.endsWith('shell:14.2')))")
    open_voyage(page,"offline")
    page.select_option("#voyageOfflineSector","gaia")
    page.click("#voyageOfflineAdd")
    expect(page.locator("#voyageOfflineList")).to_contain_text("GAIA",timeout=35000)
    page.screenshot(path=OUTPUT/"offline-mobile.png")
    page.click("#voyageClose")

    # The loopback server is also disabled for requests made by the service worker itself.
    WorkerVersions.disconnected=True
    context.set_offline(True)
    page.add_init_script("Object.defineProperty(navigator,'onLine',{get:()=>false})")
    page.reload()
    expect(page.locator("#marieOpen")).to_be_enabled(timeout=22000)
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    page.select_option("#destinationSelect","27")
    page.click("#travel")
    expect(page.locator("#toast")).to_contain_text("오프라인에 없는 구역")
    expect(page.locator("#destinationName")).to_have_text("NEREID")
    page.select_option("#destinationSelect","4")
    page.click("#travel")
    expect(page.locator("#destinationName")).to_have_text("GAIA",timeout=16000)
    expect(page.locator("#warp")).to_be_enabled(timeout=12000)
    open_voyage(page,"offline")
    page.select_option("#voyageOfflineSector","gaia")
    page.click("#voyageOfflineRemove")
    expect(page.locator("#voyageOfflineList")).to_contain_text("추가 구역 없음")
    assert not errors,errors
    context.close()
    WorkerVersions.disconnected=False


def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    with ThreadingHTTPServer(("127.0.0.1",0),partial(WorkerVersions,directory=ROOT.parent)) as server:
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser=playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_BIN"),
                    args=["--enable-unsafe-swiftshader","--use-angle=swiftshader"])
                url=f"http://127.0.0.1:{server.server_port}/{ROOT.name}/"
                storage(browser,url)
                print("PASS: legacy import, consent, backup preview/export, corruption and cross-tab delete",flush=True)
                memory_consent(browser,url)
                print("PASS: four consent combinations, reload, revocation, backup isolation and cross-tab sync",flush=True)
                custom(browser,url)
                print("PASS: three custom routes, finite repeats, pause, hidden tab, failed-leg retry/skip and safe reload",flush=True)
                offline(browser,url)
                print("PASS: PWA manifest, atomic update, offline reload, optional sector cache and removal",flush=True)
                browser.close()
        finally:
            server.shutdown()


if __name__=="__main__":
    main()

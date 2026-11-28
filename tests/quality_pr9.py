"""Exercise graphics presets and cancellation on a real static HTTP origin."""
import os
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread

from playwright.sync_api import expect, sync_playwright

from browser_smoke import ROOT, QuietHandler


def main():
    with ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=ROOT.parent)) as server:
        Thread(target=server.serve_forever,daemon=True).start()
        url=f'http://127.0.0.1:{server.server_port}/{ROOT.name}/'
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN'),
                args=['--enable-unsafe-swiftshader','--use-angle=swiftshader'])
            page=browser.new_page(service_workers="block", viewport={'width':1920,'height':900},reduced_motion='reduce')
            page.add_init_script("Object.defineProperty(navigator,'deviceMemory',{value:8});")
            errors=[]
            page.on('pageerror',lambda e: errors.append(str(e)))
            requested=[]
            page.on('request',lambda req: requested.append(req.url.rsplit('/',1)[-1]))
            page.goto(url)
            expect(page.locator('#renderMode')).to_have_text('RENDER / WEBGL 3D',timeout=25000)
            page.click('#qualityOpen')
            choice=page.locator('#qualitySelect')
            applied=page.locator('#qualityApplied')
            resolution=page.locator('#qualityResolution')
            expect(applied).to_have_text('Medium')
            assert 'nereid-medium.cube' in requested
            widths={}
            for tier,label,width in [('low','Low',512),('medium','Medium',1024),
                    ('high','High',2048),('ultra','Ultra',4096)]:
                choice.select_option(tier)
                expect(applied).to_have_text(label,timeout=25000)
                expect(page.locator('#qualityAssetSize')).to_have_text(f'{width} px / 면')
                assert f'nereid-{tier}.cube' in requested
                widths[label]=resolution.inner_text()
            choice.select_option('compatibility')
            expect(applied).to_have_text('Compatibility')
            expect(page.locator('#renderMode')).to_have_text('RENDER / WEBGL 360°')
            assert len(set(widths.values())) == 4,widths
            choice.select_option('auto')
            expect(applied).to_have_text('Medium')
            page.route('**/nereid-high.cube',lambda route:route.abort())
            choice.select_option('high')
            expect(page.locator('#qualityReason')).to_contain_text('하향')
            expect(applied).to_have_text('Medium')
            page.click('#qualityClose')
            held=[]
            page.route('**/halogate-high.cube',lambda route:held.append(route))
            with page.expect_request('**/halogate-high.cube'):
                page.select_option('#destinationSelect','27')
                page.click('#travel')
            page.keyboard.press('Escape')
            expect(page.locator('#travel')).to_be_enabled()
            expect(page.locator('#destinationName')).to_have_text('NEREID')
            held[0].abort()
            assert not errors,errors
            print('PASS: Auto/Ultra/High/Medium/Low/Compatibility, real requests, lower-tier recovery and abort',widths,flush=True)
            browser.close()
        server.shutdown()


if __name__ == '__main__':
    main()

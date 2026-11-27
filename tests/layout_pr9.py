from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
with ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=ROOT)) as server:
    Thread(target=server.serve_forever,daemon=True).start()
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN'),args=['--enable-unsafe-swiftshader','--use-angle=swiftshader'])
        page=browser.new_page(reduced_motion='reduce')
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        expect(page.locator('#renderMode')).to_have_text('RENDER / WEBGL 3D',timeout=25000)
        for width,height in [(320,568),(390,844),(768,1024),(844,390),(1440,900),(1920,1080),(2560,1440)]:
            page.set_viewport_size({'width':width,'height':height})
            expect(page.locator('#qualityOpen')).to_be_in_viewport()
            page.click('#qualityOpen')
            expect(page.locator('#qualitySelect')).to_be_in_viewport()
            assert page.locator('#qualityDialog').evaluate('el=>el.scrollWidth<=el.clientWidth')
            page.click('#qualityClose')
            print('PASS root layout',width,height,flush=True)
        browser.close()
    server.shutdown()

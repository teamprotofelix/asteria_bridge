from playwright.sync_api import sync_playwright
from pathlib import Path
import base64,json
root=Path(__file__).resolve().parents[1]
output=root/'test-output';output.mkdir(exist_ok=True)
html=(root/'index.html').read_text();css=(root/'style.css').read_text();js=(root/'app.js').read_text();assets={f.name:'data:image/webp;base64,'+base64.b64encode(f.read_bytes()).decode() for f in (root/'assets/v2').glob('*.webp') if not ('-4k' in f.name or '-8k' in f.name)}
js=js.replace("`${base}${destinations[n][0]}-${f}.webp`","asset[`${destinations[n][0]}-${f}.webp`]").replace("`${base}bridge-${f}.webp`","asset[`bridge-${f}.webp`]")
html=html.replace('src="assets/mark.svg"','src="data:image/svg+xml;base64,'+base64.b64encode((root/'assets/mark.svg').read_bytes()).decode()+'"').replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>').replace('<script src="app.js" defer></script>','<script>const asset='+json.dumps(assets)+';'+js+'</script>')
def load(page):page.set_content(html,wait_until='load',timeout=30000)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));load(page);page.wait_for_timeout(2600);page.screenshot(path=str(output/'front.png'));print('front',page.locator('#heading').inner_text(),page.locator('#renderMode').inner_text(),errors)
 page.keyboard.down('d');page.wait_for_timeout(2100);page.keyboard.up('d');page.screenshot(path=str(output/'rear.png'));print('rear',page.locator('#heading').inner_text());assert 140<float(page.locator('#heading').inner_text()[:-1])<240
 page.keyboard.press('r');page.keyboard.down('w');page.wait_for_timeout(950);page.keyboard.up('w');page.screenshot(path=str(output/'up.png'));print('up',page.locator('#pitchRead').inner_text());page.keyboard.press('r')
 page.select_option('#destinationSelect','6');page.click('#travel');page.wait_for_timeout(5200);print('dest',page.locator('#destinationName').inner_text(),page.locator('#warp').is_enabled());assert page.locator('#destinationName').inner_text()=='SINGULARITY' and page.locator('#warp').is_enabled();page.click('#roomToggle');page.screenshot(path=str(output/'blackhole.png'));page.click('#eventBtn');print('event',page.locator('#eventName').inner_text());page.click('#cinema');assert page.locator('#exitCinema').is_visible();page.keyboard.press('Escape');assert not page.locator('#exitCinema').is_visible(); print('errors',errors);assert not errors
 mobile=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1);load(mobile);mobile.wait_for_timeout(2300);mobile.screenshot(path=str(output/'mobile.png'));print('mobile overflow',mobile.evaluate('document.documentElement.scrollWidth'),mobile.locator('#travel').is_visible());b.close()

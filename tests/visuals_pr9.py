"""Capture reproducible PR09 evidence against a checkout of the parent revision."""
import argparse
import base64
import io
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = (8,3,0,4,27)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def collect(browser, url, wanted, modern):
    page = browser.new_page(viewport={'width':780,'height':580}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("""
      let now=performance.now(), queue=[];
      const gl=WebGLRenderingContext.prototype, create=gl.createTexture, release=gl.deleteTexture;
      const textures=new Set(); let peak=0;
      gl.createTexture=function() {
        const t=create.call(this); if(t) textures.add(t); peak=Math.max(peak,textures.size); return t;
      };
      gl.deleteTexture=function(t){textures.delete(t);return release.call(this,t);};
      window.textureStats=()=>({live:textures.size,peak});
      Object.defineProperty(performance,'now',{value:()=>now});
      window.requestAnimationFrame=callback=>{queue.push(callback);};
      window.advanceCapture= dt => {
        now+=dt; const ready=queue; queue=[]; for(const frame of ready) frame(now);
      };
    """)
    page.goto(url)
    expect(page.locator('#renderMode')).to_have_text('RENDER / WEBGL 3D',timeout=25000)
    page.evaluate('advanceCapture(16)')
    page.click('#roomToggle')
    evidence = []
    current = 0
    for index in wanted:
        if current != index:
            page.select_option('#destinationSelect',str(index))
            page.click('#travel')
            expect(page.locator('#modeLabel')).to_have_text('WARP DRIVE',timeout=25000)
            page.evaluate('advanceCapture(4000)')
        page.evaluate('advanceCapture(240)')
        name = page.locator('#destinationName').inner_text()
        render = page.locator('#renderMode').inner_text()
        expected = 'RENDER / WEBGL 360°' if index in (3,8) else 'RENDER / WEBGL 3D'
        assert render == expected, (name,render)
        data = page.locator('#skyView').evaluate('(canvas)=>canvas.toDataURL("image/png")')
        image = Image.open(io.BytesIO(base64.b64decode(data.split(',')[1]))).convert('RGB')
        evidence.append((name,image))
        current=index
    result = page.evaluate('textureStats()') if modern else {}
    assert not errors,errors
    if modern:
        assert result['live'] <= 3 and result['peak'] <= 3,result
        assert len({image.tobytes() for _,image in evidence}) == len(evidence)
    page.close()
    return evidence,result


def tile(sheet, name, image, x, y, width, height):
    sheet.paste(image.resize((width,height),Image.Resampling.LANCZOS),(x,y))
    ImageDraw.Draw(sheet).text((x+6,y+6),name, fill='white',stroke_width=2,stroke_fill='#111925')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    handler = partial(Quiet,directory=ROOT.parent)
    with ThreadingHTTPServer(('127.0.0.1',0),handler) as server:
        Thread(target=server.serve_forever,daemon=True).start()
        prefix=f'http://127.0.0.1:{server.server_port}'
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN'),
                args=['--enable-unsafe-swiftshader','--use-angle=swiftshader'])
            before,_ = collect(browser,f'{prefix}/{args.baseline.resolve().name}/',SAMPLES,False)
            after,stats = collect(browser,f'{prefix}/{ROOT.name}/',range(32),True)
            comparison = Image.new('RGB',(960,5*282), '#101825')
            for row,index in enumerate(SAMPLES):
                tile(comparison,before[row][0]+' / BEFORE',before[row][1],0,row*282,480,282)
                tile(comparison,after[index][0]+' / PR09',after[index][1],480,row*282,480,282)
            comparison.save(args.output/'before-after.webp',quality=83)
            contact = Image.new('RGB',(1280,8*180),'#101825')
            for index,(name,image) in enumerate(after):
                tile(contact,name,image,index%4*320,index//4*180,320,180)
            contact.save(args.output/'all-sectors.webp',quality=82)
            perf = {}
            for width,height in [(1440,900),(390,844)]:
                mobile = width < 700
                page = browser.new_page(viewport={'width':width,'height':height},is_mobile=mobile,has_touch=mobile)
                page.goto(f'{prefix}/{ROOT.name}/')
                expect(page.locator('#renderMode')).to_have_text('RENDER / WEBGL 3D',timeout=25000)
                page.click('#qualityOpen')
                expect(page.locator('#qualityApplied')).to_have_text('Low' if mobile else 'Medium')
                page.locator('#qualityDialog').screenshot(path=args.output/('mobile-quality.png' if mobile else 'desktop-quality.png'))
                page.click('#qualityClose')
                values = page.evaluate("""async() => {
                    const data=[];
                    let last=await new Promise(requestAnimationFrame);
                    for(let i=0;i<60;i++){const now=await new Promise(requestAnimationFrame);data.push(now-last);last=now;}
                    const view=document.querySelector('#skyView');
                    return {frames:data, resolution:[view.width,view.height]};
                }""")
                sorted_frames = sorted(values['frames'])
                perf[f'{width}x{height}'] = {'p50_ms':round(sorted_frames[29],2),
                       'p95_ms':round(sorted_frames[56],2),'render':values['resolution']}
                page.close()
            browser.close()
        server.shutdown()
    record = {'renderer':'Chromium SwiftShader','all_sectors':32,'repeated_warps':31,
              'textures':stats,'frame_time':perf}
    (args.output/'measurements.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record),flush=True)


if __name__ == '__main__':
    main()

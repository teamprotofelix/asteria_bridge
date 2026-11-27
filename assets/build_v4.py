"""Generate original planet-free WebP cube packs and featured assets."""
import argparse
import hashlib
import io
import json
import math
import struct
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent / 'v4'
IDS = ('nereid selene eos deep gaia solaris singularity belt nebula helion kallisto velaris sereph cinder '
       'thalassa verdant vespera cryon mistral aurum obsidian eirene emberrift glacier wanderer undertow hush '
       'halogate silentarray ambervault palimpsest mirrorward').split()
FEATURES = {'nereid', 'gaia', 'deep', 'nebula', 'halogate'}
PALETTE = [(83,108,165),(79,129,192),(184,102,66),(138,139,190),(70,140,157),(190,116,68),
           (153,83,125),(123,123,169),(76,116,209),(130,161,230),(173,80,90),(94,148,205),
           (130,141,205),(166,137,97),(61,153,147),(102,154,110),(168,97,133),(80,157,186),
           (141,87,187),(163,129,82),(140,93,92),(150,121,181),(188,80,76),(97,164,201),
           (81,118,159),(86,123,190),(136,99,198),(87,176,170),(106,140,189),(182,136,87),
           (135,164,132),(166,92,169)]


def direction(u, v, face):
    if face is None:
        lat = v*np.pi/2
        return np.sin(u*np.pi)*np.cos(lat), np.sin(lat)+np.zeros_like(u), np.cos(u*np.pi)*np.cos(lat)
    x, y = u+np.zeros_like(v), v+np.zeros_like(u)
    one = np.ones_like(x)
    x,y,z = [(x,y,one),(one,y,-x),(-x,y,-one),(-one,y,x),(x,one,-y),(x,-one,y)][face]
    length = np.sqrt(x*x+y*y+z*z)
    return x/length,y/length,z/length


def stars(x, y, z, seed, scale, pixel):
    positions = [c*scale+1000 for c in (x,y,z)]
    i,j,k = [c.astype(np.int32) for c in positions]
    hash_ = (i*73856093 ^ j*19349663 ^ k*83492791 ^ seed*19793).astype(np.uint32)
    hash_ ^= hash_ >> 13
    hash_ *= np.uint32(1274126177)
    hash_ ^= hash_ >> 16
    centers = [.25+((hash_ >> off)&15).astype(np.float32)*.033 for off in (10,14,18)]
    r2 = sum((p-q-c)**2 for p,q,c in zip(positions,(i,j,k),centers))
    sigma = min(.20,max(.074, scale*pixel*.35))
    return np.exp(-r2/(2*sigma*sigma)) * ((hash_&1023)<18) * (.5+((hash_>>23)&31)/52)


def sky(x, y, z, index, pixel):
    angle = (index+17)*.741
    a,b = math.sin(angle),math.cos(angle)
    axis = a*x+b*z
    across = b*x-a*z
    tilt = .58*math.sin(index*.438)
    plane = y*math.cos(tilt)+across*math.sin(tilt)
    noise = (.49*np.sin(axis*7.2+plane*5.6+index)+.28*np.sin(x*22.1-z*17.1+y*9.4)
             +.14*np.sin(x*40.2+y*61.3-z*24)+.06*np.cos(axis*193.2+plane*82.6)
             +.02*np.sin(x*532-y*419+z*721))
    band = np.exp(-np.abs(plane+.14*noise)*(8.5+index%6))
    cloud = (.22 if index%4 else .31)*band*np.clip(.38+axis*(.58 if index%2 else -.58),0,1)*np.clip(.62+noise,.06,1)
    if index in (3, 8, 22, 26):
        cloud += (.47 if index == 8 else .22)*np.exp(-((axis-.48)/.48)**2-((plane-.12)/.32)**2)*np.clip(.57+noise,.06,1)
    glow = .052*np.exp(-((plane/.17)**2+((across-.24*math.sin(index))/.51)**2))*np.maximum(0,axis)
    stellar = stars(x,y,z,index+17,61+index%6,pixel)+.5*stars(x,y,z,index+51,148,pixel)
    rgb = np.empty(x.shape+(3,),np.uint8)
    for c in range(3):
        rgb[...,c] = np.clip([2,3,6][c]+noise+cloud*PALETTE[index][c]+glow*(140+22*c)+stellar*(203+14*c),0,255)
    return rgb


def albedo(x, y, z, index):
    t = (.5*np.sin(7*x+6*z-4*y)+.25*np.sin(17*z+15*y-9*x)+.13*np.sin(38*x-22*y-18*z)
         +.06*np.cos(91*z+57*x+36*y)+.03*np.sin(249*y+221*x-316*z))
    fine = 3*np.sin(708*x+721*z-513*y)*np.cos(429*z-433*y)
    if index == 0:
        p = .55+.17*np.sin(35*y+3*t)+.13*np.cos(69*y+4*t)+.17*t
        channels = (88+151*p,65+128*p,49+102*p)
    else:
        land = np.clip(14*(t+.28*np.sin(9*y-2*x)-.15)+.12,0,1)
        ice = np.clip((np.abs(y)-.87)*11+t*.20,0,1)
        sea = (15+8*t,50+20*t,92+27*t)
        soil = (76+30*t,108+38*t,57+19*t)
        channels = [(sea[c]*(1-land)+soil[c]*land)*(1-ice)+(181+12*c)*ice for c in range(3)]
    return np.stack([np.clip(c+fine,0,255).astype('uint8') for c in channels],axis=-1)


def webp(index, width, height, face=None, surface=False):
    result = np.empty((height,width,3),np.uint8)
    u = ((np.arange(width,dtype=np.float32)+.5)*2/width-1)[None,:]
    for start in range(0,height,128):
        end = min(start+128,height)
        v = (1-(np.arange(start,end,dtype=np.float32)+.5)*2/height)[:,None]
        if surface:
            lat,lon = v*np.pi/2,u*np.pi
            result[start:end] = albedo(np.cos(lat)*np.cos(lon),np.sin(lat)+np.zeros_like(u),
                                       np.cos(lat)*np.sin(lon),index)
        else:
            result[start:end] = sky(*direction(u,v,face),index,2/width)
    buffer = io.BytesIO()
    Image.fromarray(result).save(buffer,'WEBP',quality=87,method=1)
    return buffer.getvalue()


def render(task):
    index,tier,size = task
    name = IDS[index]
    is_pack = tier not in ('master','surface')
    height = size if is_pack else size//2
    path = OUT / (f'{name}-{tier}.cube' if is_pack else f'{name}-{tier}.webp')
    if not path.exists():
        if is_pack:
            images = [webp(index,size,size,face) for face in range(6)]
            path.write_bytes(struct.pack('<4s6I',b'AC04',*map(len,images))+b''.join(images))
        else:
            path.write_bytes(webp(index,size,height,surface=tier=='surface'))
    payload = path.read_bytes()
    return name,tier,{'path':f'assets/v4/{path.name}','width':size,'height':height,
                      'quality':tier,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),
                      'source':'assets/build_v4.py','license':'original-repository-art'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs',type=int,default=3)
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    manifest = {name:{'faces':{},'keyLight':[round(-.66+.04*(i%7),2),round(.35+.07*(i%5),2),
                                          round(-.67+.03*(i%8),2)]} for i,name in enumerate(IDS)}
    for sector, angle in {'deep': 120, 'nebula': -60, 'nereid': 140, 'halogate': 70}.items():
        manifest[sector]['skyHeading'] = angle
    reused = {'nereid': ('nereid', 'gas'),
     'selene': ('selene', 'ice'),
     'eos': ('eos', 'rock'),
     'deep': ('deep', None),
     'gaia': ('gaia', 'earth'),
     'solaris': ('solaris', 'star'),
     'singularity': ('singularity', None),
     'belt': ('belt', 'rock'),
     'nebula': ('nebula', None),
     'helion': ('solaris', 'star'),
     'kallisto': ('solaris', 'star'),
     'velaris': ('solaris', 'star'),
     'sereph': ('solaris', 'star'),
     'cinder': ('solaris', 'star'),
     'thalassa': ('gaia', 'earth'),
     'verdant': ('gaia', 'earth'),
     'vespera': ('eos', 'rock'),
     'cryon': ('selene', 'ice'),
     'mistral': ('nereid', 'gas'),
     'aurum': ('nereid', 'gas'),
     'obsidian': ('eos', 'rock'),
     'eirene': ('selene', 'ice'),
     'emberrift': ('belt', 'rock'),
     'glacier': ('belt', 'ice'),
     'wanderer': ('eos', 'rock'),
     'undertow': ('singularity', None),
     'hush': ('selene', 'ice'),
     'halogate': ('deep', None),
     'silentarray': ('deep', None),
     'ambervault': ('deep', None),
     'palimpsest': ('deep', None),
     'mirrorward': ('deep', None)}
    for sector, (panorama, surface) in reused.items():
        manifest[sector]['legacy'] = {'panorama': f'assets/v2/{panorama}-{{face}}.webp',
                                      'surface': f'assets/v2/{surface}-4k.webp' if surface else None}
    tasks = [(i,tier,n) for i,name in enumerate(IDS) for tier,n in
             [('low',512),('medium',1024)]+([('high',2048),('ultra',4096),('master',8192)] if name in FEATURES else [])
             +([('surface',4096)] if name in {'nereid','gaia'} else [])]
    tasks.sort(key=lambda entry:entry[2])
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for name,tier,data in pool.map(render,tasks):
            group = manifest[name] if tier in ('master','surface') else manifest[name]['faces']
            group[tier] = data
            print(name,tier,data['bytes'],flush=True)
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')

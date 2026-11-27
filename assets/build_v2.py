from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np
from pathlib import Path
P=Path(__file__).parent; out=P/'v2';out.mkdir(exist_ok=True)
rng=np.random.default_rng(7218)
def noise(w,h,levels):
 a=np.zeros((h,w),np.float32)
 for gw,gh,amp in levels:
  v=rng.random((gh,gw),dtype=np.float32);v[:,-1]=v[:,0];a+=np.asarray(Image.fromarray(v).resize((w,h),Image.Resampling.BICUBIC))*amp
 return a/sum(l[2] for l in levels)
W,H=8192,4096;x=np.arange(W,dtype=np.float32)[None,:]/W;y=np.arange(H,dtype=np.float32)[:,None]/H
n=noise(W,H,[(12,7,1),(36,19,.8),(90,48,.55),(210,110,.34),(520,260,.18),(1200,600,.09),(2300,1100,.04)])
m=noise(W,H,[(9,5,1),(28,15,.65),(100,50,.4),(340,170,.22),(960,480,.1)])
d=np.abs(y-(.48+.13*np.sin(2*np.pi*x)+.045*np.sin(6*np.pi*x+1))+(n-.5)*.24);k=np.exp(-(d/.105)**1.45)*np.clip((n-.30)*2.5,0,1)**1.6;j=np.exp(-(d/.033)**1.5)*np.clip((m-.36)*2.5,0,1)**1.4;hue=.5+.5*np.sin(x*6*np.pi+1.3);mask=1-.68*np.clip((m-.48)*4,0,1)*np.exp(-(d/.033)**1.5)
base=np.empty((H,W,3),np.uint8)
for c,v in enumerate([4+8*n+(83+71*hue)*k+115*j,6+10*n+(96-46*hue)*k+84*j,13+18*n+137*k+135*j]):base[:,:,c]=np.uint8(np.clip(v*mask,0,255))
del n,m,d,k,j,mask
im=Image.fromarray(base);del base;stars=Image.new('RGB',(W,H));dr=ImageDraw.Draw(stars)
for i in range(51000):
 sx=int(rng.integers(W));sy=int(rng.integers(H));v=int(34+220*rng.random()**4);c=(int(v*.83),int(v*.91),v) if i%4 else (v,int(v*.88),int(v*.73));dr.point((sx,sy),fill=c)
 if i%111==0:dr.ellipse((sx-1,sy-1,sx+1,sy+1),fill=c)
 if i%1270==0:dr.line((sx-4,sy,sx+4,sy),fill=tuple(int(z*.55) for z in c));dr.line((sx,sy-4,sx,sy+4),fill=tuple(int(z*.55) for z in c))
im=ImageChops.add(ImageChops.add(im,stars),stars.filter(ImageFilter.GaussianBlur(2.1)));im.save(out/'deep-field-8k.webp',quality=94,method=3);sky=np.asarray(im);del stars,im
print('8K sky complete',flush=True)
W2,H2=4096,2048;yy=np.arange(H2,dtype=np.float32)[:,None]/H2;surfaces=[]
for name in ['gas','ice','rock','earth','star']:
 n=noise(W2,H2,[(12,7,1),(40,24,.8),(95,48,.5),(220,110,.26),(560,280,.15),(1400,700,.09)]);m=noise(W2,H2,[(8,5,1),(29,14,.8),(100,50,.45),(260,130,.22),(700,350,.12)])
 if name=='gas':t=np.clip(.49+.20*np.sin(yy*116+(n-.5)*6)+.13*np.sin(yy*267+(m-.5)*4)+.15*np.sin(yy*36+n*4)+(n-.5)*.6,0,1);a=[71,55,63];b=[255,211,153]
 elif name=='ice':t=np.clip(n*.9+m*.42-.12+.16*np.sin(yy*18+n*7),0,1);a=[23,60,101];b=[220,248,255]
 elif name=='rock':t=np.clip(n*.98+m*.65-.28,0,1);a=[48,20,19];b=[238,151,89]
 elif name=='star':t=np.clip((n-.30)*2.5,0,1);a=[145,23,3];b=[255,244,120]
 else:
  land=np.clip((n-.51)*25,0,1);cloud=np.clip((m-.53)*4,0,.85);ocean=np.stack([12+n*18,45+n*45,98+n*90],-1);landcol=np.stack([40+n*115,69+n*116,25+n*66],-1);rgb=ocean*(1-land[:,:,None])+landcol*land[:,:,None];rgb=rgb*(1-cloud[:,:,None])+np.array([236,243,250])*cloud[:,:,None];polar=np.clip((np.abs(yy-.5)-.38)*9,0,1);rgb=rgb*(1-polar[:,:,None])+np.array([223,240,249])*polar[:,:,None]
 if name!='earth':rgb=np.array(a)+t[:,:,None]*(np.array(b)-np.array(a))
 tex=np.uint8(np.clip(rgb,0,255));Image.fromarray(tex).save(out/f'{name}-4k.webp',quality=93,method=3);surfaces.append(tex);del n,m,rgb
print('4K surface textures complete',flush=True)
def rays(N,face):
 t=(np.arange(N,dtype=np.float32)+.5)*2/N-1;X,Y=np.meshgrid(t,-t);O=np.ones_like(X);d=[(X,Y,O),(O,Y,-X),(-X,Y,-O),(-O,Y,X),(X,O,-Y),(X,-O,Y)][face];d=np.stack(d,-1);return d/np.linalg.norm(d,axis=2,keepdims=True)
def dot(a,b):return np.sum(a*b,axis=-1)
def sample(tex,d):
 h,w=tex.shape[:2];u=np.mod(np.arctan2(d[...,0],d[...,2])/(2*np.pi)+.5,1);v=np.clip(.5-np.arcsin(np.clip(d[...,1],-1,1))/np.pi,0,.999999);return tex[(v*h).astype(np.int32),(u*w).astype(np.int32)].astype(np.float32)
def rot(d,a):
 c,s=np.cos(a),np.sin(a);return np.stack([d[...,0]*c+d[...,2]*s,d[...,1],d[...,2]*c-d[...,0]*s],-1)
scenes=[('nereid',0,0,[.32,.17,1.8],.55,True),('selene',1,1.1,[-.28,.16,1.9],.51,False),('eos',2,2.5,[.32,.08,1.8],.48,False),('deep',None,3.6,[0,0,1],0,False),('gaia',3,4.2,[-.22,.10,1.7],.58,False),('solaris',4,5.0,[.42,.13,1.7],.52,False),('singularity',None,.6,[.14,.13,1.7],.36,False),('belt',None,2.9,[0,0,1],0,False),('nebula',None,1.8,[0,0,1],0,False)]
faces=['front','right','back','left','up','down'];N=1536
for name,idx,angle,center,radius,ring in scenes:
 for f,face in enumerate(faces):
  d=rays(N,f);col=sample(sky,rot(d,angle));c=np.array(center,dtype=np.float32);b=dot(d,c);perp=np.maximum(0,dot(c,c)-b*b);light=np.array([-.67,.52,-.53]);light/=np.linalg.norm(light)
  if name=='nebula':
   glow=np.exp(-((d[...,1]-.08-.22*np.sin(d[...,0]*4))/.30)**2)*(.6+.4*np.sin(d[...,2]*8+d[...,0]*7)**2);col=col*np.array([1.05,.76,1.35])+glow[...,None]*np.array([34,12,63])
  if name=='singularity':
   rr=np.sqrt(perp);front=b>0;glow=np.exp(-((rr-radius*1.15)/(radius*.13))**2)*front;col+=glow[...,None]*np.array([220,120,42]);normal=np.array([.12,.87,.48]);den=dot(d,normal);t=dot(c,normal)/np.where(abs(den)<.0001,.0001,den);p=d*t[...,None]-c;r=np.linalg.norm(p,axis=-1);disk=(t>0)&(r>radius*1.2)&(r<radius*2.75);val=np.exp(-(r-radius*1.2)*3.4)*(.68+.32*np.sin(r*135+p[...,0]*19)**2);col[disk]+=val[disk,None]*np.array([250,135,44]);col[front&(rr<radius)]*=.015
  if idx is not None:
   h=radius*radius-perp;hit=(h>0)&(b>0);t=b-np.sqrt(np.maximum(h,0));n=(d*t[...,None]-c)/radius
   if ring:
    normal=np.array([.12,.83,.54]);den=dot(d,normal);rt=dot(c,normal)/np.where(abs(den)<.0001,.0001,den);rp=d*rt[...,None]-c;r=np.linalg.norm(rp,axis=-1)/radius;valid=(rt>0)&(r>1.22)&(r<2.05);val=np.clip(.52+.18*np.sin(r*125)+.12*np.sin(r*300)+.11*np.sin(r*49),.1,.9)*(1-.93*np.exp(-((r-1.66)/.025)**2));ringcol=np.array([203,169,128])*val[...,None]+np.array([23,22,32]);mask=valid&(~hit|(rt>t));col[mask]=col[mask]*(1-val[mask,None]*.85)+ringcol[mask]*.85
   at=(b>0)&(perp<(radius*1.07)**2)&~hit;limb=np.clip(1-(np.sqrt(perp)-radius)/(radius*.07),0,1);col[at]+=limb[at,None]**2*np.array([56,103,160])*(2 if idx==3 else 1)
   if idx==4:
    glow=np.exp(-np.maximum(0,np.sqrt(perp)-radius)/(radius*.17))*(b>0);col+=glow[...,None]*np.array([200,76,10]);col[hit]=sample(surfaces[idx],n[hit])*1.18
   else:
    lam=np.maximum(0,dot(n,light));rim=(1-np.clip(dot(n,-d),0,1))**3;col[hit]=sample(surfaces[idx],rot(n[hit],.55))*(.055+1.15*lam[hit,None])+rim[hit,None]*np.array([25,56,93])*(.15+lam[hit,None]*.65)
   if ring:
    mask=valid&hit&(rt<t);col[mask]=col[mask]*(1-val[mask,None]*.85)+ringcol[mask]*.85
  Image.fromarray(np.uint8(np.clip(col,0,255))).save(out/f'{name}-{face}.webp',quality=94,method=3)
 print('scene',name,flush=True)

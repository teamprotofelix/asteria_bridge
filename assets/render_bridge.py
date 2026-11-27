from PIL import Image
import numpy as np
from pathlib import Path
P=Path(__file__).parent/'v2';P.mkdir(exist_ok=True)
N=2048; names=['front','right','back','left','up','down']; rng=np.random.default_rng(19)
def rays(f):
 t=(np.arange(N,dtype=np.float32)+.5)*2/N-1;X,Y=np.meshgrid(t,-t);O=np.ones_like(X);return np.stack([(X,Y,O),(O,Y,-X),(-X,Y,-O),(-O,Y,X),(X,O,-Y),(X,-O,Y)][f],-1)
def fract(v):return v-np.floor(v)
def grid(v,step,width):return np.minimum(fract(v/step),1-fract(v/step))<width/step
for f,name in enumerate(names):
 d=rays(f);x,y,z=d.transpose(2,0,1);rad=np.sqrt(x*x+z*z);ang=np.arctan2(x,z);R=6.5;tw=R/np.maximum(rad,1e-6);tf=np.where(y<0,-1.85/np.minimum(y,-1e-6),1e5);tc=np.where(y>0,2.65/np.maximum(y,1e-6),1e5);t=np.minimum(tw,np.minimum(tf,tc));X=x*t;Y=y*t;Z=z*t;rr=np.sqrt(X*X+Z*Z);wall=tw==t;floor=tf==t;ceil=tc==t
 rgba=np.zeros((N,N,4),np.uint8);rgb=np.zeros((N,N,3),np.float32);opaque=~wall
 # Structural panels, deck and overhead lighting
 def paint(mask,color,fac=1):
  if np.isscalar(fac):rgb[mask]=np.array(color)*fac
  else:rgb[mask]=np.array(color)*fac[mask,None]
  opaque[mask]=True
 texture=.94+.05*np.sin(X*83+Z*19)+.03*np.cos(Z*57-X*27)
 light=.52+.45*np.exp(-rr*.13)+.17*np.cos(ang*4)**2
 paint(floor,[40,50,62],texture*light);paint(floor&(grid(X,1.45,.025)|grid(Z,1.65,.025)),[13,21,31]);paint(floor&(grid(X,1.45,.035)|grid(Z,1.65,.035))&~(grid(X,1.45,.025)|grid(Z,1.65,.025)),[66,77,85],light)
 paint(floor&(np.abs(X)<1.0),[29,40,53],texture*light);paint(floor&(np.abs(np.abs(X)-1.08)<.045),[52,203,219],.9);paint(floor&(np.abs(rr-4.95)<.04),[64,167,191],.9)
 paint(ceil,[35,44,57],texture*light);paint(ceil&(grid(X,2.1,.045)|grid(Z,2.3,.045)),[12,19,28]);paint(ceil&(np.abs(rr-4.35)<.25),[17,26,39]);paint(ceil&(np.abs(rr-4.38)<.065),[128,210,239]);paint(ceil&(np.abs(np.abs(X)-2.3)<.19),[13,22,32]);paint(ceil&(np.abs(np.abs(X)-2.3)<.035),[94,200,231]);paint(ceil&(rr<.86),[23,34,47]);paint(ceil&(np.abs(rr-.9)<.045),[129,220,235]);opaque[ceil&(rr<.80)]=False;
 # Panoramic window ring, rear hatch, frames with layered brushed-metal material
 sector=np.abs(fract((ang+np.pi/8)/(np.pi/4))-.5);beam=(sector<.034)&(np.abs(ang)>.25);wide=(sector<.057)&(np.abs(ang)>.25)
 rear=np.abs(np.abs(ang)-np.pi)<.37
 m=wall&((Y<-1.12)|(Y>2.15)|wide|rear);paint(m,[37,48,62],(.62+.2*np.cos(ang*5)**2+.16*np.sin(Y*42)**2));paint(wall&beam,[13,21,30],.85+.15*np.cos(Y*25)**2);paint(wall&(sector>.034)&(sector<.043)&(np.abs(ang)>.25),[93,112,129]);paint(wall&(sector>.049)&(sector<.054)&(np.abs(ang)>.25),[45,153,184]);paint(wall&((np.abs(Y+1.12)<.045)|(np.abs(Y-2.15)<.045)),[108,131,149]);paint(wall&((np.abs(Y+1.26)<.035)|(np.abs(Y-2.29)<.035)),[72,213,230]);paint(wall&(Y<-1.14)&(grid(Y,.28,.022)|grid(ang,.20,.007)),[17,27,38]);
 # rear door at back, central illuminated seam and amber safety frame
 paint(wall&rear&(Y>-1.45)&(Y<1.60)&(np.abs(np.abs(ang)-np.pi)<.22),[20,34,49],texture);paint(wall&rear&(Y>-1.48)&(Y<1.65)&(np.abs(np.abs(np.abs(ang)-np.pi)-.23)<.012),[116,151,168]);paint(wall&rear&(Y>-1.44)&(Y<1.61)&(np.abs(np.abs(ang)-np.pi)<.007),[88,209,226]);paint(wall&rear&(Y>1.1)&(Y<1.18)&(np.abs(np.abs(ang)-np.pi)<.17),[204,156,77]);
 # ring of angled workstations, front split with unobstructed main view. horizontal top, cylindrical fascia
 rnear=3.75;rfar=5.40;top=-.86;bottom=-1.65;tt=np.where(y<0,top/np.minimum(y,-1e-6),1e5);tr=rnear/np.maximum(rad,1e-6);yr=y*tr;rt=rad*tt;stations=(np.abs(ang)>.36)&(np.abs(ang)<2.55)
 topmask=(tt<t)&(rt>rnear)&(rt<rfar)&stations;side=(tr<t)&(yr<top)&(yr>bottom)&stations
 # nearest surface between top and side
 topmask&=~(side&(tr<tt));side&=~(topmask&(tt<tr));
 paint(side,[33,45,59],.72+.16*np.cos(yr*57)**2);paint(side&(np.abs(yr-top+.085)<.022),[100,201,223]);paint(side&grid(ang,.23,.009),[12,22,34]);paint(side&(np.abs(yr-bottom-.15)<.04),[60,85,101]);
 paint(topmask,[48,60,73],.8+.17*np.cos(rt*31)**2);paint(topmask&(np.abs(rt-rnear-.04)<.035),[91,133,156]);paint(topmask&(np.abs(rt-rfar+.10)<.035),[72,174,195]);
 u=fract((ang+.11)/.36);v=(rt-rnear)/(rfar-rnear);screen=topmask&(u>.10)&(u<.90)&(v>.20)&(v<.82);paint(screen,[5,20,31]);border=screen&((u<.135)|(u>.865)|(v<.235)|(v>.785));paint(border,[52,126,149]);paint(screen&(u>.18)&(u<.81)&(np.abs(v-(.47+.10*np.sin(u*23+ang*7)))<.012),[77,220,231]);paint(screen&(u>.20)&(u<.80)&grid(v,.095,.005),[26,75,91]);paint(screen&(u>.22)&(u<.76)&grid(u,.12,.005),[22,54,71]);paint(topmask&(v<.16)&(v>.07)&(fract(u*9)<.48),[106,194,207]);
 # central helm pedestal - geometric boxes with screen top
 def box(lo,hi,base,screen=False):
  nonlocal_dummy=0
  near=np.full_like(x,-1e5);far=np.full_like(x,1e5);axis=np.zeros_like(x,dtype=np.int8)
  for k,q in enumerate([x,y,z]):
   q=np.where(abs(q)<1e-7,1e-7,q);a=lo[k]/q;b=hi[k]/q;l=np.minimum(a,b);h=np.maximum(a,b);axis=np.where(l>near,k,axis);near=np.maximum(near,l);far=np.minimum(far,h)
  mask=(far>=near)&(near>0)&(near<t); # don't overwrite nearer station
  mask&=~(topmask&(tt<near))&~(side&(tr<near));t[mask]=near[mask];xx=x*near;yy=y*near;zz=z*near;fac=np.where(axis==1,1.12,np.where(axis==0,.68,.85));fac*=.93+.07*np.sin(xx*45+zz*38+yy*67)**2
  paint(mask,base,fac)
  if screen:
   m=mask&(axis==1)&(abs(xx)<(hi[0]-.09))&(zz>lo[2]+.08)&(zz<hi[2]-.08);paint(m,[8,28,39]);paint(m&(grid(xx,.19,.009)|grid(zz,.16,.006)),[28,81,99]);paint(m&(abs(zz-(lo[2]+.38+.07*np.cos(xx*15)))<.012),[70,227,230]);paint(m&(abs(xx)<.04),[92,178,195]);
 box([-.46,-1.85,2.7],[.46,-1.1,3.4],[33,47,61]);box([-.86,-1.12,2.48],[.86,-.86,3.65],[42,59,73],True)
 rgba[:,:,:3]=np.uint8(np.clip(rgb,0,255));rgba[:,:,3]=opaque.astype(np.uint8)*255
 Image.fromarray(rgba).save(P/f'bridge-{name}.webp',quality=94,method=3);print('bridge',name,flush=True)

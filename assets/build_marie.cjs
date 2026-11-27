// Node export for the same rig and meshes used in the live bridge.
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {build,joints,transforms} = require('../marie-rig.js');

const output = path.join(__dirname,'crew');
const clipSettings = [
  ['IDLE',5.27],['PATROL',1.05],['FOLLOW',1.05],['CHECK_CONSOLE',2.4],
  ['OBSERVE',2.8],['REPORT',2.5],['PREPARE_TEA',3.0],['SERVE_TEA',2.6],
  ['REST',3],['ALERT',2.4],['ASSIST_NAVIGATION',2.4],['CONTROL_DRONE',2.8],
];
const neutral = {time:0,phase:0,gait:0,blend:1,previous:'IDLE',state:'IDLE',seated:false,reduced:true};

function quaternion(m) {
  const trace=m[0]+m[5]+m[10];
  if (trace<.001) throw new Error('Export rotation exceeds supported keyframe range');
  const w=.5*Math.sqrt(trace+1);
  return [(m[6]-m[9])/(4*w),(m[8]-m[2])/(4*w),(m[1]-m[4])/(4*w),w];
}

function model(lod) {
  const {verts,props} = build(lod);
  const document = {
    asset:{version:'2.0',generator:'Asteria II procedural crew asset'},
    scene:0,scenes:[{name:'Marie Evans',nodes:[0,1]}],nodes:[],meshes:[],skins:[],
    materials:[{name:'Vertex color — fabric, hair, skin and metal',
      doubleSided:true,pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.7}}],
    buffers:[{byteLength:0}],bufferViews:[],accessors:[],animations:[],
  };
  const blocks = [];
  let bytes = 0;
  function accessor(values, type, componentType, lanes, options = {}) {
    const block = Buffer.from(values.buffer,values.byteOffset,values.byteLength);
    const padding = (4-block.length%4)%4;
    const bufferView = document.bufferViews.length;
    document.bufferViews.push({buffer:0,byteOffset:bytes,byteLength:block.length});
    blocks.push(block,Buffer.alloc(padding));
    bytes += block.length+padding;
    const id = document.accessors.length;
    document.accessors.push({bufferView,componentType,count:values.length/lanes,type,...options});
    return id;
  }
  const scalar = (values,lo,hi) => accessor(Float32Array.from(values),'SCALAR',5126,1,{min:[lo],max:[hi]});
  function primitive(data) {
    const coordinates=[], normals=[], colors=[], bones=[], weights=[], indices=[];
    const unique = new Map();
    const min=[Infinity,Infinity,Infinity], max=min.map(()=>-Infinity);
    for (let i=0;i<data.length;i+=10) {
      const vertex=data.slice(i,i+10);
      const key=vertex.map(v=>Math.round(v*1e5)).join('/');
      let id=unique.get(key);
      if (id===undefined) {
        id=coordinates.length/3;
        unique.set(key,id);
        for (let axis=0;axis<3;axis++) {
          const value=Math.fround(vertex[axis]);
          coordinates.push(value);
          min[axis]=Math.min(value,min[axis]);
          max[axis]=Math.max(value,max[axis]);
        }
        normals.push(...vertex.slice(7));
        colors.push(...vertex.slice(3,6).map(v=>Math.round(Math.pow(v,2.2)*255)),255);
        bones.push(vertex[6],0,0,0);
        weights.push(255,0,0,0);
      }
      indices.push(id);
    }
    const wide=unique.size>65535;
    return {attributes:{
      POSITION:accessor(Float32Array.from(coordinates),'VEC3',5126,3,{min,max}),
      NORMAL:accessor(Float32Array.from(normals),'VEC3',5126,3),
      COLOR_0:accessor(Uint8Array.from(colors),'VEC4',5121,4,{normalized:true}),
      JOINTS_0:accessor(Uint8Array.from(bones),'VEC4',5121,4),
      WEIGHTS_0:accessor(Uint8Array.from(weights),'VEC4',5121,4,{normalized:true}),
    },indices:accessor((wide ? Uint32Array : Uint16Array).from(indices),'SCALAR',wide ? 5125 : 5123,1),
    material:0};
  }

  document.meshes.push({name:'Bridge crew',primitives:[primitive(verts),primitive(props)]});
  document.nodes.push({name:'Marie mesh',mesh:0,skin:0});
  const nodeId = index => index+1;
  for (const [i,[name,parent,pivot]] of joints.entries()) {
    const location = parent<0 ? [0,0,0] : joints[parent][2];
    const children=joints.flatMap(([,p],j)=>p===i ? [nodeId(j)] : []);
    document.nodes.push({name,translation:pivot.map((v,axis)=>v-location[axis]),
      ...(children.length ? {children} : {}), ...(name==='tray' ? {scale:[.0001,.0001,.0001]} : {})});
  }
  const inverse=Float32Array.from(joints.flatMap(([, ,p])=>[1,0,0,0,0,1,0,0,0,0,1,0,-p[0],-p[1],-p[2],1]));
  document.skins.push({name:'Marie 16-joint rig',skeleton:1,joints:joints.map((_,i)=>nodeId(i)),
    inverseBindMatrices:accessor(inverse,'MAT4',5126,16)});

  for (const [state,seconds] of clipSettings) {
    const samples=Math.ceil(seconds*12);
    const times=Array.from({length:samples+1},(_,i)=>i*seconds/samples);
    const poses=times.map(time=>transforms({...neutral,time,state,
      blend:Math.min(1,time*4),phase:time/seconds*Math.PI*2,
      gait:['PATROL','FOLLOW'].includes(state) ? 1 : 0,seated:state==='REST',reduced:false},true));
    const input=scalar(times,0,Math.fround(seconds));
    const animation={name:state,channels:[],samplers:[]};
    for (const [i] of joints.entries()) {
      for (const [key,type,lanes] of [['rotation','VEC4',4],['translation','VEC3',3],['scale','VEC3',3]]) {
        const values=poses.flatMap(pose=>
          key==='rotation' ? quaternion(pose[i][key])
            : i===15 && key==='scale' && state!=='SERVE_TEA' ? [.0001,.0001,.0001] : pose[i][key]);
        if (i!==15 || key!=='scale') {
          const defaultValue=key==='rotation' ? [0,0,0,1] : key==='scale' ? [1,1,1] : document.nodes[nodeId(i)].translation;
          if (values.every((value,j)=>Math.abs(value-defaultValue[j%lanes])<.00001)) continue;
        }
        const sampler=animation.samplers.length;
        animation.samplers.push({input,output:accessor(Float32Array.from(values),type,5126,lanes),interpolation:'LINEAR'});
        animation.channels.push({sampler,target:{node:nodeId(i),path:key}});
      }
    }
    document.animations.push(animation);
  }
  document.buffers[0].byteLength=bytes;
  const json=Buffer.from(JSON.stringify(document));
  const jsonPadded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header=Buffer.alloc(12);
  header.write('glTF'); header.writeUInt32LE(2,4);
  header.writeUInt32LE(12+8+jsonPadded.length+8+bytes,8);
  const section = (length,tag) => {
    const h=Buffer.alloc(8);h.writeUInt32LE(length);h.write(tag,4);return h;
  };
  return {data:Buffer.concat([header,section(jsonPadded.length,'JSON'),jsonPadded,section(bytes,'BIN\0'),...blocks]),
    triangles:(verts.length+props.length)/30};
}

fs.mkdirSync(output,{recursive:true});
const assets = [false,true].map(lod=>{
  const {data,triangles}=model(lod), filename=lod ? 'marie-compact.glb' : 'marie.glb';
  fs.writeFileSync(path.join(output,filename),data);
  return {path:'assets/crew/'+filename,bytes:data.length,triangles,
    sha256:createHash('sha256').update(data).digest('hex')};
});
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({source:'marie-rig.js',
  license:'Original project artwork. See ASSET_LICENSES.md.',joints:joints.length,
  clips:clipSettings.map(([state])=>state),assets},null,2)+'\n');

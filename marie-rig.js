'use strict';

const AsteriaMarieRig = (() => {
  // Rigid-weight skin, with local pivots shared by WebGL and the glTF export.
  const joints = [
    ['hips',-1,[0,0,0]], ['chest',0,[0,.99,0]], ['head',1,[0,1.41,0]],
    ['hair',2,[0,1.56,.087]], ['eyes',2,[0,1.515,-.092]],
    ['leftUpperArm',1,[-.183,1.281,0]], ['leftLowerArm',5,[-.222,1.045,-.005]],
    ['rightUpperArm',1,[.183,1.281,0]], ['rightLowerArm',7,[.222,1.045,-.005]],
    ['leftThigh',0,[-.105,.791,0]], ['leftShin',9,[-.105,.419,0]], ['leftFoot',10,[-.105,.095,0]],
    ['rightThigh',0,[.105,.791,0]], ['rightShin',12,[.105,.419,0]], ['rightFoot',13,[.105,.095,0]],
    ['tray',8,[.222,.843,-.028]],
  ];
  const colors = {
    dress: [.059,.077,.115], fold: [.097,.120,.165], hem: [.24,.31,.38],
    apron: [.91,.92,.91], lace: [.79,.85,.86], collar: [.94,.94,.91],
    skin: [.83,.62,.52], ear: [.76,.50,.44], blush: [.83,.54,.48],
    hair: [.105,.061,.060], hairLight: [.193,.112,.099],
    lip: [.56,.287,.264], mouth: [.29,.143,.139],
    eye: [.91,.895,.85], iris: [.31,.22,.22], pupil: [.064,.046,.053],
    boot: [.066,.079,.105], sole: [.025,.038,.056], metal: [.44,.67,.68],
    tea: [.43,.23,.13],
  };
  const pi = Math.PI;
  const tau = pi*2;

  function build(lod = false) {
    const verts = [], props = [];
    let bone = 0, items = verts;
    function triangle(a,b,c,material,shade = 1) {
      const color = colors[material];
      const u = b.map((v,i)=>v-a[i]), v = c.map((val,i)=>val-a[i]);
      const n = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      const length = Math.hypot(...n);
      if (length < 1e-8) return;
      for (const point of [a,b,c]) items.push(...point,...color.map(channel=>channel*shade),bone,...n.map(k=>k/length));
    }
    function quad(a,b,c,d,material,shade = 1) {
      triangle(a,b,c,material,shade);
      triangle(a,c,d,material,shade);
    }
    function rings(levels, material, sides, fold = 0) {
      const ring = levels.map(([y,rx,rz,x=0,z=0]) => Array.from({length:sides},(_,i) => {
        const a = i*tau/sides, pleat = 1+fold*Math.cos(a*10);
        return [x+rx*Math.cos(a)*pleat,y,z+rz*Math.sin(a)*pleat];
      }));
      for (let r=1;r<ring.length;r++) {
        for (let i=0;i<sides;i++) {
          const j=(i+1)%sides;
          quad(ring[r-1][j],ring[r-1][i],ring[r][i],ring[r][j],material,
            fold ? .94+.06*Math.cos((i+.45)*tau/sides*10) : 1);
        }
      }
    }
    function oval([x,y,z],[rx,ry,rz],material, sides = lod ? 10 : 18, rows = lod ? 6 : 11) {
      const levels = Array.from({length:rows+1},(_,i)=>{
        const a = -pi/2 + i*pi/rows;
        return [y+Math.sin(a)*ry,Math.cos(a)*rx,Math.cos(a)*rz,x,z];
      });
      rings(levels,material,sides);
    }
    function ribbon(rows, material, columns = lod ? 10 : 20) {
      for (let i=0;i<columns;i++) {
        const point = (fn,j)=>fn(j/columns);
        for (let r=1;r<rows.length;r++) {
          quad(point(rows[r-1],i),point(rows[r-1],i+1),point(rows[r],i+1),point(rows[r],i),material);
        }
      }
    }
    const skirt = lod ? 20 : 40;
    const skirtProfile=[[.62,.292,.198],[.645,.319,.219],[.72,.305,.205],
      [.85,.24,.177],[.965,.148,.122],[1.02,.131,.106]];
    const chestProfile=[[.995,.132,.11],[1.111,.163,.121],[1.208,.181,.113],
      [1.265,.187,.094],[1.312,.093,.064]];
    rings(skirtProfile,'dress',skirt,.045);
    rings([[.614,.293,.199],[.643,.320,.220],[.661,.318,.219]],'fold',skirt,.044);
    rings([[.641,.320,.220],[.649,.321,.221]],'hem',skirt,.044);
    function apron(y0,y1,lowerWidth,upperWidth,profile,material,hemCurve=0) {
      const rows=lod ? 9 : 18;
      const functions=Array.from({length:rows+1},(_,i)=>q=>{
        const t=i/rows, across=q*2-1;
        const y=y0+(y1-y0)*t+hemCurve*across*across*(1-t);
        const x=across*(lowerWidth+(upperWidth-lowerWidth)*t);
        const index=profile.findIndex(level=>level[0]>=y);
        const a=profile[Math.max(0,index-1)], b=profile[index<0 ? profile.length-1 : index];
        const u=a===b ? 0 : (y-a[0])/(b[0]-a[0]);
        const rx=a[1]+(b[1]-a[1])*u, rz=a[2]+(b[2]-a[2])*u;
        const depth=rz*Math.sqrt(Math.max(.05,1-(x/rx)**2));
        return [x,y,-depth-.024-.004*Math.cos(across*pi*6)];
      });
      ribbon(functions,material);
    }
    apron(.66,.99,.238,.106,skirtProfile,'apron',.018);
    apron(.634,.663,.245,.239,skirtProfile,'lace',.018);
    rings([[.977,.144,.123],[1.014,.145,.122],[1.033,.139,.117]],'apron',skirt);
    for (const sign of [-1,1]) {
      oval([sign*.095,1.002,.129],[.109,.035,.034],'lace');
      oval([sign*.079,.926,.142],[.035,.077,.013],'apron');
    }
    oval([0,1.001,.155],[.027,.029,.024],'collar');
    bone = 1;
    rings(chestProfile,'dress',lod ? 12 : 24);
    apron(1.018,1.246,.103,.088,chestProfile,'apron');
    oval([0,1.337,0],[.054,.088,.052],'skin');
    quad([-.061,1.309,-.055],[0,1.288,-.09],[-.038,1.239,-.114],[-.093,1.276,-.086],'collar');
    quad([0,1.288,-.09],[.061,1.309,-.055],[.093,1.276,-.086],[.038,1.239,-.114],'collar');
    oval([0,1.278,-.104],[.041,.019,.017],'fold');
    oval([0,1.278,-.12],[.012,.014,.009],'metal');
    for (const side of [-1,1]) {
      const x = side*.182, arm = side < 0 ? 5 : 7;
      bone = arm;
      oval([x,1.244,0],[.066,.108,.067],'dress');
      rings([[1.112,.046,.044,side*.217],[1.145,.055,.052,side*.213],[1.166,.055,.053,side*.210]],
        'lace',lod ? 10 : 20,.05);
      oval([side*.222,1.089,0],[.042,.064,.041],'skin');
      bone = arm+1;
      rings([[.861,.025,.024,side*.223,-.023],[.937,.032,.029,side*.224,-.02],
        [1.002,.041,.037,side*.222,-.009],[1.069,.037,.037,side*.222]],'skin',lod ? 10 : 16);
      rings([[.857,.026,.025,side*.223,-.024],[.882,.029,.027,side*.223,-.022]],'apron',16);
      oval([side*.225,.829,-.025],[.027,.044,.022],'skin');
      oval([side*.205,.834,-.043],[.012,.023,.011],'skin');
      const leg = side < 0 ? 9 : 12;
      bone = leg;
      rings([[.397,.048,.048,side*.105],[.47,.059,.052,side*.105],[.71,.068,.06,side*.105],
        [.821,.071,.066,side*.105]],'dress',lod ? 10 : 18);
      bone = leg+1;
      rings([[.083,.037,.034,side*.105],[.204,.042,.040,side*.105],
        [.315,.055,.047,side*.105],[.445,.049,.049,side*.105]],'fold',lod ? 10 : 18);
      bone = leg+2;
      oval([side*.105,.057,-.040],[.056,.055,.109],'boot');
      rings([[.011,.053,.100,side*.105,-.04],[.024,.056,.104,side*.105,-.04],[.032,.055,.101,side*.105,-.04]],
        'sole',18);
      oval([side*.105,.094,-.027],[.044,.010,.058],'hem');
    }
    bone = 2;
    // Face profile, temples, swept fringe and separate hand-modelled details.
    rings([[1.379,.031,.041,0,-.022],[1.400,.060,.062,0,-.012],[1.448,.087,.079,0,-.003],
      [1.487,.097,.086,0,-.003],[1.527,.098,.091,0,.001],[1.576,.098,.087,0,.008],
      [1.624,.079,.067,0,.012],[1.657,.030,.038,0,.017],[1.666,0,0,0,.017]],
      'skin',lod ? 16 : 32);
    oval([0,1.484,-.087],[.018,.030,.018],'skin');
    oval([0,1.467,-.100],[.019,.010,.014],'blush');
    oval([0,1.433,-.073],[.025,.008,.009],'lip');
    oval([0,1.433,-.080],[.019,.0027,.004],'mouth');
    oval([0,1.603,.032],[.101,.083,.092],'hair',lod ? 14 : 30,14);
    oval([0,1.525,.067],[.097,.106,.056],'hair');
    for (const side of [-1,1]) {
      oval([side*.091,1.490,.003],[.019,.035,.019],'ear');
      oval([side*.102,1.469,-.001],[.008,.011,.009],'metal');
      oval([side*.086,1.524,.033],[.030,.091,.048],'hair');
      oval([side*.088,1.472,-.02],[.018,.084,.024],'hairLight');
      const x = side*.044;
      oval([x,1.544,-.083],[.027,.0045,.007],'hair');
      oval([x,1.512,-.084],[.025,.009,.009],'mouth');
      bone = 4;
      oval([x,1.514,-.089],[.021,.0073,.008],'eye');
      oval([x+side*.001,1.514,-.097],[.0088,.0082,.0041],'iris');
      oval([x,1.514,-.100],[.0044,.006,.0025],'pupil');
      oval([x-.002,1.518,-.102],[.0021,.0021,.0019],'collar');
      bone = 2;
    }
    for (let i=0;i<7;i++) {
      const x = -.082+.026*i;
      oval([x,1.589+.004*i,-.050],[.027,.049+(6-i)*.003,.026],i%3 ? 'hair' : 'hairLight');
    }
    const bandRow = (y,rx,rz) => q => [rx*Math.cos(q*pi),y+Math.sin(q*pi)*.028,.01-rz*Math.sin(q*pi)];
    ribbon([bandRow(1.638,.093,.090),bandRow(1.655,.092,.083),bandRow(1.675,.083,.068)],'collar');
    for (let i=0;i<=10;i++) {
      const a = i*pi/10;
      oval([.091*Math.cos(a),1.674+Math.sin(a)*.027,.01-.071*Math.sin(a)],
        [.012,.013,.011],'lace',10,6);
    }
    bone = 3;
    oval([0,1.548,.119],[.064,.086,.062],'hair');
    rings([[1.101,.010,.026,-.032,.164],[1.192,.035,.036,-.019,.18],
      [1.334,.052,.043,0,.179],[1.475,.056,.051,0,.137],[1.568,.039,.043,0,.112]],'hair',lod ? 10 : 24);
    oval([0,1.492,.154],[.052,.018,.055],'hem');
    oval([-.042,1.473,.164],[.035,.027,.019],'fold');
    oval([.042,1.473,.164],[.035,.027,.019],'fold');

    items = props;
    bone = 15;
    rings([[.826,.170,.121,.185,-.093],[.837,.184,.131,.185,-.093],
      [.854,.188,.134,.185,-.093],[.855,.165,.121,.185,-.093],
      [.84,0,0,.185,-.093]],'metal',lod ? 14 : 24);
    rings([[.846,.035,.035,.143,-.107],[.864,.041,.041,.143,-.107],[.919,.045,.045,.143,-.107],
      [.922,.038,.038,.143,-.107],[.907,.030,.030,.143,-.107],[.907,0,0,.143,-.107]],'collar',22);
    oval([.143,.908,-.107],[.030,.002,.030],'tea',18,4);
    oval([.187,.884,-.106],[.016,.018,.008],'apron',12,6);
    return {verts, props};
  }

  function matrix([x,y,z], shift = [0,0,0], yScale = 1) {
    const cx=Math.cos(x), sx=Math.sin(x), cy=Math.cos(y), sy=Math.sin(y), cz=Math.cos(z), sz=Math.sin(z);
    return [
      cy*cz, cx*sz+sx*sy*cz, sx*sz-cx*sy*cz, 0,
      -cy*sz*yScale, (cx*cz-sx*sy*sz)*yScale, (sx*cz+cx*sy*sz)*yScale, 0,
      sy, -sx*cy, cx*cy, 0,
      ...shift,1,
    ];
  }
  function multiply(a,b) {
    return b.map((_,i)=>{
      const column=i&~3, r=i%4;
      return a[r]*b[column]+a[4+r]*b[column+1]+a[8+r]*b[column+2]+a[12+r]*b[column+3];
    });
  }

  const gestures = {
    CHECK_CONSOLE: {2:[.13,.17,0],7:[.55,0,.08],8:[.54,0,0]},
    OBSERVE: {2:[-.11,.22,0]},
    REPORT: {2:[-.05,0,-.07],7:[.26,0,.02],8:[.44,0,0]},
    ALERT: {1:[-.10,0,0],2:[-.08,-.23,0],5:[.22,0,-.12],7:[.24,0,.12]},
    ASSIST_NAVIGATION: {2:[.18,-.12,0],5:[.30,0,-.13],6:[.69,0,0]},
    PREPARE_TEA: {2:[.22,.12,0],5:[.38,0,-.18],6:[.76,0,0],7:[.42,0,.03],8:[.94,0,0]},
    SERVE_TEA: {2:[.06,0,0],5:[.26,0,-.14],6:[.85,0,0],7:[.32,0,-.06],8:[1.05,0,0],15:[-1.37,0,.06]},
    CONTROL_DRONE: {2:[.13,.24,0],5:[.44,0,-.15],6:[.69,0,0],7:[.55,0,.06],8:[.65,0,0]},
    REST: {1:[.11,0,0],2:[.13,0,.08],9:[1.33,0,0],10:[-1.26,0,0],12:[1.33,0,0],13:[-1.26,0,0]},
  };

  function transforms(pose, exportPose = false) {
    const {time, phase, gait, blend, previous, state, seated, reduced} = pose;
    const swing = Math.sin(phase), weight = gait;
    const breath = reduced ? 0 : .014*Math.sin(time*2.3);
    const blinkAt = time % 5.27;
    const eyelid = reduced ? 1 : Math.min(1,.13+Math.abs(blinkAt-3.9)*16);
    const anim = joints.map((_,i)=>{
      const a = gestures[previous]?.[i] ?? [0,0,0];
      const b = gestures[state]?.[i] ?? [0,0,0];
      return a.map((v,j)=>v+(b[j]-v)*blend);
    });
    if (!seated) for (const [sign,arm,leg] of [[-1,5,9],[1,7,12]]) {
      const stride = swing*sign;
      anim[leg][0] += .51*stride*weight;
      anim[leg+1][0] -= .52*Math.max(0,-stride)*weight;
      anim[leg+2][0] -= (anim[leg][0]+anim[leg+1][0])*.7;
      anim[arm][0] -= (state === 'SERVE_TEA' ? .06 : .30)*stride*weight;
      anim[arm+1][0] += .12*weight;
    }
    anim[1][1] += .069*swing*weight;
    anim[1][2] += breath + .052*swing*weight;
    anim[2][0] += breath;
    anim[3][0] += .13*weight;
    anim[3][2] += .13*swing*weight;
    const world = [], localParts = [];
    const skin = new Float32Array(joints.length*16);
    joints.forEach(([,parent,pivot],i)=>{
      const p = parent < 0 ? [0,0,0] : joints[parent][2];
      const translation = pivot.map((v,axis)=>v-p[axis]);
      if (i === 0) translation[1] += (seated ? -.275 : 0) + .027*weight*Math.abs(swing);
      const scale = [1,i===4 ? eyelid : 1,1];
      const turn = matrix(anim[i]);
      localParts.push({translation,rotation:turn,scale});
      const local = matrix(anim[i],translation,scale[1]);
      world[i] = parent < 0 ? local : multiply(world[parent],local);
      skin.set(multiply(world[i],matrix([0,0,0],pivot.map(v=>-v))),i*16);
    });
    return exportPose ? localParts : skin;
  }
  return {build,joints,transforms};
})();

if (typeof module === 'object' && module.exports) module.exports = AsteriaMarieRig;

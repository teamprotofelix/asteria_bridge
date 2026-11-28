'use strict';

const AsteriaNavigationMap = (() => {
  const coordinates = {
    nereid: [-.20, -.03, .16], selene: [.12, -.03, -.15], eos: [-.02, .25, .22],
    deep: [-.31, -.32, -.45], gaia: [.22, .29, .06], solaris: [-.47, .22, -.16],
    singularity: [.20, -.34, .29], belt: [-.02, -.27, .37], nebula: [-.47, -.05, -.18],
    helion: [-.83, .43, .36], kallisto: [-.58, .55, -.33], velaris: [-.28, .65, -.13],
    sereph: [-.05, .58, .26], cinder: [-.74, .14, -.26],
    thalassa: [.32, .57, -.18], verdant: [.57, .65, .34], vespera: [.83, .48, -.21],
    cryon: [.53, .33, .04], mistral: [.75, .17, .15], aurum: [.46, .03, .37],
    obsidian: [.77, -.12, -.32], eirene: [.95, .11, .26],
    emberrift: [-.83, -.18, .32], glacier: [-.63, -.37, -.23], wanderer: [-.72, -.68, .17],
    undertow: [-.33, -.65, .35], hush: [-.08, -.64, -.32],
    halogate: [.49, -.34, -.17], silentarray: [.86, -.37, .29], ambervault: [.59, -.66, .21],
    palimpsest: [.28, -.60, -.29], mirrorward: [.90, -.65, -.08],
  };

  function create(destinations, groups, {select, travel, voyage}) {
    const el = id => document.getElementById(id);
    const dialog = el('mapDialog');
    const canvas = el('mapCanvas');
    const plot = el('mapPlot');
    const context = canvas.getContext('2d');
    const nodeLayer = el('mapNodes');
    const filter = el('mapFilter');
    const currentLabel = el('mapCurrent');
    const selectedLabel = el('mapSelected');
    const visitLabel = el('mapVisitState');
    const summary = el('mapSummary');
    const status = el('mapStatus');
    const localFlight = el('mapLocalFlight');
    const startButton = el('mapTravel');
    const visited=()=>new Set(voyage.data.visitedSectorIds);
    const nodes = destinations.map(([id, name, , code, group = 'legacy'], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-node';
      button.dataset.sector = id;
      button.dataset.group = group;
      button.title = name;
      button.setAttribute('aria-label', name + ' · ' + code);
      button.addEventListener('click', () => select(index));
      nodeLayer.append(button);
      return {id, group, button, name, code};
    });

    for (const [value, label] of Object.entries(groups)) filter.append(new Option(label, value));
    let current = 0, selected = 0, origin = null, transit = null;
    let busy = true, failure = '', px = 0, py = 0, zoom = 1, yaw = -.14, pitch = .16;
    let drag = null, pendingDraw = false;

    function renderDetails() {
      if (!dialog.open) return;
      const destination = destinations[selected];
      const visits = visited();
      currentLabel.textContent = transit ? destinations[transit.from][1] : destinations[current][1];
      selectedLabel.textContent = destination[1];
      el('mapDescription').textContent = destination[2] + ' · ' + destination[3];
      visitLabel.textContent = current === selected && !transit ? '현재 구역'
        : visits.has(destination[0]) ? '방문 완료' : '미탐사';
      summary.textContent = `${visits.size} / ${destinations.length} 방문`;
      startButton.disabled = busy || selected === current;
      status.textContent = failure || (transit ? '워프 이동 중 · ' + destinations[transit.to][1]
        : busy ? '항로 계산 중' : selected === current ? '현재 구역입니다.' : '예정 항로를 확인하고 워프를 시작하세요.');
      el('mapFlightProgress').hidden = !transit;
      el('mapFlightProgress').value = transit ? transit.progress : 0;
      nodes.forEach(({id, button, group, name, code}, index) => {
        button.hidden = filter.value !== 'all' && filter.value !== group && index !== current && index !== selected
          && index !== transit?.from && index !== transit?.to;
        button.classList.toggle('visited', visits.has(id));
        button.setAttribute('aria-pressed', String(index === selected));
        button.setAttribute('aria-current', index === current && !transit ? 'location' : 'false');
        const location = index === current && !transit ? '현재 구역' : visits.has(id) ? '방문 완료' : '미탐사';
        button.setAttribute('aria-label', `${name} · ${code} · ${location}`);
      });
      scheduleDraw();
    }

    function project([x, y, z]) {
      const c = Math.cos(yaw), s = Math.sin(yaw), a = Math.cos(pitch), b = Math.sin(pitch);
      const depth = c*z - s*x;
      const scale = Math.min(px / 2.27, py / 1.84) * zoom;
      return [px/2 + scale*(c*x + s*z), py/2 - scale*(a*y - b*depth), b*y + a*depth];
    }

    function line(from, to) {
      context.beginPath();
      context.moveTo(from[0], from[1]);
      context.lineTo(to[0], to[1]);
      context.stroke();
    }

    function drawShip(point, direction) {
      if (!direction) {
        context.strokeStyle = '#baffff';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(point[0], point[1], 14, 0, Math.PI * 2);
        context.stroke();
        return;
      }
      const angle = Math.atan2(direction[1], direction[0]);
      const offset = Math.hypot(...direction) < 1 ? 0 : 17;
      context.save();
      context.translate(point[0], point[1]);
      context.rotate(angle);
      context.translate(offset, 0);
      context.beginPath();
      context.moveTo(8, 0);
      context.lineTo(-5, -5);
      context.lineTo(-2, 0);
      context.lineTo(-5, 5);
      context.closePath();
      context.fillStyle = '#e9fffe';
      context.shadowColor = '#6df5f2';
      context.shadowBlur = 10;
      context.fill();
      context.restore();
    }

    function drawLabel(point, name, above) {
      context.font = '600 11px ui-monospace, monospace';
      const width = context.measureText(name).width + 10;
      const x = Math.max(3, Math.min(px - width - 3, point[0] - width/2));
      const y = Math.max(3, Math.min(py - 21, point[1] + (above ? -37 : 17)));
      context.fillStyle = '#091722';
      context.fillRect(x, y, width, 18);
      context.fillStyle = '#c7fffa';
      context.textBaseline = 'middle';
      context.fillText(name, x + 5, y + 9);
    }

    function draw() {
      pendingDraw = false;
      if (!dialog.open) return;
      const {width, height} = plot.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      px = width;
      py = height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const dw = Math.round(width*dpr), dh = Math.round(height*dpr);
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw;
        canvas.height = dh;
      }
      context.setTransform(dw/width, 0, 0, dh/height, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;
      context.strokeStyle = 'rgba(94,216,226,.15)';
      for (let i = -4; i <= 4; i++) {
        const offset = i*.25;
        line(project([offset,-.78,-.44]), project([offset,.78,-.44]));
        line(project([-1.12,offset*.78,-.44]), project([1.12,offset*.78,-.44]));
      }

      const positions = nodes.map(({id, button}, index) => {
        const point = project(coordinates[id]);
        button.style.left = point[0] + 'px';
        button.style.top = point[1] + 'px';
        button.style.zIndex = index === selected || index === current ? 24 : Math.round(11 + point[2]*7);
        return point;
      });
      const from = positions[transit?.from ?? current];
      const to = positions[transit?.to ?? selected];
      const activeRoute = transit || selected !== current;
      context.lineWidth = 2;
      if (activeRoute) {
        context.setLineDash([5, 5]);
        context.strokeStyle = '#53cdd0';
        line(from, to);
        context.setLineDash([]);
      }

      if (transit) {
        const p = transit.progress;
        const ship = [from[0] + (to[0] - from[0])*p, from[1] + (to[1] - from[1])*p];
        context.strokeStyle = '#e0ffff';
        line(from, ship);
        drawShip(ship, [to[0] - from[0], to[1] - from[1]]);
      } else {
        const previous = origin === null ? null : positions[origin];
        drawShip(from, previous && [from[0] - previous[0], from[1] - previous[1]]);
        drawLabel(from, nodes[current].name, false);
      }
      if (transit || selected !== current) drawLabel(to, nodes[transit?.to ?? selected].name, true);
    }

    function scheduleDraw() {
      if (dialog.open && !pendingDraw) {
        pendingDraw = true;
        requestAnimationFrame(draw);
      }
    }

    function adjust(horizontal, vertical, magnify = 0) {
      yaw += horizontal;
      pitch = Math.max(-.8, Math.min(.8, pitch + vertical));
      zoom = Math.max(1, Math.min(1.65, zoom + magnify));
      scheduleDraw();
    }

    plot.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button') || drag) return;
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
      plot.setPointerCapture(event.pointerId);
    });
    plot.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      adjust((event.clientX - drag.x)*.009, (event.clientY - drag.y)*.008);
      drag.x = event.clientX;
      drag.y = event.clientY;
    });
    plot.addEventListener('lostpointercapture', () => { drag = null; });
    plot.addEventListener('keydown', event => {
      if (event.target !== plot) return;
      const angle = .17;
      const keys = {ArrowLeft: [-angle, 0], ArrowRight: [angle, 0], ArrowUp: [0, -angle], ArrowDown: [0, angle]};
      if (!keys[event.key]) return;
      event.preventDefault();
      adjust(...keys[event.key]);
    });
    el('mapZoomIn').onclick = () => adjust(0, 0, .2);
    el('mapZoomOut').onclick = () => adjust(0, 0, -.2);
    el('mapReset').onclick = () => {
      yaw = -.14;
      pitch = .16;
      zoom = 1;
      scheduleDraw();
    };
    filter.onchange = renderDetails;
    el('mapClose').onclick = () => dialog.close();
    startButton.onclick = () => {
      if (!busy && selected !== current) travel(selected);
    };
    if (window.ResizeObserver) new ResizeObserver(scheduleDraw).observe(plot);
    else window.addEventListener('resize', scheduleDraw);

    voyage.subscribe(renderDetails);

    return {
      visits:()=>voyage.data.visitedSectorIds.slice(),
      flightStatus(phase, target, ring, position) {
        const available=!!position || ['PLAN','ALIGN','LOAD','WARP'].includes(phase);
        localFlight.hidden=!available;
        if (!available || !dialog.open) return;
        const local=position ? ' · 구역 내 '+position.map(n=>n.toFixed(1)).join(' / ')+' SU' : '';
        const previous=origin===null ? '' : ' · 이전 출발 '+nodes[origin].name;
        const text='자유 조종 '+phase+' · '+nodes[target].name+local+(ring?' · 고리 경계':'')+previous;
        if (localFlight.textContent!==text) localFlight.textContent=text;
      },
      open() {
        if (dialog.open) return;
        dialog.showModal();
        renderDetails();
      },
      select(index) {
        selected = index;
        failure = '';
        renderDetails();
      },
      setBusy(value) {
        busy = value;
        if (busy) failure = '';
        renderDetails();
      },
      fail(message) {
        failure = message;
        renderDetails();
      },
      begin(index) {
        if (index === null || index === current) return;
        transit = {from: current, to: index, progress: 0};
        renderDetails();
      },
      progress(fraction) {
        if (!transit) return;
        transit.progress = fraction;
        if (dialog.open) el('mapFlightProgress').value = fraction;
        scheduleDraw();
      },
      arrive(index) {
        if (index !== current) origin = current;
        current = index;
        transit = null;
        renderDetails();
      },
    };
  }

  return {create};
})();

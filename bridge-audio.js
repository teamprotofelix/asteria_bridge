'use strict';

const AsteriaAudio = (() => {
  const locations = {engine:[-1.4,-1.5,-3.7], fan:[3.7,1.8,1.1],
    radar:[0,-.9,3.45], contact:[-3.93,-.9,1.9], hatch:[0,-.4,-4.86]};

  function buildGraph(context) {
    const panners = new Map();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    function place(gain, pan) {
      if (!context.createStereoPanner) {
        gain.connect(master);
        return {disconnect: () => gain.disconnect()};
      }
      const placement = context.createStereoPanner();
      placement.pan.value = pan;
      gain.connect(placement);
      placement.connect(master);
      return {pan: placement.pan, disconnect() {
        gain.disconnect();
        placement.disconnect();
      }};
    }

    function bus(pan) {
      const gain = context.createGain();
      gain.gain.value = 0;
      panners.set(gain, place(gain, pan).pan);
      return gain;
    }

    function tone(output, frequency, type = 'sine') {
      const source = context.createOscillator();
      source.frequency.value = frequency;
      source.type = type;
      source.connect(output);
      source.start();
      return source;
    }

    const engine = bus(-.12);
    const bass = tone(engine, 41);
    const harmonic = tone(engine, 82, 'triangle');

    const fan = bus(.48);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 330;
    filter.Q.value = .32;
    filter.connect(fan);
    const noise = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const edge = Math.min(1, i / 32, (samples.length - 1 - i) / 32);
      samples[i] = (Math.random() * 2 - 1) * edge;
    }
    const airflow = context.createBufferSource();
    airflow.buffer = noise;
    airflow.loop = true;
    airflow.connect(filter);
    airflow.start();

    const warp = bus(.06);
    const coil = tone(warp, 76, 'triangle');

    const ambientLeft = bus(-.55);
    const ambientRight = bus(.55);
    tone(ambientLeft, 110);
    tone(ambientRight, 164.81);
    tone(ambientRight, 219.4);

    function cue(type, point, state) {
      const cues = {
        radar: [910, 740, .14, .075, -.54],
        contact: [620, 970, .23, .09, -.38],
        hatch: [245, 122, .32, .12, .68],
        step: [135, 54, .105, .079, 0],
      };
      const [from, to, seconds, level, pan] = cues[type];
      const gain = context.createGain();
      gain.gain.value = 0;
      const position = point ?? locations[type];
      const spatial = position && positionMix(position, state);
      const placement = place(gain, spatial?.pan ?? pan);
      const sound = tone(gain, from, type === 'hatch' || type === 'step' ? 'triangle' : 'sine');
      const now = context.currentTime;
      gain.gain.linearRampToValueAtTime(level * (spatial?.level ?? 1), now + .025);
      gain.gain.exponentialRampToValueAtTime(.001, now + seconds);
      sound.frequency.exponentialRampToValueAtTime(to, now + seconds);
      sound.stop(now + seconds + .01);
      sound.onended = () => {
        sound.disconnect();
        placement.disconnect();
      };
    }

    return {context, master, engine, bass, harmonic, fan, warp, coil, ambientLeft, ambientRight, cue, panners};
  }

  function positionMix(source, {listener = [0,0,0], right = [1,0,0]}) {
    return AsteriaInterior.acoustics(source, listener, right);
  }

  function create() {
    const targets = new WeakMap();
    let graph = null;
    let enabled = false;
    let request = 0;
    let requested = false;
    let current = {throttle: 0, warp: null, ambient: false, hidden: false};

    function apply() {
      if (!graph) return;
      const {throttle, warp, ambient, hidden, volume = 1} = current;
      const {context, master, engine, bass, harmonic, fan, coil, ambientLeft, ambientRight} = graph;
      function target(parameter, value) {
        if (targets.get(parameter) === value) return;
        targets.set(parameter, value);
        const now = context.currentTime;
        parameter.cancelScheduledValues(now);
        parameter.setTargetAtTime(value, now, .09);
      }
      function placeBus(bus, source, gain) {
        const spatial = positionMix(source, current);
        const pan = graph.panners.get(bus);
        if (pan) target(pan, spatial.pan);
        target(bus.gain, gain*spatial.level);
      }
      target(master.gain, enabled && !hidden ? .42*volume : 0);
      placeBus(engine, locations.engine, ambient ? .025 + throttle * .00035 : .095 + throttle * .0014);
      target(bass.frequency, 36 + throttle * .27);
      target(harmonic.frequency, 72 + throttle * .54);
      placeBus(fan, locations.fan, ambient ? .13 : .25);
      const envelope = warp === null ? 0 : Math.max(0, Math.min(1, warp * 4, (1 - warp) * 4));
      target(graph.warp.gain, envelope * (ambient ? .13 : .32));
      target(coil.frequency, warp === null ? 76 : 76 + 178 * warp);
      target(ambientLeft.gain, ambient ? .055 : 0);
      target(ambientRight.gain, ambient ? .045 : 0);
    }

    async function toggle() {
      const id = ++request;
      requested = !requested;
      if (!requested) {
        enabled = false;
        apply();
        return enabled;
      }
      try {
        if (!graph) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) throw Error('Web Audio unavailable');
          const context = new AudioContext();
          try {
            graph = buildGraph(context);
          } catch (error) {
            context.close().catch(() => {});
            throw error;
          }
        }
        await graph.context.resume();
        if (id === request) {
          if (graph.context.state !== 'running') throw Error('Audio context unavailable');
          enabled = true;
          apply();
        }
        return enabled;
      } catch (error) {
        if (id !== request) return enabled;
        enabled = requested = false;
        apply();
        throw error;
      }
    }

    return {
      toggle,
      get enabled() { return enabled; },
      mix(next) {
        current = next;
        apply();
      },
      cue(type, point) {
        if (enabled && !current.hidden && graph.context.state === 'running') graph.cue(type, point, current);
      },
    };
  }

  return {create};
})();

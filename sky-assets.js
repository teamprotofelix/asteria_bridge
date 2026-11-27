'use strict';

const AsteriaSkyAssets = (() => {
  const tiers = ['low', 'medium', 'high', 'ultra'];
  const caps = {low: 740, medium: 1080, high: 1600, ultra: 2200};
  let catalog;

  async function read(path, signal) {
    const gate = new AbortController();
    const cancel = () => gate.abort(signal.reason);
    if (signal?.aborted) throw signal.reason;
    signal?.addEventListener('abort', cancel, {once: true});
    const timeout = setTimeout(() => gate.abort(), 15000);
    try {
      const r = await fetch(path, {signal: gate.signal, cache: 'no-cache'});
      if (!r.ok) throw Error('에셋 HTTP ' + r.status);
      return await r.arrayBuffer();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }

  async function record(id, signal) {
    if (!catalog) {
      const buffer = await read('assets/v4/manifest.json', signal);
      if (buffer.byteLength > 128000) throw Error('에셋 목록 크기 오류');
      const manifest = JSON.parse(new TextDecoder().decode(buffer));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Error('에셋 목록 오류');
      catalog = manifest;
    }
    return Object.hasOwn(catalog, id) ? catalog[id] : null;
  }

  function entries(data, expected) {
    if (data.byteLength !== expected || data.byteLength < 28) throw Error('큐브 크기 오류');
    const view = new DataView(data);
    if (view.getUint32(0) !== 0x41433034) throw Error('큐브 헤더 오류');
    let offset = 28;
    const faces = [];
    for (let i = 0; i < 6; i++) {
      const length = view.getUint32(4 + i*4, true);
      if (length < 12 || offset + length > data.byteLength ||
          view.getUint32(offset) !== 0x52494646 || view.getUint32(offset+8) !== 0x57454250) {
        throw Error('WebP 면 데이터 오류');
      }
      faces.push(new Uint8Array(data, offset, length));
      offset += length;
    }
    if (offset !== data.byteLength) throw Error('큐브 경계 오류');
    return faces;
  }

  function valid(asset, ext, cap) {
    return asset && /^assets\/v4\/[a-z0-9-]+\.(cube|webp)$/.test(asset.path) &&
      asset.path.endsWith(ext) && [512,1024,2048,4096].includes(asset.width) && asset.width <= cap &&
      asset.height === (ext === '.cube' ? asset.width : asset.width/2) &&
      Number.isInteger(asset.bytes) && asset.bytes > 0 && asset.bytes < 8000000;
  }

  async function decode(bytes, asset, signal, loadImage) {
    const url = URL.createObjectURL(new Blob([bytes], {type: 'image/webp'}));
    try {
      const image = await loadImage(url, signal);
      if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height) throw Error('에셋 해상도 오류');
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadBackground(sector, ideal, cap, signal, loadImage) {
    let failed = false;
    for (const tier of tiers.slice(0, tiers.indexOf(ideal)+1).reverse()) {
      const asset = sector?.faces?.[tier];
      if (!valid(asset, '.cube', cap)) continue;
      try {
        const packed = entries(await read(asset.path, signal), asset.bytes);
        const images = [];
        for (const face of packed) images.push(await decode(face, asset, signal, loadImage));
        return {images, tier, width: asset.width, reason: failed ? '에셋 오류로 하향'
          : tier !== ideal ? '구역 에셋 또는 GPU 한도' : ''};
      } catch (error) {
        if (signal?.aborted) throw error;
        failed = true;
      }
    }
    return null;
  }

  async function loadSurface(sector, cap, signal, loadImage) {
    const asset = sector?.surface;
    if (!valid(asset, '.webp', cap)) return null;
    try {
      const bytes = await read(asset.path, signal);
      if (bytes.byteLength !== asset.bytes) throw Error('표면 파일 크기 오류');
      return await decode(bytes, asset, signal, loadImage);
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
  }

  return {record, entries, loadBackground, loadSurface, caps};
})();

'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

// Only one visible clip plays or buffers at a time. Incomplete offscreen
// downloads are cancelled; fully buffered clips stay available for replay.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const connection = navigator.connection;
const clips = [];
let activeClip = null;
let clipTimer;
const slowConnection = () => connection?.saveData || /^(slow-2g|2g|3g)$/.test(connection?.effectiveType || '');
const mayAutoplay = () => !reducedMotion.matches && !slowConnection();

function clipSource(clip) {
  const { video, quality } = clip;
  if (quality === 'high') return video.dataset.srcHigh;
  if (video.dataset.srcMobile && (innerWidth <= 720 || slowConnection())) return video.dataset.srcMobile;
  return video.dataset.src;
}
function updateClip(clip) {
  const running = activeClip === clip;
  clip.button.textContent = running ? (clip.loading ? 'Loading…' : 'Pause') : (clip.failed ? 'Retry' : 'Play');
  clip.button.setAttribute('aria-label', `${running ? 'Pause' : 'Play'}: ${clip.video.getAttribute('aria-label')}`);
  clip.player.setAttribute('aria-busy', String(running && clip.loading));
}
function fullyBuffered(video) {
  if (!Number.isFinite(video.duration) || !video.buffered.length) return false;
  let end = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) > end + 0.1) return false;
    end = video.buffered.end(i);
  }
  return end >= video.duration - 0.1;
}
function releaseClip(clip) {
  const { video } = clip;
  if (!video.hasAttribute('src')) return;
  clip.resumeAt = video.currentTime || clip.resumeAt;
  video.removeAttribute('src');
  video.load(); // Cancels the previous media request as well as decoding.
}
function stopClip(clip) {
  if (activeClip === clip) activeClip = null;
  clip.video.pause();
  clip.loading = false;
  if (!fullyBuffered(clip.video)) releaseClip(clip);
  updateClip(clip);
}
function startClip(clip, manual = false) {
  if (document.hidden) return;
  if (activeClip && activeClip !== clip) stopClip(activeClip);
  if (manual) { clip.userPaused = false; clip.blocked = false; clip.manual = true; }
  activeClip = clip;
  clip.failed = false;
  const source = clipSource(clip);
  if (clip.video.getAttribute('src') !== source) {
    releaseClip(clip);
    clip.video.src = source;
  }
  clip.loading = clip.video.readyState < 3;
  updateClip(clip);
  clip.video.play().catch(error => {
    if (activeClip !== clip || error.name === 'AbortError') return;
    clip.blocked = true; // Autoplay rejection needs a user gesture, not a retry loop.
    stopClip(clip);
  });
}
function scheduleClip() {
  clearTimeout(clipTimer);
  if (document.hidden) return;
  clipTimer = setTimeout(() => {
    if (!mayAutoplay() || document.hidden) return;
    if (activeClip?.manual && activeClip.ratio >= 0.35) return;
    const candidates = clips.filter(clip => clip.ratio >= 0.35 && !clip.userPaused && !clip.blocked && !clip.failed);
    candidates.sort((a, b) => b.area - a.area);
    const next = candidates[0];
    if (next && next !== activeClip) startClip(next);
  }, 250); // Do not fetch clips that the visitor merely scrolls past.
}
const clipObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const clip = clips.find(item => item.video === entry.target);
    clip.ratio = entry.intersectionRatio;
    clip.area = entry.intersectionRect.width * entry.intersectionRect.height;
    if (activeClip === clip && clip.ratio < 0.35) stopClip(clip);
  }
  scheduleClip();
}, { threshold: [0, 0.1, 0.35, 0.5, 0.75, 1] });
$$('video.loop').forEach(video => {
  const player = document.createElement('div');
  player.className = 'clip-player';
  video.before(player);
  player.append(video);
  const toolbar = document.createElement('div');
  toolbar.className = 'clip-toolbar';
  const button = document.createElement('button');
  button.type = 'button';
  const clip = { video, player, button, ratio: 0, area: 0, resumeAt: 0, quality: 'auto' };
  clips.push(clip);
  if (video.dataset.srcHigh) {
    const quality = document.createElement('select');
    quality.setAttribute('aria-label', 'Teaser video quality');
    quality.innerHTML = '<option value="auto">Auto quality</option><option value="high">High quality · 31 MB</option>';
    quality.addEventListener('change', () => {
      clip.quality = quality.value;
      startClip(clip, true);
    });
    toolbar.append(quality);
  }
  toolbar.append(button);
  player.append(toolbar);
  const toggle = () => {
    if (activeClip === clip) { clip.userPaused = true; stopClip(clip); }
    else startClip(clip, true);
  };
  button.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  video.addEventListener('loadedmetadata', () => {
    if (clip.resumeAt && Number.isFinite(video.duration)) video.currentTime = Math.min(clip.resumeAt, Math.max(0, video.duration - 0.1));
    clip.resumeAt = 0;
  });
  video.addEventListener('playing', () => {
    if (activeClip !== clip) { video.pause(); return; }
    clip.loading = false;
    updateClip(clip);
  });
  video.addEventListener('waiting', () => { clip.loading = true; updateClip(clip); });
  video.addEventListener('error', () => {
    if (!video.hasAttribute('src')) return;
    clip.failed = true;
    stopClip(clip);
  });
  updateClip(clip);
  clipObserver.observe(video);
});
document.addEventListener('visibilitychange', () => {
  clearTimeout(clipTimer);
  if (document.hidden) {
    if (activeClip) stopClip(activeClip);
  } else scheduleClip();
});
function updatePlaybackPreference() {
  if (!mayAutoplay() && activeClip && !activeClip.manual) stopClip(activeClip);
  scheduleClip();
}
reducedMotion.addEventListener('change', updatePlaybackPreference);
connection?.addEventListener('change', updatePlaybackPreference);

// Rendered layer tabs.
const layers = {
  rgb: ['RGB rendering of the reconstructed courtyard.', 'RGB rendering of the reconstructed outdoor courtyard with trees, chairs, and surrounding buildings.'],
  gui: ['The underlying 2D Gaussian disks. Individual disks can deviate from the composited surface.', 'The underlying planar Gaussian disks forming the outdoor scene.'],
  depth: ['Alpha-composited depth. Path-aligned queries read surface distance from this rendered geometry.', 'Rendered depth of the courtyard shown with a blue-to-red colormap.'],
  normal: ['Rendered normals. Their dispersion across views is the signal used for structural attribution.', 'Surface normals of the courtyard encoded as RGB directions.'],
  score: ['Structural scores of observation-supported non-ground disks. High scores attract denser roadmap sampling.', 'Structural scores highlighting corners and clutter in the courtyard.'],
  semantic: ['Semantic labels transferred to the disks. Ground regions define where nodes and paths may lie.', 'Semantic labels distinguish ground, buildings, and vegetation in the courtyard.']
};
const tabs = $$('[data-layer]');
function selectLayer(button) {
  const [caption, alt] = layers[button.dataset.layer];
  tabs.forEach(tab => {
    const active = tab === button;
    tab.setAttribute('aria-selected', active);
    tab.tabIndex = active ? 0 : -1;
  });
  $('#layer-image').src = `files/images/scene-${button.dataset.layer}.webp`;
  $('#layer-image').alt = alt;
  $('#layer-caption').textContent = caption;
  $('#layer-panel').setAttribute('aria-labelledby', button.id);
}
tabs.forEach(tab => tab.addEventListener('click', () => selectLayer(tab)));
$('.tabs').addEventListener('keydown', event => {
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length];
  tab.focus();
  selectLayer(tab);
});

// Uniform / adaptive sampling slider.
$('#sampling-slider').addEventListener('input', event => {
  const value = Number(event.target.value);
  $('#roadmap-wipe').style.setProperty('--split', `${value}%`);
  event.target.setAttribute('aria-valuetext', `Uniform ${value} percent, adaptive ${100 - value} percent`);
});

// Zoomable image viewer: figure links open here instead of a new tab.
// Wheel / pinch to zoom around the pointer, drag to pan.
const zoom = $('#zoom');
const stage = $('.zoom-stage', zoom);
const zoomImage = $('#zoom-image');
const view = { scale: 1, x: 0, y: 0, fit: 1 };
// Size the image itself (not a CSS scale) so vector SVGs are re-rendered sharply at every zoom level.
function render() {
  zoomImage.style.width = `${zoomImage.naturalWidth * view.scale}px`;
  zoomImage.style.transform = `translate(${view.x}px, ${view.y}px)`;
}
function fitImage() {
  const w = zoomImage.naturalWidth || 1, h = zoomImage.naturalHeight || 1;
  const box = stage.getBoundingClientRect();
  const top = 64, bottom = 48;  // keep clear of the toolbar and the hint
  view.fit = Math.min(box.width * 0.96 / w, (box.height - top - bottom) / h);
  view.scale = view.fit;
  view.x = (box.width - w * view.scale) / 2;
  view.y = top + (box.height - top - bottom - h * view.scale) / 2;
  render();
}
function zoomAt(factor, cx, cy) {
  const next = Math.min(Math.max(view.scale * factor, view.fit), view.fit * 16);
  const k = next / view.scale;
  view.x = cx - (cx - view.x) * k;
  view.y = cy - (cy - view.y) * k;
  view.scale = next;
  render();
}
function stageCentre() { const box = stage.getBoundingClientRect(); return [box.width / 2, box.height / 2]; }
$$('figure a[href^="files/images/"]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  zoomImage.alt = $('img', link)?.alt || '';
  $('#zoom-original').href = link.getAttribute('href');
  zoomImage.onload = fitImage;
  zoomImage.src = link.getAttribute('href');
  zoom.showModal();
  if (zoomImage.complete && zoomImage.naturalWidth) fitImage();
}));
stage.addEventListener('wheel', event => {
  event.preventDefault();
  const box = stage.getBoundingClientRect();
  zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top);
}, { passive: false });
const pointers = new Map();
let pinch = null;
stage.addEventListener('pointerdown', event => {
  stage.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, [event.clientX, event.clientY]);
  stage.classList.add('dragging');
});
stage.addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  const [px, py] = pointers.get(event.pointerId);
  pointers.set(event.pointerId, [event.clientX, event.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const box = stage.getBoundingClientRect();
    if (pinch) zoomAt(distance / pinch, (a[0] + b[0]) / 2 - box.left, (a[1] + b[1]) / 2 - box.top);
    pinch = distance;
  } else {
    view.x += event.clientX - px; view.y += event.clientY - py; render();
  }
});
function release(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) stage.classList.remove('dragging');
}
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('dblclick', event => {
  const box = stage.getBoundingClientRect();
  zoomAt(2, event.clientX - box.left, event.clientY - box.top);
});
$$('[data-zoom]', zoom).forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.zoom;
  if (action === 'close') zoom.close();
  else if (action === 'fit') fitImage();
  else zoomAt(action === 'in' ? 1.5 : 1 / 1.5, ...stageCentre());
}));
addEventListener('resize', () => { if (zoom.open) fitImage(); });
zoom.addEventListener('close', () => { zoomImage.removeAttribute('src'); });

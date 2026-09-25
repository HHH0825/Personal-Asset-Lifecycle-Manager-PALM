const slider = document.querySelector('#demo-slider');
slider.addEventListener('input', () => {
  const days = Number(slider.value);
  document.querySelector('#demo-days').textContent = days;
  document.querySelector('#demo-cost').textContent = (300 / days).toFixed(2);
  document.querySelector('#demo-message').textContent = days >= 300 ? '小目标达成：每天不超过 1 元！' : `距离每天 1 元，还需 ${300 - days} 天`;
  const progress = Math.min(100, days / 300 * 100);
  document.querySelector('#demo-progress').setAttribute('aria-valuenow', progress.toFixed(1));
  document.querySelector('#demo-progress span').style.width = `${progress}%`;
  document.querySelector('.demo-notebook').classList.toggle('goal-reached', days >= 300);
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if ('IntersectionObserver' in window && !reduceMotion.matches) {
  const revealTargets = document.querySelectorAll([
    '.chapter-strip', '.landing-heading', '.feature-card', '.demo-copy',
    '.demo-notebook', '.invite-doodle', '.landing-invite h2', '.landing-invite .primary-btn',
  ].join(', '));
  const initiallyVisible = window.innerHeight * .78;
  for (const element of revealTargets) {
    const bounds = element.getBoundingClientRect();
    if (bounds.top < initiallyVisible && bounds.bottom > 0) element.classList.add('reveal-visible');
  }
  document.body.classList.add('landing-motion');

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('reveal-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: .08, rootMargin: '0px 0px -22% 0px' });
  for (const element of revealTargets) {
    if (!element.classList.contains('reveal-visible')) observer.observe(element);
  }

  const scene = document.querySelector('.archive-scene');
  const wideScreen = window.matchMedia('(min-width: 901px)');
  let framePending = false;
  let lastProgress = -1;
  function updateScene() {
    framePending = false;
    if (!wideScreen.matches || reduceMotion.matches) return;
    const progress = Math.min(1, Math.max(0, window.scrollY / document.querySelector('.landing-hero').offsetHeight));
    if (progress === lastProgress) return;
    lastProgress = progress;
    scene.style.setProperty('--scene-main-y', `${(-14 * progress).toFixed(1)}px`);
    scene.style.setProperty('--scene-stamp-y', `${(-28 * progress).toFixed(1)}px`);
    scene.style.setProperty('--scene-small-y', `${(10 * progress).toFixed(1)}px`);
  }
  function scheduleScene() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(updateScene);
  }
  window.addEventListener('scroll', scheduleScene, { passive: true });
  window.addEventListener('resize', scheduleScene);
  scheduleScene();

  reduceMotion.addEventListener('change', () => {
    if (!reduceMotion.matches) return;
    observer.disconnect();
    document.body.classList.remove('landing-motion');
    window.removeEventListener('scroll', scheduleScene);
    window.removeEventListener('resize', scheduleScene);
  });
}
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });

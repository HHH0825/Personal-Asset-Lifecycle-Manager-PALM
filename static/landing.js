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
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });

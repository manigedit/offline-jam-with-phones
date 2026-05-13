import { renderHome } from './ui/home.js';
import { renderHost } from './ui/host.js';
import { renderJoin } from './ui/join.js';

const app = document.getElementById('app');

function route() {
  const hash = window.location.hash.slice(1);
  app.innerHTML = '';
  if (hash === 'host') renderHost(app);
  else if (hash === 'join') renderJoin(app);
  else renderHome(app);
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock === null) keepAwake();
});
keepAwake();

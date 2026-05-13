function isIosSafariNotStandalone() {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return isIos && !isStandalone;
}

export function renderHome(root) {
  const installHint = isIosSafariNotStandalone()
    ? `<div class="card"><h2>Install for offline use</h2><p>Tap the Share button below, then "Add to Home Screen". The app will then work even with no internet.</p></div>`
    : '';
  root.innerHTML = `
    <h1>Audio Party</h1>
    <p>Sync songs across phone speakers. No internet, no accounts.</p>
    <div class="card">
      <h2>I have the songs</h2>
      <p>Be the host. Your phone serves the music; friends scan a QR to join.</p>
      <button id="goHost">Host a session</button>
    </div>
    <div class="card">
      <h2>I'm joining</h2>
      <p>Open this on your phone, then scan the QR from the host.</p>
      <button class="secondary" id="goJoin">Join a session</button>
    </div>
    ${installHint}
    <p class="muted">Tip: connect everyone to the same WiFi or the host's hotspot first.</p>
  `;
  root.querySelector('#goHost').onclick = () => { location.hash = 'host'; };
  root.querySelector('#goJoin').onclick = () => { location.hash = 'join'; };
}

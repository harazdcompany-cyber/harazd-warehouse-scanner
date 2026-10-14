// HARAZD navigation bridge: відкриває потрібну вкладку після повернення з vehicles.html.
(() => {
  const allowed = new Set(['warehouse','add','scanner','categories','personnel','events','repairs']);
  function openFromHash() {
    const page = decodeURIComponent(location.hash.slice(1));
    if (!allowed.has(page)) return;
    const button = document.querySelector('#nav button[data-page="' + page + '"]');
    if (button) button.click();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openFromHash);
  else openFromHash();
  window.addEventListener('hashchange', openFromHash);
})();

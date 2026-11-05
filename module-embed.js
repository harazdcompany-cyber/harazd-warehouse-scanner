/* V49.21 — embedded module alignment with main warehouse content. */
(() => {
  const params = new URLSearchParams(location.search);
  if(params.get('embedded')!=='1' || window.parent===window) return;
  document.documentElement.classList.add('harazd-embedded');
  const style = document.createElement('style');
  style.textContent = `
    html.harazd-embedded .shell {display:block;min-height:100%;}
    html.harazd-embedded .shell > .side {display:none!important;}
    html.harazd-embedded .vehicle-topbar {display:none!important;}
    html.harazd-embedded .main {min-width:0;min-height:100dvh;padding:0!important;}
    html.harazd-embedded .vehicle-content {max-width:none;margin:0;padding:0!important;}
    html.harazd-embedded {scrollbar-gutter:stable;}
    @media(max-width:650px){html.harazd-embedded .main,html.harazd-embedded .vehicle-content{padding:0!important}}
  `;
  document.head.appendChild(style);
  // Delegate navigation back to the application's existing tab controller.
  const known = new Set(['warehouse','add','scanner','categories','personnel','events','repairs','packaging','vehicles']);
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if(!link || link.target==='_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = new URL(link.href, location.href);
    if(target.origin!==location.origin) return;
    const path = target.pathname.split('/').pop();
    const page = path==='index.html' ? (target.hash.slice(1)||'warehouse') : path==='packaging.html' ? 'packaging' : path==='vehicles.html' ? 'vehicles' : null;
    // Deep links to a specific package keep their query parameters.
    if(!known.has(page)|| (page==='packaging' && target.searchParams.has('pk')))return;
    event.preventDefault();
    window.parent.postMessage({type:'harazd:navigate',page},location.origin);
  },true);
})();

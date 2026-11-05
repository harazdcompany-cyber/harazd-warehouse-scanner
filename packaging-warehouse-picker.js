// V49.42 — legacy cross-page picker retired.
// The packaging section now selects equipment in a local modal.
// Clear abandoned navigation context so the old PK banner does not reappear.
(() => {
  'use strict';
  try {
    sessionStorage.removeItem('harazd-packaging-picker');
    sessionStorage.removeItem('harazd-packaging-picked');
  } catch (_) {}
})();

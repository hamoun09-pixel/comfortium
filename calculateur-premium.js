/* Calculateur — icônes au trait à la place des émojis, et retrait des émojis restants dans les textes
   (y compris ceux ajoutés plus tard par le calcul ou le changement de langue). */
(function () {
  'use strict';
  var P = {
    house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>', cottage: '<path d="M3 12l9-8 9 8"/><path d="M5 11v9h14v-9"/><path d="M10 20v-5h4v5"/><path d="M16 6V3h2v5"/>',
    building: '<rect x="4" y="3" width="16" height="18"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>', person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    oil: '<rect x="5" y="6" width="14" height="14" rx="2"/><path d="M9 6V3h6v3M8 12h8"/>', base: '<rect x="3" y="13" width="18" height="6" rx="1"/><path d="M6 13v6M10 13v6M14 13v6M18 13v6"/>',
    air: '<path d="M3 8h12a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h8"/>', water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    gas: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 3 3 3"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01"/>',
    condo: '<rect x="4" y="2" width="16" height="20"/><path d="M8 6h2M14 6h2M8 10h2M14 10h2M8 14h2M14 14h2M10 22v-4h4v4"/>', semi: '<path d="M2 12l6-5 6 5"/><path d="M10 12l6-5 6 5"/><path d="M4 11v9h16v-9"/>',
    plex: '<rect x="5" y="3" width="14" height="18"/><path d="M5 12h14M9 7h2M13 7h2M9 16h2M13 16h2"/>',
    area: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h4M3 15h4M9 3v4M15 3v4"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/>', gaugeL: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l-4-5"/>', gaugeM: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18V11"/>',
    central: '<rect x="7" y="9" width="10" height="12" rx="1"/><path d="M9 9V4h6v5M3 6h4M17 6h4"/>', multi: '<rect x="2" y="4" width="9" height="5" rx="1"/><rect x="13" y="4" width="9" height="5" rx="1"/><rect x="7" y="14" width="10" height="6" rx="1"/>',
    wall: '<rect x="3" y="6" width="18" height="7" rx="2"/><path d="M6 16v2M12 16v3M18 16v2"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>'
  };
  var MAP = {
    statut: { proprietaire_principal: 'house', proprietaire_secondaire: 'cottage', proprietaire_immeuble: 'building', locataire: 'person' },
    chauffage: { mazout: 'oil', plinthes: 'base', fournaise_elec: 'air', chaudiere_elec: 'water', gaz: 'gas', autre: 'help' },
    propriete: { unifamiliale: 'house', condo: 'condo', jumele: 'semi', plex: 'plex' },
    superficie: { small: 'area', medium: 'area', large: 'area', xlarge: 'area', xxlarge: 'area' },
    conso: { low: 'gaugeL', medium: 'gaugeM', high: 'gauge', unknown: 'help' },
    type_tp: { centrale: 'central', multizone: 'multi', murale: 'wall', conseiller: 'help' },
    amperage: { '200': 'bolt', '150': 'bolt', '125': 'bolt', '100': 'bolt', unknown: 'help' },
    horizon: { asap: 'clock', '1_3_mois': 'cal', '3_6_mois': 'cal', info: 'search' }
  };
  function icons() {
    document.querySelectorAll('.option[data-field]').forEach(function (o) {
      var e = o.querySelector('.option-emoji'); if (!e || e.getAttribute('data-icon')) return;
      var k = (MAP[o.getAttribute('data-field')] || {})[o.getAttribute('data-value')] || 'help';
      e.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + P[k] + '</svg>'; e.setAttribute('data-icon', k);
    });
  }
  // Émojis pictographiques (on garde ✓, ×, →, ←, ↗).
  var RX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{2712}\u{2714}-\u{27BF}\u{FE0F}\u{200D}]\s?/gu;
  var ZONES = '.hero, .cv26-panel, .calc-section, .result-section';
  function clean(root) {
    (root.querySelectorAll ? [root] : []).concat(Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('*') : [])).forEach(function (el) {
      if (el.closest && !el.closest(ZONES)) return;
      if (el.classList && el.classList.contains('option-emoji')) return;
      ['data-v22-fr', 'data-v22-en', 'data-i18n-fr', 'data-i18n-en'].forEach(function (a) { var v = el.getAttribute && el.getAttribute(a); if (v && RX.test(v)) { RX.lastIndex = 0; el.setAttribute(a, v.replace(RX, '')); } RX.lastIndex = 0; });
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && RX.test(n.nodeValue)) { RX.lastIndex = 0; n.nodeValue = n.nodeValue.replace(RX, ''); } else RX.lastIndex = 0;
    });
  }
  function run() {
    icons();
    document.querySelectorAll(ZONES).forEach(clean);
    var mo = new MutationObserver(function (list) {
      mo.disconnect();
      list.forEach(function (m) { if (m.type === 'characterData') { var p = m.target.parentNode; if (p) clean(p); } else m.addedNodes.forEach(function (n) { if (n.nodeType === 1) clean(n); else if (n.parentNode) clean(n.parentNode); }); });
      observe();
    });
    function observe() { document.querySelectorAll(ZONES).forEach(function (z) { mo.observe(z, { childList: true, subtree: true, characterData: true }); }); }
    observe();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();

/* Étape facultative : ouvrir la recherche ou passer aux questions. */
(function () {
  'use strict';
  function go() {
    var yes = document.getElementById('cvpYes'), no = document.getElementById('cvpNo'), skip = document.getElementById('cvpSkip'), box = document.getElementById('cvpSearch');
    if (!yes || !box) return;
    function toQuestions() { var c = document.getElementById('calcSection'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    yes.addEventListener('click', function () {
      var open = box.classList.contains('cv26-hidden');
      box.classList.toggle('cv26-hidden', !open); yes.setAttribute('aria-expanded', String(open));
      if (open) setTimeout(function () { var s = document.getElementById('cv26Search'); if (s) s.focus({ preventScroll: true }); }, 60);
    });
    if (no) no.addEventListener('click', toQuestions);
    // Les liens « choisir mon modèle » du résultat ouvrent directement la recherche.
    document.addEventListener('click', function (e) { var l = e.target.closest && e.target.closest('a[href="#cv26Lookup"]'); if (l && box.classList.contains('cv26-hidden')) { box.classList.remove('cv26-hidden'); yes.setAttribute('aria-expanded', 'true'); } });
    if (location.hash === '#cv26Lookup') { box.classList.remove('cv26-hidden'); yes.setAttribute('aria-expanded', 'true'); }
    if (skip) skip.addEventListener('click', toQuestions);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();

/* Panneau « Votre projet » : se remplit à chaque réponse (ordinateur seulement). */
(function () {
  'use strict';
  var F = [['statut', 'Statut', 'Status'], ['codePostal', 'Code postal', 'Postal code'], ['chauffage', 'Chauffage actuel', 'Current heating'], ['propriete', 'Propriété', 'Property'], ['superficie', 'Superficie', 'Floor area'], ['type_tp', 'Thermopompe', 'Heat pump'], ['amperage', 'Entrée électrique', 'Electrical service'], ['horizon', 'Échéancier', 'Timeline']];
  function en() { return document.documentElement.lang === 'en'; }
  function ans() { try { return (typeof answers !== 'undefined') ? answers : {}; } catch (e) { return {}; } }
  function label(field, v) {
    var o = document.querySelector('.option[data-field="' + field + '"][data-value="' + String(v).replace(/"/g, '') + '"] .option-label');
    return o ? o.textContent.trim().split(' ~')[0] : v;
  }
  function money(n) { return new Intl.NumberFormat(en() ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var side;
  function render() {
    var sec = document.getElementById('calcSection'); if (!sec || !sec.querySelector('.step')) return;
    if (!side || !sec.contains(side)) { side = document.createElement('aside'); side.className = 'cfx-side'; side.setAttribute('aria-label', 'Votre projet'); sec.appendChild(side); }
    var a = ans(), E = en(), rows = '';
    F.forEach(function (f) {
      var v = f[0] === 'codePostal' ? (a.codePostal || (document.getElementById('codePostal') || {}).value || '') : a[f[0]];
      rows += '<div><dt>' + esc(E ? f[2] : f[1]) + '</dt><dd' + (v ? '' : ' class="cfx-empty"') + '>' + esc(v ? (f[0] === 'codePostal' ? String(v).toUpperCase() : label(f[0], v)) : '—') + '</dd></div>';
    });
    var m = window.cv26Selected, amt;
    if (m && m.base) amt = '<div class="cfx-amt"><small>' + (E ? 'LogisVert for your model' : 'LogisVert de votre modèle') + '</small><strong>' + money(m.base) + '</strong><span>' + esc(m.brand + ' · ' + m.out) + '</span></div>';
    else amt = '<div class="cfx-amt"><small>LogisVert</small><strong>' + (E ? 'Calculated at the end' : 'Calculé à la fin') + '</strong><span>' + (E ? 'Choose your model above for the exact amount' : 'Choisissez votre modèle en haut pour le montant exact') + '</span></div>';
    side.innerHTML = '<p class="cfx-eb">' + (E ? 'Your project' : 'Votre projet') + '</p><h3>' + (E ? 'Summary' : 'En résumé') + '</h3><dl>' + rows + '</dl>' + amt +
      '<p class="cfx-note">' + (E ? 'Free and without obligation. An advisor replies within 24 to 48 hours.' : 'Gratuit et sans engagement. Un conseiller vous répond en 24 à 48 h.') + '</p>';
  }
  var t; function soon() { clearTimeout(t); t = setTimeout(render, 60); }
  function go() { render(); ['click', 'input', 'change'].forEach(function (ev) { document.addEventListener(ev, soon, true); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();

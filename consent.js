/* Comfortium — gestion du consentement aux témoins (Loi 25).
   Par défaut : aucun témoin de mesure ou de suivi. Google Analytics reste en mode refusé
   et le script de suivi HubSpot n'est chargé qu'avec l'accord du visiteur.
   Le choix est conservé dans le navigateur (clé comfortium_consent) et modifiable en tout temps
   avec le lien « Gérer les témoins » (window.comfortiumConsent.open()). */
(function () {
  'use strict';
  var KEY = 'comfortium_consent', VERSION = 1;
  var HUBSPOT_SRC = 'https://js-na3.hs-scripts.com/343220257.js';
  var T = {
    fr: {
      title: 'Vos choix de témoins',
      text: 'Nous utilisons des témoins de mesure d’audience et de suivi des visites seulement si vous les acceptez. Les témoins essentiels (langue, vos choix) restent actifs.',
      policy: 'Politique de confidentialité',
      refuse: 'Tout refuser', accept: 'Tout accepter', custom: 'Personnaliser', save: 'Enregistrer mes choix',
      essential: 'Essentiels', essentialD: 'Langue d’affichage et mémorisation de vos choix. Toujours actifs.',
      analytics: 'Mesure d’audience (Google Analytics)', analyticsD: 'Statistiques de visite anonymisées pour améliorer le site. Témoins _ga, conservés 2 ans.',
      hubspot: 'Suivi des visites (HubSpot)', hubspotD: 'Associe vos visites à vos demandes dans notre outil de suivi. Témoins __hstc, hubspotutk (6 mois), __hssc (30 min).',
      saved: 'Vos choix ont été enregistrés.'
    },
    en: {
      title: 'Your cookie choices',
      text: 'We use audience measurement and visit tracking cookies only if you accept them. Essential cookies (language, your choices) remain active.',
      policy: 'Privacy policy',
      refuse: 'Refuse all', accept: 'Accept all', custom: 'Customize', save: 'Save my choices',
      essential: 'Essential', essentialD: 'Display language and storage of your choices. Always active.',
      analytics: 'Audience measurement (Google Analytics)', analyticsD: 'Anonymized visit statistics to improve the site. _ga cookies, kept 2 years.',
      hubspot: 'Visit tracking (HubSpot)', hubspotD: 'Links your visits to your requests in our follow-up tool. __hstc, hubspotutk (6 months), __hssc (30 min) cookies.',
      saved: 'Your choices have been saved.'
    }
  };
  var root = null, detailed = false;

  function lang() { return document.documentElement.lang === 'en' ? 'en' : 'fr'; }
  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.v === VERSION ? v : null; }
    catch (e) { return null; }
  }
  function write(c) {
    c.v = VERSION; c.date = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
  }
  function loadHubSpot() {
    if (document.getElementById('hs-script-loader')) return;
    var s = document.createElement('script');
    s.id = 'hs-script-loader'; s.async = true; s.defer = true; s.src = HUBSPOT_SRC;
    document.head.appendChild(s);
  }
  function apply(c) {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: c.analytics ? 'granted' : 'denied' });
    }
    if (c.hubspot) loadHubSpot();
    else if (window._hsp) { try { window._hsp.push(['revokeCookieConsent']); } catch (e) {} }
  }
  function choose(c) { write(c); apply(c); close(); }

  function css() {
    if (document.getElementById('cc-style')) return;
    var st = document.createElement('style'); st.id = 'cc-style';
    st.textContent =
      '.cc-box{position:fixed;left:20px;bottom:20px;z-index:2147483000;box-sizing:border-box;width:min(520px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:auto;background:#fff;color:#263b32;border:1px solid #dedbd1;border-radius:14px;box-shadow:0 18px 50px rgba(22,44,35,.18);padding:22px 22px 18px;font:14px/1.6 Arial,Helvetica,sans-serif}' +
      '.cc-box h2{font:normal 22px/1.2 Georgia,serif;margin:0 0 8px;color:#1f3029}' +
      '.cc-box p{margin:0 0 12px;color:#4d5a53}' +
      '.cc-box a{color:#263e36;text-decoration:underline;text-underline-offset:2px}' +
      '.cc-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}' +
      '.cc-btn{flex:1 1 140px;min-height:44px;border-radius:9px;font:700 13px Arial,Helvetica,sans-serif;cursor:pointer;padding:10px 14px}' +
      '.cc-solid{background:#203b32;color:#fff;border:1px solid #b28a62}.cc-solid:hover{background:#305447}' +
      '.cc-line{background:#fff;color:#203b32;border:1px solid #9eaea2}.cc-line:hover{background:#f5f2ea}' +
      '.cc-opt{display:flex;gap:10px;align-items:flex-start;border-top:1px solid #e6e3da;padding:12px 0 2px}' +
      '.cc-opt input{margin-top:4px;width:17px;height:17px;accent-color:#263e36;flex-shrink:0}' +
      '.cc-opt strong{display:block;color:#1f3029;font-size:13.5px}.cc-opt span{display:block;font-size:12.5px;color:#5a655e}' +
      '@media(max-width:600px){.cc-box{left:10px;right:10px;bottom:10px;width:auto;padding:18px 16px 14px}body.cc-open #chatBubble{display:none!important}}';
    document.head.appendChild(st);
  }
  function render() {
    var t = T[lang()], c = read() || { analytics: false, hubspot: false };
    var opts = detailed ?
      '<label class="cc-opt"><input type="checkbox" checked disabled><span><strong>' + t.essential + '</strong><span>' + t.essentialD + '</span></span></label>' +
      '<label class="cc-opt"><input type="checkbox" id="cc-analytics"' + (c.analytics ? ' checked' : '') + '><span><strong>' + t.analytics + '</strong><span>' + t.analyticsD + '</span></span></label>' +
      '<label class="cc-opt"><input type="checkbox" id="cc-hubspot"' + (c.hubspot ? ' checked' : '') + '><span><strong>' + t.hubspot + '</strong><span>' + t.hubspotD + '</span></span></label>' : '';
    var actions = detailed ?
      '<button type="button" class="cc-btn cc-solid" data-cc="refuse">' + t.refuse + '</button>' +
      '<button type="button" class="cc-btn cc-line" data-cc="save">' + t.save + '</button>' +
      '<button type="button" class="cc-btn cc-solid" data-cc="accept">' + t.accept + '</button>' :
      '<button type="button" class="cc-btn cc-solid" data-cc="refuse">' + t.refuse + '</button>' +
      '<button type="button" class="cc-btn cc-line" data-cc="custom">' + t.custom + '</button>' +
      '<button type="button" class="cc-btn cc-solid" data-cc="accept">' + t.accept + '</button>';
    root.innerHTML = '<h2 id="cc-title">' + t.title + '</h2><p>' + t.text + ' <a href="politique-de-confidentialite.html">' + t.policy + '</a></p>' + opts + '<div class="cc-actions">' + actions + '</div>';
  }
  function open(withDetails) {
    css();
    detailed = !!withDetails;
    if (!root) {
      root = document.createElement('div');
      root.className = 'cc-box'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-labelledby', 'cc-title');
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-cc]'); if (!b) return;
        var a = b.getAttribute('data-cc');
        if (a === 'accept') choose({ analytics: true, hubspot: true });
        else if (a === 'refuse') choose({ analytics: false, hubspot: false });
        else if (a === 'custom') { detailed = true; render(); }
        else if (a === 'save') choose({ analytics: !!document.getElementById('cc-analytics').checked, hubspot: !!document.getElementById('cc-hubspot').checked });
      });
      document.body.appendChild(root);
    }
    render();
    document.body.classList.add('cc-open');
  }
  function close() {
    if (root) { root.remove(); root = null; }
    document.body.classList.remove('cc-open');
  }
  // Retraduire la bannière si la langue du site change.
  new MutationObserver(function () { if (root) render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  window.comfortiumConsent = { open: function () { open(true); }, get: read };
  function start() { var c = read(); if (c) apply(c); else open(false); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

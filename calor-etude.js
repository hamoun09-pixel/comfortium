/* Comfortium — étude de consommation énergétique dans CALOR.
   Parcours guidé (sans IA pour les chiffres) : projet → consommation → coordonnées → code de vérification
   → résultat et rapport PDF. Les calculs sont déterministes et reprennent les hypothèses du calculateur.
   Le rapport et l'envoi du prospect à HubSpot ne sont débloqués qu'après la vérification du code. */
(function () {
  'use strict';
  var CTX_KEY = 'comfortium_etude_ctx';
  var CATALOGUE_URL = 'catalogue-comfortium-2026-10-15.json';
  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  // Hypothèses — identiques au calculateur (calculateur-subvention.html, objet HYP).
  var HYP = {
    coutBase: { murale: 4500, multizone: 7500, centrale: 11500, conseiller: 10000 },
    supplementGrosseCapacite: 2000, supplementMazout: 2500, supplementElectrique: 2500, ecartCout: 0.20,
    mazoutPrix: [2.00, 2.30], kwhParLitreMazout: 10.2, rendementFournaiseMazout: 0.80,
    electricitePrix: [0.09, 0.11], copSaisonnier: [2.0, 2.6], partChauffageFacture: [0.50, 0.65],
    couverture: { murale: [0.40, 0.60], multizone: [0.70, 0.90], centrale: [0.85, 1.00], conseiller: [0.60, 0.90] },
    consoMazoutL: { low: [1000, 1500], medium: [1500, 2500], high: [2500, 3500], unknown: [1500, 2500] },
    factureHydro: { low: [1200, 1800], medium: [1800, 2800], high: [2800, 3800], unknown: [1800, 2800] },
    lavalMazout: { unifamiliale: 2000, jumele: 1400, condo: 1400, plex: 1400 },
    tauxLogisVert: 120
  };
  var ELEC = ['plinthes', 'fournaise_elec', 'chaudiere_elec', 'electrique'];

  var T = {
    fr: {
      intro: "Avec plaisir. L’**étude de consommation** compare ce que vous payez aujourd’hui pour vous chauffer avec le coût estimé d’une **thermopompe climat froid très haute efficacité**.\nJ’ai besoin de quelques chiffres de vos factures. Le rapport PDF est débloqué avec un **code envoyé à votre courriel ou à votre téléphone**.",
      fromCalc: "J’ai repris votre projet du calculateur : ",
      s1: 'Votre projet', s2: 'Votre consommation actuelle', s3: 'Vos coordonnées', s4: 'Code de vérification',
      chauffage: 'Chauffage actuel', chOpts: [['mazout', 'Mazout'], ['plinthes', 'Plinthes électriques'], ['fournaise_elec', 'Fournaise électrique'], ['chaudiere_elec', 'Chaudière électrique'], ['gaz', 'Gaz naturel'], ['autre', 'Autre / je ne sais pas']],
      propriete: 'Type de propriété', prOpts: [['unifamiliale', 'Maison unifamiliale'], ['jumele', 'Jumelé / rangée'], ['condo', 'Condo'], ['plex', 'Duplex / triplex']],
      typeTp: 'Thermopompe souhaitée', tpOpts: [['centrale', 'Centrale (avec conduits)'], ['multizone', 'Murale multizone'], ['murale', 'Murale simple'], ['conseiller', 'Me conseiller']],
      superficie: 'Superficie à chauffer', suOpts: [['12000', 'Moins de 1 000 pi²'], ['18000', '1 000 à 1 500 pi²'], ['24000', '1 500 à 2 000 pi²'], ['30000', '2 000 à 2 500 pi²'], ['36000', 'Plus de 2 500 pi²']],
      codePostal: 'Code postal', choose: '— Choisir —',
      hydroD: 'Facture Hydro-Québec des 12 derniers mois ($)', hydroK: 'Consommation des 12 derniers mois (kWh, facultatif)',
      hydroHelp: 'Ces chiffres sont sur votre facture ou dans votre Espace client Hydro-Québec.',
      mazoutL: 'Mazout utilisé par année (litres)', mazoutD: 'Montant payé pour le mazout par année ($)', mazoutHelp: 'Indiquez l’un ou l’autre, ou les deux.',
      unknown: 'Je n’ai pas ces chiffres : utiliser des moyennes québécoises',
      prenom: 'Prénom', nom: 'Nom', email: 'Courriel', tel: 'Téléphone', channel: 'Recevoir le code par', chEmail: 'Courriel', chSms: 'Texto (SMS)',
      consent: 'J’accepte que Comfortium utilise ces renseignements pour préparer mon étude et me contacter au sujet de mon projet.',
      next: 'Continuer →', back: '← Retour', send: 'Recevoir mon code', verify: 'Débloquer mon rapport', resend: 'Renvoyer le code',
      codeLbl: 'Code à 6 chiffres', codeSent: function (dest) { return 'Code envoyé à ' + dest + '. Il expire dans 10 minutes.'; },
      sending: 'Envoi en cours…', checking: 'Vérification…',
      errProjet: 'Complétez tous les champs du projet (code postal au format H7V 2P6).',
      errConso: 'Indiquez au moins votre facture Hydro-Québec ou votre consommation de mazout, ou cochez « Je n’ai pas ces chiffres ».',
      errName: 'Indiquez votre prénom et votre nom.', errEmail: 'Adresse courriel invalide.', errTel: 'Numéro de téléphone invalide (10 chiffres).', errConsent: 'Cochez la case de consentement pour continuer.',
      errCode: 'Entrez le code à 6 chiffres reçu.', errService: 'La vérification est indisponible pour le moment. Appelez-nous au (514) 444-7483.',
      done: 'Contact vérifié ✅ Voici votre étude :',
      curCost: 'Chauffage actuel', newCost: 'Avec une thermopompe', saving: 'Économies estimées', invest: 'Investissement estimé', lv: 'LogisVert', net: 'Investissement net', payback: 'Retour sur investissement', perYear: ' / an',
      notComputed: 'Pour un chauffage au gaz ou un autre système, les économies sont évaluées lors de la visite.',
      download: '📄 Télécharger mon rapport PDF', downloaded: '✓ Rapport téléchargé', pdfError: 'Le rapport n’a pas pu être généré. Réessayez ou appelez-nous au (514) 444-7483.',
      after: "Un conseiller Comfortium vous contacte en 24 à 48 h pour planifier la visite. Une fois le contrat signé, nous nous occupons de vos demandes de subvention.",
      hint: '✏️ Complétez l’étude ci-dessus', yes: 'données de vos factures', avg: 'moyennes québécoises'
    },
    en: {
      intro: "Happy to help. The **energy use study** compares what you pay today to heat your home with the estimated cost of a **very high efficiency cold-climate heat pump**.\nI need a few figures from your bills. The PDF report is unlocked with a **code sent to your email or phone**.",
      fromCalc: 'I picked up your project from the calculator: ',
      s1: 'Your project', s2: 'Your current energy use', s3: 'Your contact details', s4: 'Verification code',
      chauffage: 'Current heating', chOpts: [['mazout', 'Heating oil'], ['plinthes', 'Electric baseboards'], ['fournaise_elec', 'Electric furnace'], ['chaudiere_elec', 'Electric boiler'], ['gaz', 'Natural gas'], ['autre', 'Other / not sure']],
      propriete: 'Property type', prOpts: [['unifamiliale', 'Single-family home'], ['jumele', 'Semi-detached / row'], ['condo', 'Condo'], ['plex', 'Duplex / triplex']],
      typeTp: 'Heat pump wanted', tpOpts: [['centrale', 'Central (ducted)'], ['multizone', 'Multi-zone wall-mounted'], ['murale', 'Single wall-mounted'], ['conseiller', 'Advise me']],
      superficie: 'Area to heat', suOpts: [['12000', 'Under 1,000 sq. ft.'], ['18000', '1,000 to 1,500 sq. ft.'], ['24000', '1,500 to 2,000 sq. ft.'], ['30000', '2,000 to 2,500 sq. ft.'], ['36000', 'Over 2,500 sq. ft.']],
      codePostal: 'Postal code', choose: '— Select —',
      hydroD: 'Hydro-Québec bill, last 12 months ($)', hydroK: 'Use over the last 12 months (kWh, optional)',
      hydroHelp: 'These figures are on your bill or in your Hydro-Québec Customer Space.',
      mazoutL: 'Heating oil used per year (litres)', mazoutD: 'Amount paid for oil per year ($)', mazoutHelp: 'Enter either one, or both.',
      unknown: 'I don’t have these figures: use Québec averages',
      prenom: 'First name', nom: 'Last name', email: 'Email', tel: 'Phone', channel: 'Receive the code by', chEmail: 'Email', chSms: 'Text (SMS)',
      consent: 'I agree that Comfortium may use this information to prepare my study and contact me about my project.',
      next: 'Continue →', back: '← Back', send: 'Get my code', verify: 'Unlock my report', resend: 'Resend the code',
      codeLbl: '6-digit code', codeSent: function (dest) { return 'Code sent to ' + dest + '. It expires in 10 minutes.'; },
      sending: 'Sending…', checking: 'Checking…',
      errProjet: 'Complete all project fields (postal code like H7V 2P6).',
      errConso: 'Enter at least your Hydro-Québec bill or your oil use, or tick “I don’t have these figures”.',
      errName: 'Please enter your first and last name.', errEmail: 'Invalid email address.', errTel: 'Invalid phone number (10 digits).', errConsent: 'Please tick the consent box to continue.',
      errCode: 'Enter the 6-digit code you received.', errService: 'Verification is unavailable right now. Call us at (514) 444-7483.',
      done: 'Contact verified ✅ Here is your study:',
      curCost: 'Current heating', newCost: 'With a heat pump', saving: 'Estimated savings', invest: 'Estimated investment', lv: 'LogisVert', net: 'Net investment', payback: 'Payback', perYear: ' / yr',
      notComputed: 'For gas or another system, savings are assessed during the visit.',
      download: '📄 Download my PDF report', downloaded: '✓ Report downloaded', pdfError: 'The report could not be generated. Try again or call us at (514) 444-7483.',
      after: 'A Comfortium advisor will contact you within 24 to 48 hours to schedule the visit. Once the contract is signed, we handle your rebate applications.',
      hint: '✏️ Complete the study above', yes: 'figures from your bills', avg: 'Québec averages'
    }
  };
  function L() { try { return (typeof lang !== 'undefined' && lang === 'en') ? 'en' : 'fr'; } catch (e) { return 'fr'; } }
  function tx() { return T[L()]; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '')); return isFinite(n) && n > 0 ? n : 0; }
  function arrondir(n, pas) { pas = pas || 50; return Math.round(n / pas) * pas; }
  function money(n) { return new Intl.NumberFormat(L() === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n); }
  function plage(a, b) { return a === b ? money(a) : money(a) + (L() === 'en' ? ' to ' : ' à ') + money(b); }
  function ans(a, b) {
    var r = function (x) { return Math.max(0.5, Math.round(x * 2) / 2).toLocaleString(L() === 'en' ? 'en-CA' : 'fr-CA'); };
    var u = L() === 'en' ? ' years' : ' ans', ab = L() === 'en' ? 'about ' : 'environ ';
    return a === b ? ab + r(a) + u : ab + r(a) + (L() === 'en' ? ' to ' : ' à ') + r(b) + u;
  }
  function labelOf(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === String(v)) return list[i][1]; return v || '—'; }

  // ── Calcul déterministe ───────────────────────────────────────────
  var catalogue = null;
  function loadCatalogue() {
    if (catalogue) return Promise.resolve(catalogue);
    return fetch(CATALOGUE_URL).then(function (r) { if (!r.ok) throw Error('catalogue'); return r.json(); })
      .then(function (d) { catalogue = d; return d; }).catch(function () { catalogue = []; return catalogue; });
  }
  function btuOf(v) { return parseInt(String(v).replace(/\D/g, ''), 10) || 0; }
  function fourchetteLV(btu) {
    var v = (catalogue || []).filter(function (r) { return btuOf(r.btu) === btu; }).map(function (r) { return r.base; }).sort(function (a, b) { return a - b; });
    if (v.length < 10) return null;
    return { min: v[Math.floor(v.length * 0.1)], max: v[Math.floor(v.length * 0.9)] };
  }
  function cout(type, btu, amperage, chauffage) {
    var c = HYP.coutBase[type] || HYP.coutBase.conseiller;
    if ((type === 'multizone' || type === 'centrale') && btu > 24000) c += HYP.supplementGrosseCapacite;
    if (chauffage === 'mazout') c += HYP.supplementMazout;
    if (!amperage || amperage === '100' || amperage === 'unknown') c += HYP.supplementElectrique;
    return [arrondir(c * (1 - HYP.ecartCout), 100), arrondir(c * (1 + HYP.ecartCout), 100)];
  }

  function calculer(p, c) {
    var type = p.type_tp || 'conseiller', cov = HYP.couverture[type] || HYP.couverture.conseiller;
    var cop = HYP.copSaisonnier, out = { sources: {} };
    // Prix de l'électricité : réel si la facture et les kWh sont donnés.
    var pe = HYP.electricitePrix.slice();
    if (c.hydroD && c.hydroK) {
      var reel = c.hydroD / c.hydroK;
      if (reel >= 0.05 && reel <= 0.25) { pe = [reel, reel]; out.sources.prixElec = 'facture'; }
    }
    out.prixElec = pe;
    var eff = [cov[0] / cop[0] + (1 - cov[0]), cov[1] / cop[1] + (1 - cov[1])]; // part d'électricité restante : pire, meilleur cas
    var mm = function (arr) { return [Math.min.apply(null, arr), Math.max.apply(null, arr)]; };
    if (p.chauffage === 'mazout') {
      var pm = HYP.mazoutPrix, paires;
      if (c.mazoutL && c.mazoutD) { paires = [[c.mazoutL, c.mazoutD]]; out.sources.mazout = 'facture'; out.prixMazout = [c.mazoutD / c.mazoutL, c.mazoutD / c.mazoutL]; }
      else if (c.mazoutL) { paires = [[c.mazoutL, c.mazoutL * pm[0]], [c.mazoutL, c.mazoutL * pm[1]]]; out.sources.mazout = 'litres'; }
      else if (c.mazoutD) { paires = [[c.mazoutD / pm[1], c.mazoutD], [c.mazoutD / pm[0], c.mazoutD]]; out.sources.mazout = 'montant'; }
      else { var lm = HYP.consoMazoutL[p.conso] || HYP.consoMazoutL.unknown; paires = [[lm[0], lm[0] * pm[0]], [lm[0], lm[0] * pm[1]], [lm[1], lm[1] * pm[0]], [lm[1], lm[1] * pm[1]]]; out.sources.mazout = 'moyenne'; }
      var k = HYP.kwhParLitreMazout * HYP.rendementFournaiseMazout;
      // Après la conversion, le système au mazout est retiré : la thermopompe couvre une part de la chaleur,
      // l'appoint électrique le reste.
      var act = [], apr = [], eco = [];
      paires.forEach(function (q) { eff.forEach(function (e) { pe.forEach(function (x) { var n = q[0] * k * e * x; act.push(q[1]); apr.push(n); eco.push(q[1] - n); }); }); });
      out.litres = mm(paires.map(function (q) { return q[0]; }));
      out.actuel = mm(act).map(function (v) { return arrondir(v); });
      out.apres = mm(apr).map(function (v) { return arrondir(v); });
      out.eco = mm(eco).map(function (v) { return arrondir(Math.max(0, v)); });
    } else if (ELEC.indexOf(p.chauffage) >= 0) {
      var part = HYP.partChauffageFacture, C;
      if (c.hydroD) { C = [c.hydroD * part[0], c.hydroD * part[1]]; out.sources.hydro = c.hydroK ? 'facture' : 'montant'; }
      else if (c.hydroK) { C = [c.hydroK * part[0] * pe[0], c.hydroK * part[1] * pe[1]]; out.sources.hydro = 'kwh'; }
      else { var fh = HYP.factureHydro[p.conso] || HYP.factureHydro.unknown; C = [fh[0] * part[0], fh[1] * part[1]]; out.sources.hydro = 'moyenne'; }
      var e2 = [], a2 = [];
      C.forEach(function (cc) { [[cov[0], cop[0]], [cov[1], cop[1]]].forEach(function (z) { var g = cc * z[0] * (1 - 1 / z[1]); e2.push(g); a2.push(cc - g); }); });
      out.actuel = C.map(function (v) { return arrondir(v); });
      out.apres = mm(a2).map(function (v) { return arrondir(v); });
      out.eco = mm(e2).map(function (v) { return arrondir(v); });
      out.kwhChauffage = [arrondir(C[0] / pe[1], 100), arrondir(C[1] / pe[0], 100)];
    } else {
      out.eco = null;
    }
    // Investissement et subventions.
    var btu = p.model ? btuOf(p.model.btu) : (parseInt(p.btu, 10) || 24000);
    out.btu = btu;
    out.cout = cout(type, btu, p.amperage, p.chauffage);
    if (p.model && p.model.base) out.lv = { min: p.model.base, max: p.model.base, exact: true };
    else if (p.lv) out.lv = { min: p.lv.min, max: p.lv.max, exact: p.lv.min === p.lv.max };
    else out.lv = fourchetteLV(btu);
    out.net = out.lv ? [arrondir(Math.max(0, out.cout[0] - out.lv.max), 100), arrondir(Math.max(0, out.cout[1] - out.lv.min), 100)] : out.cout.slice();
    out.retour = out.eco && out.eco[0] > 0 ? [out.net[0] / out.eco[1], out.net[1] / out.eco[0]] : null;
    out.quinze = out.eco ? [out.eco[0] * 15, out.eco[1] * 15] : null;
    var cp = String(p.codePostal || '').toUpperCase().replace(/\s/g, '');
    out.laval = p.chauffage === 'mazout' && cp.indexOf('H7') === 0 ? (HYP.lavalMazout[p.propriete] || 1400) : 0;
    return out;
  }

  // ── État du parcours ──────────────────────────────────────────────
  var S = null; // { step, projet, conso, contact, verified, result, fromCalc }
  function readCtx() {
    try { var raw = sessionStorage.getItem(CTX_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function start(ctx) {
    ctx = ctx || readCtx();
    S = { step: ctx ? 2 : 1, projet: ctx ? ctx : { chauffage: '', propriete: '', type_tp: '', btu: '', codePostal: '' }, conso: {}, contact: { channel: 'email' }, verified: false, result: null, fromCalc: !!ctx, err: '', msg: '' };
    loadCatalogue();
    var tl = tx();
    var lines = tl.intro;
    if (ctx) {
      var p = ctx, d = T[L()];
      lines += '\n\n' + d.fromCalc + '**' + [labelOf(d.chOpts, p.chauffage), labelOf(d.tpOpts, p.type_tp), p.model ? p.model.brand + ' ' + p.model.out : null].filter(Boolean).join(' · ') + '**.';
    }
    if (typeof addBot === 'function') addBot(lines, null, null, 450);
    setTimeout(function () { refresh(); }, 520);
    try { if (typeof gtag === 'function') gtag('event', 'calor_etude_start', { from_calculator: !!ctx }); } catch (e) {}
  }
  function refresh() { if (typeof renderChat === 'function') { renderChat(); } if (typeof scrollChat === 'function') scrollChat(); }
  function active() { return !!(S && !S.closed); }
  function stop() { if (S) S.closed = true; refresh(); }
  // Après le résultat : fige l'étude en message (pour continuer la conversation sans perdre le résumé).
  function freeze() {
    if (!S || S.closed || S.step !== 5 || !S.result) return;
    var tl = tx(), r = S.result, lines = [tl.done];
    if (r.eco) lines.push(tl.curCost + ' : ' + plage(r.actuel[0], r.actuel[1]) + tl.perYear, tl.saving + ' : **' + plage(r.eco[0], r.eco[1]) + tl.perYear + '**');
    lines.push(tl.net + ' : ' + plage(r.net[0], r.net[1]));
    if (r.retour) lines.push(tl.payback + ' : ' + ans(r.retour[0], r.retour[1]));
    S.closed = true;
    try { chatMsgs.push({ id: 'e' + Date.now(), from: 'bot', type: 'text', text: lines.join('\n'), replies: [{ l: tl.download, v: 'etude_pdf' }] }); } catch (e) {}
  }

  // ── Rendu du panneau ──────────────────────────────────────────────
  function sel(id, label, opts, val) {
    var tl = tx();
    return '<label class="chat-form-lbl" for="' + id + '">' + esc(label) + '</label><select class="chat-input" id="' + id + '"><option value="">' + esc(tl.choose) + '</option>' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(val) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function inp(id, label, type, val, extra) {
    return '<label class="chat-form-lbl" for="' + id + '">' + esc(label) + '</label><input class="chat-input" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '"' + (extra || '') + '/>';
  }
  function panel() {
    if (!active()) return null;
    var tl = tx(), p = S.projet, c = S.conso, k = S.contact, h = '';
    var wrap = document.createElement('div'); wrap.className = 'chat-msg bot';
    if (S.step === 1) {
      h += '<p class="chat-form-title">1/4 · ' + esc(tl.s1) + '</p>' + sel('et_ch', tl.chauffage, tl.chOpts, p.chauffage) + sel('et_pr', tl.propriete, tl.prOpts, p.propriete) +
        sel('et_tp', tl.typeTp, tl.tpOpts, p.type_tp) + sel('et_su', tl.superficie, tl.suOpts, p.btu) + inp('et_cp', tl.codePostal, 'text', p.codePostal, ' maxlength="7" autocomplete="postal-code" placeholder="H7V 2P6"');
      h += btns([['next', tl.next]]);
    } else if (S.step === 2) {
      var maz = p.chauffage === 'mazout';
      h += '<p class="chat-form-title">2/4 · ' + esc(tl.s2) + '</p>' + inp('et_hd', tl.hydroD, 'text', c.hydroD, ' inputmode="decimal" placeholder="2 400"') + inp('et_hk', tl.hydroK, 'text', c.hydroK, ' inputmode="numeric" placeholder="24 000"') +
        '<p class="et-help">' + esc(tl.hydroHelp) + '</p>';
      if (maz) h += inp('et_ml', tl.mazoutL, 'text', c.mazoutL, ' inputmode="numeric" placeholder="2 000"') + inp('et_md', tl.mazoutD, 'text', c.mazoutD, ' inputmode="decimal" placeholder="4 200"') + '<p class="et-help">' + esc(tl.mazoutHelp) + '</p>';
      h += '<label class="et-check"><input type="checkbox" id="et_unk"' + (c.unknown ? ' checked' : '') + '/><span>' + esc(tl.unknown) + '</span></label>';
      h += btns(S.fromCalc ? [['next', tl.next]] : [['back', tl.back], ['next', tl.next]]);
    } else if (S.step === 3) {
      h += '<p class="chat-form-title">3/4 · ' + esc(tl.s3) + '</p><div class="chat-form-row"><div>' + inp('et_pn', tl.prenom, 'text', k.prenom, ' autocomplete="given-name"') + '</div><div>' + inp('et_nm', tl.nom, 'text', k.nom, ' autocomplete="family-name"') + '</div></div>' +
        inp('et_em', tl.email, 'email', k.email, ' autocomplete="email" placeholder="votre@courriel.com"') + inp('et_tl', tl.tel, 'tel', k.tel, ' autocomplete="tel" placeholder="(514) 555-1234"') +
        '<p class="chat-form-lbl" style="margin-top:8px">' + esc(tl.channel) + '</p><div class="et-radios"><label><input type="radio" name="et_chn" value="email"' + (k.channel !== 'sms' ? ' checked' : '') + '/> ' + esc(tl.chEmail) + '</label><label><input type="radio" name="et_chn" value="sms"' + (k.channel === 'sms' ? ' checked' : '') + '/> ' + esc(tl.chSms) + '</label></div>' +
        '<label class="et-check"><input type="checkbox" id="et_cs"' + (k.consent ? ' checked' : '') + '/><span>' + esc(tl.consent) + '</span></label>' +
        '<input type="text" id="et_hp" style="display:none!important;position:absolute;left:-9999px" tabindex="-1" autocomplete="off"/>';
      h += btns([['back', tl.back], ['send', tl.send]]);
    } else if (S.step === 4) {
      h += '<p class="chat-form-title">4/4 · ' + esc(tl.s4) + '</p>' + (S.msg ? '<p class="et-help">' + esc(S.msg) + '</p>' : '') +
        inp('et_cd', tl.codeLbl, 'text', '', ' inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"');
      h += btns([['verify', tl.verify]]) + '<div class="et-links"><button type="button" class="et-link" data-et="resend">' + esc(tl.resend) + '</button> · <button type="button" class="et-link" data-et="back">' + esc(tl.back) + '</button></div>';
    } else if (S.step === 5 && S.result) {
      h += resultHtml();
    }
    if (S.err) h += '<p class="et-err" role="alert">' + esc(S.err) + '</p>';
    wrap.innerHTML = '<div class="chat-lead-form et-panel">' + h + '</div>';
    wrap.addEventListener('click', onClick);
    return wrap;
  }
  function btns(list) {
    return '<div class="et-actions">' + list.map(function (b) { return '<button type="button" class="' + (b[0] === 'back' ? 'et-btn-ghost' : 'chat-submit-btn') + '" data-et="' + b[0] + '">' + esc(b[1]) + '</button>'; }).join('') + '</div>';
  }
  function resultHtml() {
    var tl = tx(), r = S.result, h = '<p class="chat-form-title">' + esc(tl.done) + '</p><div class="et-rows">';
    var row = function (k, v, strong) { return '<div class="et-row' + (strong ? ' et-strong' : '') + '"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; };
    if (r.eco) {
      h += row(tl.curCost, plage(r.actuel[0], r.actuel[1]) + tl.perYear) + row(tl.newCost, plage(r.apres[0], r.apres[1]) + tl.perYear) + row(tl.saving, plage(r.eco[0], r.eco[1]) + tl.perYear, true);
    }
    h += row(tl.invest, plage(r.cout[0], r.cout[1]));
    if (r.lv) h += row(tl.lv + (r.lv.exact ? '' : (L() === 'en' ? ' (range)' : ' (fourchette)')), '− ' + plage(r.lv.min, r.lv.max));
    h += row(tl.net, plage(r.net[0], r.net[1]), true);
    if (r.retour) h += row(tl.payback, ans(r.retour[0], r.retour[1]));
    h += '</div>';
    if (!r.eco) h += '<p class="et-help">' + esc(tl.notComputed) + '</p>';
    h += '<button type="button" class="chat-submit-btn" data-et="pdf" id="et_pdf">' + esc(S.pdfDone ? tl.downloaded : tl.download) + '</button>';
    h += '<p class="et-help">' + esc(tl.after) + '</p>';
    h += '<div class="et-links"><button type="button" class="et-link" data-et="menu">' + esc(L() === 'en' ? '↩ Back to menu' : '↩ Retour au menu') + '</button></div>';
    return h;
  }

  // ── Actions ───────────────────────────────────────────────────────
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function checked(id) { var el = document.getElementById(id); return !!(el && el.checked); }
  function save() {
    if (S.step === 1) { S.projet.chauffage = val('et_ch'); S.projet.propriete = val('et_pr'); S.projet.type_tp = val('et_tp'); S.projet.btu = val('et_su'); S.projet.codePostal = val('et_cp').toUpperCase(); }
    if (S.step === 2) { S.conso = { hydroD: num(val('et_hd')), hydroK: num(val('et_hk')), mazoutL: num(val('et_ml')), mazoutD: num(val('et_md')), unknown: checked('et_unk') }; }
    if (S.step === 3) { S.contact.prenom = val('et_pn'); S.contact.nom = val('et_nm'); S.contact.email = val('et_em'); S.contact.tel = val('et_tl'); S.contact.consent = checked('et_cs'); var r = document.querySelector('input[name="et_chn"]:checked'); S.contact.channel = r ? r.value : 'email'; }
  }
  function onClick(e) {
    var b = e.target.closest('[data-et]'); if (!b) return;
    var a = b.getAttribute('data-et'), tl = tx();
    save(); S.err = '';
    if (a === 'back') { S.step = S.step === 4 ? 3 : Math.max(S.fromCalc ? 2 : 1, S.step - 1); return refresh(); }
    if (a === 'next' && S.step === 1) {
      var p = S.projet;
      if (!p.chauffage || !p.propriete || !p.type_tp || !p.btu || !/^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(p.codePostal)) { S.err = tl.errProjet; return refresh(); }
      S.step = 2; return refresh();
    }
    if (a === 'next' && S.step === 2) {
      var c = S.conso, maz = S.projet.chauffage === 'mazout';
      var ok = c.unknown || (maz ? (c.mazoutL || c.mazoutD) : c.hydroD || c.hydroK) || (!maz && ELEC.indexOf(S.projet.chauffage) < 0);
      if (!ok) { S.err = tl.errConso; return refresh(); }
      S.step = 3; return refresh();
    }
    if (a === 'send' || a === 'resend') return sendCode(a === 'resend');
    if (a === 'verify') return verifyCode();
    if (a === 'pdf') return makePdf();
    if (a === 'menu') { freeze(); if (typeof addBot === 'function' && typeof CHAT_T !== 'undefined') addBot(CHAT_T[L()].menuAgain, CHAT_T[L()].menu, null, 300); return; }
  }
  function phoneDigits(t) { return String(t || '').replace(/\D/g, ''); }
  function sendCode(isResend) {
    var tl = tx(), k = S.contact;
    if (!isResend) {
      if (val('et_hp')) return;
      if (!k.prenom || !k.nom) { S.err = tl.errName; return refresh(); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(k.email || '')) { S.err = tl.errEmail; return refresh(); }
      var d = phoneDigits(k.tel); if (!(d.length === 10 || (d.length === 11 && d[0] === '1'))) { S.err = tl.errTel; return refresh(); }
      if (!k.consent) { S.err = tl.errConsent; return refresh(); }
    }
    S.msg = tl.sending; S.step = 4; refresh();
    fetch('/.netlify/functions/verification-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: k.email, phone: k.tel, channel: k.channel }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) {
        if (!x.ok) throw Error(x.b && x.b.error || 'service');
        S.msg = tl.codeSent(k.channel === 'sms' ? k.tel : k.email); S.err = ''; refresh();
        try { if (typeof gtag === 'function') gtag('event', 'calor_etude_code_sent', { channel: k.channel }); } catch (e) {}
      })
      .catch(function (e) { S.msg = ''; S.err = (e && e.message && e.message !== 'service' && e.message !== 'Failed to fetch') ? e.message : tl.errService; refresh(); });
  }
  function verifyCode() {
    var tl = tx(), k = S.contact, code = val('et_cd');
    if (!/^\d{6}$/.test(code)) { S.err = tl.errCode; return refresh(); }
    S.msg = tl.checking; refresh();
    fetch('/.netlify/functions/verification-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: k.email, phone: k.tel, channel: k.channel, code: code }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) {
        if (!x.ok || !x.b || !x.b.verified) throw Error(x.b && x.b.error || 'service');
        S.verified = true; S.msg = '';
        return loadCatalogue().then(function () {
          S.result = calculer(S.projet, S.conso.unknown ? {} : S.conso);
          S.step = 5; refresh(); pushLead();
          try { if (typeof gtag === 'function') gtag('event', 'generate_lead', { currency: 'CAD', value: 1, method: 'calor_etude' }); } catch (e) {}
        });
      })
      .catch(function (e) { S.msg = ''; S.err = (e && e.message && e.message !== 'service' && e.message !== 'Failed to fetch') ? e.message : tl.errService; refresh(); });
  }

  function resume() {
    var r = S.result, p = S.projet, c = S.conso, m = p.model;
    return ['Étude de consommation CALOR — contact vérifié (' + S.contact.channel + ')',
      'Chauffage : ' + labelOf(T.fr.chOpts, p.chauffage), 'Système : ' + labelOf(T.fr.tpOpts, p.type_tp),
      m ? 'Modèle : ' + m.brand + ' ' + m.out + (m.inside ? ' / ' + m.inside : '') + ' (AHRI ' + (m.ahri || '—') + ')' : 'Modèle : non choisi',
      c.unknown ? 'Consommation : moyennes' : 'Hydro : ' + (c.hydroD ? c.hydroD + ' $' : '—') + (c.hydroK ? ' / ' + c.hydroK + ' kWh' : '') + (p.chauffage === 'mazout' ? ' · Mazout : ' + (c.mazoutL ? c.mazoutL + ' L' : '—') + (c.mazoutD ? ' / ' + c.mazoutD + ' $' : '') : ''),
      r.eco ? 'Économies/an : ' + fr(r.eco) : 'Économies : à évaluer',
      'Investissement : ' + fr(r.cout), r.lv ? 'LogisVert : ' + fr([r.lv.min, r.lv.max]) : '', 'Net : ' + fr(r.net),
      r.laval ? 'Laval mazout : jusqu’à ' + r.laval + ' $ (non inclus)' : '',
      p.horizon ? 'Échéancier : ' + p.horizon : ''
    ].filter(Boolean).join(' · ');
  }
  function fr(a) { return a[0] === a[1] ? Math.round(a[0]) + ' $' : Math.round(a[0]) + ' à ' + Math.round(a[1]) + ' $'; }
  function pushLead() {
    var p = S.projet, k = S.contact;
    var systeme = { mazout: 'oil', plinthes: 'electric', fournaise_elec: 'electric', chaudiere_elec: 'electric', gaz: 'gas', autre: 'other' };
    var propriete = { unifamiliale: 'house', jumele: 'house', condo: 'condo', plex: 'duplex' };
    var projet = { murale: 'wall', multizone: 'wall', centrale: 'central' };
    var d = phoneDigits(k.tel); d = d.length === 11 ? d.slice(1) : d;
    var t = {}; try { t = typeof getTrackingData === 'function' ? getTrackingData() : {}; } catch (e) {}
    var payload = {
      firstname: k.prenom, lastname: k.nom, email: k.email, phone: '+1' + d,
      city: String(p.codePostal || '').toUpperCase().indexOf('H7') === 0 ? 'Laval' : '',
      hs_lead_status: 'NEW', lead_source_utm: (t.utm_source || 'organic') + '|' + (t.utm_medium || 'direct') + '|' + (S.fromCalc ? 'calculateur' : (t.utm_campaign || 'calor')),
      conversion_stage: 'estimate_completed', contact_method_preference: 'phone',
      hvac_system_type: systeme[p.chauffage] || '', property_type: propriete[p.propriete] || '', request_type: projet[p.type_tp] || '',
      subsidy_eligible: p.chauffage === 'mazout' ? 'true' : 'false',
      notes_hvac: 'Code postal : ' + String(p.codePostal || '').toUpperCase() + ' · ' + resume()
    };
    fetch('/.netlify/functions/hubspot-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .catch(function (e) { console.error('HubSpot', e); });
  }

  // ── Rapport PDF ───────────────────────────────────────────────────
  function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = JSPDF_URL; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  }
  function makePdf() {
    var tl = tx();
    if (!S.verified || !S.result) return;
    loadJsPdf().then(function () { buildPdf(); S.pdfDone = true; refresh(); try { if (typeof gtag === 'function') gtag('event', 'pdf_generated', { event_category: 'calor_etude' }); } catch (e) {} })
      .catch(function (e) { console.error(e); S.err = tl.pdfError; refresh(); });
  }
  function buildPdf() {
    var jsPDF = window.jspdf.jsPDF, doc = new jsPDF({ unit: 'mm', format: 'letter' });
    var r = S.result, p = S.projet, c = S.conso, k = S.contact, m = p.model, d = T.fr;
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16, CW = W - 2 * M;
    var VERT = [38, 62, 54], OR = [170, 146, 115], ENCRE = [32, 37, 34], GRIS = [103, 107, 99];
    var today = new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    var M$ = function (n) { return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n); };
    var P$ = function (a, b) { return a === b ? M$(a) : M$(a) + ' à ' + M$(b); };
    var N = function (n) { return Math.round(n).toLocaleString('fr-CA'); };
    var A = function (a, b) { var f = function (x) { return Math.max(0.5, Math.round(x * 2) / 2).toLocaleString('fr-CA'); }; return a === b ? 'environ ' + f(a) + ' ans' : 'environ ' + f(a) + ' à ' + f(b) + ' ans'; };
    var y = 0;
    function entete(titre) {
      doc.setFillColor.apply(doc, VERT); doc.rect(0, 0, W, 30, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('COMFORTIUM', M, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(227, 197, 143); doc.text('CHAUFFAGE · CLIMATISATION · CONFORT', M, 20);
      doc.setTextColor(255, 255, 255); doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text(titre, W - M, 14, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(today, W - M, 20, { align: 'right' });
      y = 40;
    }
    function pied() {
      doc.setDrawColor.apply(doc, OR); doc.setLineWidth(0.3); doc.line(M, H - 16, W - M, H - 16);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, GRIS);
      doc.text('Comfortium · 169, rue Louise, Longueuil (Québec) J4J 2T2 · (514) 444-7483 · info@comfortium.ca', M, H - 11);
      doc.text('Installateur SPC · Licence RBQ 2638-8587', W - M, H - 11, { align: 'right' });
    }
    function place(h) { if (y + h > H - 22) { pied(); doc.addPage(); entete('Étude de consommation (suite)'); } }
    function titre(t) { place(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor.apply(doc, VERT); doc.text(t, M, y); y += 2; doc.setDrawColor.apply(doc, OR); doc.setLineWidth(0.5); doc.line(M, y, M + 22, y); y += 6; }
    function para(t, taille, couleur, gras) {
      taille = taille || 9.5; doc.setFont('helvetica', gras ? 'bold' : 'normal'); doc.setFontSize(taille); doc.setTextColor.apply(doc, couleur || ENCRE);
      var lignes = doc.splitTextToSize(t, CW); place(lignes.length * taille * 0.45 + 2); doc.text(lignes, M, y); y += lignes.length * taille * 0.45 + 2.5;
    }
    function info(kk, v) { place(6); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, GRIS); doc.text(kk, M, y); doc.setTextColor.apply(doc, ENCRE); doc.setFont('helvetica', 'bold'); var l = doc.splitTextToSize(String(v || '—'), CW - 58); doc.text(l, M + 58, y); y += 5.5 * l.length; }
    function chiffre(kk, v, note, fort) {
      place(15); doc.setFillColor(fort ? 38 : 245, fort ? 62 : 242, fort ? 54 : 234); doc.roundedRect(M, y - 4.5, CW, 12.5, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor.apply(doc, fort ? [255, 255, 255] : ENCRE); doc.text(kk, M + 4, y + 1);
      if (note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor.apply(doc, fort ? [227, 197, 143] : GRIS); doc.text(note, M + 4, y + 5.3); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor.apply(doc, fort ? [255, 255, 255] : VERT); doc.text(v, W - M - 4, y + 2.5, { align: 'right' }); y += 15;
    }
    function etapes(liste) {
      liste.forEach(function (t, i) {
        doc.setFontSize(9.5); var l = doc.splitTextToSize(t, CW - 10); place(l.length * 4.3 + 2.5);
        doc.setFillColor.apply(doc, VERT); doc.circle(M + 2.6, y - 1.2, 2.6, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255); doc.text(String(i + 1), M + 2.6, y, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor.apply(doc, ENCRE); doc.text(l, M + 9, y); y += l.length * 4.3 + 2.5;
      });
    }
    var maz = p.chauffage === 'mazout', src = c.unknown ? 'moyennes québécoises' : 'données fournies';

    // Page 1
    entete('Étude de consommation énergétique');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor.apply(doc, ENCRE); doc.text(k.prenom + ' ' + k.nom, M, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, GRIS);
    doc.text(k.email + ' · ' + k.tel + ' · ' + String(p.codePostal || '').toUpperCase() + ' · coordonnées vérifiées', M, y); y += 10;
    titre('Votre projet');
    info('Chauffage actuel', labelOf(d.chOpts, p.chauffage));
    info('Type de propriété', labelOf(d.prOpts, p.propriete));
    info('Système envisagé', labelOf(d.tpOpts, p.type_tp));
    if (m) { info('Modèle choisi', m.brand + ' · ' + m.out + (m.inside ? ' / ' + m.inside : '')); info('Références', 'AHRI ' + (m.ahri || '—') + ' · ENERGY STAR ' + (m.energy || '—')); }
    else info('Puissance estimée', 'environ ' + N(r.btu) + ' BTU (modèle à déterminer lors de la visite)');
    y += 2;
    titre('Votre consommation actuelle (' + src + ')');
    if (!c.unknown) {
      if (c.hydroD) info('Facture Hydro-Québec, 12 mois', M$(c.hydroD));
      if (c.hydroK) info('Consommation, 12 mois', N(c.hydroK) + ' kWh');
      if (maz && c.mazoutL) info('Mazout par année', N(c.mazoutL) + ' litres');
      if (maz && c.mazoutD) info('Mazout payé par année', M$(c.mazoutD));
    }
    if (r.sources.prixElec === 'facture') info('Prix moyen de votre électricité', (r.prixElec[0]).toFixed(3).replace('.', ',') + ' $/kWh (facture ÷ kWh)');
    if (maz && r.prixMazout && r.sources.mazout === 'facture') info('Prix moyen de votre mazout', r.prixMazout[0].toFixed(2).replace('.', ',') + ' $/L');
    if (r.kwhChauffage) info('Électricité pour le chauffage', 'environ ' + N(r.kwhChauffage[0]) + ' à ' + N(r.kwhChauffage[1]) + ' kWh par année');
    if (maz && r.litres && (r.sources.mazout === 'montant' || r.sources.mazout === 'moyenne')) info('Mazout pour le chauffage', r.litres[0] === r.litres[1] ? N(r.litres[0]) + ' litres par année' : 'environ ' + N(r.litres[0]) + ' à ' + N(r.litres[1]) + ' litres par année');
    y += 2;
    titre('Résultats estimés');
    if (r.eco) {
      chiffre('Coût actuel du chauffage', P$(r.actuel[0], r.actuel[1]) + ' / an', maz ? 'Mazout, selon vos données ou les moyennes' : 'Part chauffage de votre facture d’électricité');
      chiffre('Coût avec une thermopompe', P$(r.apres[0], r.apres[1]) + ' / an', 'Thermopompe climat froid très haute efficacité, appoint électrique compris');
      chiffre('Économies estimées', P$(r.eco[0], r.eco[1]) + ' / an', 'Sur 15 ans : ' + P$(r.quinze[0], r.quinze[1]) + ' (sans inflation)', true);
    } else {
      para('Pour un chauffage au gaz naturel ou un autre système, les économies sont évaluées lors de la visite.', 9.5, GRIS);
    }
    chiffre('Investissement estimé', P$(r.cout[0], r.cout[1]), 'Équipement, installation et travaux connexes probables');
    chiffre(r.lv && r.lv.exact ? 'Subvention LogisVert du modèle' : 'Subvention LogisVert (fourchette)', r.lv ? '- ' + P$(r.lv.min, r.lv.max) : 'À évaluer', r.lv && r.lv.exact ? '120 $ par 1 000 BTU/h à -8 °C · sous réserve d’admissibilité' : 'Selon les modèles du catalogue pour cette puissance');
    chiffre('Investissement net estimé', P$(r.net[0], r.net[1]), 'Avant les autres aides possibles (page suivante)', true);
    if (r.retour) chiffre('Retour sur investissement', A(r.retour[0], r.retour[1]), 'Investissement net divisé par les économies annuelles');
    para('Estimation approximative et non contractuelle ; le prix final est établi par soumission après la visite. Hypothèses : '
      + (r.sources.prixElec === 'facture' ? 'prix de l’électricité tiré de votre facture' : 'électricité de 0,09 à 0,11 $/kWh') + ' ; '
      + (maz ? (r.sources.mazout === 'facture' ? 'prix du mazout tiré de vos données' : 'mazout de 2,00 à 2,30 $/L') + ' ; 10,2 kWh par litre et rendement de 80 % de la fournaise actuelle ; ' : 'chauffage égal à 50 à 65 % de la facture d’électricité ; ') + (r.sources.mazout === 'moyenne' || r.sources.hydro === 'moyenne' ? 'consommation selon des moyennes québécoises, faute de données de facture ; ' : '')
      + 'rendement saisonnier de la thermopompe de 2,0 à 2,6 ; part de la chaleur couverte par la thermopompe : murale 40 à 60 %, multizone 70 à 90 %, centrale 85 à 100 %, le reste par l’appoint électrique'
      + (maz ? ' (le système au mazout est retiré)' : '') + ' ; coût d’installation à plus ou moins 20 % selon le type de système.', 7.5, GRIS);
    pied();

    // Page 2
    doc.addPage(); entete('Vos subventions, pris en charge');
    titre('Autres aides possibles (non incluses dans le calcul)');
    para('Programme fédéral de remises pour les thermopompes, annoncé le 8 octobre 2026 : selon l’annonce, jusqu’à 10 000 $ pour les ménages dont le revenu est sous la médiane et 2 000 $ pour les autres. Portail en ligne dès janvier 2027, demande approuvée en 24 h, aucune évaluation énergétique, cumulable avec LogisVert. Règles détaillées à publier.');
    if (r.laval) para('Ville de Laval, remplacement du chauffage au mazout : jusqu’à ' + M$(r.laval) + ' selon le type de bâtiment (règlement L-12494). Travaux terminés au plus tard le 31 décembre 2026, demande au plus tard le 31 janvier 2027.');
    if (m && m.multi && p.statut === 'proprietaire_immeuble') para('Bonus multilogement LogisVert : ' + M$(m.multi) + ' de plus pour ce modèle si l’immeuble répond aux critères d’Hydro-Québec (construit en 1995 ou avant, zone désignée, chauffage électrique, un compteur par logement).');
    y += 3;
    titre('Comment Comfortium prend en charge vos subventions');
    para('Une fois votre contrat signé, Comfortium s’occupe des démarches en votre nom, avec votre autorisation écrite :', 9.5, ENCRE, true);
    etapes([
      'Visite d’évaluation à domicile, sans engagement : besoins, dimensionnement, état de l’entrée électrique.',
      'Soumission détaillée : équipement admissible, travaux connexes et coordination des corps de métier.',
      'Signature du contrat et du mandat qui autorise Comfortium à préparer et déposer vos demandes.',
      'Programme fédéral : Comfortium dépose votre demande dès l’ouverture du portail, avant les travaux.',
      'Installation par l’installateur SPC, licence RBQ 2638-8587 (vérifiable au registre de la RBQ).',
      'Après l’installation : Comfortium dépose votre demande LogisVert avec les factures et les références AHRI.',
      'Suivi de vos dossiers jusqu’à la décision des programmes.'
    ]);
    y += 2;
    titre('Documents à prévoir');
    para('Preuve de propriété (compte de taxes ou acte notarié) · facture Hydro-Québec récente' + (maz ? ' · factures de mazout récentes' : '') + ' · tout document sur votre système de chauffage actuel.');
    y += 3;
    titre('Prochaine étape : planifier votre visite');
    para('Un conseiller Comfortium vous contacte en 24 à 48 h. Vous pouvez aussi nous appeler au (514) 444-7483 ou écrire à info@comfortium.ca en mentionnant cette étude.', 10.5, VERT, true);
    pied();
    doc.save('Etude-consommation-Comfortium-' + String(k.nom).replace(/[^A-Za-z0-9À-ÿ-]/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  // ── Style du panneau ──────────────────────────────────────────────
  var st = document.createElement('style');
  st.textContent = '.et-panel select.chat-input{appearance:auto;cursor:pointer}.et-help{font-size:11.5px;line-height:1.45;color:#5f6b64;margin:4px 0 6px}' +
    '.et-check{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.4;margin:10px 0 6px;color:#4b5563}.et-check input{margin-top:2px;flex-shrink:0}' +
    '.et-radios{display:flex;gap:16px;font-size:13px;margin:2px 0 4px}.et-radios label{display:flex;gap:6px;align-items:center;cursor:pointer}' +
    '.et-actions{display:flex;gap:8px;margin-top:10px}.et-actions .chat-submit-btn{flex:1;margin-top:0}' +
    '.et-btn-ghost{flex:0 0 auto;background:#fff;color:#263e36;border:1px solid #9eaea2;border-radius:10px;padding:10px 14px;font:600 13px Arial,Helvetica,sans-serif;cursor:pointer}' +
    '.et-links{text-align:center;font-size:12px;margin-top:8px;color:#7a8580}.et-link{background:none;border:0;color:#263e36;text-decoration:underline;cursor:pointer;font-size:12px;padding:2px}' +
    '.et-err{color:#b91c1c;font-size:12px;margin:8px 0 0}.et-rows{margin:6px 0 10px;border-top:1px solid #e3e0d6}' +
    '.et-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #e3e0d6;font-size:12.5px;color:#4d5a53}.et-row b{color:#1f3029;text-align:right}' +
    '.et-strong{background:#f1f6f2;margin:0 -8px;padding:8px}.et-strong b{color:#1f5133}';
  document.head.appendChild(st);

  window.calorEtude = { start: start, panel: panel, active: active, stop: stop, freeze: freeze, pdf: makePdf, blocking: function () { return !!(S && !S.closed && S.step < 5); }, hint: function () { return tx().hint; }, _calculer: calculer, _hyp: HYP };

  // Ouverture automatique depuis le calculateur (index.html?etude=1).
  function auto() {
    try {
      if (!/[?&]etude=1\b/.test(location.search)) return;
      var ctx = readCtx();
      if (typeof toggleChat !== 'function') return;
      if (!chatOpen) toggleChat();
      setTimeout(function () { start(ctx); }, 900);
      history.replaceState(null, '', location.pathname + location.hash);
    } catch (e) { console.error(e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();

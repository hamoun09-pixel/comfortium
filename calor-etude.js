/* Comfortium — étude de consommation énergétique dans CALOR (v2, questionnaire validé le 4 novembre 2026).
   Parcours guidé, une question par écran, tuiles à toucher : maison → bâtiment → système → énergie → (mazout) →
   électricité → consommation → projet → coordonnées → code → résultat et rapport PDF.
   Calcul déterministe (sans IA) : estimation centrale ±15 %, travaux connexes déduits des réponses.
   L'investissement n'est pas chiffré tant que la grille de prix privée n'est pas branchée.
   Le rapport et l'envoi du prospect à HubSpot ne sont débloqués qu'après la vérification du code. */
(function () {
  'use strict';
  // Texto (SMS) masqué tant que Twilio n'est pas configuré dans Netlify. Mettre true une fois TWILIO_* ajoutées.
  var SMS_ON = false;
  var CTX_KEY = 'comfortium_etude_ctx';
  var CATALOGUE_URL = 'catalogue-comfortium-2026-10-15.json';
  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  // ── Hypothèses (à mettre à jour) ──────────────────────────────────
  // Mazout : Régie de l'énergie, relevé hebdomadaire du mazout léger, Montréal, semaine du 2 novembre 2026 : 232,34 ¢/L avant TPS et TVQ.
  // Électricité : Hydro-Québec, tarif D au 1er avril 2026 : 11,142 ¢/kWh au-delà de 40 kWh par jour (tranche où tombe le chauffage).
  var H = {
    majour: '2 novembre 2026',
    mazout: 2.32, elec: 0.1114, kwhLitre: 10.2,
    rendMazout: { m10: 0.84, '1020': 0.80, p20: 0.72, nsp: 0.78 },
    partChauffage: 0.55, // part de la facture d'électricité consacrée au chauffage (maison chauffée à l'électricité)
    intensite: { av1960: 12, '6090': 10.5, '9010': 8.5, ap2010: 6.5, '': 10 }, // kWh de chaleur utile par pi² par an
    isol: { bonne: 0.85, moyenne: 1, faible: 1.2, inconnue: 1, '': 1 },
    sol: { centrale: { cov: 0.95, cop: 2.4 }, multizone: { cov: 0.8, cop: 2.6 }, murale: { cov: 0.45, cop: 2.8 }, airEau: { cov: 0.85, cop: 2.2 }, chaudiereElec: { cov: 1, cop: 1 }, fournaiseElec: { cov: 1, cop: 1 } },
    marge: 0.15,
    lavalMazout: { unifamiliale: 2000, jumele: 1400, condo: 1400, plex: 1400 }
  };
  var PAC = ['centrale', 'multizone', 'murale']; // solutions admissibles à LogisVert (thermopompes air-air)
  var SUP_CALC = { small: 900, medium: 1250, large: 1750, xlarge: 2250, xxlarge: 2800 };

  // ── Textes ─────────────────────────────────────────────────────────
  var T = {
    fr: {
      intro: "Avec plaisir. L’**étude de consommation** compare ce que vous payez aujourd’hui pour vous chauffer avec une solution électrique efficace, adaptée à votre maison. Elle repère aussi les **subventions** et les **travaux à prévoir**.\nComptez environ **3 minutes**. C’est gratuit et sans engagement, et votre rapport PDF est débloqué avec un code envoyé à votre courriel.",
      fromCalc: 'J’ai repris vos réponses du calculateur : il ne reste que quelques questions.',
      step: function (i, n) { return 'Étape ' + i + ' sur ' + n; },
      next: 'Continuer', back: '←', send: 'Recevoir mon code', verify: 'Voir mon étude', resend: 'Renvoyer le code', backLink: '← Modifier mes coordonnées',
      titles: { maison: 'Quel type de propriété ?', batiment: 'Parlez-nous du bâtiment', systeme: 'Comment la chaleur circule-t-elle ?', energie: 'Avec quelle énergie ?', mazout: 'Et le réservoir de mazout ?', electricite: 'Votre entrée électrique', consommation: 'Ce que vous payez aujourd’hui', projet: 'Que souhaitez-vous ?', coordonnees: 'Où envoyer votre rapport ?', code: 'Entrez le code reçu' },
      why: { maison: 'Les subventions et les travaux changent selon le type de bâtiment.', batiment: 'La superficie et l’isolation servent à estimer votre besoin de chauffage si vous n’avez pas vos factures.', systeme: 'C’est la question qui décide de la bonne solution.', energie: 'L’énergie utilisée détermine vos économies et les subventions.', mazout: 'Le retrait du réservoir est souvent exigé par les subventions. Son emplacement change le travail à prévoir.', electricite: 'Passer à l’électrique peut demander plus de puissance : c’est souvent le travail connexe le plus important.', consommation: 'Avec vos vrais chiffres, l’estimation devient précise. Ils sont sur vos factures ou dans votre Espace client Hydro-Québec.', projet: '', coordonnees: 'Nous vous envoyons un code par courriel pour confirmer que c’est bien vous. Votre étude s’affiche ensuite et se télécharge en PDF.', code: '' },
      prop: [['unifamiliale', 'Unifamiliale isolée', 'house'], ['jumele', 'Jumelé ou rangée', 'semi'], ['plex', 'Duplex ou triplex', 'plex'], ['condo', 'Condo', 'condo'], ['commerce', 'Commerce ou immeuble', 'shop']],
      cp: 'Code postal', sup: 'Superficie chauffée', etages: 'Étages chauffés (sous-sol compris)', etOpts: [['1', '1'], ['2', '2'], ['3', '3 et plus']],
      annee: 'Année de construction', anOpts: [['av1960', 'Avant 1960'], ['6090', '1960–1990'], ['9010', '1990–2010'], ['ap2010', 'Après 2010']],
      isol: 'Isolation', isOpts: [['bonne', 'Bonne'], ['moyenne', 'Moyenne'], ['faible', 'Faible'], ['inconnue', 'Je ne sais pas']],
      syst: [['air', 'Air pulsé', 'air', 'Grilles au plancher ou aux murs, avec des conduits'], ['eau', 'Eau chaude', 'water', 'Radiateurs, plinthes à eau ou plancher radiant'], ['plinthes', 'Plinthes électriques', 'base', 'Une plinthe par pièce, sans conduits'], ['autre', 'Poêle ou autre', 'fire', 'Bois, granules, foyer']],
      energie: [['mazout', 'Mazout', 'oil'], ['electricite', 'Électricité', 'bolt'], ['bienergie', 'Biénergie', 'mix', 'Mazout et électricité (tarif DT)'], ['gaz', 'Gaz ou propane', 'gas']], bois: ['bois', 'Bois ou granules', 'fire'],
      age: { eau: 'Âge de la chaudière', plinthes: 'Âge des plinthes', autre: 'Âge de l’appareil principal' }, agOpts: [['m10', 'Moins de 10 ans'], ['1020', '10 à 20 ans'], ['p20', 'Plus de 20 ans'], ['nsp', 'Je ne sais pas']],
      resLbl: 'Emplacement', reservoir: [['sous-sol', 'Au sous-sol', 'oil'], ['exterieur', 'À l’extérieur', 'house'], ['enfoui', 'Enfoui sous terre', 'help', 'Retrait par un service spécialisé']],
      pomper: 'Reste-t-il de l’huile à pomper ?', poOpts: [['oui', 'Oui'], ['non', 'Non, presque vide'], ['nsp', 'Je ne sais pas']],
      entree: 'Capacité de l’entrée', enOpts: [['60', '60 A'], ['100', '100 A'], ['200', '200 A'], ['nsp', 'Je ne sais pas']], enHelp: 'Inscrite sur le disjoncteur principal, en haut du panneau.',
      panneau: 'Type de panneau', paOpts: [['disjoncteurs', 'Disjoncteurs'], ['fusibles', 'Fusibles'], ['nsp', 'Je ne sais pas']],
      place: 'Place libre dans le panneau ?', plOpts: [['oui', 'Oui'], ['non', 'Non'], ['nsp', 'Je ne sais pas']],
      mazAn: 'Mazout par année', moOpts: [['litres', 'En litres'], ['dollars', 'En dollars']], phL: 'ex. 2 000 litres', phD: 'ex. 4 600 $',
      hydro: 'Facture Hydro-Québec', hyOpts: [['an', 'Par année'], ['mois', 'Par mois']], phHa: 'ex. 2 400 $', phHm: 'ex. 200 $',
      inconnu: 'Je n’ai pas ces chiffres : estimez à partir de ma maison.',
      but: [['chauffage', 'Chauffer moins cher'], ['clim', 'Chauffer et climatiser'], ['conseil', 'Être conseillé']],
      solLbl: 'Solutions adaptées à votre maison',
      solEau: [['chaudiereElec', 'Chaudière électrique', 'boiler', 'Garde vos radiateurs, simple et rapide'], ['airEau', 'Thermopompe air-eau', 'central', 'Plus d’économies, chauffe l’eau des radiateurs'], ['multizone', 'Murales en complément', 'multi', 'Climatisation et économies par temps doux'], ['conseil', 'Me conseiller', 'help']],
      solAir: [['centrale', 'Thermopompe centrale', 'central', 'Chauffe et climatise toute la maison'], ['fournaiseElec', 'Fournaise électrique seulement', 'boiler', 'Remplace l’appareil, sans climatisation'], ['conseil', 'Me conseiller', 'help']],
      solPli: [['murale', 'Murale (une pièce)', 'wall', 'Pour l’aire ouverte principale'], ['multizone', 'Multizone', 'multi', '2 à 5 têtes, plusieurs pièces'], ['centrale', 'Centrale avec conduits', 'central', 'Si des conduits sont possibles'], ['conseil', 'Me conseiller', 'help']],
      solAutre: [['murale', 'Murale', 'wall'], ['multizone', 'Multizone', 'multi'], ['centrale', 'Centrale', 'central'], ['conseil', 'Me conseiller', 'help']],
      zones: 'Nombre de pièces ou de zones', zoOpts: [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 et plus']],
      sousSol: 'Hauteur du sous-sol de moins de 7 pieds ?', ssOpts: [['oui', 'Oui'], ['non', 'Non'], ['nsp', 'Je ne sais pas']],
      echeance: 'Échéancier', ecOpts: [['urgent', 'Le plus vite possible'], ['3mois', 'D’ici 3 mois'], ['6mois', 'D’ici 6 mois'], ['info', 'Je m’informe']],
      prenom: 'Prénom', nom: 'Nom', email: 'Courriel', tel: 'Téléphone', channel: 'Recevoir le code par', chEmail: 'Courriel', chSms: 'Texto (SMS)',
      consent: 'J’accepte que Comfortium utilise ces renseignements pour préparer mon étude et me contacter à ce sujet, selon sa politique de confidentialité.',
      codeLbl: 'Code à 6 chiffres', codeSent: function (d) { return 'Code envoyé à ' + d + '. Il expire dans 10 minutes. Pensez à vérifier vos courriels indésirables.'; },
      sending: 'Envoi du code…', checking: 'Vérification…',
      errCp: 'Entrez un code postal valide, par exemple H7V 2P6.', errName: 'Entrez votre prénom et votre nom.', errEmail: 'Entrez une adresse courriel valide.', errTel: 'Entrez un numéro de téléphone à 10 chiffres.', errConsent: 'Cochez la case de consentement pour recevoir votre étude.', errCode: 'Entrez le code à 6 chiffres reçu.', errService: 'Le service est momentanément indisponible. Réessayez ou appelez-nous au (514) 444-7483.',
      live: 'ÉCONOMIE ESTIMÉE', liveChoose: 'Choisissez une solution', tagBills: 'vos factures', tagEst: 'se précise', perYear: ' / an',
      done: 'Votre étude est prête', ecoTitle: function (v) { return 'Économie estimée de ' + v + ' par année'; }, range: function (a, b) { return 'Fourchette réaliste : ' + a + ' à ' + b + ' par année.'; },
      baseBills: 'Calculée avec vos factures.', baseHouse: 'Estimée à partir de votre maison : vos factures la rendraient plus précise.',
      curCost: 'Chauffage actuel', newCost: function (n) { return 'Avec ' + n; }, subv: 'Subventions possibles', invest: 'Investissement', investV: 'Selon votre soumission', lvRow: 'LogisVert estimé',
      noSaving: 'Pas d’économie d’énergie notable avec cette solution : le remplacement se justifie surtout par l’âge de l’appareil ou le confort.',
      notComputed: 'Pour le gaz, le propane ou le bois, les économies sont évaluées lors de la visite.',
      works: 'Travaux à prévoir d’après vos réponses', disclaimer: 'Estimation non contractuelle. Le prix final est établi par une soumission après la visite.',
      download: 'Télécharger mon rapport PDF', downloaded: '✓ Rapport téléchargé', pdfError: 'Le rapport n’a pas pu être généré. Réessayez ou appelez-nous au (514) 444-7483.',
      after: 'Un conseiller Comfortium vous contacte en 24 à 48 h pour planifier la visite.', menu: '↩ Retour au menu', hint: '✏️ Répondez aux questions ci-dessus',
      solNom: { centrale: 'une thermopompe centrale', multizone: 'une thermopompe multizone', murale: 'une thermopompe murale', airEau: 'une thermopompe air-eau', chaudiereElec: 'une chaudière électrique', fournaiseElec: 'une fournaise électrique' },
      w: { entree: 'Mise à niveau de l’entrée électrique', entreeNsp: 'Entrée électrique à vérifier', fusibles: 'Panneau à disjoncteurs', place: 'Espace à libérer dans le panneau', res: 'Retrait du réservoir', resEnf: 'Retrait du réservoir enfoui (service spécialisé)', pomper: 'Pompage de l’huile', bas: 'Appareil compact pour sous-sol bas', plenum: 'Raccordement au plénum', amiante: 'Vérification amiante si nécessaire', conduits: 'Conduits à évaluer' }
    },
    en: {
      intro: "Happy to help. The **energy use study** compares what you pay today to heat your home with an efficient electric solution suited to your house. It also flags **rebates** and **work to plan for**.\nIt takes about **3 minutes**. It is free and without obligation, and your PDF report is unlocked with a code sent to your email.",
      fromCalc: 'I picked up your answers from the calculator: only a few questions left.',
      step: function (i, n) { return 'Step ' + i + ' of ' + n; },
      next: 'Continue', back: '←', send: 'Get my code', verify: 'See my study', resend: 'Resend the code', backLink: '← Edit my details',
      titles: { maison: 'What type of property?', batiment: 'Tell us about the building', systeme: 'How is heat distributed?', energie: 'Using which energy?', mazout: 'And the oil tank?', electricite: 'Your electrical service', consommation: 'What you pay today', projet: 'What would you like?', coordonnees: 'Where should we send your report?', code: 'Enter the code you received' },
      why: { maison: 'Rebates and work depend on the type of building.', batiment: 'Floor area and insulation are used to estimate your heating needs if you do not have your bills.', systeme: 'This is the question that decides the right solution.', energie: 'The energy you use determines your savings and rebates.', mazout: 'Rebates often require removing the tank. Its location changes the work involved.', electricite: 'Switching to electricity may require more capacity: it is often the biggest related job.', consommation: 'With your real figures, the estimate becomes precise. They are on your bills or in your Hydro-Québec Customer Space.', projet: '', coordonnees: 'We send you a code by email to confirm it is you. Your study then appears and can be downloaded as a PDF.', code: '' },
      prop: [['unifamiliale', 'Detached house', 'house'], ['jumele', 'Semi-detached or row', 'semi'], ['plex', 'Duplex or triplex', 'plex'], ['condo', 'Condo', 'condo'], ['commerce', 'Business or building', 'shop']],
      cp: 'Postal code', sup: 'Heated floor area', etages: 'Heated floors (basement included)', etOpts: [['1', '1'], ['2', '2'], ['3', '3 or more']],
      annee: 'Year built', anOpts: [['av1960', 'Before 1960'], ['6090', '1960–1990'], ['9010', '1990–2010'], ['ap2010', 'After 2010']],
      isol: 'Insulation', isOpts: [['bonne', 'Good'], ['moyenne', 'Average'], ['faible', 'Poor'], ['inconnue', 'I don’t know']],
      syst: [['air', 'Forced air', 'air', 'Floor or wall vents, with ducts'], ['eau', 'Hot water', 'water', 'Radiators, hydronic baseboards or radiant floor'], ['plinthes', 'Electric baseboards', 'base', 'One baseboard per room, no ducts'], ['autre', 'Stove or other', 'fire', 'Wood, pellets, fireplace']],
      energie: [['mazout', 'Oil', 'oil'], ['electricite', 'Electricity', 'bolt'], ['bienergie', 'Dual energy', 'mix', 'Oil and electricity (Rate DT)'], ['gaz', 'Gas or propane', 'gas']], bois: ['bois', 'Wood or pellets', 'fire'],
      age: { eau: 'Boiler age', plinthes: 'Baseboard age', autre: 'Main unit age' }, agOpts: [['m10', 'Under 10 years'], ['1020', '10 to 20 years'], ['p20', 'Over 20 years'], ['nsp', 'I don’t know']],
      resLbl: 'Location', reservoir: [['sous-sol', 'In the basement', 'oil'], ['exterieur', 'Outside', 'house'], ['enfoui', 'Buried underground', 'help', 'Removal by a specialized service']],
      pomper: 'Is there oil left to pump out?', poOpts: [['oui', 'Yes'], ['non', 'No, nearly empty'], ['nsp', 'I don’t know']],
      entree: 'Service capacity', enOpts: [['60', '60 A'], ['100', '100 A'], ['200', '200 A'], ['nsp', 'I don’t know']], enHelp: 'Shown on the main breaker, at the top of the panel.',
      panneau: 'Panel type', paOpts: [['disjoncteurs', 'Breakers'], ['fusibles', 'Fuses'], ['nsp', 'I don’t know']],
      place: 'Free space in the panel?', plOpts: [['oui', 'Yes'], ['non', 'No'], ['nsp', 'I don’t know']],
      mazAn: 'Oil per year', moOpts: [['litres', 'In litres'], ['dollars', 'In dollars']], phL: 'e.g. 2,000 litres', phD: 'e.g. $4,600',
      hydro: 'Hydro-Québec bill', hyOpts: [['an', 'Per year'], ['mois', 'Per month']], phHa: 'e.g. $2,400', phHm: 'e.g. $200',
      inconnu: 'I don’t have these figures: estimate from my house.',
      but: [['chauffage', 'Heat for less'], ['clim', 'Heat and cool'], ['conseil', 'Get advice']],
      solLbl: 'Solutions suited to your home',
      solEau: [['chaudiereElec', 'Electric boiler', 'boiler', 'Keeps your radiators, simple and quick'], ['airEau', 'Air-to-water heat pump', 'central', 'More savings, heats the radiator water'], ['multizone', 'Wall units as a complement', 'multi', 'Cooling and savings in milder weather'], ['conseil', 'Advise me', 'help']],
      solAir: [['centrale', 'Central heat pump', 'central', 'Heats and cools the whole home'], ['fournaiseElec', 'Electric furnace only', 'boiler', 'Replaces the unit, no cooling'], ['conseil', 'Advise me', 'help']],
      solPli: [['murale', 'Wall unit (one room)', 'wall', 'For the main open area'], ['multizone', 'Multi-zone', 'multi', '2 to 5 heads, several rooms'], ['centrale', 'Central with ducts', 'central', 'If ducts are possible'], ['conseil', 'Advise me', 'help']],
      solAutre: [['murale', 'Wall unit', 'wall'], ['multizone', 'Multi-zone', 'multi'], ['centrale', 'Central', 'central'], ['conseil', 'Advise me', 'help']],
      zones: 'Number of rooms or zones', zoOpts: [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 or more']],
      sousSol: 'Basement height under 7 feet?', ssOpts: [['oui', 'Yes'], ['non', 'No'], ['nsp', 'I don’t know']],
      echeance: 'Timeline', ecOpts: [['urgent', 'As soon as possible'], ['3mois', 'Within 3 months'], ['6mois', 'Within 6 months'], ['info', 'Just looking']],
      prenom: 'First name', nom: 'Last name', email: 'Email', tel: 'Phone', channel: 'Receive the code by', chEmail: 'Email', chSms: 'Text (SMS)',
      consent: 'I agree that Comfortium may use this information to prepare my study and contact me about it, under its privacy policy.',
      codeLbl: '6-digit code', codeSent: function (d) { return 'Code sent to ' + d + '. It expires in 10 minutes. Check your junk folder too.'; },
      sending: 'Sending the code…', checking: 'Checking…',
      errCp: 'Enter a valid postal code, for example H7V 2P6.', errName: 'Enter your first and last name.', errEmail: 'Enter a valid email address.', errTel: 'Enter a 10-digit phone number.', errConsent: 'Check the consent box to receive your study.', errCode: 'Enter the 6-digit code you received.', errService: 'The service is temporarily unavailable. Try again or call us at (514) 444-7483.',
      live: 'ESTIMATED SAVINGS', liveChoose: 'Choose a solution', tagBills: 'your bills', tagEst: 'getting sharper', perYear: ' / yr',
      done: 'Your study is ready', ecoTitle: function (v) { return 'Estimated savings of ' + v + ' per year'; }, range: function (a, b) { return 'Realistic range: ' + a + ' to ' + b + ' per year.'; },
      baseBills: 'Calculated from your bills.', baseHouse: 'Estimated from your house: your bills would make it more precise.',
      curCost: 'Current heating', newCost: function (n) { return 'With ' + n; }, subv: 'Possible rebates', invest: 'Investment', investV: 'Per your quote', lvRow: 'Estimated LogisVert',
      noSaving: 'No notable energy savings with this solution: replacement is mainly justified by the unit’s age or comfort.',
      notComputed: 'For gas, propane or wood, savings are assessed during the visit.',
      works: 'Work to plan for, based on your answers', disclaimer: 'Non-binding estimate. The final price is set by a quote after the visit.',
      download: 'Download my PDF report', downloaded: '✓ Report downloaded', pdfError: 'The report could not be generated. Try again or call us at (514) 444-7483.',
      after: 'A Comfortium advisor will contact you within 24 to 48 hours to schedule the visit.', menu: '↩ Back to menu', hint: '✏️ Answer the questions above',
      solNom: { centrale: 'a central heat pump', multizone: 'a multi-zone heat pump', murale: 'a wall-mounted heat pump', airEau: 'an air-to-water heat pump', chaudiereElec: 'an electric boiler', fournaiseElec: 'an electric furnace' },
      w: { entree: 'Electrical service upgrade', entreeNsp: 'Electrical service to check', fusibles: 'Breaker panel', place: 'Space to free up in the panel', res: 'Tank removal', resEnf: 'Buried tank removal (specialized service)', pomper: 'Oil pump-out', bas: 'Compact unit for a low basement', plenum: 'Plenum connection', amiante: 'Asbestos check if needed', conduits: 'Ducts to assess' }
    }
  };
  var ICON = {
    house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>', semi: '<path d="M2 12l6-5 6 5"/><path d="M10 12l6-5 6 5"/><path d="M4 11v9h16v-9"/>',
    plex: '<rect x="5" y="3" width="14" height="18"/><path d="M5 12h14M9 7h2M13 7h2M9 16h2M13 16h2"/>', condo: '<rect x="4" y="2" width="16" height="20"/><path d="M8 6h2M14 6h2M8 10h2M14 10h2M8 14h2M14 14h2M10 22v-4h4v4"/>',
    shop: '<path d="M3 9l2-5h14l2 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>', air: '<path d="M3 8h12a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h8"/>',
    water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>', base: '<rect x="3" y="13" width="18" height="6" rx="1"/><path d="M6 13v6M10 13v6M14 13v6M18 13v6"/>',
    fire: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 3 3 3"/>', oil: '<rect x="5" y="6" width="14" height="14" rx="2"/><path d="M9 6V3h6v3M8 12h8"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', mix: '<path d="M13 2L7 11h5l-1 6"/><rect x="13" y="12" width="8" height="9" rx="1"/>',
    gas: '<path d="M12 21a6 6 0 0 0 6-6c0-4-6-12-6-12S6 11 6 15a6 6 0 0 0 6 6z"/>', wall: '<rect x="3" y="6" width="18" height="7" rx="2"/><path d="M6 16v2M12 16v3M18 16v2"/>',
    multi: '<rect x="2" y="4" width="9" height="5" rx="1"/><rect x="13" y="4" width="9" height="5" rx="1"/><rect x="7" y="14" width="10" height="6" rx="1"/>',
    central: '<rect x="7" y="9" width="10" height="12" rx="1"/><path d="M9 9V4h6v5M3 6h4M17 6h4"/>', boiler: '<rect x="6" y="3" width="12" height="15" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 21v-3M15 21v-3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01"/>'
  };

  function L() { try { return (typeof lang !== 'undefined' && lang === 'en') ? 'en' : 'fr'; } catch (e) { return 'fr'; } }
  function tx() { return T[L()]; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '')); return isFinite(n) && n > 0 ? n : 0; }
  function arr(n, pas) { pas = pas || 50; return Math.round(n / pas) * pas; }
  function money(n, lg) { return new Intl.NumberFormat((lg || L()) === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n); }
  function nfmt(n, lg) { return Math.round(n).toLocaleString((lg || L()) === 'en' ? 'en-CA' : 'fr-CA'); }
  function labelOf(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === String(v)) return list[i][1]; return v || '—'; }
  function phoneDigits(t) { return String(t || '').replace(/\D/g, ''); }
  function U() { return L() === 'en' ? ' sq ft' : ' pi²'; }
  function cpOk(v) { return /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(String(v || '').trim()); }
  function track(ev, p) { try { if (typeof gtag === 'function') gtag('event', ev, p || {}); } catch (e) {} }

  // ── Catalogue LogisVert (fourchette par puissance) ─────────────────
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

  // ── État ───────────────────────────────────────────────────────────
  var S = null;
  function blank() {
    return { prop: '', cp: '', sup: 1500, etages: '', annee: '', isol: '', syst: '', energie: '', age: '', reservoir: '', pomper: '', entree: '', panneau: '', place: '', consoMode: 'litres', litres: '', mazoutD: '', hydroMode: 'an', hydro: '', inconnu: false, but: '', solution: '', zones: '', sousSol: '', echeance: '', model: null, lv: null, statut: '' };
  }
  function fromCtx(ctx) {
    var a = blank(); if (!ctx) return a;
    a.cp = String(ctx.codePostal || '').toUpperCase(); a.prop = ctx.propriete || ''; a.statut = ctx.statut || '';
    a.sup = SUP_CALC[ctx.superficie] || 1500;
    var ch = ctx.chauffage;
    if (ch === 'mazout') a.energie = 'mazout';
    else if (ch === 'plinthes') { a.syst = 'plinthes'; a.energie = 'electricite'; }
    else if (ch === 'fournaise_elec') { a.syst = 'air'; a.energie = 'electricite'; }
    else if (ch === 'chaudiere_elec') { a.syst = 'eau'; a.energie = 'electricite'; }
    else if (ch === 'gaz') a.energie = 'gaz';
    var tp = { centrale: 'centrale', multizone: 'multizone', murale: 'murale', conseiller: 'conseil' }[ctx.type_tp]; if (tp) a.solution = tp;
    var am = ctx.amperage; a.entree = am === '200' ? '200' : (am === '100' || am === '125' || am === '150') ? '100' : am === 'unknown' ? 'nsp' : '';
    a.echeance = { asap: 'urgent', '1_3_mois': '3mois', '3_6_mois': '6mois', urgent: 'urgent', info: 'info' }[ctx.horizon] || '';
    a.model = ctx.model || null; a.lv = ctx.lv || null;
    return a;
  }
  function steps() {
    var s = ['maison', 'batiment', 'systeme', 'energie'];
    if (S.a.energie === 'mazout' || S.a.energie === 'bienergie') s.push('mazout');
    s.push('electricite', 'consommation', 'projet', 'coordonnees', 'code', 'resultat');
    return s;
  }
  function solutions() { var t = tx(), y = S.a.syst; return y === 'eau' ? t.solEau : y === 'air' ? t.solAir : y === 'plinthes' ? t.solPli : t.solAutre; }
  function solEff() { // solution réellement calculée (« me conseiller » → recommandation par système)
    var s = S.a.solution;
    if (s && s !== 'conseil') return s;
    return S.a.syst === 'eau' ? 'chaudiereElec' : S.a.syst === 'plinthes' ? 'multizone' : 'centrale';
  }
  var OK = {
    maison: function (a) { return a.prop && cpOk(a.cp); },
    batiment: function (a) { return a.etages && a.annee && a.isol; },
    systeme: function (a) { return a.syst; },
    energie: function (a) { return a.energie && a.age; },
    mazout: function (a) { return a.reservoir && a.pomper; },
    electricite: function (a) { return a.entree && a.panneau && a.place; },
    consommation: function (a) { return a.inconnu || num(a.litres) || num(a.mazoutD) || num(a.hydro); },
    projet: function (a) { return a.but && a.solution && a.echeance && (a.solution !== 'multizone' || a.zones); },
    coordonnees: function () { return true; }, code: function () { return true; }, resultat: function () { return true; }
  };

  // ── Calcul ─────────────────────────────────────────────────────────
  function calc(a) {
    a = a || S.a;
    if (!a.energie) return null;
    var maz = a.energie === 'mazout' || a.energie === 'bienergie', elec = a.energie === 'electricite';
    var sol = solEff(), out = { sol: sol, base: 'maison', eco: null };
    var rend = H.rendMazout[a.age] || H.rendMazout.nsp;
    var L1 = a.inconnu ? 0 : (num(a.litres) || (num(a.mazoutD) ? num(a.mazoutD) / H.mazout : 0));
    var hy = a.inconnu ? 0 : num(a.hydro) * (a.hydroMode === 'mois' ? 12 : 1);
    var besoinMaison = a.sup * (H.intensite[a.annee] || 10) * (H.isol[a.isol] || 1);
    var besoin, avant;
    if (maz) {
      if (L1) { besoin = L1 * H.kwhLitre * rend; out.base = 'factures'; out.litres = L1; }
      else { besoin = besoinMaison; out.litres = besoin / (H.kwhLitre * rend); }
      avant = out.litres * H.mazout;
    } else if (elec) {
      if (hy) { avant = hy * H.partChauffage; besoin = avant / H.elec; out.base = 'factures'; }
      else { besoin = besoinMaison; avant = besoin * H.elec; }
      out.kwh = besoin;
    } else { return out; } // gaz, propane, bois : évalué lors de la visite
    var s = H.sol[sol] || H.sol.centrale;
    var apres = besoin * (s.cov / s.cop + (1 - s.cov)) * H.elec;
    out.besoin = besoin; out.avant = avant; out.apres = apres; out.eco = Math.max(0, avant - apres);
    // LogisVert (thermopompes air-air seulement)
    out.btu = a.model ? btuOf(a.model.btu) : (sol === 'murale' ? (a.sup < 1000 ? 12000 : 18000) : sol === 'multizone' && a.zones ? ({ 2: 18000, 3: 24000, 4: 30000, 5: 36000 }[a.zones] || 24000) : (a.sup < 1000 ? 12000 : a.sup < 1500 ? 18000 : a.sup < 2000 ? 24000 : a.sup < 2500 ? 30000 : 36000));
    if (PAC.indexOf(sol) >= 0) {
      if (a.model && a.model.base) out.lv = { min: a.model.base, max: a.model.base, exact: true };
      else if (a.lv && a.lv.min) out.lv = { min: a.lv.min, max: a.lv.max, exact: a.lv.min === a.lv.max };
      else { var f = fourchetteLV(out.btu); if (f) out.lv = { min: f.min, max: f.max, exact: false }; }
    }
    var cp = String(a.cp || '').toUpperCase().replace(/\s/g, '');
    out.laval = maz && cp.indexOf('H7') === 0 && a.prop !== 'commerce' ? (H.lavalMazout[a.prop] || 1400) : 0;
    return out;
  }
  function subvList(r, a, lg) {
    var en = lg === 'en', l = [];
    if (r && r.lv) l.push('LogisVert');
    if (r && r.laval) l.push(en ? 'City of Laval' : 'Ville de Laval');
    if (PAC.concat(['airEau']).indexOf(r ? r.sol : '') >= 0 && a.prop !== 'commerce') l.push(en ? 'federal (2027)' : 'fédéral (2027)');
    if (a.prop === 'commerce') l.push('Solutions efficaces');
    return l;
  }
  function travaux(a, lg) {
    var w = T[lg || L()].w, l = [], sol = solEff();
    if (a.entree === '60' || a.entree === '100') l.push(w.entree); else if (a.entree === 'nsp') l.push(w.entreeNsp);
    if (a.panneau === 'fusibles') l.push(w.fusibles);
    if (a.place === 'non') l.push(w.place);
    if (a.reservoir) l.push(a.reservoir === 'enfoui' ? w.resEnf : w.res);
    if (a.pomper === 'oui') l.push(w.pomper);
    if (a.sousSol === 'oui') l.push(w.bas);
    if (a.syst === 'air' && (sol === 'centrale' || sol === 'fournaiseElec')) l.push(w.plenum);
    if (a.syst !== 'air' && sol === 'centrale') l.push(w.conduits);
    if (a.annee === 'av1960' || a.annee === '6090') l.push(w.amiante);
    return l;
  }

  // ── Parcours ───────────────────────────────────────────────────────
  function readCtx() { try { var raw = sessionStorage.getItem(CTX_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
  function start(ctx) {
    ctx = ctx || readCtx();
    S = { a: fromCtx(ctx), cur: 'maison', contact: { channel: 'email' }, verified: false, result: null, fromCalc: !!ctx, err: '', msg: '' };
    loadCatalogue();
    var tl = tx();
    if (typeof addBot === 'function') addBot(tl.intro + (ctx ? '\n\n' + tl.fromCalc : ''), null, null, 450);
    setTimeout(refresh, 520);
    track('calor_etude_start', { from_calculator: !!ctx });
  }
  function refresh() { if (typeof renderChat === 'function') renderChat(); if (typeof scrollChat === 'function') scrollChat(); }
  function active() { return !!(S && !S.closed); }
  function stop() { if (S) S.closed = true; refresh(); }
  function freeze() {
    if (!S || S.closed || S.cur !== 'resultat' || !S.result) return;
    var tl = tx(), r = S.result, lines = [tl.done];
    if (r.eco != null) lines.push(tl.curCost + ' : ' + money(arr(r.avant)) + tl.perYear, tl.ecoTitle('**' + money(arr(r.eco)) + '**'));
    S.closed = true;
    try { chatMsgs.push({ id: 'e' + Date.now(), from: 'bot', type: 'text', text: lines.join('\n'), replies: [{ l: tl.download, v: 'etude_pdf' }] }); } catch (e) {}
  }

  // ── Rendu ──────────────────────────────────────────────────────────
  function ico(k) { return ICON[k] ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>' : ''; }
  function tiles(key, opts) {
    return '<div class="et-tiles" role="group">' + opts.map(function (o) {
      return '<button type="button" class="et-tile" data-k="' + key + '" data-v="' + esc(o[0]) + '" aria-pressed="' + (String(S.a[key]) === o[0]) + '">' + ico(o[2]) + '<span>' + esc(o[1]) + '</span>' + (o[3] ? '<small>' + esc(o[3]) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function pills(key, opts) {
    return '<div class="et-pills" role="group">' + opts.map(function (o) { return '<button type="button" class="et-pill" data-k="' + key + '" data-v="' + esc(o[0]) + '" aria-pressed="' + (String(S.a[key]) === o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function lbl(t, f) { return '<' + (f ? 'label for="' + f + '"' : 'p') + ' class="et-lbl">' + esc(t) + '</' + (f ? 'label' : 'p') + '>'; }
  function field(id, key, val, attrs) { return '<input class="et-input" id="' + id + '" data-in="' + key + '" value="' + esc(val || '') + '"' + (attrs || '') + '/>'; }
  function screen(name) {
    var t = tx(), a = S.a, h = '';
    switch (name) {
      case 'maison': h = tiles('prop', t.prop) + lbl(t.cp, 'et_cp') + field('et_cp', 'cp', a.cp, ' maxlength="7" autocomplete="postal-code" placeholder="H7V 2P6"'); break;
      case 'batiment': h = lbl(t.sup, 'et_sup') + '<div class="et-range"><input type="range" id="et_sup" data-in="sup" min="500" max="5000" step="100" value="' + a.sup + '"/><output id="et_supv">' + nfmt(a.sup) + U() + '</output></div>' +
        lbl(t.etages) + pills('etages', t.etOpts) + lbl(t.annee) + pills('annee', t.anOpts) + lbl(t.isol) + pills('isol', t.isOpts); break;
      case 'systeme': h = tiles('syst', t.syst); break;
      case 'energie': h = tiles('energie', a.syst === 'autre' ? t.energie.concat([t.bois]) : t.energie) + lbl(t.age[a.syst] || t.age.autre) + pills('age', t.agOpts); break;
      case 'mazout': h = lbl(t.resLbl) + tiles('reservoir', t.reservoir) + lbl(t.pomper) + pills('pomper', t.poOpts); break;
      case 'electricite': h = lbl(t.entree) + pills('entree', t.enOpts) + '<p class="et-help">' + esc(t.enHelp) + '</p>' + lbl(t.panneau) + pills('panneau', t.paOpts) + lbl(t.place) + pills('place', t.plOpts); break;
      case 'consommation':
        var maz = a.energie === 'mazout' || a.energie === 'bienergie';
        if (maz) h += lbl(t.mazAn) + pills('consoMode', t.moOpts) + (a.consoMode === 'litres' ? field('et_ml', 'litres', a.litres, ' inputmode="numeric" placeholder="' + esc(t.phL) + '"') : field('et_md', 'mazoutD', a.mazoutD, ' inputmode="decimal" placeholder="' + esc(t.phD) + '"'));
        h += lbl(t.hydro) + pills('hydroMode', t.hyOpts) + field('et_hy', 'hydro', a.hydro, ' inputmode="decimal" placeholder="' + esc(a.hydroMode === 'an' ? t.phHa : t.phHm) + '"');
        h += '<label class="et-check"><input type="checkbox" data-in="inconnu"' + (a.inconnu ? ' checked' : '') + '/><span>' + esc(t.inconnu) + '</span></label>'; break;
      case 'projet':
        h = pills('but', t.but) + lbl(t.solLbl) + tiles('solution', solutions());
        if (a.solution === 'multizone') h += lbl(t.zones) + pills('zones', t.zoOpts);
        if (a.syst === 'air' || a.solution === 'centrale') h += lbl(t.sousSol) + pills('sousSol', t.ssOpts);
        h += lbl(t.echeance) + pills('echeance', t.ecOpts); break;
      case 'coordonnees':
        var k = S.contact;
        h = '<div class="et-two"><div>' + lbl(t.prenom, 'et_pn') + '<input class="et-input" id="et_pn" value="' + esc(k.prenom || '') + '" autocomplete="given-name"/></div><div>' + lbl(t.nom, 'et_nm') + '<input class="et-input" id="et_nm" value="' + esc(k.nom || '') + '" autocomplete="family-name"/></div></div>' +
          lbl(t.email, 'et_em') + '<input class="et-input" id="et_em" type="email" value="' + esc(k.email || '') + '" autocomplete="email" placeholder="votre@courriel.com"/>' +
          lbl(t.tel, 'et_tl') + '<input class="et-input" id="et_tl" type="tel" value="' + esc(k.tel || '') + '" autocomplete="tel" placeholder="(514) 555-1234"/>' +
          (SMS_ON ? lbl(t.channel) + '<div class="et-radios"><label><input type="radio" name="et_chn" value="email"' + (k.channel !== 'sms' ? ' checked' : '') + '/> ' + esc(t.chEmail) + '</label><label><input type="radio" name="et_chn" value="sms"' + (k.channel === 'sms' ? ' checked' : '') + '/> ' + esc(t.chSms) + '</label></div>' : '') +
          '<label class="et-check"><input type="checkbox" id="et_cs"' + (k.consent ? ' checked' : '') + '/><span>' + esc(t.consent) + '</span></label>' +
          '<input type="text" id="et_hp" style="display:none!important;position:absolute;left:-9999px" tabindex="-1" autocomplete="off" aria-hidden="true"/>'; break;
      case 'code':
        h = (S.msg ? '<p class="et-help">' + esc(S.msg) + '</p>' : '') + lbl(t.codeLbl, 'et_cd') + '<input class="et-input et-code" id="et_cd" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"/>' +
          '<div class="et-links"><button type="button" class="et-link" data-et="resend">' + esc(t.resend) + '</button> · <button type="button" class="et-link" data-et="edit">' + esc(t.backLink) + '</button></div>'; break;
    }
    return h;
  }
  function liveHtml() {
    var t = tx(), r = calc();
    if (!r || r.eco == null || ['maison', 'batiment', 'systeme', 'resultat', 'code'].indexOf(S.cur) >= 0) return '';
    var v = S.a.solution ? '≈ ' + money(arr(r.eco)) + t.perYear : t.liveChoose;
    return '<div class="et-live"><div><small>' + esc(t.live) + '</small><strong>' + esc(v) + '</strong></div><span>' + esc(r.base === 'factures' && S.a.solution ? t.tagBills : t.tagEst) + '</span></div>';
  }
  function panel() {
    if (!active()) return null;
    var t = tx(), st = steps(), i = st.indexOf(S.cur), n = st.length - 1, h = '';
    var wrap = document.createElement('div'); wrap.className = 'chat-msg bot';
    if (S.cur === 'resultat' && S.result) h = resultHtml();
    else {
      h += '<div class="et-prog"><span>' + esc(t.step(i + 1, n)) + '</span><div class="et-bar"><i style="width:' + Math.round((i + 1) / n * 100) + '%"></i></div></div>';
      h += '<p class="et-title">' + esc(t.titles[S.cur]) + '</p>' + (t.why[S.cur] ? '<p class="et-why">' + esc(t.why[S.cur]) + '</p>' : '') + screen(S.cur);
      h += '<div class="et-live-slot">' + liveHtml() + '</div>';
      var primary = S.cur === 'coordonnees' ? ['send', t.send] : S.cur === 'code' ? ['verify', t.verify] : ['next', t.next];
      h += '<div class="et-actions">' + (i > 0 && S.cur !== 'code' ? '<button type="button" class="et-btn-ghost" data-et="back" aria-label="' + (L() === 'en' ? 'Back' : 'Retour') + '">' + t.back + '</button>' : '') +
        '<button type="button" class="chat-submit-btn et-primary" data-et="' + primary[0] + '"' + (OK[S.cur](S.a) ? '' : ' disabled') + '>' + esc(primary[1]) + '</button></div>';
    }
    if (S.err) h += '<p class="et-err" role="alert">' + esc(S.err) + '</p>';
    wrap.innerHTML = '<div class="chat-lead-form et-panel">' + h + '</div>';
    wrap.addEventListener('click', onClick);
    wrap.addEventListener('input', onInput);
    wrap.addEventListener('change', onInput);
    return wrap;
  }
  function resultHtml() {
    var t = tx(), r = S.result, a = S.a, h = '<p class="et-eyebrow">' + esc(t.done) + '</p>';
    var row = function (k, v) { return '<div class="et-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; };
    if (r.eco != null && r.eco >= 100) {
      h += '<p class="et-title">' + esc(t.ecoTitle(money(arr(r.eco)))) + '</p><p class="et-why">' + esc(t.range(money(arr(r.eco * (1 - H.marge))), money(arr(r.eco * (1 + H.marge))))) + ' ' + esc(r.base === 'factures' ? t.baseBills : t.baseHouse) + '</p>';
    } else if (r.eco != null) {
      h += '<p class="et-title">' + esc(t.done) + '</p><p class="et-why">' + esc(t.noSaving) + '</p>';
    } else h += '<p class="et-title">' + esc(t.done) + '</p><p class="et-why">' + esc(t.notComputed) + '</p>';
    h += '<div class="et-rows">';
    if (r.eco != null) h += row(t.curCost, money(arr(r.avant)) + t.perYear) + row(t.newCost(t.solNom[r.sol]), money(arr(r.apres)) + t.perYear);
    var sv = subvList(r, a, L()); if (sv.length) h += row(t.subv, sv.join(' · '));
    if (r.lv) h += row(t.lvRow, r.lv.exact ? money(r.lv.min) : money(r.lv.min) + (L() === 'en' ? ' to ' : ' à ') + money(r.lv.max));
    h += row(t.invest, t.investV) + '</div>';
    var w = travaux(a); if (w.length) h += '<p class="et-lbl">' + esc(t.works) + '</p><div class="et-chips">' + w.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>';
    h += '<p class="et-help">' + esc(t.disclaimer) + '</p>';
    h += '<button type="button" class="chat-submit-btn et-primary" data-et="pdf" id="et_pdf">' + esc(S.pdfDone ? t.downloaded : t.download) + '</button>';
    h += '<p class="et-help">' + esc(t.after) + '</p><div class="et-links"><button type="button" class="et-link" data-et="menu">' + esc(t.menu) + '</button></div>';
    return h;
  }

  // ── Actions ────────────────────────────────────────────────────────
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function updateLive() {
    var slot = document.querySelector('.et-panel .et-live-slot'); if (slot) slot.innerHTML = liveHtml();
    var b = document.querySelector('.et-panel .et-primary'); if (b && S.cur !== 'resultat') b.disabled = !OK[S.cur](S.a);
  }
  function onInput(e) {
    var el = e.target, k = el.getAttribute('data-in'); if (!k || !S) return;
    S.a[k] = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'sup') { S.a.sup = parseInt(el.value, 10) || 1500; var o = document.getElementById('et_supv'); if (o) o.textContent = nfmt(S.a.sup) + U(); }
    if (k === 'cp') { var c = String(el.value || '').toUpperCase().replace(/\s/g, ''); S.a.cp = c.length === 6 ? c.slice(0, 3) + ' ' + c.slice(3) : String(el.value || '').toUpperCase(); }
    if (k === 'inconnu' && e.type === 'change') { S.err = ''; }
    updateLive();
  }
  function saveContact() {
    if (S.cur !== 'coordonnees') return;
    var k = S.contact; k.prenom = val('et_pn'); k.nom = val('et_nm'); k.email = val('et_em'); k.tel = val('et_tl');
    var cs = document.getElementById('et_cs'); k.consent = !!(cs && cs.checked);
    var r = document.querySelector('input[name="et_chn"]:checked'); k.channel = (SMS_ON && r) ? r.value : 'email';
  }
  function onClick(e) {
    var b = e.target.closest('[data-k],[data-et]'); if (!b || !S) return;
    var t = tx();
    if (b.hasAttribute('data-k')) {
      var k = b.getAttribute('data-k'), v = b.getAttribute('data-v');
      S.a[k] = v; S.err = '';
      if (k === 'syst') { if (v === 'plinthes') S.a.energie = 'electricite'; var ok = solutions().some(function (o) { return o[0] === S.a.solution; }); if (!ok) S.a.solution = ''; }
      if (k === 'energie' && v !== 'mazout' && v !== 'bienergie') { S.a.reservoir = ''; S.a.pomper = ''; }
      if (k === 'solution' && v !== 'multizone') S.a.zones = '';
      return refresh();
    }
    var a = b.getAttribute('data-et'); saveContact(); S.err = '';
    var st = steps(), i = st.indexOf(S.cur);
    if (a === 'back') { if (i > 0) S.cur = st[i - 1]; return refresh(); }
    if (a === 'edit') { S.cur = 'coordonnees'; S.msg = ''; return refresh(); }
    if (a === 'next') {
      if (S.cur === 'maison' && !cpOk(S.a.cp)) { S.err = t.errCp; return refresh(); }
      if (!OK[S.cur](S.a)) return refresh();
      S.cur = st[i + 1]; track('calor_etude_step', { step: S.cur }); return refresh();
    }
    if (a === 'send' || a === 'resend') return sendCode(a === 'resend');
    if (a === 'verify') return verifyCode();
    if (a === 'pdf') return makePdf();
    if (a === 'menu') { freeze(); if (typeof addBot === 'function' && typeof CHAT_T !== 'undefined') addBot(CHAT_T[L()].menuAgain, CHAT_T[L()].menu, null, 300); return; }
  }
  function sendCode(isResend) {
    var t = tx(), k = S.contact;
    if (!isResend) {
      if (val('et_hp')) return;
      if (!k.prenom || !k.nom) { S.err = t.errName; return refresh(); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(k.email || '')) { S.err = t.errEmail; return refresh(); }
      var d = phoneDigits(k.tel); if (!(d.length === 10 || (d.length === 11 && d[0] === '1'))) { S.err = t.errTel; return refresh(); }
      if (!k.consent) { S.err = t.errConsent; return refresh(); }
    }
    S.msg = t.sending; S.cur = 'code'; refresh();
    fetch('/.netlify/functions/verification-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: k.email, phone: k.tel, channel: k.channel }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) {
        if (!x.ok) throw Error(x.b && x.b.error || 'service');
        S.msg = t.codeSent(k.channel === 'sms' ? k.tel : k.email); S.err = ''; refresh();
        track('calor_etude_code_sent', { channel: k.channel });
      })
      .catch(function (e) { S.msg = ''; S.err = (e && e.message && e.message !== 'service' && e.message !== 'Failed to fetch') ? e.message : t.errService; refresh(); });
  }
  function verifyCode() {
    var t = tx(), k = S.contact, code = val('et_cd');
    if (!/^\d{6}$/.test(code)) { S.err = t.errCode; return refresh(); }
    S.msg = t.checking; refresh();
    fetch('/.netlify/functions/verification-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: k.email, phone: k.tel, channel: k.channel, code: code }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (x) {
        if (!x.ok || !x.b || !x.b.verified) throw Error(x.b && x.b.error || 'service');
        S.verified = true; S.msg = '';
        return loadCatalogue().then(function () {
          S.result = calc(); S.cur = 'resultat'; refresh(); pushLead();
          track('generate_lead', { currency: 'CAD', value: 1, method: 'calor_etude' });
        });
      })
      .catch(function (e) { S.msg = ''; S.err = (e && e.message && e.message !== 'service' && e.message !== 'Failed to fetch') ? e.message : t.errService; refresh(); });
  }

  // ── HubSpot ────────────────────────────────────────────────────────
  function resume() {
    var a = S.a, r = S.result, f = T.fr;
    var maz = a.energie === 'mazout' || a.energie === 'bienergie';
    return ['Étude CALOR v2 — contact vérifié (' + S.contact.channel + ')',
      'Propriété : ' + labelOf(f.prop, a.prop) + ', ' + a.sup + ' pi², ' + a.etages + ' étage(s), ' + labelOf(f.anOpts, a.annee) + ', isolation ' + labelOf(f.isOpts, a.isol).toLowerCase(),
      'Système : ' + labelOf(f.syst, a.syst) + ' · Énergie : ' + labelOf(f.energie.concat([f.bois]), a.energie) + ' · Âge : ' + labelOf(f.agOpts, a.age),
      maz ? 'Réservoir : ' + labelOf(f.reservoir, a.reservoir) + ', huile à pomper : ' + labelOf(f.poOpts, a.pomper) : '',
      'Électricité : entrée ' + labelOf(f.enOpts, a.entree) + ', panneau ' + labelOf(f.paOpts, a.panneau).toLowerCase() + ', place libre : ' + labelOf(f.plOpts, a.place).toLowerCase(),
      a.inconnu ? 'Consommation : estimée' : 'Consommation : ' + (maz ? (num(a.litres) ? num(a.litres) + ' L' : num(a.mazoutD) ? num(a.mazoutD) + ' $ de mazout' : '—') + ' · ' : '') + 'Hydro ' + (num(a.hydro) ? num(a.hydro) + ' $/' + a.hydroMode : '—'),
      'Projet : ' + labelOf(f.but, a.but) + ' · ' + labelOf(f.solEau.concat(f.solAir, f.solPli), a.solution) + (a.zones ? ' (' + a.zones + ' zones)' : '') + (a.sousSol === 'oui' ? ' · sous-sol bas' : '') + ' · ' + labelOf(f.ecOpts, a.echeance),
      a.model ? 'Modèle (calculateur) : ' + a.model.brand + ' ' + a.model.out + ' (AHRI ' + (a.model.ahri || '—') + ')' : '',
      r && r.eco != null ? 'Économie estimée : ' + Math.round(r.eco) + ' $/an (actuel ' + Math.round(r.avant) + ' $, après ' + Math.round(r.apres) + ' $, base ' + r.base + ')' : 'Économie : à évaluer',
      r && r.lv ? 'LogisVert : ' + r.lv.min + (r.lv.exact ? '' : '–' + r.lv.max) + ' $' : '',
      r && r.laval ? 'Laval mazout : jusqu’à ' + r.laval + ' $' : '',
      'Travaux : ' + (travaux(a, 'fr').join(', ') || 'aucun signalé')
    ].filter(Boolean).join(' · ');
  }
  function pushLead() {
    var a = S.a, k = S.contact;
    var systeme = { mazout: 'oil', bienergie: 'oil', electricite: 'electric', gaz: 'gas', bois: 'other' };
    var propriete = { unifamiliale: 'house', jumele: 'house', condo: 'condo', plex: 'duplex', commerce: 'commercial' };
    var projet = { murale: 'wall', multizone: 'wall', centrale: 'central', airEau: 'boiler', chaudiereElec: 'boiler', fournaiseElec: 'furnace', conseil: '' };
    var d = phoneDigits(k.tel); d = d.length === 11 ? d.slice(1) : d;
    var tr = {}; try { tr = typeof getTrackingData === 'function' ? getTrackingData() : {}; } catch (e) {}
    var payload = {
      firstname: k.prenom, lastname: k.nom, email: k.email, phone: '+1' + d,
      city: String(a.cp || '').toUpperCase().indexOf('H7') === 0 ? 'Laval' : '',
      hs_lead_status: 'NEW', lead_source_utm: (tr.utm_source || 'organic') + '|' + (tr.utm_medium || 'direct') + '|' + (S.fromCalc ? 'calculateur' : (tr.utm_campaign || 'calor')),
      conversion_stage: 'estimate_completed', contact_method_preference: 'phone',
      hvac_system_type: systeme[a.energie] || '', property_type: propriete[a.prop] || '', request_type: projet[a.solution] || '',
      subsidy_eligible: (S.result && (S.result.lv || S.result.laval)) ? 'true' : 'false',
      notes_hvac: 'Code postal : ' + String(a.cp || '').toUpperCase() + ' · ' + resume()
    };
    fetch('/.netlify/functions/hubspot-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .catch(function (e) { console.error('HubSpot', e); });
  }

  // ── Rapport PDF ────────────────────────────────────────────────────
  function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = JSPDF_URL; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  }
  function makePdf() {
    var t = tx();
    if (!S || !S.verified || !S.result) return;
    loadJsPdf().then(function () { buildPdf(); S.pdfDone = true; refresh(); track('pdf_generated', { event_category: 'calor_etude' }); })
      .catch(function (e) { console.error(e); S.err = t.pdfError; refresh(); });
  }
  function buildPdf() {
    var lg = L(), t = T[lg], en = lg === 'en';
    var jsPDF = window.jspdf.jsPDF, doc = new jsPDF({ unit: 'mm', format: 'letter' });
    var r = S.result, a = S.a, k = S.contact;
    var W = doc.internal.pageSize.getWidth(), Hh = doc.internal.pageSize.getHeight(), M = 18, CW = W - 2 * M;
    var VERT = [32, 59, 50], VERT2 = [47, 82, 70], OR = [170, 146, 115], ORP = [233, 225, 211], CREME = [245, 242, 234], ENCRE = [31, 38, 34], GRIS = [102, 112, 106], BLANC = [255, 255, 255];
    var M$ = function (n) { return money(n, lg); };
    var today = new Date().toLocaleDateString(en ? 'en-CA' : 'fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    var y = 0, page = 1;
    var fill = function (c) { doc.setFillColor(c[0], c[1], c[2]); }, ink = function (c) { doc.setTextColor(c[0], c[1], c[2]); }, line = function (c) { doc.setDrawColor(c[0], c[1], c[2]); };
    function font(st, sz) { doc.setFont('helvetica', st); doc.setFontSize(sz); }
    function serif(st, sz) { doc.setFont('times', st); doc.setFontSize(sz); }
    function entete() {
      fill(VERT); doc.rect(0, 0, W, 24, 'F'); fill(OR); doc.rect(0, 24, W, 0.8, 'F');
      serif('bold', 17); ink(BLANC); doc.text('COMFORTIUM', M, 13);
      font('normal', 7); ink([214, 196, 160]); doc.text(en ? 'HEATING · COOLING · COMFORT' : 'CHAUFFAGE · CLIMATISATION · CONFORT', M, 18.5);
      font('bold', 8.5); ink(BLANC); doc.text(en ? 'ENERGY USE STUDY' : 'ÉTUDE DE CONSOMMATION', W - M, 13, { align: 'right' });
      font('normal', 8); ink([201, 212, 204]); doc.text(today, W - M, 18.5, { align: 'right' });
      y = 36;
    }
    function pied() {
      line(ORP); doc.setLineWidth(0.3); doc.line(M, Hh - 15, W - M, Hh - 15);
      font('normal', 7); ink(GRIS);
      doc.text('Comfortium · 169, rue Louise, Longueuil (Québec) J4J 2T2 · (514) 444-7483 · info@comfortium.ca', M, Hh - 10);
      doc.text((en ? 'Installer SPC · RBQ licence 2638-8587 · page ' : 'Installateur SPC · Licence RBQ 2638-8587 · page ') + page, W - M, Hh - 10, { align: 'right' });
    }
    function nouvellePage() { pied(); doc.addPage(); page++; entete(); }
    function place(h) { if (y + h > Hh - 22) nouvellePage(); }
    function section(txt) { place(16); font('bold', 7.5); ink(OR); doc.text(txt.toUpperCase(), M, y, { charSpace: 0.6 }); y += 2.5; line(ORP); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 6; }
    function para(txt, sz, c, st) { sz = sz || 9.5; font(st || 'normal', sz); ink(c || ENCRE); var l = doc.splitTextToSize(txt, CW); place(l.length * sz * 0.42 + 2); doc.text(l, M, y); y += l.length * sz * 0.42 + 2.5; }
    function grille(items) { // faits sur deux colonnes
      var colW = CW / 2, i;
      for (i = 0; i < items.length; i += 2) {
        place(12);
        [items[i], items[i + 1]].forEach(function (it, j) {
          if (!it) return; var x = M + j * colW;
          font('normal', 7); ink(GRIS); doc.text(String(it[0]).toUpperCase(), x, y, { charSpace: 0.3 });
          font('bold', 9.5); ink(ENCRE); var l = doc.splitTextToSize(String(it[1] || '—'), colW - 6); doc.text(l, x, y + 4.6);
        });
        y += 12;
      }
    }
    function puce(txt) { font('normal', 9.3); var l = doc.splitTextToSize(txt, CW - 7); place(l.length * 4.1 + 1.5); fill(OR); doc.circle(M + 1.4, y - 1.2, 0.9, 'F'); ink(ENCRE); doc.text(l, M + 5, y); y += l.length * 4.1 + 1.6; }

    // Page 1 — résultat
    entete();
    serif('normal', 22); ink(ENCRE); doc.text(k.prenom + ' ' + k.nom, M, y); y += 6;
    font('normal', 8.5); ink(GRIS); doc.text(k.email + ' · ' + k.tel + ' · ' + String(a.cp || '').toUpperCase() + (en ? ' · verified contact' : ' · coordonnées vérifiées'), M, y); y += 9;

    var maz = a.energie === 'mazout' || a.energie === 'bienergie';
    if (r.eco != null && r.eco >= 100) {
      fill(VERT); doc.roundedRect(M, y, CW, 34, 2.5, 2.5, 'F');
      font('bold', 7.5); ink([214, 196, 160]); doc.text(en ? 'ESTIMATED SAVINGS' : 'ÉCONOMIE ESTIMÉE', M + 8, y + 9, { charSpace: 0.6 });
      serif('normal', 30); ink(BLANC); doc.text(M$(arr(r.eco)) + (en ? ' / year' : ' / an'), M + 8, y + 22);
      font('normal', 8.5); ink([201, 212, 204]);
      doc.text((en ? 'Realistic range ' : 'Fourchette réaliste ') + M$(arr(r.eco * (1 - H.marge))) + (en ? ' to ' : ' à ') + M$(arr(r.eco * (1 + H.marge))) + ' · ' + (r.base === 'factures' ? (en ? 'from your bills' : 'selon vos factures') : (en ? 'estimated from your house' : 'estimée selon votre maison')), M + 8, y + 29);
      font('normal', 8); ink([201, 212, 204]); doc.text((en ? 'Over 15 years: ' : 'Sur 15 ans : ') + M$(arr(r.eco * 15, 500)), W - M - 8, y + 9, { align: 'right' });
      y += 44;
      // Comparaison avant / après (barres à l'échelle)
      section(en ? 'Your heating cost per year' : 'Votre coût de chauffage par année');
      var max = Math.max(r.avant, r.apres), bw = CW - 62;
      [[t.curCost, r.avant, ORP, (maz ? (en ? 'Oil' : 'Mazout') : (en ? 'Electricity' : 'Électricité'))], [t.newCost(t.solNom[r.sol]), r.apres, VERT2, en ? 'Electricity, backup included' : 'Électricité, appoint compris']].forEach(function (b) {
        place(14); font('bold', 9); ink(ENCRE); doc.text(b[0].charAt(0).toUpperCase() + b[0].slice(1), M, y);
        font('normal', 7.5); ink(GRIS); doc.text(b[3], M, y + 4);
        fill(b[2]); doc.roundedRect(M + 62, y - 4, Math.max(3, bw * b[1] / max), 8, 1.2, 1.2, 'F');
        font('bold', 9.5); ink(b[2] === VERT2 ? BLANC : ENCRE);
        var lab = M$(arr(b[1])), wbar = bw * b[1] / max;
        if (wbar > 30) doc.text(lab, M + 62 + wbar - 3, y + 1.4, { align: 'right' }); else { ink(ENCRE); doc.text(lab, M + 62 + wbar + 3, y + 1.4); }
        y += 13;
      });
      y += 2;
    } else {
      para(r.eco == null ? t.notComputed : t.noSaving, 10, VERT, 'bold'); y += 2;
    }

    section(en ? 'Your home' : 'Votre maison');
    var f = t;
    grille([
      [en ? 'Property' : 'Propriété', labelOf(f.prop, a.prop)], [en ? 'Heated area' : 'Superficie chauffée', nfmt(a.sup, lg) + (en ? ' sq ft · ' : ' pieds carrés · ') + labelOf(f.etOpts, a.etages) + (en ? ' floor(s)' : ' étage(s)')],
      [en ? 'Year built · insulation' : 'Construction · isolation', labelOf(f.anOpts, a.annee) + ' · ' + labelOf(f.isOpts, a.isol)], [en ? 'Heating system' : 'Système de chauffage', labelOf(f.syst, a.syst) + ' · ' + labelOf(f.energie.concat([f.bois]), a.energie)],
      [en ? 'Unit age' : 'Âge de l’appareil', labelOf(f.agOpts, a.age)], [en ? 'Electrical' : 'Électricité', labelOf(f.enOpts, a.entree) + ' · ' + labelOf(f.paOpts, a.panneau)],
      [en ? 'Chosen solution' : 'Solution retenue', labelOf(solutions(), a.solution) + (a.zones ? ' · ' + a.zones + ' zones' : '')], [en ? 'Timeline' : 'Échéancier', labelOf(f.ecOpts, a.echeance)]
    ].concat(maz ? [[en ? 'Oil tank' : 'Réservoir', labelOf(f.reservoir, a.reservoir) + ' · ' + (en ? 'pump-out: ' : 'pompage : ') + labelOf(f.poOpts, a.pomper)], [en ? 'Oil used' : 'Mazout utilisé', (en ? 'about ' : 'environ ') + nfmt(arr(r.litres || 0, 50), lg) + (en ? ' litres / year' : ' litres / an')]] : [])
      .concat(a.model ? [[en ? 'Model (calculator)' : 'Modèle (calculateur)', a.model.brand + ' ' + a.model.out + (a.model.ahri ? ' · AHRI ' + a.model.ahri : '')]] : []));

    var w = travaux(a, lg);
    if (w.length) { section(t.works); w.forEach(puce); y += 2; }

    // Page 2 — subventions et suite
    nouvellePage();
    section(en ? 'Rebates to look at' : 'Subventions à examiner');
    if (r.lv) {
      place(18); fill(CREME); doc.roundedRect(M, y - 4, CW, 15, 2, 2, 'F');
      font('bold', 10); ink(ENCRE); doc.text(en ? 'LogisVert — Hydro-Québec' : 'LogisVert — Hydro-Québec', M + 5, y + 1.5);
      font('normal', 7.8); ink(GRIS); doc.text(r.lv.exact ? (en ? 'Amount for the chosen model, subject to eligibility' : 'Montant du modèle choisi, sous réserve d’admissibilité') : (en ? 'Range for this capacity, depending on the model installed' : 'Fourchette pour cette puissance, selon le modèle installé'), M + 5, y + 6.5);
      serif('bold', 14); ink(VERT); doc.text(r.lv.exact ? M$(r.lv.min) : M$(r.lv.min) + (en ? ' to ' : ' à ') + M$(r.lv.max), W - M - 5, y + 3, { align: 'right' });
      y += 17;
    }
    if (r.laval) puce(en ? 'City of Laval, oil heating replacement (by-law L-12494): up to ' + M$(r.laval) + ' depending on the building, with tank removal. Work completed by December 31, 2026, application by January 31, 2027.' : 'Ville de Laval, remplacement du chauffage au mazout (règlement L-12494) : jusqu’à ' + M$(r.laval) + ' selon le bâtiment, avec le retrait du réservoir. Travaux terminés au plus tard le 31 décembre 2026, demande au plus tard le 31 janvier 2027.');
    if (subvList(r, a, lg).join('').indexOf('2027') >= 0) puce(en ? 'Federal heat pump rebate program announced October 8, 2026: up to $10,000 for households below the median income and $2,000 for others, according to the announcement. Online portal planned for January 2027, approval in 24 hours, no energy assessment, stackable with LogisVert. Detailed rules to be published.' : 'Programme fédéral de remises pour les thermopompes, annoncé le 8 octobre 2026 : selon l’annonce, jusqu’à 10 000 $ pour les ménages sous le revenu médian et 2 000 $ pour les autres. Portail en ligne prévu en janvier 2027, approbation en 24 h, aucune évaluation énergétique, cumulable avec LogisVert. Règles détaillées à publier.');
    if (a.prop === 'commerce') puce(en ? 'Hydro-Québec Solutions efficaces program for businesses: financial assistance assessed for your building during the visit.' : 'Programme Solutions efficaces d’Hydro-Québec pour les entreprises : aide financière évaluée pour votre bâtiment lors de la visite.');
    if (!r.lv && !r.laval && a.prop !== 'commerce' && subvList(r, a, lg).length === 0) para(en ? 'The solution chosen does not qualify for heat pump rebates. We will review other options with you during the visit.' : 'La solution choisie n’est pas admissible aux subventions pour thermopompes. Nous verrons les autres options avec vous lors de la visite.', 9.3, GRIS);
    y += 3;
    section(en ? 'How Comfortium takes care of it' : 'Comment Comfortium s’en occupe');
    [en ? 'Home assessment visit, without obligation: needs, sizing, electrical service.' : 'Visite d’évaluation à domicile, sans engagement : besoins, dimensionnement, entrée électrique.',
      en ? 'Detailed quote: eligible equipment, related work and coordination of the trades.' : 'Soumission détaillée : équipement admissible, travaux connexes et coordination des corps de métier.',
      en ? 'Contract and authorization allowing Comfortium to prepare and file your rebate applications.' : 'Contrat et mandat qui autorise Comfortium à préparer et déposer vos demandes de subvention.',
      en ? 'Installation and start-up, then the post-installation rebate applications with the invoices and AHRI references.' : 'Installation et mise en service, puis dépôt des demandes après l’installation avec les factures et les références AHRI.',
      en ? 'Follow-up of your files until the programs decide.' : 'Suivi de vos dossiers jusqu’à la décision des programmes.'
    ].forEach(function (s, i) {
      font('normal', 9.3); var l = doc.splitTextToSize(s, CW - 11); place(l.length * 4.1 + 3);
      fill(VERT); doc.circle(M + 2.8, y - 1.2, 2.8, 'F'); font('bold', 8); ink(BLANC); doc.text(String(i + 1), M + 2.8, y + 0.1, { align: 'center' });
      font('normal', 9.3); ink(ENCRE); doc.text(l, M + 9, y); y += l.length * 4.1 + 3;
    });
    y += 2;
    section(en ? 'Documents to have on hand' : 'Documents à prévoir');
    para((en ? 'Proof of ownership (tax bill or deed) · recent Hydro-Québec bill' : 'Preuve de propriété (compte de taxes ou acte notarié) · facture Hydro-Québec récente') + (maz ? (en ? ' · recent oil bills' : ' · factures de mazout récentes') : '') + (en ? ' · any document about your current system.' : ' · tout document sur votre système actuel.'), 9.3);
    y += 3;
    place(26); fill(CREME); doc.roundedRect(M, y - 2, CW, 22, 2.5, 2.5, 'F'); fill(OR); doc.rect(M, y - 2, 1.4, 22, 'F');
    serif('normal', 14); ink(VERT); doc.text(en ? 'Next step: schedule your visit' : 'Prochaine étape : planifier votre visite', M + 7, y + 5);
    font('normal', 9); ink(ENCRE); doc.text(doc.splitTextToSize(en ? 'A Comfortium advisor will contact you within 24 to 48 hours. You can also call (514) 444-7483 or write to info@comfortium.ca and mention this study.' : 'Un conseiller Comfortium vous contacte en 24 à 48 h. Vous pouvez aussi appeler au (514) 444-7483 ou écrire à info@comfortium.ca en mentionnant cette étude.', CW - 14), M + 7, y + 11);
    y += 28;
    section(en ? 'Assumptions' : 'Hypothèses');
    para(en
      ? 'Non-binding estimate; the final price is set by a quote after the visit. Prices before taxes: heating oil $' + H.mazout.toFixed(2) + '/L (Régie de l’énergie, Montréal, week of November 2, 2026); electricity ' + (H.elec * 100).toFixed(3) + ' ¢/kWh (Hydro-Québec Rate D, price above 40 kWh per day, April 1, 2026). 10.2 kWh per litre of oil, current oil unit efficiency 72 to 84% depending on age. Seasonal efficiency and heat coverage: central 2.4 and 95%, multi-zone 2.6 and 80%, wall unit 2.8 and 45%, air-to-water 2.2 and 85%, the rest by electric backup. ' + (r.base === 'factures' ? 'Consumption from your figures.' : 'Consumption estimated from floor area, year built and insulation.') + ' Realistic range: plus or minus 15%.'
      : 'Estimation non contractuelle ; le prix final est établi par une soumission après la visite. Prix avant taxes : mazout ' + H.mazout.toFixed(2).replace('.', ',') + ' $/L (Régie de l’énergie, Montréal, semaine du 2 novembre 2026) ; électricité ' + (H.elec * 100).toFixed(3).replace('.', ',') + ' ¢/kWh (Hydro-Québec, tarif D, prix au-delà de 40 kWh par jour, 1er avril 2026). 10,2 kWh par litre de mazout, rendement de l’appareil au mazout de 72 à 84 % selon son âge. Rendement saisonnier et part de la chaleur couverte : centrale 2,4 et 95 %, multizone 2,6 et 80 %, murale 2,8 et 45 %, air-eau 2,2 et 85 %, le reste par l’appoint électrique. ' + (r.base === 'factures' ? 'Consommation tirée de vos chiffres.' : 'Consommation estimée selon la superficie, l’année de construction et l’isolation.') + ' Fourchette réaliste : plus ou moins 15 %.', 7.3, GRIS);
    pied();
    doc.save((en ? 'Energy-study-Comfortium-' : 'Etude-consommation-Comfortium-') + String(k.nom).replace(/[^A-Za-z0-9À-ÿ-]/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  // ── Style ──────────────────────────────────────────────────────────
  var st = document.createElement('style');
  st.textContent = '.et-panel{padding:14px 14px 12px!important}.et-panel *{box-sizing:border-box}' +
    '.et-prog{margin:0 0 10px}.et-prog span{display:block;font:600 11px Arial,Helvetica,sans-serif;color:#66706a;margin-bottom:5px}.et-bar{height:4px;background:#e9e1d3;border-radius:99px;overflow:hidden}.et-bar i{display:block;height:100%;background:#203b32;border-radius:99px;transition:width .3s ease}' +
    '.et-title{font:normal 19px/1.25 Georgia,"Times New Roman",serif;color:#1f2622;margin:4px 0 4px}.et-why{font-size:12px;line-height:1.5;color:#66706a;margin:0 0 10px}.et-eyebrow{font:700 10.5px Arial,Helvetica,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#aa9273;margin:0 0 2px}' +
    '.et-lbl{display:block;font:700 10.5px Arial,Helvetica,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#aa9273;margin:12px 0 6px}' +
    '.et-tiles{display:grid;grid-template-columns:1fr 1fr;gap:7px}.et-tile{border:1.5px solid #e3ded2;background:#fff;border-radius:12px;padding:10px 9px;text-align:left;cursor:pointer;font:600 12.5px/1.25 Arial,Helvetica,sans-serif;color:#1f2622;display:flex;flex-direction:column;gap:5px;min-height:58px;transition:border-color .15s,background .15s}' +
    '.et-tile svg{width:22px;height:22px;stroke:#2f5246;fill:none;stroke-width:1.6}.et-tile small{font:400 11px/1.35 Arial,Helvetica,sans-serif;color:#66706a}.et-tile:hover{border-color:#b9c4bd}.et-tile[aria-pressed="true"]{border-color:#203b32;background:#f4f8f5;box-shadow:0 0 0 2px rgba(32,59,50,.12)}' +
    '.et-pills{display:flex;flex-wrap:wrap;gap:6px}.et-pill{border:1.5px solid #e3ded2;background:#fff;border-radius:999px;padding:7px 12px;font:600 12px Arial,Helvetica,sans-serif;cursor:pointer;color:#1f2622}.et-pill[aria-pressed="true"]{border-color:#203b32;background:#203b32;color:#f5f2ea}' +
    '.et-tile:focus-visible,.et-pill:focus-visible,.et-input:focus-visible,.et-primary:focus-visible,.et-btn-ghost:focus-visible{outline:2px solid #aa9273;outline-offset:2px}' +
    '.et-input{width:100%;border:1.5px solid #e3ded2;border-radius:10px;padding:10px 11px;font:15px Arial,Helvetica,sans-serif;background:#fff;color:#1f2622;margin-top:6px}.et-code{text-align:center;font:22px Georgia,serif;letter-spacing:.3em}' +
    '.et-range{display:flex;align-items:center;gap:10px}.et-range input{flex:1;accent-color:#203b32}.et-range output{font:normal 17px Georgia,serif;min-width:82px;text-align:right;color:#1f2622}' +
    '.et-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.et-two .et-lbl{margin-top:4px}' +
    '.et-help{font-size:11.5px;line-height:1.45;color:#66706a;margin:6px 0}.et-check{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.45;margin:12px 0 4px;color:#4b5563}.et-check input{margin-top:2px;flex-shrink:0;accent-color:#203b32}' +
    '.et-radios{display:flex;gap:16px;font-size:13px;margin:2px 0 4px}.et-radios label{display:flex;gap:6px;align-items:center;cursor:pointer}' +
    '.et-live{margin:12px 0 0;border-radius:12px;background:#fff;border:1px solid #e3ded2;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px}.et-live small{display:block;font-size:10px;letter-spacing:.06em;color:#66706a}.et-live strong{font:normal 17px Georgia,serif;color:#203b32}.et-live span{font:700 10px Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#aa9273}' +
    '.et-actions{display:flex;gap:8px;margin-top:14px}.et-actions .chat-submit-btn{flex:1;margin-top:0}.et-primary{background:#203b32!important;color:#f5f2ea!important;border:1px solid #aa9273!important;border-radius:12px!important}.et-primary[disabled]{opacity:.45;cursor:not-allowed}' +
    '.et-btn-ghost{flex:0 0 auto;background:#fff;color:#203b32;border:1px solid #9eaea2;border-radius:12px;padding:10px 14px;font:600 14px Arial,Helvetica,sans-serif;cursor:pointer}' +
    '.et-links{text-align:center;font-size:12px;margin-top:8px;color:#7a8580}.et-link{background:none;border:0;color:#203b32;text-decoration:underline;cursor:pointer;font-size:12px;padding:2px}' +
    '.et-err{color:#b91c1c;font-size:12px;margin:8px 0 0}.et-rows{margin:8px 0 6px;border-top:1px solid #e3ded2}.et-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #e3ded2;font-size:12.5px;color:#4d5a53}.et-row b{color:#1f2622;text-align:right;font-variant-numeric:tabular-nums}' +
    '.et-chips{display:flex;flex-wrap:wrap;gap:5px}.et-chips span{font-size:11px;border:1px solid #d9cdb8;color:#7a6446;border-radius:999px;padding:3px 8px;background:#fbf8f2}' +
    '@media (prefers-reduced-motion:reduce){.et-bar i{transition:none}}';
  document.head.appendChild(st);

  // Changement de langue : le chat est réinitialisé, l'étude en cours est reprise avec ses réponses.
  function snapshot() { return (S && !S.closed && S.cur !== 'resultat') ? JSON.parse(JSON.stringify(S)) : null; }
  function restore(snap) {
    if (!snap) return; S = snap; S.closed = false; S.err = ''; S.msg = '';
    if (S.cur === 'code') S.cur = 'coordonnees';
    if (typeof addBot === 'function') addBot(L() === 'en' ? 'Let’s pick up your energy use study where you left off.' : 'Reprenons votre étude de consommation là où vous étiez.', null, null, 300);
    setTimeout(refresh, 380);
  }
  window.calorEtude = { snapshot: snapshot, restore: restore, start: start, panel: panel, active: active, stop: stop, freeze: freeze, pdf: makePdf, blocking: function () { return !!(S && !S.closed && S.cur !== 'resultat'); }, hint: function () { return tx().hint; }, _calc: calc, _hyp: H, _state: function () { return S; } };

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

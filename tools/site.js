// Site commercial ZintaServices : node tools/site.js  →  site/ (français à la racine, anglais dans /en/)
// Univers : logiciel SknEDU-studio, fournitures scolaires et de bureau, compléments alimentaires et produits bio,
// appareils et accessoires électroniques / informatiques.
// Les offres et les prix du logiciel viennent de package.json › commercial (les mêmes que dans le logiciel).
// Publication : npx --yes wrangler@4 pages deploy site --project-name zintaservices
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site');
const C = require('../package.json').commercial;
const BASE = 'https://zintaservices.pages.dev';
const RELEASES = 'https://github.com/ZintaSkn/edupdf-studio/releases/latest';
const REPO = 'https://github.com/ZintaSkn/edupdf-studio';
const WA = String(C.whatsapp).replace(/[^\d]/g, ''); // 2250506848164
const PHONE = '+225 05 06 84 81 64';
const EMAIL = C.email;
const VENDEUR = C.vendeur || 'ZintaServices';
const TITULAIRE = 'SEHI BI Kouahi Nestor';
const YEAR = 2026;
const INLINE_JS = "document.documentElement.classList.add('js')"; // seul script en ligne (empreinte dans la CSP)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n, lang) => Number(n).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
const price = (n, lang) => `${num(n, lang)} ${C.devise || 'FCFA'}`;
const OFFRES = C.offres.map((o) => ({ ...o, prix: Number(String(o.prix).replace(/[^\d]/g, '')) }));
const offre = (id) => OFFRES.find((o) => o.id === id);
const OFFRE_EN = { 'ens-3m': 'Teacher — 3 months', 'ens-1a': 'Teacher — 1 year', 'ens-2a': 'Teacher — 2 years', 'etab-1a': 'School — 1 year per seat (10 seats minimum)' };
const offreLabel = (o, lang) => (lang === 'en' ? OFFRE_EN[o.id] || o.libelle : o.libelle);
const perMonth = (o) => Math.round(o.prix / (o.jours / 30.4) / 5) * 5;

// ------------------------------------------------------------------ pages (chemins français / anglais)
const PAGES = {
  home: { fr: '/', en: '/en/' },
  logiciel: { fr: '/sknedu-studio/', en: '/en/sknedu-studio/' },
  download: { fr: '/sknedu-studio/telecharger/', en: '/en/sknedu-studio/download/' },
  pricing: { fr: '/sknedu-studio/tarifs/', en: '/en/sknedu-studio/pricing/' },
  order: { fr: '/sknedu-studio/commander/', en: '/en/sknedu-studio/order/' },
  fournitures: { fr: '/fournitures/', en: '/en/supplies/' },
  bio: { fr: '/bio/', en: '/en/organic/' },
  electronique: { fr: '/electronique/', en: '/en/electronics/' },
  privacy: { fr: '/confidentialite/', en: '/en/privacy/' },
  contact: { fr: '/contact/', en: '/en/contact/' },
  legal: { fr: '/mentions-legales/', en: '/en/legal-notice/' },
};
const SOFT = ['logiciel', 'download', 'pricing', 'order'];
const NAV = [['home', 'Accueil', 'Home'], ['logiciel', 'SknEDU-studio', 'SknEDU-studio'], ['fournitures', 'Fournitures', 'Supplies'], ['bio', 'Bio & compléments', 'Organic & supplements'], ['electronique', 'Électronique', 'Electronics'], ['contact', 'Contact', 'Contact']];
const SUBNAV = [['logiciel', 'Présentation', 'Overview'], ['download', 'Télécharger', 'Download'], ['pricing', 'Tarifs', 'Pricing'], ['order', 'Commander une licence', 'Order a licence']];

const ICON = {
  wa: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.2L4 7.3V17h16V7.3l-8 4.9ZM5.3 7 12 11.1 18.7 7H5.3Z"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M11 3h2v9.6l3.3-3.3 1.4 1.4L12 16.4l-5.7-5.7 1.4-1.4 3.3 3.3V3ZM4 18h16v2H4v-2Z"/></svg>',
  win: '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M3 5.5 10 4.5v7H3v-6Zm8-1.2L21 3v8.5H11V4.3ZM3 12.5h7v7l-7-1v-6Zm8 0h10V21l-10-1.4v-7.1Z"/></svg>',
  mac: '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M16.4 12.7c0-2.4 2-3.6 2.1-3.7a4.6 4.6 0 0 0-3.6-1.9c-1.5-.2-3 .9-3.7.9s-2-.9-3.2-.8A4.8 4.8 0 0 0 3.9 9.6c-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.2.8 2.1-1.2 2.9-2.4a10 10 0 0 0 1.3-2.7 4.2 4.2 0 0 1-2.2-4ZM14 5.6A4.3 4.3 0 0 0 15 2.5a4.4 4.4 0 0 0-2.9 1.5 4.1 4.1 0 0 0-1 3 3.6 3.6 0 0 0 2.9-1.4Z"/></svg>',
  linux: '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M12 2c-2.2 0-3.6 1.8-3.6 4.4 0 1.3.3 2.4-.6 3.8-1.1 1.6-2.6 3.5-2.6 6 0 .8.1 1.4.4 2-.8.4-1.6.9-1.6 1.6 0 1 1.5 1.2 3 1.6 1 .3 1.9.7 2.6.7.9 0 1.4-.6 1.9-.9h1c.5.3 1 .9 1.9.9.7 0 1.6-.4 2.6-.7 1.5-.4 3-.6 3-1.6 0-.7-.8-1.2-1.6-1.6.3-.6.4-1.2.4-2 0-2.5-1.5-4.4-2.6-6-.9-1.4-.6-2.5-.6-3.8C15.6 3.8 14.2 2 12 2Zm-1.5 4.5c.4 0 .7.5.7 1.1 0 .3 0 .5-.2.7l-.5-.2c.1-.1.1-.3.1-.5 0-.3-.1-.5-.2-.5s-.2.2-.2.5v.2l-.4-.1v-.1c0-.6.3-1.1.7-1.1Zm3 0c.4 0 .7.5.7 1.1v.2l-.4.1v-.3c0-.3-.1-.5-.3-.5-.1 0-.2.2-.2.5 0 .2 0 .3.1.4l-.4.2c-.1-.2-.2-.4-.2-.6 0-.6.3-1.1.7-1.1ZM12 9c.8 0 2 .7 2 1s-1.2 1.1-2 1.1-2-.8-2-1.1 1.2-1 2-1Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8V3Zm-3 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v10h10V9H5Z"/></svg>',
  gh: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.2-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .6 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"/></svg>',
};

const WAVES = `<svg class="waves" viewBox="0 0 1440 110" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><linearGradient id="wg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#2f6fe4"/><stop offset=".38" stop-color="#14b8a6"/><stop offset=".66" stop-color="#22a35a"/><stop offset="1" stop-color="#F1B434"/></linearGradient></defs><path d="M0 62C320 8 760 112 1440 34V110H0Z" fill="url(#wg)" opacity=".35"/><path d="M0 84C420 40 900 118 1440 66V110H0Z" fill="url(#wg)"/><path d="M0 100C440 78 1000 120 1440 92V110H0Z" fill="#fff"/></svg>`;

/** Capture d'écran responsive (800 / 1600 px). */
function shot(name, alt, lang, { eager = false, cls = '' } = {}) {
  const n = `${name}-${lang}`;
  return `<a class="shot ${cls}" href="/img/${n}-1600.webp" target="_blank" rel="noopener"><img src="/img/${n}-800.webp" srcset="/img/${n}-800.webp 800w, /img/${n}-1600.webp 1600w" sizes="(min-width: 1000px) 620px, 100vw" width="1600" height="864" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></a>`;
}

// ------------------------------------------------------------------ univers (accueil, pied de page, pages produits)
const UNIVERS = [
  { key: 'logiciel', cls: 'u-soft', ic: '<img src="/img/logo-96.png" width="48" height="48" alt="" loading="lazy">',
    fr: ['Logiciel SknEDU-studio', 'L\'éditeur PDF hors ligne des enseignants : modifier les sujets, corriger les copies, OCR, conversions Office, assistant IA.', ['Essai gratuit 30 jours', 'Windows · macOS · Linux', `Dès ${price(OFFRES[0].prix, 'fr')}`]],
    en: ['SknEDU-studio software', 'The offline PDF editor for teachers: edit worksheets, grade papers, OCR, Office conversions, AI assistant.', ['30-day free trial', 'Windows · macOS · Linux', `From ${price(OFFRES[0].prix, 'en')}`]] },
  { key: 'fournitures', cls: 'u-four', ic: '✏️',
    fr: ['Fournitures scolaires et de bureau', 'Écriture, cahiers et papier, classement, matériel de classe et petit matériel de bureau, pour l\'école comme pour l\'entreprise.', ['Listes de rentrée', 'Écoles et entreprises', 'Commandes en quantité']],
    en: ['School and office supplies', 'Writing, notebooks and paper, filing, classroom supplies and office essentials, for school and for business.', ['Back-to-school lists', 'Schools and businesses', 'Bulk orders']] },
  { key: 'bio', cls: 'u-bio', ic: '🌿',
    fr: ['Compléments alimentaires et produits bio', 'Une sélection de compléments alimentaires et de produits naturels et bio, pour accompagner une alimentation variée et équilibrée.', ['Compléments', 'Alimentation bio', 'Soins naturels']],
    en: ['Food supplements and organic products', 'A selection of food supplements and natural and organic products, alongside a varied and balanced diet.', ['Supplements', 'Organic food', 'Natural care']] },
  { key: 'electronique', cls: 'u-elec', ic: '💻',
    fr: ['Appareils et accessoires électroniques et informatiques', 'Appareils, accessoires informatiques, stockage, charge et énergie, impression et réseau : pour travailler, enseigner et rester connecté.', ['Accessoires', 'Stockage', 'Charge et énergie']],
    en: ['Electronic and computer devices and accessories', 'Devices, computer accessories, storage, charging and power, printing and networking: to work, teach and stay connected.', ['Accessories', 'Storage', 'Charging and power']] },
];

// ------------------------------------------------------------------ gabarit commun
let ASSET_V = '';
function layout({ lang, key, title, desc, body, head = '', og }) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const p = PAGES[key]; const other = lang === 'fr' ? 'en' : 'fr';
  const url = BASE + p[lang];
  const inSoft = SOFT.includes(key);
  const ogImg = og || (inSoft ? `og-${lang}.jpg` : `og-zinta-${lang}.jpg`);
  const cur = (k) => (k === key || (k === 'logiciel' && inSoft) ? ' aria-current="page"' : '');
  const nav = NAV.map(([k, fr, en]) => `<a href="${PAGES[k][lang]}"${cur(k)}>${tr(fr, en)}</a>`).join('');
  const sub = inSoft ? `<nav class="subnav" aria-label="SknEDU-studio"><div class="wrap subnav-row"><span class="subnav-brand"><img src="/img/logo-96.png" width="26" height="26" alt="">SknEDU-studio</span>${SUBNAV.map(([k, fr, en]) => `<a href="${PAGES[k][lang]}"${k === key ? ' aria-current="page"' : ''}>${tr(fr, en)}</a>`).join('')}</div></nav>` : '';
  const prodLinks = UNIVERS.map((u) => `<li><a href="${PAGES[u.key][lang]}">${u[lang][0]}</a></li>`).join('');
  const siteLinks = [['download', 'Télécharger SknEDU-studio', 'Download SknEDU-studio'], ['pricing', 'Tarifs du logiciel', 'Software pricing'], ['order', 'Commander une licence', 'Order a licence'], ['privacy', 'Confidentialité', 'Privacy'], ['legal', 'Mentions légales', 'Legal notice'], ['contact', 'Contact', 'Contact']]
    .map(([k, fr, en]) => `<li><a href="${PAGES[k][lang]}">${tr(fr, en)}</a></li>`).join('');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="fr" href="${BASE + p.fr}">
<link rel="alternate" hreflang="en" href="${BASE + p.en}">
<link rel="alternate" hreflang="x-default" href="${BASE + p.fr}">
<meta name="theme-color" content="#001871">
<meta name="color-scheme" content="light">
<link rel="icon" href="/img/zinta.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/img/zinta-32.png">
<link rel="apple-touch-icon" href="/img/zinta-180.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${VENDEUR}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE}/img/${ogImg}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${tr('fr_FR', 'en_US')}">
<meta property="og:locale:alternate" content="${tr('en_US', 'fr_FR')}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/assets/site.css?v=${ASSET_V}">
<script>${INLINE_JS}</script>
<script src="/assets/site.js?v=${ASSET_V}" defer></script>
${head}</head>
<body>
<a class="skip" href="#contenu">${tr('Aller au contenu', 'Skip to content')}</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="${PAGES.home[lang]}" aria-label="${VENDEUR} — ${tr('accueil', 'home')}"><img src="/img/zinta.svg" width="42" height="42" alt=""><span><b>Zinta<i>Services</i></b><small>${tr('Logiciel · Fournitures · Bio · Électronique', 'Software · Supplies · Organic · Electronics')}</small></span></a>
    <button class="menu" type="button" aria-expanded="false" aria-controls="nav"><span class="burger" aria-hidden="true"></span>Menu</button>
    <nav id="nav" aria-label="${tr('Navigation principale', 'Main navigation')}">${nav}<a class="lang" href="${p[other]}" hreflang="${other}" lang="${other}" title="${tr('English version', 'Version française')}">${tr('🌐 EN', '🌐 FR')}</a></nav>
  </div>
</header>
${sub}
<main id="contenu">
${body}
</main>
<footer class="foot">
  <div class="wrap foot-grid">
    <div>
      <a class="brand" href="${PAGES.home[lang]}"><img src="/img/zinta.svg" width="42" height="42" alt="" loading="lazy"><span><b>Zinta<i>Services</i></b><small>Côte d'Ivoire</small></span></a>
      <p>${tr('Le logiciel SknEDU-studio, des fournitures scolaires et de bureau, des compléments alimentaires et produits bio, des appareils et accessoires électroniques et informatiques.', 'The SknEDU-studio software, school and office supplies, food supplements and organic products, electronic and computer devices and accessories.')}</p>
    </div>
    <div>
      <h2>${tr('Nos produits', 'Our products')}</h2>
      <ul>${prodLinks}</ul>
    </div>
    <div>
      <h2>${tr('Le site', 'Site')}</h2>
      <ul>${siteLinks}</ul>
    </div>
    <div>
      <h2>${tr('Nous joindre', 'Get in touch')}</h2>
      <ul class="contact-list">
        <li><a href="https://wa.me/${WA}" rel="noopener">${ICON.wa} WhatsApp ${PHONE}</a></li>
        <li><a href="mailto:${EMAIL}">${ICON.mail} ${EMAIL}</a></li>
        <li><a href="${REPO}" rel="noopener">${ICON.gh} ${tr('SknEDU-studio sur GitHub', 'SknEDU-studio on GitHub')}</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap foot-legal">
    <p>© ${YEAR} ${VENDEUR} — ${TITULAIRE}. ${tr('« SknEDU-studio » et son logo sont des marques réservées ; le logiciel est libre (AGPL-3.0).', '“SknEDU-studio” and its logo are reserved trademarks; the software is free software (AGPL-3.0).')}</p>
  </div>
</footer>
<a class="wa-float" href="https://wa.me/${WA}" rel="noopener" aria-label="${tr('Écrire sur WhatsApp', 'Message us on WhatsApp')}">${ICON.wa}<span>WhatsApp</span></a>
</body>
</html>
`;
}

function pageHead(title, lead, { cls = '' } = {}) {
  return `<section class="pagehead ${cls}"><div class="wrap"><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</div>${WAVES}</section>`;
}

/** Commande en 3 étapes (produits). */
function howToOrder(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  return `<ol class="steps">
      <li><h3>${tr('Choisissez', 'Choose')}</h3><p>${tr('Parcourez nos univers ou préparez directement votre liste d\'articles.', 'Browse our ranges or simply write your list of items.')}</p></li>
      <li><h3>${tr('Demandez', 'Ask')}</h3><p>${tr('Envoyez votre demande par WhatsApp ou par e-mail : nous vous répondons avec la disponibilité, le prix et les modalités de livraison.', 'Send your request by WhatsApp or e-mail: we reply with availability, price and delivery options.')}</p></li>
      <li><h3>${tr('Payez et recevez', 'Pay and receive')}</h3><p>${tr('Paiement par Wave ou MTN MoMo. Livraison ou retrait : à convenir ensemble.', 'Payment by Wave or MTN MoMo. Delivery or pick-up: agreed together.')}</p></li>
    </ol>`;
}

// ------------------------------------------------------------------ Accueil ZintaServices
function home(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const tiles = UNIVERS.map((u) => `<a class="tile ${u.cls}" href="${PAGES[u.key][lang]}"><span class="tile-ic" aria-hidden="true">${u.ic}</span><span>${u[lang][0]}</span></a>`).join('\n');
  const cards = UNIVERS.map((u) => `<article class="ucard ${u.cls}">
      <span class="ucard-ic" aria-hidden="true">${u.ic}</span>
      <h3><a href="${PAGES[u.key][lang]}">${u[lang][0]}</a></h3>
      <p>${u[lang][1]}</p>
      <ul class="chips">${u[lang][2].map((c) => `<li>${c}</li>`).join('')}</ul>
      <span class="more" aria-hidden="true">${tr('Découvrir', 'Discover')} →</span>
    </article>`).join('\n');
  const ld = { '@context': 'https://schema.org', '@type': 'Organization', name: VENDEUR, url: BASE + PAGES.home[lang], logo: `${BASE}/img/zinta-180.png`, email: EMAIL, telephone: PHONE.replace(/ /g, ''),
    founder: { '@type': 'Person', name: TITULAIRE }, address: { '@type': 'PostalAddress', addressCountry: 'CI' },
    contactPoint: [{ '@type': 'ContactPoint', telephone: PHONE.replace(/ /g, ''), contactType: 'customer service', availableLanguage: ['fr', 'en'] }] };
  const body = `
<section class="hero hero-home">
  <div class="wrap hero-grid">
    <div class="hero-txt">
      <p class="eyebrow">${VENDEUR} · Côte d'Ivoire</p>
      <h1>${tr('Tout pour apprendre, travailler <em>et bien vivre</em>', 'Everything to learn, work <em>and live well</em>')}</h1>
      <p class="lead">${tr('Le logiciel SknEDU-studio pour les enseignants, des fournitures scolaires et de bureau, des compléments alimentaires et produits bio, des appareils et accessoires électroniques et informatiques.', 'The SknEDU-studio software for teachers, school and office supplies, food supplements and organic products, electronic and computer devices and accessories.')}</p>
      <div class="cta">
        <a class="btn btn-gold btn-lg" href="#univers">${tr('Découvrir nos produits', 'Discover our products')}</a>
        <a class="btn btn-ghost btn-lg" href="https://wa.me/${WA}" rel="noopener">${ICON.wa} WhatsApp</a>
      </div>
      <ul class="hero-points">
        <li>${tr('Demande et réponse sur WhatsApp', 'Ask and get answers on WhatsApp')}</li>
        <li>${tr('Paiement Wave ou MTN MoMo', 'Pay with Wave or MTN MoMo')}</li>
        <li>${tr('Particuliers, écoles et entreprises', 'Individuals, schools and businesses')}</li>
      </ul>
    </div>
    <nav class="tiles" aria-label="${tr('Nos univers', 'Our ranges')}">
${tiles}
    </nav>
  </div>
  ${WAVES}
</section>

<section class="sec" id="univers">
  <div class="wrap">
    <h2 class="h2c">${tr('Nos univers', 'Our ranges')}</h2>
    <p class="intro">${tr('Quatre familles de produits, un seul interlocuteur : vous demandez, nous vous répondons avec la disponibilité et le prix.', 'Four product families, one contact: you ask, we reply with availability and price.')}</p>
    <div class="ucards">
${cards}
    </div>
  </div>
</section>

<section class="sec sec-alt">
  <div class="wrap">
    <h2 class="h2c">${tr('Commander, c\'est simple', 'Ordering is simple')}</h2>
    ${howToOrder(lang)}
  </div>
</section>

<section class="sec">
  <div class="wrap spot">
    <div class="spot-img">${shot('correction', tr('SknEDU-studio : copie d\'élève corrigée avec des tampons', 'SknEDU-studio: a student\'s paper graded with stamps'), lang)}</div>
    <div class="spot-txt">
      <p class="kicker">${tr('Notre logiciel', 'Our software')}</p>
      <h2>${tr('SknEDU-studio, l\'éditeur PDF hors ligne des enseignants', 'SknEDU-studio, the offline PDF editor for teachers')}</h2>
      <ul class="checks">
        <li>${tr('Modifier un PDF dans sa police d\'origine, OCR des scans', 'Edit a PDF in its original font, OCR for scans')}</li>
        <li>${tr('Tampons, notes et relevé des notes, évaluations différenciées', 'Stamps, marks and grade summary, differentiated tests')}</li>
        <li>${tr('Conversions Word / Excel / PowerPoint, assistant IA', 'Word / Excel / PowerPoint conversions, AI assistant')}</li>
        <li>${tr('Fonctionne sans Internet, en français et en anglais', 'Works without Internet, in French and English')}</li>
      </ul>
      <div class="cta">
        <a class="btn btn-gold" href="${PAGES.download[lang]}">${ICON.down} ${tr('Essai gratuit 30 jours', '30-day free trial')}</a>
        <a class="btn btn-line" href="${PAGES.logiciel[lang]}">${tr('En savoir plus', 'Learn more')}</a>
      </div>
    </div>
  </div>
</section>

<section class="sec sec-alt">
  <div class="wrap">
    <h2 class="h2c">${tr('Pourquoi ZintaServices ?', 'Why ZintaServices?')}</h2>
    <div class="why">
      <div><span class="ic" aria-hidden="true">💬</span><h3>${tr('Un contact direct', 'A direct contact')}</h3><p>${tr(`Une question, une liste, un devis : écrivez-nous sur WhatsApp au ${PHONE}.`, `A question, a list, a quote: message us on WhatsApp at ${PHONE}.`)}</p></div>
      <div><span class="ic" aria-hidden="true">📱</span><h3>${tr('Paiement Mobile Money', 'Mobile Money payment')}</h3><p>${tr('Wave ou MTN MoMo, sans carte bancaire, en francs CFA.', 'Wave or MTN MoMo, no bank card needed, in CFA francs.')}</p></div>
      <div><span class="ic" aria-hidden="true">🏫</span><h3>${tr('Écoles et entreprises', 'Schools and businesses')}</h3><p>${tr('Fournitures en quantité, équipement informatique, licences SknEDU-studio pour tous les postes : demandez un devis.', 'Supplies in bulk, IT equipment, SknEDU-studio licences for every computer: ask for a quote.')}</p></div>
      <div><span class="ic" aria-hidden="true">🤝</span><h3>${tr('Des conseils honnêtes', 'Honest advice')}</h3><p>${tr('Nous vous indiquons ce qui est disponible et ce qui convient à votre besoin, avant toute commande.', 'We tell you what is available and what suits your needs, before you order.')}</p></div>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap band-row">
    <div><h2>${tr('Une liste, une question, un devis ?', 'A list, a question, a quote?')}</h2><p>${tr('Envoyez-nous votre demande : nous vous répondons rapidement.', 'Send us your request: we will get back to you quickly.')}</p></div>
    <div class="cta"><a class="btn btn-gold btn-lg" href="https://wa.me/${WA}" rel="noopener">${ICON.wa} WhatsApp</a><a class="btn btn-ghost btn-lg" href="mailto:${EMAIL}">${ICON.mail} E-mail</a></div>
  </div>
</section>`;
  return layout({ lang, key: 'home', body,
    title: tr('ZintaServices — logiciel SknEDU-studio, fournitures, bio et électronique', 'ZintaServices — SknEDU-studio software, supplies, organic and electronics'),
    desc: tr('ZintaServices : le logiciel SknEDU-studio pour les enseignants, fournitures scolaires et de bureau, compléments alimentaires et produits bio, appareils et accessoires électroniques et informatiques. Commande par WhatsApp, paiement Wave ou MTN MoMo.', 'ZintaServices: the SknEDU-studio software for teachers, school and office supplies, food supplements and organic products, electronic and computer devices and accessories. Order by WhatsApp, pay with Wave or MTN MoMo.'),
    head: `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n` });
}

// ------------------------------------------------------------------ Pages produits
const CATS = {
  fournitures: {
    cls: 'u-four', ic: '✏️',
    fr: { lead: 'Pour les élèves, les enseignants, les établissements et les entreprises : de quoi écrire, classer, s\'organiser et bien démarrer l\'année.', desc: 'Fournitures scolaires et de bureau chez ZintaServices : écriture, cahiers et papier, classement, matériel de classe, petit matériel de bureau. Demande par WhatsApp, paiement Wave ou MTN MoMo.', placeholder: 'Ex. : 10 cahiers de 200 pages, 1 boîte de stylos bleus, 2 ramettes de papier A4…' },
    en: { lead: 'For students, teachers, schools and businesses: everything to write, file, get organised and start the year well.', desc: 'School and office supplies from ZintaServices: writing, notebooks and paper, filing, classroom supplies, office essentials. Request by WhatsApp, pay with Wave or MTN MoMo.', placeholder: 'E.g. 10 notebooks (200 pages), 1 box of blue pens, 2 reams of A4 paper…' },
    fam: [
      ['🖊️', 'Écriture', 'Writing', 'Stylos, crayons, feutres, surligneurs, marqueurs.', 'Pens, pencils, felt-tips, highlighters, markers.'],
      ['📒', 'Cahiers et papier', 'Notebooks and paper', 'Cahiers, blocs, feuilles, ramettes de papier, enveloppes.', 'Notebooks, pads, loose sheets, reams of paper, envelopes.'],
      ['🗂️', 'Classement', 'Filing', 'Classeurs, chemises, intercalaires, pochettes, boîtes d\'archives.', 'Binders, folders, dividers, sleeves, archive boxes.'],
      ['📐', 'Matériel de classe', 'Classroom supplies', 'Règles, équerres, compas, ardoises, craies, marqueurs pour tableau blanc.', 'Rulers, set squares, compasses, slates, chalk, whiteboard markers.'],
      ['📎', 'Petit matériel de bureau', 'Office essentials', 'Agrafeuses, perforateurs, trombones, colle, ciseaux, notes adhésives.', 'Staplers, hole punches, paper clips, glue, scissors, sticky notes.'],
      ['🧮', 'Calculatrices', 'Calculators', 'Calculatrices de poche, de bureau et scientifiques.', 'Pocket, desk and scientific calculators.'],
    ],
    extra: (tr, lang) => `<div class="cols2">
      <div class="card card-accent"><h2>📋 ${tr('Votre liste de rentrée', 'Your back-to-school list')}</h2><p>${tr('Envoyez-nous la liste de fournitures de l\'école, en photo ou en texte : nous vous répondons avec la disponibilité et le prix de chaque article.', 'Send us the school\'s supply list, as a photo or text: we reply with the availability and price of each item.')}</p><p><a class="btn btn-wa" href="https://wa.me/${WA}?text=${encodeURIComponent(tr('Bonjour ZintaServices, voici ma liste de fournitures :', 'Hello ZintaServices, here is my supply list:'))}" rel="noopener">${ICON.wa} ${tr('Envoyer ma liste sur WhatsApp', 'Send my list on WhatsApp')}</a></p></div>
      <div class="card"><h2>🏫 ${tr('Établissements et entreprises', 'Schools and businesses')}</h2><p>${tr('Commandes en quantité pour une classe, un établissement ou un bureau : indiquez les articles et les quantités, nous vous adressons un devis.', 'Bulk orders for a class, a school or an office: list the items and quantities and we will send you a quote.')}</p><p>${tr('Équipez aussi vos enseignants avec', 'Also equip your teachers with')} <a href="${PAGES.logiciel[lang]}">SknEDU-studio</a>.</p></div>
    </div>`,
  },
  bio: {
    cls: 'u-bio', ic: '🌿',
    fr: { lead: 'Une sélection de compléments alimentaires et de produits naturels et bio, pour accompagner une alimentation variée et un mode de vie sain.', desc: 'Compléments alimentaires et produits bio chez ZintaServices : compléments, alimentation bio et naturelle, bien-être et soins naturels. Demande par WhatsApp, paiement Wave ou MTN MoMo.', placeholder: 'Ex. : le nom du produit ou ce que vous cherchez (vitamines, infusion, soin…) et la quantité.' },
    en: { lead: 'A selection of food supplements and natural and organic products, alongside a varied diet and a healthy lifestyle.', desc: 'Food supplements and organic products from ZintaServices: supplements, organic and natural food, wellbeing and natural care. Request by WhatsApp, pay with Wave or MTN MoMo.', placeholder: 'E.g. the product name or what you are looking for (vitamins, herbal tea, skin care…) and the quantity.' },
    fam: [
      ['💊', 'Compléments alimentaires', 'Food supplements', 'Vitamines, minéraux et autres compléments, à choisir selon vos besoins.', 'Vitamins, minerals and other supplements, to choose according to your needs.'],
      ['🍯', 'Alimentation bio et naturelle', 'Organic and natural food', 'Produits d\'épicerie, infusions et boissons issus de l\'agriculture biologique ou d\'ingrédients naturels.', 'Groceries, herbal teas and drinks from organic farming or natural ingredients.'],
      ['🧴', 'Bien-être et soins naturels', 'Wellbeing and natural care', 'Huiles, savons et soins à base d\'ingrédients naturels.', 'Oils, soaps and care products made with natural ingredients.'],
    ],
    extra: (tr) => `<div class="notice notice-green">
      <h2>ℹ️ ${tr('À savoir sur les compléments alimentaires', 'About food supplements')}</h2>
      <ul>
        <li>${tr('Les compléments alimentaires <b>ne sont pas des médicaments</b> : ils ne remplacent ni une alimentation variée et équilibrée, ni un traitement médical.', 'Food supplements <b>are not medicines</b>: they replace neither a varied and balanced diet nor medical treatment.')}</li>
        <li>${tr('Respectez la dose journalière indiquée sur l\'emballage et tenez les produits hors de portée des enfants.', 'Follow the daily dose shown on the packaging and keep products out of the reach of children.')}</li>
        <li>${tr('Demandez l\'avis d\'un médecin ou d\'un pharmacien en cas de grossesse, d\'allaitement, de traitement en cours ou pour un enfant.', 'Ask a doctor or pharmacist for advice if you are pregnant, breastfeeding, taking treatment, or for a child.')}</li>
        <li>${tr('Avant d\'acheter, demandez-nous la composition et la notice du produit.', 'Before buying, ask us for the product\'s ingredients and leaflet.')}</li>
      </ul>
    </div>`,
  },
  electronique: {
    cls: 'u-elec', ic: '💻',
    fr: { lead: 'Du matériel et des accessoires pour travailler, enseigner et rester connecté, à la maison, à l\'école ou au bureau.', desc: 'Appareils et accessoires électroniques et informatiques chez ZintaServices : accessoires, stockage, charge et énergie, impression, réseau. Demande par WhatsApp, paiement Wave ou MTN MoMo.', placeholder: 'Ex. : 1 souris sans fil, 1 clé USB 64 Go, 1 chargeur pour ordinateur (marque et modèle)…' },
    en: { lead: 'Equipment and accessories to work, teach and stay connected, at home, at school or at the office.', desc: 'Electronic and computer devices and accessories from ZintaServices: accessories, storage, charging and power, printing, networking. Request by WhatsApp, pay with Wave or MTN MoMo.', placeholder: 'E.g. 1 wireless mouse, 1 64 GB USB stick, 1 laptop charger (brand and model)…' },
    fam: [
      ['💻', 'Appareils', 'Devices', 'Ordinateurs, tablettes, téléphones et autres appareils, selon disponibilité.', 'Computers, tablets, phones and other devices, subject to availability.'],
      ['🖱️', 'Accessoires informatiques', 'Computer accessories', 'Souris, claviers, casques, webcams, câbles et adaptateurs.', 'Mice, keyboards, headsets, webcams, cables and adapters.'],
      ['💾', 'Stockage', 'Storage', 'Clés USB, cartes mémoire, disques durs externes.', 'USB sticks, memory cards, external hard drives.'],
      ['🔋', 'Charge et énergie', 'Charging and power', 'Chargeurs, batteries externes, multiprises, onduleurs.', 'Chargers, power banks, power strips, UPS units.'],
      ['🖨️', 'Impression', 'Printing', 'Imprimantes, cartouches et toners, selon le modèle.', 'Printers, cartridges and toners, depending on the model.'],
      ['📶', 'Réseau', 'Networking', 'Routeurs, répéteurs Wi-Fi, câbles réseau.', 'Routers, Wi-Fi extenders, network cables.'],
    ],
    extra: (tr, lang) => `<div class="cols2">
      <div class="card card-accent"><h2>🔎 ${tr('Accessoires compatibles', 'Compatible accessories')}</h2><p>${tr('Pour un chargeur, une cartouche ou une batterie, indiquez la <b>marque et le modèle</b> de votre appareil (ou envoyez une photo de l\'étiquette) : nous vérifions la compatibilité avant la commande.', 'For a charger, a cartridge or a battery, give the <b>brand and model</b> of your device (or send a photo of the label): we check compatibility before you order.')}</p></div>
      <div class="card"><h2>🏫 ${tr('Salle informatique, classe connectée', 'Computer room, connected classroom')}</h2><p>${tr('Matériel et licences', 'Equipment and')} <a href="${PAGES.logiciel[lang]}">SknEDU-studio</a> ${tr('pour tous les postes : demandez un devis pour votre établissement.', 'licences for every computer: ask for a quote for your school.')}</p></div>
    </div>`,
  },
};
function category(key, lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const c = CATS[key]; const u = UNIVERS.find((x) => x.key === key); const L = c[lang];
  const fams = c.fam.map(([ic, tf, te, df, de]) => `<article class="feat"><span class="ic" aria-hidden="true">${ic}</span><h3>${tr(tf, te)}</h3><p>${tr(df, de)}</p></article>`).join('\n');
  const body = `${pageHead(`<span class="ph-ic" aria-hidden="true">${c.ic}</span> ${u[lang][0]}`, L.lead, { cls: c.cls })}
<section class="sec">
  <div class="wrap">
    <h2 class="h2c">${tr('Ce que nous proposons', 'What we offer')}</h2>
    <p class="intro">${tr('Quelques exemples de produits. <b>La disponibilité et les prix évoluent</b> : demandez-nous, nous vous répondons avec une proposition.', 'A few examples of products. <b>Availability and prices change</b>: just ask and we will reply with an offer.')}</p>
    <div class="feats">
${fams}
    </div>
  </div>
</section>
<section class="sec sec-tight">
  <div class="wrap">
    ${c.extra(tr, lang)}
  </div>
</section>
<section class="sec sec-alt" id="demande">
  <div class="wrap">
    <h2 class="h2c">${tr('Faire une demande', 'Make a request')}</h2>
    ${howToOrder(lang)}
    <div class="order-grid">
      <div class="card">
        <h2>${tr('Votre demande', 'Your request')}</h2>
        <form class="form req-form" data-cat="${esc(u[lang][0])}" novalidate>
          <label class="full"><span>${tr('Articles et quantités', 'Items and quantities')} <span class="req">*</span></span><textarea name="items" rows="5" placeholder="${esc(L.placeholder)}"></textarea></label>
          <fieldset>
            <legend>${tr('Vos coordonnées', 'Your details')}</legend>
            <label><span>${tr('Nom et prénom', 'Full name')} <span class="req">*</span></span><input type="text" name="nom" autocomplete="name"></label>
            <label>${tr('Téléphone (facultatif)', 'Phone (optional)')}<input name="tel" type="tel" inputmode="tel" autocomplete="tel" placeholder="+225 …"></label>
            <label>${tr('Ville / commune (facultatif)', 'Town / district (optional)')}<input type="text" name="ville" autocomplete="address-level2"></label>
            <label>${tr('Réception', 'Receiving')}<select name="reception"><option>${tr('À convenir', 'To be agreed')}</option><option>${tr('Livraison', 'Delivery')}</option><option>${tr('Retrait', 'Pick-up')}</option></select></label>
          </fieldset>
          <p class="error" role="alert" hidden></p>
          <div class="send">
            <button class="btn btn-wa" type="submit" data-req="wa">${ICON.wa} ${tr('Envoyer par WhatsApp', 'Send by WhatsApp')}</button>
            <button class="btn btn-navy" type="button" data-req="mail">${ICON.mail} ${tr('Envoyer par e-mail', 'Send by e-mail')}</button>
            <button class="btn btn-line" type="button" data-req="copy">${ICON.copy} ${tr('Copier', 'Copy')}</button>
          </div>
          <p class="muted small">${tr('Ce formulaire n\'envoie rien à notre serveur : le message s\'ouvre dans votre WhatsApp ou votre messagerie, et c\'est vous qui l\'envoyez.', 'This form sends nothing to our server: the message opens in your WhatsApp or e-mail app, and you send it yourself.')}</p>
        </form>
      </div>
      <aside class="order-side">
        <div class="card card-navy">
          <h2>${tr('Paiement', 'Payment')}</h2>
          <p>${tr(`Après confirmation de la disponibilité et du prix : <b>Wave</b> ou <b>MTN MoMo</b> au <b>${PHONE}</b> (${VENDEUR}).`, `Once availability and price are confirmed: <b>Wave</b> or <b>MTN MoMo</b> to <b>${PHONE}</b> (${VENDEUR}).`)}</p>
          <p><button class="btn btn-sm btn-gold" type="button" data-copy="${esc(C.whatsapp)}">${ICON.copy} ${tr('Copier le numéro', 'Copy the number')}</button></p>
        </div>
        <div class="card">
          <h2>${tr('Une question ?', 'A question?')}</h2>
          <p><a class="btn btn-wa btn-block" href="https://wa.me/${WA}" rel="noopener" aria-label="WhatsApp ${PHONE}">${ICON.wa} <span class="nw">${PHONE}</span></a></p>
          <p><a class="btn btn-line btn-block" href="mailto:${EMAIL}">${ICON.mail} ${EMAIL}</a></p>
        </div>
      </aside>
    </div>
  </div>
</section>`;
  return layout({ lang, key, body, title: `${u[lang][0]} — ${VENDEUR}`, desc: L.desc });
}

// ------------------------------------------------------------------ SknEDU-studio : contenu partagé
const FEATURES = [
  ['✏️', 'Modifier le texte d\'origine', 'Edit the original text', 'Corrigez une faute directement dans le PDF : le texte est réécrit dans sa police, sa taille et sa couleur d\'origine, paragraphes recomposés compris. Rechercher / remplacer dans tout le document.', 'Fix a typo right inside the PDF: the text is rewritten in its original font, size and colour, whole paragraphs included. Find and replace across the document.', 1],
  ['🔍', 'OCR des scans', 'OCR for scans', 'Rendez les scans et les copies numérisées cherchables et modifiables : français, anglais, espagnol, allemand, italien, portugais, arabe.', 'Make scans and scanned papers searchable and editable: French, English, Spanish, German, Italian, Portuguese, Arabic.', 1],
  ['🔄', 'Word, Excel, PowerPoint', 'Word, Excel, PowerPoint', 'Conversions PDF ↔ Word, Excel et PowerPoint sans rien installer, tableaux reconstitués en vraies cellules, réenregistrement dans le format d\'origine.', 'PDF ↔ Word, Excel and PowerPoint conversions with nothing to install, tables rebuilt as real cells, save back to the original format.', 1],
  ['✨', 'Assistant IA', 'AI assistant', 'Résumé, QCM, fiche d\'exercices, simplification, grille d\'évaluation, plan de séance… avec Claude, ChatGPT, Gemini, Mistral (votre clé) ou une IA locale gratuite, hors ligne.', 'Summary, quiz, worksheet, simplified version, rubric, lesson plan… with Claude, ChatGPT, Gemini, Mistral (your own key) or a free local AI that works offline.', 1],
  ['📝', 'Correction de copies assistée', 'Assisted grading', 'Barème, lecture de l\'écriture manuscrite par l\'IA, notes et commentaires posés sur les copies, export Excel : l\'IA propose, vous validez chaque note.', 'Marking scheme, handwriting read by AI, marks and comments placed on the papers, Excel export: the AI suggests, you approve every mark.', 1],
  ['✅', 'Tampons et notes', 'Stamps and marks', 'Tampons ✔ ✘ « Très bien », « À revoir »… posés d\'un clic ; outil « Noter » : la note (ex. 14/20) et une appréciation s\'inscrivent sur la copie ; relevé des notes avec la moyenne, à copier dans un tableur.', 'One-click stamps ✔ ✘ “Very good”, “Revise”…; “Grade” tool: the mark (e.g. 14/20) and a comment are written on the paper; grade summary with the average, ready to paste into a spreadsheet.', 0],
  ['🎯', 'Évaluations différenciées', 'Differentiated tests', 'Trois niveaux de difficulté, sujets A / B mélangés, corrigé, export Moodle (GIFT) et tableur.', 'Three difficulty levels, shuffled A / B versions, answer key, Moodle (GIFT) and spreadsheet export.', 1],
  ['✉️', 'Publipostage', 'Mail merge', 'Un PDF par élève à partir d\'Excel ou CSV ({{Nom}}, {{Classe}}…) : bulletins, attestations, convocations.', 'One PDF per student from Excel or CSV ({{Name}}, {{Class}}…): report cards, certificates, notices.', 1],
  ['📶', 'Classe connectée sans Internet', 'Connected classroom, no Internet', 'Partagez une fiche par QR code sur le réseau local de la salle : les élèves la téléchargent et rendent leur copie, sans connexion Internet.', 'Share a worksheet by QR code on the room\'s local network: students download it and hand in their work, no Internet needed.', 1],
  ['🔤', 'Version DYS', 'Dyslexia-friendly version', 'Police OpenDyslexic, interligne et espacement adaptés, règle de lecture et lecture à voix haute.', 'OpenDyslexic font, adapted line and letter spacing, reading ruler and read-aloud.', 0],
  ['▶️', 'Diaporama interactif', 'Interactive slideshow', 'Plein écran avec stylo, tableau blanc, minuteur, pointeur laser et mode présentateur sur deux écrans.', 'Full screen with pen, whiteboard, timer, laser pointer and presenter mode on two screens.', 0],
  ['📴', 'Hors ligne, en français ou en anglais', 'Offline, in French or English', 'Aucune connexion nécessaire pour travailler, copie de récupération automatique en cas de coupure de courant. Interface entièrement en français ou en anglais, changement immédiat.', 'No connection needed to work, automatic recovery copy if the power goes out. Interface fully in French or English, switch instantly.', 0],
];

// Comparatif (docs/EDITIONS.md)
const COMPARE = [
  ['Ouvrir et lire tous les formats (PDF, Word, PowerPoint, Excel, images, EPUB…)', 'Open and read every format (PDF, Word, PowerPoint, Excel, images, EPUB…)', 1, 1, 1],
  ['Imprimer (2 ou 4 pages par feuille), enregistrer en PDF, cloud (enregistrer / ouvrir)', 'Print (2 or 4 pages per sheet), save as PDF, cloud (save / open)', 1, 1, 1],
  ['Organiser les pages : pivoter, déplacer, supprimer, fusionner, extraire, numéroter', 'Organise pages: rotate, move, delete, merge, extract, number', 1, 1, 1],
  ['Annoter : texte ajouté, surligneur, cadres, formes, flèches, stylo, commentaires, tampons ; noter les copies et relevé des notes', 'Annotate: added text, highlighter, boxes, shapes, arrows, pen, comments, stamps; mark papers and grade summary', 1, 1, 1],
  ['Remplir les formulaires, signature manuscrite, scanner, modèles (Seyès, évaluation…)', 'Fill in forms, handwritten signature, scanner, templates (ruled paper, tests…)', 1, 1, 1],
  ['Diaporama interactif, version DYS et lecture à voix haute, français / anglais', 'Interactive slideshow, dyslexia-friendly version and read-aloud, French / English', 1, 1, 1],
  ['✏️ Modifier le texte et les paragraphes d\'origine, rechercher et remplacer', '✏️ Edit the original text and paragraphs, find and replace', 0, 1, 1],
  ['🔍 OCR : rendre les scans et les copies numérisées modifiables', '🔍 OCR: make scans and scanned papers editable', 0, 1, 1],
  ['🔄 Conversions PDF ↔ Word, Excel, PowerPoint, format d\'origine', '🔄 PDF ↔ Word, Excel, PowerPoint conversions, original format', 0, 1, 1],
  ['✨ Assistant IA (Claude, ChatGPT, Gemini, Mistral, IA locale)', '✨ AI assistant (Claude, ChatGPT, Gemini, Mistral, local AI)', 0, 1, 1],
  ['🎓 Correction de copies, évaluations différenciées, publipostage, version bilingue, classe connectée, équations', '🎓 Grading, differentiated tests, mail merge, bilingual version, connected classroom, equations', 0, 1, 1],
  ['🔒 Mot de passe, signature par certificat, comparaison, copie commentée en lecture seule', '🔒 Password, certificate signature, comparison, read-only annotated copy', 0, 1, 1],
  ['🧰 Sauvegarde automatique dans le cloud, en-tête / pied de page, filigrane, réduction de taille', '🧰 Automatic cloud backup, header / footer, watermark, file size reduction', 0, 1, 1],
  ['🛡️ Administration des postes (droits, journal, notifications), licence pour tout le PC', '🛡️ Workstation administration (permissions, log, notifications), licence for the whole PC', 0, 0, 1],
  ['Nom de l\'établissement dans l\'application et les modèles, support prioritaire, formation', 'School name in the app and templates, priority support, training', 0, 0, 1],
];

function licenceRules(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  return `<ul class="checks">
    <li>${tr('Une licence est liée à <b>l\'adresse e-mail du compte</b> SknEDU-studio.', 'A licence is tied to the <b>e-mail address of the SknEDU-studio account</b>.')}</li>
    <li>${tr('Elle est <b>active sur un seul ordinateur à la fois</b>.', 'It is <b>active on one computer at a time</b>.')}</li>
    <li>${tr('<b>Transférable</b> : « Désactiver de ce PC » dans Aide › Licence et édition, puis activez la même clé sur l\'autre ordinateur ; elle garde ses jours restants.', '<b>Transferable</b>: “Deactivate from this PC” in Help › Licence and edition, then activate the same key on the other computer; it keeps its remaining days.')}</li>
    <li>${tr('<b>Cumulable</b> : deux licences au plus peuvent être actives ensemble sur un poste, leurs jours s\'additionnent.', '<b>Stackable</b>: up to two licences can be active together on one computer, and their days add up.')}</li>
    <li>${tr('L\'activation et la désactivation demandent Internet ; ensuite, une vérification automatique au moins tous les 14 jours.', 'Activation and deactivation need Internet; after that, an automatic check at least every 14 days.')}</li>
    <li>${tr('À l\'expiration, les fonctions Premium s\'arrêtent ; la version gratuite reste utilisable.', 'When it expires, Premium features stop; the free version remains available.')}</li>
  </ul>`;
}

function pricingCards(lang, { compact = false } = {}) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const ens = OFFRES.filter((o) => o.edition === 'enseignant');
  const etab = OFFRES.find((o) => o.edition === 'etablissement');
  const dur = (o) => ({ 90: tr('3 mois', '3 months'), 365: tr('1 an', '1 year'), 730: tr('2 ans', '2 years') }[o.jours] || `${o.jours} ${tr('jours', 'days')}`);
  return `<div class="plans">
  <article class="plan">
    <h3>${tr('Gratuite', 'Free')}</h3>
    <p class="price"><b>0</b> FCFA</p>
    <p class="sub">${tr('Après les 30 jours d\'essai, sans limite de durée', 'After the 30-day trial, with no time limit')}</p>
    <ul class="checks">
      <li>${tr('Lire tous les formats, imprimer', 'Read every format, print')}</li>
      <li>${tr('Annoter, tampons, noter les copies', 'Annotate, stamps, mark papers')}</li>
      <li>${tr('Organiser les pages, remplir, signer', 'Organise pages, fill in, sign')}</li>
      <li>${tr('Diaporama interactif, version DYS', 'Interactive slideshow, dyslexia-friendly version')}</li>
    </ul>
    <a class="btn btn-line" href="${PAGES.download[lang]}">${ICON.down} ${tr('Télécharger', 'Download')}</a>
  </article>
  <article class="plan plan-main">
    <p class="ribbon">${tr('Pour chaque enseignant', 'For every teacher')}</p>
    <h3>${tr('Enseignant', 'Teacher')}</h3>
    <p class="price">${tr('dès', 'from')} <b>${num(ens[0].prix, lang)}</b> FCFA</p>
    <ul class="durations">
      ${ens.map((o) => `<li><span>${dur(o)}</span><b>${price(o.prix, lang)}</b>${o.jours > 100 ? `<small>${tr('soit', 'i.e.')} ${price(perMonth(o), lang)} ${tr('/ mois', '/ month')}</small>` : ''}</li>`).join('')}
    </ul>
    ${compact ? '' : `<ul class="checks">
      <li>${tr('Toutes les fonctions Premium', 'All Premium features')}</li>
      <li>${tr('Modifier le texte, OCR, conversions Office', 'Edit text, OCR, Office conversions')}</li>
      <li>${tr('Assistant IA, outils de la classe', 'AI assistant, classroom tools')}</li>
    </ul>`}
    <a class="btn btn-gold" href="${PAGES.order[lang]}?offre=ens-1a">${tr('Commander', 'Order')}</a>
  </article>
  <article class="plan">
    <h3>${tr('Établissement', 'School')}</h3>
    <p class="price"><b>${num(etab.prix, lang)}</b> FCFA</p>
    <p class="sub">${tr(`par poste et par an — ${etab.min} postes minimum, soit ${price(etab.prix * etab.min, lang)} / an`, `per seat per year — ${etab.min} seats minimum, i.e. ${price(etab.prix * etab.min, lang)} / year`)}</p>
    <ul class="checks">
      <li>${tr('Tout ce que contient l\'édition Enseignant', 'Everything in the Teacher edition')}</li>
      <li>${tr('Administration des postes : droits, journal, notifications', 'Workstation administration: permissions, log, notifications')}</li>
      <li>${tr('Nom de l\'établissement dans l\'application et les modèles', 'School name in the app and templates')}</li>
      <li>${tr('Support prioritaire et formation', 'Priority support and training')}</li>
    </ul>
    <a class="btn btn-line" href="${PAGES.order[lang]}?offre=etab-1a">${tr('Commander pour l\'établissement', 'Order for your school')}</a>
  </article>
</div>`;
}

// ------------------------------------------------------------------ SknEDU-studio : présentation
function logiciel(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const feats = FEATURES.map(([ic, tf, te, df, de, prem]) => `<article class="feat"><span class="ic" aria-hidden="true">${ic}</span><h3>${tr(tf, te)}${prem ? ' <span class="tag tag-p">Premium</span>' : ` <span class="tag tag-f">${tr('Gratuit', 'Free')}</span>`}</h3><p>${tr(df, de)}</p></article>`).join('\n');
  const faq = [
    [tr('Faut-il une connexion Internet ?', 'Do I need an Internet connection?'), tr('Non. SknEDU-studio fonctionne hors ligne. Internet n\'est utile que pour télécharger le logiciel et ses mises à jour, activer une licence, et pour l\'assistant IA en ligne (l\'IA locale fonctionne sans Internet).', 'No. SknEDU-studio works offline. Internet is only needed to download the software and its updates, to activate a licence, and for the online AI assistant (the local AI works without Internet).')],
    [tr('Que se passe-t-il après les 30 jours d\'essai ?', 'What happens after the 30-day trial?'), tr('Le logiciel passe en version gratuite, sans limite de durée : lire, annoter, organiser, remplir, signer, imprimer. Les fonctions Premium demandent une licence Enseignant ou Établissement. L\'essai est lié à l\'ordinateur et ne s\'utilise qu\'une fois par poste.', 'The software switches to the free version, with no time limit: read, annotate, organise, fill in, sign, print. Premium features require a Teacher or School licence. The trial is tied to the computer and can only be used once per machine.')],
    [tr('Comment payer ?', 'How do I pay?'), tr(`Par Wave ou MTN MoMo au ${PHONE} (${VENDEUR}), puis envoyez la demande et la preuve de paiement par WhatsApp ou par e-mail. Vous recevez votre clé de licence en retour.`, `By Wave or MTN MoMo to ${PHONE} (${VENDEUR}), then send the request and proof of payment by WhatsApp or e-mail. You receive your licence key in return.`)],
    [tr('Puis-je changer d\'ordinateur ?', 'Can I move to another computer?'), tr('Oui. Désactivez la licence sur l\'ancien PC (Aide › Licence et édition), puis activez la même clé sur le nouveau : elle garde ses jours restants.', 'Yes. Deactivate the licence on the old PC (Help › Licence and edition), then activate the same key on the new one: it keeps its remaining days.')],
    [tr('Mes documents sont-ils envoyés quelque part ?', 'Are my documents sent anywhere?'), tr('Non. Les documents restent sur votre ordinateur. Rien n\'est envoyé sans action de votre part (voir la page Confidentialité).', 'No. Your documents stay on your computer. Nothing is sent without you asking (see the Privacy page).')],
    [tr('Windows refuse d\'installer le logiciel ?', 'Windows refuses to install the software?'), tr(`Sur certains PC Windows 11, le contrôle intelligent des applications bloque l'installateur, pas encore signé. Téléchargez la <a href="${PAGES.download.fr}#windows">version sans installation</a> (.zip), extrayez-la puis lancez SknEDU-studio.exe : elle fonctionne et se met à jour normalement.`, `On some Windows 11 PCs, Smart App Control blocks the installer, which is not signed yet. Download the <a href="${PAGES.download.en}#windows">no-install version</a> (.zip), extract it and run SknEDU-studio.exe: it works and updates normally.`)],
  ].map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('\n');
  const ld = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'SknEDU-studio', applicationCategory: 'EducationalApplication', operatingSystem: 'Windows 10, Windows 11, macOS, Linux',
    description: tr('Éditeur PDF hors ligne pour les enseignants.', 'Offline PDF editor for teachers.'), url: BASE + PAGES.logiciel[lang], image: `${BASE}/img/og-${lang}.jpg`, downloadUrl: RELEASES, inLanguage: ['fr', 'en'],
    publisher: { '@type': 'Organization', name: VENDEUR, email: EMAIL, telephone: PHONE.replace(/ /g, '') },
    offers: [{ '@type': 'Offer', name: tr('Version gratuite', 'Free version'), price: '0', priceCurrency: 'XOF' }, ...OFFRES.map((o) => ({ '@type': 'Offer', name: offreLabel(o, lang), price: String(o.prix), priceCurrency: 'XOF' }))] };
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-txt">
      <p class="eyebrow">${tr('Pour les enseignants · Windows · macOS · Linux', 'For teachers · Windows · macOS · Linux')}</p>
      <h1>${tr('L\'éditeur PDF <em>hors ligne</em> des enseignants', 'The <em>offline</em> PDF editor for teachers')}</h1>
      <p class="lead">${tr('Corrigez un sujet PDF sans le retaper, corrigez les copies avec des tampons, préparez vos évaluations avec l\'IA. Même sans Internet.', 'Fix a PDF worksheet without retyping it, grade papers with stamps, prepare your tests with AI. Even without Internet.')}</p>
      <div class="cta">
        <a class="btn btn-gold btn-lg" href="${PAGES.download[lang]}">${ICON.down} ${tr('Télécharger gratuitement', 'Download for free')}</a>
        <a class="btn btn-ghost btn-lg" href="${PAGES.pricing[lang]}">${tr('Voir les tarifs', 'See pricing')}</a>
      </div>
      <ul class="hero-points">
        <li>${tr('30 jours d\'essai de toutes les fonctions', '30-day trial of every feature')}</li>
        <li>${tr('Puis version gratuite, sans limite de durée', 'Then a free version, with no time limit')}</li>
        <li>${tr('Paiement Wave ou MTN MoMo', 'Pay with Wave or MTN MoMo')}</li>
      </ul>
    </div>
    <div class="hero-img">${shot('correction', tr('SknEDU-studio : copie d\'élève corrigée avec des tampons, une note de 14/20, un entourage et un commentaire', 'SknEDU-studio: a student\'s paper graded with stamps, a 14/20 mark, a circled error and a comment'), lang, { eager: true })}</div>
  </div>
  ${WAVES}
</section>

<section class="strip" aria-label="${tr('Points clés', 'Key points')}">
  <div class="wrap strip-row">
    <span>📴 ${tr('Hors ligne', 'Offline')}</span><span>🌍 ${tr('Français / anglais', 'French / English')}</span><span>💻 Windows · macOS · Linux</span><span>🔒 ${tr('Vos documents restent sur votre PC', 'Your documents stay on your PC')}</span><span>🔓 ${tr('Code source ouvert', 'Open source')}</span>
  </div>
</section>

<section class="sec" id="fonctions">
  <div class="wrap">
    <h2 class="h2c">${tr('Tout ce qu\'il faut pour préparer, corriger et partager', 'Everything you need to prepare, grade and share')}</h2>
    <p class="intro">${tr('Un seul logiciel pour vos sujets, vos fiches, vos copies et vos cours : pensé avec et pour les enseignants.', 'One piece of software for your tests, worksheets, papers and lessons: designed with and for teachers.')}</p>
    <div class="feats">
${feats}
    </div>
    <p class="also">${tr('Et aussi : annoter, remplir les formulaires, signer, scanner, organiser les pages, imprimer 2 ou 4 pages par feuille, protéger par mot de passe, comparer deux versions, enregistrer dans OneDrive, Google Drive ou Dropbox…', 'And also: annotate, fill in forms, sign, scan, organise pages, print 2 or 4 pages per sheet, password-protect, compare two versions, save to OneDrive, Google Drive or Dropbox…')}</p>
  </div>
</section>

<section class="sec sec-alt" id="captures">
  <div class="wrap">
    <h2 class="h2c">${tr('Aperçu du logiciel', 'A look at the software')}</h2>
    <div class="gallery">
      <figure>${shot('correction', tr('Correction d\'une copie dans l\'onglet Classe', 'Grading a paper in the Classroom tab'), lang)}<figcaption>${tr('<b>Correction de copies</b> — tampons, note et appréciation (outil « Noter »), entourage, commentaire : les outils de l\'onglet Classe.', '<b>Grading papers</b> — stamps, mark and comment (“Grade” tool), circling, notes: the Classroom tab tools.')}</figcaption></figure>
      <figure>${shot('ia', tr('Le panneau de l\'assistant IA ouvert à côté d\'un document', 'The AI assistant panel open next to a document'), lang)}<figcaption>${tr('<b>Assistant IA</b> — QCM, résumé, fiche d\'exercices, différenciation, grille d\'évaluation…', '<b>AI assistant</b> — quiz, summary, worksheet, differentiation, rubric…')}</figcaption></figure>
      <figure>${shot('accueil', tr('L\'écran d\'accueil de SknEDU-studio', 'The SknEDU-studio home screen'), lang)}<figcaption>${tr('<b>Accueil</b> — ouvrir un fichier, partir d\'un document vierge ou d\'un modèle.', '<b>Home</b> — open a file, start from a blank document or a template.')}</figcaption></figure>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <h2 class="h2c">${tr('Pensé pour le terrain', 'Built for real classrooms')}</h2>
    <div class="why">
      <div><span class="ic" aria-hidden="true">⚡</span><h3>${tr('Coupures ? Pas de panique', 'Power cut? No panic')}</h3><p>${tr('Le logiciel travaille sans Internet et garde une copie de récupération de vos documents : après une coupure de courant, ils vous sont proposés au redémarrage.', 'The software works without Internet and keeps a recovery copy of your documents: after a power cut, they are offered when you restart.')}</p></div>
      <div><span class="ic" aria-hidden="true">📱</span><h3>${tr('Payé en FCFA, par Mobile Money', 'Priced in FCFA, paid by Mobile Money')}</h3><p>${tr('Wave ou MTN MoMo, sans carte bancaire. La licence arrive par WhatsApp ou par e-mail.', 'Wave or MTN MoMo, no bank card needed. Your licence arrives by WhatsApp or e-mail.')}</p></div>
      <div><span class="ic" aria-hidden="true">💬</span><h3>${tr('Une aide sur WhatsApp', 'Help on WhatsApp')}</h3><p>${tr(`Une question avant d'acheter ou pendant l'installation ? Écrivez-nous au ${PHONE}.`, `A question before buying or during installation? Message us at ${PHONE}.`)}</p></div>
      <div><span class="ic" aria-hidden="true">🛡️</span><h3>${tr('Vos documents restent chez vous', 'Your documents stay with you')}</h3><p>${tr('Pas de statistiques d\'utilisation, pas de compte en ligne obligatoire : votre adresse e-mail reste sur l\'ordinateur.', 'No usage statistics, no mandatory online account: your e-mail address stays on the computer.')}</p></div>
    </div>
    <div class="card secu">
      <h3>🔐 ${tr('Sécurité', 'Security')}</h3>
      <ul class="checks">
        <li>${tr('Copies de récupération et compte chiffrés sur l\'ordinateur (AES-256-GCM).', 'Recovery copies and account encrypted on the computer (AES-256-GCM).')}</li>
        <li>${tr('Connexions chiffrées en TLS 1.3 au minimum (mises à jour, activation, IA en ligne).', 'Connections encrypted with TLS 1.3 at least (updates, activation, online AI).')}</li>
        <li>${tr('Mises à jour signées par l\'éditeur (Ed25519) et vérifiées (SHA-512) avant d\'être installées.', 'Updates signed by the publisher (Ed25519) and verified (SHA-512) before they are installed.')}</li>
        <li>${tr('Audit des dépendances, tests d\'intrusion automatisés et auto-test complet à chaque version ; code source public.', 'Dependency audit, automated penetration tests and a full self-test for every version; public source code.')}</li>
      </ul>
      <p><a class="link-arrow" href="${REPO}/blob/main/docs/SECURITE.md" rel="noopener">${tr('Configuration de sécurité de référence', 'Reference security configuration (in French)')} →</a></p>
    </div>
  </div>
</section>

<section class="sec sec-alt" id="tarifs">
  <div class="wrap">
    <h2 class="h2c">${tr('Des tarifs simples, en FCFA', 'Simple pricing, in FCFA')}</h2>
    <p class="intro">${tr('À l\'installation : <b>30 jours d\'essai gratuit de toutes les fonctions</b> (compte e-mail obligatoire). Ensuite, la version gratuite, ou une licence pour les fonctions Premium.', 'When you install: <b>a 30-day free trial of every feature</b> (e-mail account required). After that, the free version, or a licence for Premium features.')}</p>
    ${pricingCards(lang, { compact: true })}
    <p class="center"><a class="link-arrow" href="${PAGES.pricing[lang]}">${tr('Comparer les éditions en détail', 'Compare the editions in detail')} →</a></p>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <h2 class="h2c">${tr('Obtenir une licence en 3 étapes', 'Get a licence in 3 steps')}</h2>
    <ol class="steps">
      <li><h3>${tr('Installez et essayez', 'Install and try')}</h3><p>${tr('Téléchargez SknEDU-studio, créez votre compte avec votre adresse e-mail : 30 jours d\'essai de tout.', 'Download SknEDU-studio and create your account with your e-mail address: 30 days to try everything.')}</p></li>
      <li><h3>${tr('Commandez et payez', 'Order and pay')}</h3><p>${tr('Dans le logiciel : <b>Aide › Obtenir une licence</b>. Payez par Wave ou MTN MoMo, envoyez la demande par WhatsApp ou e-mail.', 'In the software: <b>Help › Get a licence</b>. Pay by Wave or MTN MoMo, send the request by WhatsApp or e-mail.')}</p></li>
      <li><h3>${tr('Activez', 'Activate')}</h3><p>${tr('Collez la clé <code>SKN1.…</code> reçue dans <b>Aide › Licence et édition › Activer</b>.', 'Paste the <code>SKN1.…</code> key you received into <b>Help › Licence and edition › Activate</b>.')}</p></li>
    </ol>
    <p class="center"><a class="btn btn-navy" href="${PAGES.order[lang]}">${tr('Commander une licence', 'Order a licence')}</a></p>
  </div>
</section>

<section class="sec sec-alt">
  <div class="wrap narrow">
    <h2 class="h2c">${tr('Questions fréquentes', 'Frequently asked questions')}</h2>
    <div class="faq">
${faq}
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap band-row">
    <div><h2>${tr('Prêt à essayer ?', 'Ready to try it?')}</h2><p>${tr('Gratuit à télécharger, 30 jours d\'essai de toutes les fonctions.', 'Free to download, 30-day trial of every feature.')}</p></div>
    <div class="cta"><a class="btn btn-gold btn-lg" href="${PAGES.download[lang]}">${ICON.down} ${tr('Télécharger', 'Download')}</a><a class="btn btn-ghost btn-lg" href="https://wa.me/${WA}" rel="noopener">${ICON.wa} WhatsApp</a></div>
  </div>
</section>`;
  return layout({ lang, key: 'logiciel', body,
    title: tr('SknEDU-studio — l\'éditeur PDF hors ligne des enseignants | ZintaServices', 'SknEDU-studio — the offline PDF editor for teachers | ZintaServices'),
    desc: tr('Modifier les PDF dans leur police d\'origine, OCR, conversions Word / Excel / PowerPoint, assistant IA, correction de copies, évaluations différenciées. Hors ligne, Windows, macOS, Linux. Essai gratuit 30 jours.', 'Edit PDFs in their original font, OCR, Word / Excel / PowerPoint conversions, AI assistant, grading, differentiated tests. Offline, Windows, macOS, Linux. 30-day free trial.'),
    head: `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n` });
}

// ------------------------------------------------------------------ Télécharger
function download(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  // Chaque bouton mène à la page de la dernière version ; site.js le remplace par le lien direct du fichier (API GitHub).
  const dl = (asset, label, file, primary) => `<a class="btn ${primary ? 'btn-gold' : 'btn-line'} dl" href="${RELEASES}" rel="noopener" data-asset="${asset}">${ICON.down} <span>${label}</span><small class="dl-meta">${file}</small></a>`;
  const os = [
    ['win', 'Windows', tr('Windows 10 et 11, 64 bits', 'Windows 10 and 11, 64-bit'),
      dl('win-setup', tr('Installateur', 'Installer'), '.exe', true) + dl('win-zip', tr('Version sans installation', 'No-install version'), '.zip')
      + `<p class="os-note">${tr('Version sans installation : si Windows bloque l\'installateur (voir ci-dessous).', 'No-install version: if Windows blocks the installer (see below).')}</p>`, ICON.win],
    ['mac', 'macOS', tr('Mac Apple Silicon et Intel', 'Apple Silicon and Intel Macs'),
      dl('mac-arm', tr('Apple Silicon (M1 et suivants)', 'Apple Silicon (M1 and later)'), '.dmg', true) + dl('mac-x64', tr('Mac Intel', 'Intel Mac'), '.dmg'), ICON.mac],
    ['linux', 'Linux', tr('Distributions 64 bits', '64-bit distributions'), dl('linux', 'AppImage', '.AppImage', true), ICON.linux],
  ].map(([id, name, req, links, ic]) => `<article class="os" data-os="${id}"><span class="os-ic">${ic}</span><h2>${name}</h2><p class="req">${req}</p><div class="dls">${links}</div><p class="mine-note">${tr('Votre système', 'Your system')}</p></article>`).join('\n');
  const body = `${pageHead(tr('Télécharger SknEDU-studio', 'Download SknEDU-studio'), tr('Gratuit à télécharger. À l\'installation, créez votre compte (adresse e-mail) : <b>30 jours d\'essai de toutes les fonctions</b>, puis la version gratuite ou une licence.', 'Free to download. When you install, create your account (e-mail address): <b>a 30-day trial of every feature</b>, then the free version or a licence.'))}
<section class="sec">
  <div class="wrap">
    <p class="release" id="release" data-lang="${lang}">${tr('Dernière version publiée sur GitHub', 'Latest release published on GitHub')}</p>
    <div class="oses">
${os}
    </div>
    <p class="center muted">${tr('Fichiers d\'environ 130 à 175 Mo : préférez une connexion Wi-Fi. Si un bouton ouvre la page GitHub, choisissez le fichier de votre système dans « Assets ».', 'Files are about 130 to 175 MB: a Wi-Fi connection is best. If a button opens the GitHub page, pick the file for your system under “Assets”.')}</p>

    <div class="notice" id="windows">
      <h2>⚠️ ${tr('Windows : avertissement au premier lancement', 'Windows: warning on first launch')}</h2>
      <p>${tr('Soyons transparents : l\'installateur <b>n\'est pas encore signé</b> par un certificat d\'éditeur. Au premier lancement du fichier téléchargé, Windows peut afficher <b>« Windows a protégé votre ordinateur »</b>.', 'To be transparent: the installer <b>is not code-signed yet</b> with a publisher certificate. When you first run the downloaded file, Windows may show <b>“Windows protected your PC”</b>.')}</p>
      <ol>
        <li>${tr('Cliquez sur <b>Informations complémentaires</b>.', 'Click <b>More info</b>.')}</li>
        <li>${tr('Puis sur <b>Exécuter quand même</b>.', 'Then <b>Run anyway</b>.')}</li>
      </ol>
      <p>${tr('Sur certains PC Windows 11, le <b>Contrôle intelligent des applications</b> bloque l\'installateur. Prenez alors la <b>version sans installation</b> (<code>.zip</code>) : extrayez-la, par exemple dans Documents, puis lancez <code>SknEDU-studio.exe</code>. Le logiciel propose les raccourcis Bureau et menu Démarrer, et se met à jour tout seul.', 'On some Windows 11 PCs, <b>Smart App Control</b> blocks the installer. In that case, take the <b>no-install version</b> (<code>.zip</code>): extract it, for example into Documents, then run <code>SknEDU-studio.exe</code>. The software offers Desktop and Start menu shortcuts and updates itself.')}</p>
      <p>${tr('L\'installateur a été analysé sans aucune détection par Kaspersky et Microsoft Defender, et le code source du logiciel est public.', 'The installer was scanned with no detection by Kaspersky and Microsoft Defender, and the software\'s source code is public.')}</p>
    </div>

    <div class="cols2">
      <div class="card">
        <h2>${tr('Installer en 4 étapes', 'Install in 4 steps')}</h2>
        <ol class="list">
          <li>${tr('Téléchargez le fichier de votre système.', 'Download the file for your system.')}</li>
          <li>${tr('Lancez-le (Windows : installateur, ou extrayez la version sans installation ; macOS : faites glisser l\'application dans « Applications » ; Linux : rendez l\'AppImage exécutable).', 'Run it (Windows: installer, or extract the no-install version; macOS: drag the app to “Applications”; Linux: make the AppImage executable).')}</li>
          <li>${tr('Au premier démarrage, créez votre compte avec votre adresse e-mail.', 'On first start, create your account with your e-mail address.')}</li>
          <li>${tr('Profitez de 30 jours d\'essai de toutes les fonctions.', 'Enjoy a 30-day trial of every feature.')}</li>
        </ol>
      </div>
      <div class="card">
        <h2>${tr('Bon à savoir', 'Good to know')}</h2>
        <ul class="list">
          <li>${tr('<b>Mises à jour automatiques</b> sous Windows : vérification au démarrage puis toutes les 4 heures. Elles s\'installent à la fermeture, même quand Windows bloque les installateurs : le contenu, signé par l\'éditeur, est vérifié avant d\'être remplacé.', '<b>Automatic updates</b> on Windows: checked at startup and every 4 hours. They install when you close the app, even when Windows blocks installers: the content, signed by the publisher, is verified before it is replaced.')}</li>
          <li>${tr('<b>macOS</b> : l\'application n\'est pas encore signée par Apple ; à la première ouverture, faites un clic droit sur l\'application › <b>Ouvrir</b>. Les nouvelles versions s\'y signalent par un lien de téléchargement.', '<b>macOS</b>: the app is not yet signed by Apple; the first time, right-click the app › <b>Open</b>. New versions are announced there with a download link.')}</li>
          <li>${tr('<b>Linux</b> : <code>chmod +x SknEDU-studio-*.AppImage</code> puis lancez le fichier.', '<b>Linux</b>: <code>chmod +x SknEDU-studio-*.AppImage</code> then run the file.')}</li>
          <li>${tr('Non pris en charge : Windows 7 / 8 et les systèmes 32 bits. Les PC Windows 11 ARM fonctionnent en émulation.', 'Not supported: Windows 7 / 8 and 32-bit systems. Windows 11 ARM PCs work through emulation.')}</li>
          <li>${tr(`Code source (AGPL-3.0) et historique des versions : <a href="${REPO}" rel="noopener">GitHub</a>.`, `Source code (AGPL-3.0) and release history: <a href="${REPO}" rel="noopener">GitHub</a>.`)}</li>
        </ul>
      </div>
    </div>
  </div>
</section>`;
  return layout({ lang, key: 'download', body,
    title: tr('Télécharger SknEDU-studio — Windows, macOS, Linux | ZintaServices', 'Download SknEDU-studio — Windows, macOS, Linux | ZintaServices'),
    desc: tr('Téléchargez gratuitement SknEDU-studio pour Windows (installateur .exe ou version sans installation .zip), macOS (.dmg) ou Linux (AppImage). 30 jours d\'essai de toutes les fonctions.', 'Download SknEDU-studio for free for Windows (.exe installer or no-install .zip), macOS (.dmg) or Linux (AppImage). 30-day trial of every feature.') });
}

// ------------------------------------------------------------------ Tarifs
function pricing(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const yes = `<span class="yes" role="img" aria-label="${tr('inclus', 'included')}">✓</span>`; const no = `<span class="no" role="img" aria-label="${tr('non inclus', 'not included')}">—</span>`;
  const rows = COMPARE.map(([f, e, a, b, c]) => `<tr><th scope="row">${tr(f, e)}</th><td>${a ? yes : no}</td><td>${b ? yes : no}</td><td>${c ? yes : no}</td></tr>`).join('\n');
  const body = `${pageHead(tr('Éditions et tarifs', 'Editions and pricing'), tr('Chaque installation commence par <b>30 jours d\'essai gratuit de toutes les fonctions</b> (compte e-mail obligatoire, une fois par ordinateur). Ensuite, la version gratuite reste utilisable sans limite de durée ; les fonctions Premium demandent une licence.', 'Every installation starts with <b>a 30-day free trial of every feature</b> (e-mail account required, once per computer). After that, the free version remains available with no time limit; Premium features require a licence.'))}
<section class="sec">
  <div class="wrap">
    <h2 class="sr">${tr('Offres et prix', 'Offers and prices')}</h2>
    ${pricingCards(lang)}
    <p class="center muted">${tr(`Prix en francs CFA. Paiement par Wave ou MTN MoMo au ${PHONE} (${VENDEUR}).`, `Prices in CFA francs. Payment by Wave or MTN MoMo to ${PHONE} (${VENDEUR}).`)}</p>
  </div>
</section>
<section class="sec sec-alt">
  <div class="wrap">
    <h2 class="h2c">${tr('Comparatif des éditions', 'Edition comparison')}</h2>
    <div class="table-wrap">
      <table class="compare">
        <caption class="sr">${tr('Fonctions incluses dans chaque édition', 'Features included in each edition')}</caption>
        <thead><tr><th scope="col">${tr('Fonction', 'Feature')}</th><th scope="col">${tr('Gratuite', 'Free')}</th><th scope="col"><span class="l">${tr('Enseignant', 'Teacher')}</span><span class="s" aria-hidden="true">${tr('Enseig.', 'Teacher')}</span></th><th scope="col"><span class="l">${tr('Établissement', 'School')}</span><span class="s" aria-hidden="true">${tr('Établ.', 'School')}</span></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </div>
</section>
<section class="sec">
  <div class="wrap cols2">
    <div class="card">
      <h2>${tr('Conditions de la licence', 'Licence terms')}</h2>
      ${licenceRules(lang)}
    </div>
    <div class="card card-navy">
      <h2>${tr('Prêt à commander ?', 'Ready to order?')}</h2>
      <p>${tr('Le plus simple : dans SknEDU-studio, menu <b>Aide › Obtenir une licence</b>. La demande est préparée avec votre adresse e-mail et le code de votre poste.', 'The easiest way: in SknEDU-studio, <b>Help › Get a licence</b>. The request is prepared with your e-mail address and your computer code.')}</p>
      <p>${tr('Vous pouvez aussi commander depuis ce site.', 'You can also order from this website.')}</p>
      <p><a class="btn btn-gold" href="${PAGES.order[lang]}">${tr('Commander une licence', 'Order a licence')}</a></p>
    </div>
  </div>
</section>`;
  return layout({ lang, key: 'pricing', body,
    title: tr('Éditions et tarifs — SknEDU-studio | ZintaServices', 'Editions and pricing — SknEDU-studio | ZintaServices'),
    desc: tr(`Version gratuite, licence Enseignant dès ${price(OFFRES[0].prix, 'fr')} pour 3 mois, licence Établissement ${price(offre('etab-1a').prix, 'fr')} par poste et par an. Essai gratuit de 30 jours.`, `Free version, Teacher licence from ${price(OFFRES[0].prix, 'en')} for 3 months, School licence ${price(offre('etab-1a').prix, 'en')} per seat per year. 30-day free trial.`) });
}

// ------------------------------------------------------------------ Commander une licence
function order(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const data = { lang, wa: WA, email: EMAIL, vendeur: VENDEUR, phone: PHONE, devise: C.devise || 'FCFA',
    offres: OFFRES.map((o) => ({ id: o.id, label: offreLabel(o, lang), prix: o.prix, parPoste: !!o.parPoste, min: o.min || 1 })) };
  const mm = (C.mobileMoney || []).map((m) => `<div class="pay"><span class="pay-logo pay-${m.operateur.toLowerCase().replace(/[^a-z]/g, '')}">${esc(m.operateur)}</span><div><b class="pay-num">${PHONE}</b><small>${esc(m.nom || VENDEUR)}</small></div><button class="btn btn-sm btn-line" type="button" data-copy="${esc(m.numero)}">${ICON.copy} ${tr('Copier', 'Copy')}</button></div>`).join('\n');
  const opts = data.offres.map((o) => `<option value="${o.id}">${esc(o.label)} — ${price(o.prix, lang)}${o.parPoste ? tr(' par poste', ' per seat') : ''}</option>`).join('');
  const body = `${pageHead(tr('Commander une licence', 'Order a licence'), tr('Payez par Mobile Money, envoyez votre demande par WhatsApp ou par e-mail, et recevez votre clé de licence SknEDU-studio.', 'Pay by Mobile Money, send your request by WhatsApp or e-mail, and receive your SknEDU-studio licence key.'))}
<section class="sec">
  <div class="wrap order-grid">
    <div class="order-main">
      <div class="card">
        <h2><span class="num">1</span> ${tr('Préparez votre demande', 'Prepare your request')}</h2>
        <p>${tr('<b>Depuis le logiciel (recommandé)</b> : menu <b>Aide › 🛒 Obtenir une licence</b>, choisissez l\'offre puis « WhatsApp », « Mobile Money » ou « E-mail » : la demande est préparée avec l\'adresse e-mail de votre compte et le code de votre poste.', '<b>From the software (recommended)</b>: <b>Help › 🛒 Get a licence</b>, choose the offer, then “WhatsApp”, “Mobile Money” or “E-mail”: the request is prepared with your account e-mail address and your computer code.')}</p>
        <p>${tr('Vous avez choisi <b>« Page de paiement »</b> ? Votre demande a été copiée : collez-la ci-dessous. Vous pouvez aussi remplir le formulaire.', 'Did you choose <b>“Payment page”</b>? Your request has been copied: paste it below. You can also fill in the form.')}</p>
        <form id="order" class="form" novalidate>
          <script type="application/json" id="order-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
          <label class="full">${tr('Demande copiée depuis le logiciel (facultatif)', 'Request copied from the software (optional)')}
            <textarea id="o-paste" rows="5" placeholder="Commande SknEDU-studio — CMD-…"></textarea>
          </label>
          <div class="paste-row"><button class="btn btn-sm btn-line" type="button" id="o-pastebtn">📋 ${tr('Coller', 'Paste')}</button><p id="o-parsed" class="parsed" hidden></p></div>
          <fieldset id="o-manual">
            <legend>${tr('Ou remplissez le formulaire', 'Or fill in the form')}</legend>
            <label class="full">${tr('Offre', 'Offer')}<select id="o-offre">${opts}</select></label>
            <label id="o-qte-row" hidden>${tr('Nombre de postes', 'Number of seats')}<input id="o-qte" type="number" inputmode="numeric" min="1" max="500" value="1"></label>
            <label><span>${tr('Adresse e-mail du compte SknEDU-studio', 'SknEDU-studio account e-mail address')} <span class="req">*</span></span><input id="o-email" type="email" autocomplete="email" inputmode="email" placeholder="prenom.nom@exemple.com"></label>
            <label>${tr('Nom et prénom', 'Full name')}<input type="text" id="o-nom" autocomplete="name"></label>
            <label>${tr('Établissement', 'School')}<input type="text" id="o-org" autocomplete="organization"></label>
          </fieldset>
          <p class="total">${tr('Montant', 'Amount')} : <b id="o-total">—</b></p>
          <p class="muted small">${tr('La licence sera émise pour l\'adresse e-mail du compte créé dans le logiciel : utilisez la même adresse.', 'The licence is issued for the e-mail address of the account created in the software: use the same address.')}</p>
        </form>
      </div>

      <div class="card">
        <h2><span class="num">2</span> ${tr('Payez par Mobile Money', 'Pay by Mobile Money')}</h2>
        <p>${tr('Envoyez le montant à l\'un de ces numéros, depuis votre application ou le menu de votre opérateur :', 'Send the amount to one of these numbers, from your app or your operator\'s menu:')}</p>
        <div class="pays">
${mm}
        </div>
        <p class="muted small">${tr('Indiquez la référence de commande (CMD-…) dans le motif du transfert, si l\'opérateur le permet. Gardez le SMS ou la capture de confirmation.', 'Put the order reference (CMD-…) in the transfer note, if your operator allows it. Keep the confirmation SMS or screenshot.')}</p>
        <label class="inline">${tr('Moyen de paiement utilisé', 'Payment method used')}
          <select id="o-moyen" form="order">${(C.mobileMoney || []).map((m) => `<option>${esc(m.operateur)}</option>`).join('')}<option value="">${tr('Pas encore payé', 'Not paid yet')}</option></select>
        </label>
        <label class="inline">${tr('Référence de la transaction (facultatif)', 'Transaction reference (optional)')}<input type="text" id="o-trx" form="order" autocomplete="off"></label>
      </div>

      <div class="card">
        <h2><span class="num">3</span> ${tr('Envoyez la demande et la preuve de paiement', 'Send the request and proof of payment')}</h2>
        <p>${tr('Le message s\'ouvre dans votre WhatsApp ou votre messagerie : vérifiez-le, ajoutez la capture du paiement, puis envoyez-le.', 'The message opens in your WhatsApp or e-mail app: check it, attach the payment screenshot, then send it.')}</p>
        <p id="o-error" class="error" role="alert" hidden></p>
        <div class="send">
          <button class="btn btn-wa" type="submit" form="order" data-send="wa">${ICON.wa} ${tr('Envoyer par WhatsApp', 'Send by WhatsApp')}</button>
          <button class="btn btn-navy" type="button" data-send="mail">${ICON.mail} ${tr('Envoyer par e-mail', 'Send by e-mail')}</button>
          <button class="btn btn-line" type="button" data-send="copy">${ICON.copy} ${tr('Copier le message', 'Copy the message')}</button>
        </div>
        <details class="preview"><summary>${tr('Voir le message', 'Show the message')}</summary><pre id="o-preview"></pre></details>
        <p class="muted small">${tr('Ce formulaire n\'envoie rien à notre serveur : tout se passe dans votre navigateur, et c\'est vous qui envoyez le message.', 'This form sends nothing to our server: everything happens in your browser, and you send the message yourself.')}</p>
      </div>

      <div class="card">
        <h2><span class="num">4</span> ${tr('Activez votre licence', 'Activate your licence')}</h2>
        <p>${tr('Après vérification du paiement, vous recevez votre clé <code>SKN1.…</code> par WhatsApp ou par e-mail. Dans SknEDU-studio : <b>Aide › Licence et édition › Activer</b>, collez la clé. L\'activation demande une connexion Internet.', 'Once the payment is checked, you receive your <code>SKN1.…</code> key by WhatsApp or e-mail. In SknEDU-studio: <b>Help › Licence and edition › Activate</b>, paste the key. Activation needs an Internet connection.')}</p>
      </div>
    </div>
    <aside class="order-side">
      <div class="card card-navy">
        <h2>${tr('Rappel des offres', 'Offers')}</h2>
        <ul class="durations">${OFFRES.map((o) => `<li><span>${esc(offreLabel(o, lang).replace(/ \(.*\)$/, ''))}</span><b>${price(o.prix, lang)}</b>${o.parPoste ? `<small>${tr(`par poste, ${o.min} postes minimum`, `per seat, ${o.min} seats minimum`)}</small>` : ''}</li>`).join('')}</ul>
        <p><a href="${PAGES.pricing[lang]}">${tr('Détail des éditions', 'Edition details')} →</a></p>
      </div>
      <div class="card">
        <h2>${tr('Bon à savoir', 'Good to know')}</h2>
        ${licenceRules(lang)}
      </div>
      <div class="card">
        <h2>${tr('Une question ?', 'A question?')}</h2>
        <p><a class="btn btn-wa btn-block" href="https://wa.me/${WA}" rel="noopener" aria-label="WhatsApp ${PHONE}">${ICON.wa} <span class="nw">${PHONE}</span></a></p>
        <p><a class="btn btn-line btn-block" href="mailto:${EMAIL}">${ICON.mail} ${EMAIL}</a></p>
      </div>
    </aside>
  </div>
</section>`;
  return layout({ lang, key: 'order', body,
    title: tr('Commander une licence SknEDU-studio — Wave, MTN MoMo | ZintaServices', 'Order a SknEDU-studio licence — Wave, MTN MoMo | ZintaServices'),
    desc: tr(`Commandez votre licence SknEDU-studio : paiement Wave ou MTN MoMo au ${PHONE}, demande par WhatsApp ou e-mail, clé reçue en retour.`, `Order your SknEDU-studio licence: pay by Wave or MTN MoMo to ${PHONE}, send the request by WhatsApp or e-mail, receive your key.`) });
}

// ------------------------------------------------------------------ Confidentialité (site, commandes, PRIVACY.md)
function privacy(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const R = [
    ['Mises à jour (github.com)', 'Updates (github.com)', 'Au démarrage puis toutes les 4 heures', 'At startup and every 4 hours', 'Aucune donnée personnelle : demande de la dernière version publiée', 'No personal data: a request for the latest published version', 'Aide › Préférences › « Rechercher les mises à jour automatiquement »', 'Help › Preferences › “Check for updates automatically”'],
    ['Assistant IA (Anthropic, OpenAI, Google, Mistral)', 'AI assistant (Anthropic, OpenAI, Google, Mistral)', 'Uniquement quand l\'utilisateur lance une demande à l\'IA avec sa propre clé', 'Only when the user sends a request to the AI with their own key', 'Le texte de la demande et la page, la sélection ou le document choisi', 'The request text and the chosen page, selection or document', 'Ne pas configurer de clé ; ou IA locale (Ollama), qui ne quitte pas l\'ordinateur ; l\'administrateur peut bloquer l\'IA', 'Do not set up a key; or use the local AI (Ollama), which never leaves the computer; the administrator can block AI'],
    ['Cloud (OneDrive, Google Drive, Dropbox…)', 'Cloud (OneDrive, Google Drive, Dropbox…)', 'Uniquement si l\'utilisateur enregistre dans un dossier synchronisé ou active la sauvegarde automatique', 'Only if the user saves to a synced folder or turns on automatic backup', 'Le document enregistré, transmis par l\'application officielle du service', 'The saved document, sent by the service\'s official app', 'Ne pas activer la sauvegarde automatique ; l\'administrateur peut bloquer le cloud', 'Do not turn on automatic backup; the administrator can block the cloud'],
    ['Classe connectée (réseau local)', 'Connected classroom (local network)', 'Uniquement quand l\'enseignant démarre un partage', 'Only when the teacher starts sharing', 'Le document partagé, aux appareils de la classe connectés au même réseau', 'The shared document, to classroom devices on the same network', 'Arrêter le partage (arrêt automatique à la fermeture)', 'Stop sharing (stops automatically on exit)'],
    ['Notifications d\'administration (ntfy)', 'Administration notifications (ntfy)', 'Uniquement si l\'administrateur de l\'établissement les configure', 'Only if the school administrator sets them up', 'Type d\'évènement, poste et utilisateur concernés', 'Event type, computer and user concerned', 'Console d\'administration', 'Administration console'],
    ['Activation des licences (service de l\'éditeur, Cloudflare)', 'Licence activation (publisher\'s service, Cloudflare)', 'Uniquement pour activer, désactiver ou revérifier une licence (au plus une fois par 12 h)', 'Only to activate, deactivate or re-check a licence (at most once every 12 h)', 'Clé de licence, adresse e-mail du compte, identifiant anonyme du poste', 'Licence key, account e-mail address, anonymous computer identifier', 'Ne pas activer de licence en ligne ; la version gratuite et l\'essai fonctionnent sans connexion', 'Do not activate a licence online; the free version and the trial work offline'],
    ['Commande d\'une licence', 'Ordering a licence', 'Uniquement si vous envoyez la demande (Aide › Obtenir une licence)', 'Only if you send the request (Help › Get a licence)', 'Adresse e-mail, nom, établissement, code du poste, offre choisie — envoyés à l\'éditeur par WhatsApp ou e-mail, depuis votre propre application', 'E-mail address, name, school, computer code, chosen offer — sent to the publisher by WhatsApp or e-mail, from your own app', 'Ne pas envoyer de demande', 'Do not send a request'],
    ['Compte et essai', 'Account and trial', 'Au premier démarrage', 'On first start', '<b>Rien n\'est envoyé</b> : l\'adresse e-mail, le nom et l\'établissement saisis restent sur l\'ordinateur, avec la date de début de l\'essai', '<b>Nothing is sent</b>: the e-mail address, name and school you enter stay on the computer, with the trial start date', '—', '—'],
    ['Installation d\'outils (winget, Ollama)', 'Installing tools (winget, Ollama)', 'Uniquement sur demande explicite (LibreOffice, Google Drive, IA locale…)', 'Only on explicit request (LibreOffice, Google Drive, local AI…)', 'Aucune donnée personnelle', 'No personal data', 'Ne pas lancer l\'installation', 'Do not start the installation'],
  ];
  const H = [tr('Connexion', 'Connection'), tr('Quand', 'When'), tr('Données envoyées', 'Data sent'), tr('Comment la désactiver', 'How to turn it off')];
  const rows = R.map((r) => `<tr><th scope="row" data-label="${H[0]}">${tr(r[0], r[1])}</th><td data-label="${H[1]}">${tr(r[2], r[3])}</td><td data-label="${H[2]}">${tr(r[4], r[5])}</td><td data-label="${H[3]}">${tr(r[6], r[7])}</td></tr>`).join('\n');
  const body = `${pageHead(tr('Confidentialité', 'Privacy'), tr('Ce site ne dépose aucun cookie et ne mesure pas l\'audience. Le logiciel SknEDU-studio fonctionne hors connexion, sans statistiques d\'utilisation.', 'This website sets no cookies and does not measure traffic. The SknEDU-studio software works offline, with no usage statistics.'))}
<section class="sec">
  <div class="wrap prose">
    <h2>${tr('Ce site', 'This website')}</h2>
    <ul>
      <li>${tr('<b>Aucun cookie</b>, aucune mesure d\'audience, aucun traceur publicitaire.', '<b>No cookies</b>, no audience measurement, no advertising trackers.')}</li>
      <li>${tr('Les formulaires de demande et de commande fonctionnent <b>dans votre navigateur</b> : ils ne transmettent rien à notre serveur. Le message n\'est envoyé que si vous l\'envoyez vous-même, par WhatsApp ou par e-mail.', 'The request and order forms work <b>in your browser</b>: they send nothing to our server. The message is only sent if you send it yourself, by WhatsApp or e-mail.')}</li>
      <li>${tr('Le site est hébergé par Cloudflare (Cloudflare Pages), qui peut traiter des données techniques de connexion (adresse IP, navigateur) pour acheminer les pages et protéger le service.', 'The site is hosted by Cloudflare (Cloudflare Pages), which may process technical connection data (IP address, browser) to deliver pages and protect the service.')}</li>
      <li>${tr('La page Télécharger demande à GitHub (api.github.com) le numéro et les fichiers de la dernière version, et les téléchargements se font depuis GitHub : GitHub reçoit alors les mêmes données techniques de connexion.', 'The Download page asks GitHub (api.github.com) for the number and files of the latest version, and downloads come from GitHub: GitHub then receives the same technical connection data.')}</li>
    </ul>
    <h2>${tr('Vos demandes et commandes', 'Your requests and orders')}</h2>
    <p>${tr('Les informations que vous nous envoyez (nom, téléphone, adresse e-mail, ville ou adresse de livraison, articles demandés, preuve de paiement et, pour une licence, l\'adresse e-mail du compte et le code du poste) servent uniquement à vous répondre, à traiter et livrer votre commande et à émettre votre licence. Elles ne sont ni vendues ni cédées. Vous pouvez demander à les consulter ou à les supprimer en nous écrivant.', 'The information you send us (name, phone, e-mail address, town or delivery address, items requested, proof of payment and, for a licence, the account e-mail address and computer code) is used only to reply to you, process and deliver your order and issue your licence. It is never sold or passed on. You can ask to see or delete it by writing to us.')}</p>

    <h2>${tr('Le logiciel SknEDU-studio', 'The SknEDU-studio software')}</h2>
    <p>${tr('SknEDU-studio fonctionne <b>hors connexion</b>. Le logiciel ne collecte aucune donnée personnelle, n\'envoie <b>aucune statistique d\'utilisation</b> et ne transfère aucune information vers un autre système en réseau, sauf dans les cas suivants, tous visibles et à l\'initiative de l\'utilisateur ou de son administrateur :', 'SknEDU-studio works <b>offline</b>. The software collects no personal data, sends <b>no usage statistics</b> and transfers no information to any other networked system, except in the following cases, all visible and started by the user or their administrator:')}</p>
  </div>
  <div class="wrap">
    <div class="table-wrap"><table class="rt">
      <thead><tr>${H.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>
  </div>
  <div class="wrap prose">
    <p>${tr('Le compte (adresse e-mail obligatoire, nom et établissement facultatifs) et la date de début de l\'essai sont enregistrés sur l\'ordinateur, chiffrés (AES-256-GCM). Ces informations servent uniquement à l\'essai et à la vérification de la licence ; elles ne sont transmises à personne. Elles sont conservées après la désinstallation pour que l\'essai ne puisse pas être recommencé sur le même poste.', 'The account (e-mail address required, name and school optional) and the trial start date are stored on the computer, encrypted (AES-256-GCM). This information is used only for the trial and to check the licence; it is passed on to no one. It is kept after uninstalling so that the trial cannot be restarted on the same computer.')}</p>
    <p>${tr('Les clés d\'API de l\'assistant IA sont chiffrées sur l\'ordinateur et ne sont jamais envoyées ailleurs qu\'au fournisseur choisi. Les documents ouverts restent sur l\'ordinateur ; leurs copies de récupération (documents non enregistrés) sont chiffrées (AES-256-GCM).', 'AI assistant API keys are encrypted on the computer and are never sent anywhere other than the chosen provider. Opened documents stay on the computer; their recovery copies (unsaved documents) are encrypted (AES-256-GCM).')}</p>
    <p>${tr('Notes attribuées avec l\'outil « Noter » : la note, le barème et l\'appréciation de chaque page sont enregistrés dans les propriétés du PDF (en plus de leur affichage sur la copie), pour que le relevé des notes fonctionne après réouverture. Ils accompagnent donc le fichier s\'il est partagé ; un PDF ne contenant qu\'une copie ne contient que la note de cette copie.', 'Marks given with the “Grade” tool: the mark, the scale and the comment for each page are saved in the PDF properties (as well as being shown on the paper), so that the grade summary still works after reopening. They therefore travel with the file if it is shared; a PDF containing a single paper only contains that paper\'s mark.')}</p>
    <p>${tr('Composants tiers : les services ci-dessus appliquent leur propre politique de confidentialité lorsque l\'utilisateur choisit de les utiliser.', 'Third-party components: the services above apply their own privacy policy when the user chooses to use them.')}</p>
    <h2>${tr('Contact', 'Contact')}</h2>
    <p>${tr(`Pour toute question sur vos données : <a href="mailto:${EMAIL}">${EMAIL}</a> ou WhatsApp ${PHONE}. Pour un problème du logiciel : <a href="${REPO}/issues" rel="noopener">GitHub › Issues</a>.`, `For any question about your data: <a href="mailto:${EMAIL}">${EMAIL}</a> or WhatsApp ${PHONE}. For a software issue: <a href="${REPO}/issues" rel="noopener">GitHub › Issues</a>.`)}</p>
  </div>
</section>`;
  return layout({ lang, key: 'privacy', body,
    title: tr('Confidentialité — ZintaServices', 'Privacy — ZintaServices'),
    desc: tr('Confidentialité chez ZintaServices : pas de cookies sur le site, usage des données de commande, et fonctionnement hors connexion du logiciel SknEDU-studio.', 'Privacy at ZintaServices: no cookies on the website, how order data is used, and how the SknEDU-studio software works offline.') });
}

// ------------------------------------------------------------------ Contact
function contact(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const body = `${pageHead(tr('Contact', 'Contact'), tr('Une question, une liste de produits, un devis pour votre école ou votre entreprise, une licence SknEDU-studio ? Écrivez-nous.', 'A question, a list of products, a quote for your school or business, a SknEDU-studio licence? Get in touch.'))}
<section class="sec">
  <div class="wrap contact-grid">
    <article class="card contact-card"><span class="big-ic ic-wa">${ICON.wa}</span><h2>WhatsApp</h2><p>${tr('Le moyen le plus rapide : questions, demandes de produits, commandes, aide à l\'installation du logiciel.', 'The quickest way: questions, product requests, orders, help installing the software.')}</p><p class="big"><a href="tel:+${WA}">${PHONE.replace(/ /g, ' ')}</a></p><a class="btn btn-wa" href="https://wa.me/${WA}" rel="noopener">${tr('Écrire sur WhatsApp', 'Message on WhatsApp')}</a></article>
    <article class="card contact-card"><span class="big-ic ic-mail">${ICON.mail}</span><h2>E-mail</h2><p>${tr('Pour les commandes, les devis et les factures.', 'For orders, quotes and invoices.')}</p><p class="big">${EMAIL}</p><a class="btn btn-navy" href="mailto:${EMAIL}">${tr('Envoyer un e-mail', 'Send an e-mail')}</a></article>
    <article class="card contact-card"><span class="big-ic ic-mm">📱</span><h2>Mobile Money</h2><p>${tr(`Wave ou MTN MoMo, au nom de ${VENDEUR}, après confirmation de votre commande.`, `Wave or MTN MoMo, in the name of ${VENDEUR}, once your order is confirmed.`)}</p><p class="big">${PHONE}</p><button class="btn btn-line" type="button" data-copy="${esc(C.whatsapp)}">${ICON.copy} ${tr('Copier le numéro', 'Copy the number')}</button></article>
    <article class="card contact-card"><span class="big-ic ic-gh">${ICON.gh}</span><h2>${tr('Logiciel : signaler un problème', 'Software: report a problem')}</h2><p>${tr('Un bogue ou une idée pour SknEDU-studio ? Le code source est public.', 'A bug or an idea for SknEDU-studio? The source code is public.')}</p><p class="big">GitHub</p><a class="btn btn-line" href="${REPO}/issues" rel="noopener">${tr('Ouvrir une demande', 'Open an issue')}</a></article>
  </div>
  <div class="wrap narrow">
    <p class="center muted">${tr('Pour une question de licence, indiquez l\'adresse e-mail de votre compte SknEDU-studio.', 'For a licence question, please give the e-mail address of your SknEDU-studio account.')}<br>${VENDEUR} — ${TITULAIRE} — Côte d'Ivoire</p>
  </div>
</section>`;
  return layout({ lang, key: 'contact', body,
    title: tr('Contact — ZintaServices', 'Contact — ZintaServices'),
    desc: tr(`Contactez ZintaServices : WhatsApp ${PHONE}, e-mail ${EMAIL}. Logiciel SknEDU-studio, fournitures, produits bio, électronique.`, `Contact ZintaServices: WhatsApp ${PHONE}, e-mail ${EMAIL}. SknEDU-studio software, supplies, organic products, electronics.`) });
}

// ------------------------------------------------------------------ Mentions légales
function legal(lang) {
  const tr = (fr, en) => (lang === 'fr' ? fr : en);
  const body = `${pageHead(tr('Mentions légales', 'Legal notice'), '')}
<section class="sec">
  <div class="wrap prose">
    <h2>${tr('Éditeur du site', 'Website publisher')}</h2>
    <p><b>${VENDEUR}</b><br>${tr('Titulaire', 'Owner')} : ${TITULAIRE}<br>Côte d'Ivoire<br>WhatsApp / ${tr('téléphone', 'phone')} : ${PHONE}<br>E-mail : <a href="mailto:${EMAIL}">${EMAIL}</a></p>
    <p>${tr('Directeur de la publication', 'Publication director')} : ${TITULAIRE}.</p>
    <p>${tr('Activités : édition et vente du logiciel SknEDU-studio ; vente de fournitures scolaires et de bureau, de compléments alimentaires et produits bio, d\'appareils et accessoires électroniques et informatiques.', 'Activities: publishing and selling the SknEDU-studio software; selling school and office supplies, food supplements and organic products, electronic and computer devices and accessories.')}</p>

    <h2>${tr('Hébergement', 'Hosting')}</h2>
    <p>Cloudflare, Inc. (Cloudflare Pages), 101 Townsend St, San Francisco, CA 94107, ${tr('États-Unis', 'United States')} — <a href="https://www.cloudflare.com" rel="noopener">www.cloudflare.com</a>.</p>
    <p>${tr('Les fichiers d\'installation du logiciel sont distribués par GitHub', 'The software installers are distributed via GitHub')} (<a href="${RELEASES}" rel="noopener">github.com/ZintaSkn/edupdf-studio</a>).</p>

    <h2>${tr('Vente de produits', 'Product sales')}</h2>
    <ul>
      <li>${tr('Les produits présentés sur ce site sont des exemples de ce que nous proposons. La disponibilité et le prix de chaque article sont communiqués sur demande (WhatsApp ou e-mail), avant toute commande.', 'The products shown on this website are examples of what we offer. The availability and price of each item are given on request (WhatsApp or e-mail), before any order.')}</li>
      <li>${tr(`Le paiement se fait par Wave ou MTN MoMo au ${PHONE} (${VENDEUR}), après confirmation de la commande. La livraison ou le retrait sont convenus avec le client.`, `Payment is made by Wave or MTN MoMo to ${PHONE} (${VENDEUR}), once the order is confirmed. Delivery or pick-up is agreed with the customer.`)}</li>
      <li>${tr('Compléments alimentaires : ce ne sont pas des médicaments ; ils ne remplacent ni une alimentation variée et équilibrée, ni un traitement médical. Respectez la dose journalière et demandez l\'avis d\'un professionnel de santé en cas de doute.', 'Food supplements: they are not medicines; they replace neither a varied and balanced diet nor medical treatment. Follow the daily dose and ask a health professional if in doubt.')}</li>
    </ul>

    <h2>${tr('Vente des licences SknEDU-studio', 'SknEDU-studio licence sales')}</h2>
    <ul>
      <li>${tr('Une licence donne accès aux fonctions Premium de SknEDU-studio pour la durée achetée. Les offres et prix en vigueur sont ceux de la page', 'A licence gives access to SknEDU-studio\'s Premium features for the purchased period. Current offers and prices are those on the')} <a href="${PAGES.pricing[lang]}">${tr('Éditions et tarifs', 'Editions and pricing')}</a>${tr('', ' page')}.</li>
      <li>${tr(`Le paiement se fait par Wave ou MTN MoMo au ${PHONE} (${VENDEUR}). La clé de licence est envoyée par WhatsApp ou par e-mail après vérification du paiement.`, `Payment is made by Wave or MTN MoMo to ${PHONE} (${VENDEUR}). The licence key is sent by WhatsApp or e-mail once the payment is checked.`)}</li>
      <li>${tr('La licence est liée à l\'adresse e-mail du compte, active sur un seul ordinateur à la fois, transférable vers un autre poste pour ses jours restants ; deux licences au plus se cumulent sur un poste.', 'The licence is tied to the account e-mail address, active on one computer at a time, transferable to another computer for its remaining days; up to two licences can be stacked on one computer.')}</li>
      <li>${tr('L\'essai gratuit de 30 jours permet de vérifier que le logiciel convient avant tout achat.', 'The 30-day free trial lets you check that the software suits you before buying.')}</li>
    </ul>
    <p>${tr(`Pour toute question ou réclamation sur une commande : <a href="mailto:${EMAIL}">${EMAIL}</a> ou WhatsApp ${PHONE}.`, `For any question or complaint about an order: <a href="mailto:${EMAIL}">${EMAIL}</a> or WhatsApp ${PHONE}.`)}</p>

    <h2>${tr('Propriété intellectuelle', 'Intellectual property')}</h2>
    <p>${tr(`Le <b>code</b> de SknEDU-studio est un logiciel libre, publié sous licence <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">GNU AGPL-3.0</a> (Copyright © ${YEAR} ${TITULAIRE}) : vous pouvez l'utiliser, l'étudier, le modifier et le redistribuer selon les termes de cette licence.`, `SknEDU-studio's <b>code</b> is free software, published under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">GNU AGPL-3.0</a> licence (Copyright © ${YEAR} ${TITULAIRE}): you may use, study, modify and redistribute it under the terms of that licence.`)}</p>
    <p>${tr(`La <b>marque</b> est différente : les noms « SknEDU-studio » et « SknEDU », le logo et l'icône sont réservés à leur titulaire, ${TITULAIRE}. Une version modifiée doit porter un autre nom et un autre logo. Détails : <a href="${REPO}/blob/main/TRADEMARK.md" rel="noopener">politique de marque</a>.`, `The <b>trademark</b> is different: the names “SknEDU-studio” and “SknEDU”, the logo and the icon are reserved to their owner, ${TITULAIRE}. A modified version must use another name and logo. Details: <a href="${REPO}/blob/main/TRADEMARK.md" rel="noopener">trademark policy</a>.`)}</p>
    <p>${tr(`Les textes, captures d'écran et visuels de ce site appartiennent à ${VENDEUR}. Les marques des produits proposés et les noms Wave, MTN MoMo, WhatsApp, Windows, macOS, Linux et des services d'IA cités appartiennent à leurs propriétaires respectifs.`, `The texts, screenshots and visuals on this website belong to ${VENDEUR}. The brands of the products offered and the names Wave, MTN MoMo, WhatsApp, Windows, macOS, Linux and the AI services mentioned belong to their respective owners.`)}</p>

    <h2>${tr('Données personnelles', 'Personal data')}</h2>
    <p>${tr('Voir la page', 'See the')} <a href="${PAGES.privacy[lang]}">${tr('Confidentialité', 'Privacy')}</a>${tr('.', ' page.')}</p>

    <h2>${tr('Garantie du logiciel', 'Software warranty')}</h2>
    <p>${tr('Comme tout logiciel publié sous licence AGPL-3.0, SknEDU-studio est fourni sans garantie, dans les limites prévues par cette licence et par la loi applicable.', 'Like all software published under the AGPL-3.0 licence, SknEDU-studio is provided without warranty, within the limits set by that licence and by applicable law.')}</p>
  </div>
</section>`;
  return layout({ lang, key: 'legal', body,
    title: tr('Mentions légales — ZintaServices', 'Legal notice — ZintaServices'),
    desc: tr(`Mentions légales de ZintaServices : éditeur ${TITULAIRE}, hébergement, vente de produits et de licences SknEDU-studio, propriété intellectuelle.`, `ZintaServices legal notice: publisher ${TITULAIRE}, hosting, sale of products and SknEDU-studio licences, intellectual property.`) });
}

// ------------------------------------------------------------------ 404
function notFound() {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page introuvable — ZintaServices</title><meta name="robots" content="noindex">
<link rel="icon" href="/img/zinta.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/site.css?v=${ASSET_V}"></head>
<body class="nf">
<main class="wrap nf-box">
  <a href="/"><img src="/img/zinta.svg" width="96" height="96" alt="ZintaServices"></a>
  <h1>Page introuvable</h1>
  <p>Cette page n'existe pas ou a été déplacée.</p>
  <p class="cta"><a class="btn btn-gold" href="/">Accueil</a> <a class="btn btn-line" href="/sknedu-studio/">SknEDU-studio</a> <a class="btn btn-line" href="/contact/">Contact</a></p>
  <p lang="en" class="muted">Page not found — <a href="/en/">English home page</a></p>
</main>
</body>
</html>
`;
}

// ------------------------------------------------------------------ écriture
function write(rel, content) {
  const f = path.join(OUT, rel.replace(/\/$/, '/index.html').replace(/^\//, ''));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
function build() {
  const css = fs.readFileSync(path.join(OUT, 'assets', 'site.css'));
  const js = fs.readFileSync(path.join(OUT, 'assets', 'site.js'));
  ASSET_V = crypto.createHash('sha256').update(css).update(js).digest('hex').slice(0, 10);
  const builders = { home, logiciel, download, pricing, order, privacy, contact, legal };
  for (const [k, fn] of Object.entries(builders)) for (const lang of ['fr', 'en']) write(PAGES[k][lang], fn(lang));
  for (const k of Object.keys(CATS)) for (const lang of ['fr', 'en']) write(PAGES[k][lang], category(k, lang));
  write('/404.html', notFound());
  // pages HTML qui ne sont plus générées (à supprimer à la main avant publication)
  const made = new Set(['404.html', ...Object.values(PAGES).flatMap((p) => ['fr', 'en'].map((l) => (p[l].slice(1) + 'index.html')))]);
  const stale = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.html') && !made.has(path.relative(OUT, p).split(path.sep).join('/'))) stale.push(p); } })(OUT);
  if (stale.length) console.warn('Pages obsolètes (plus générées) :\n  ' + stale.join('\n  '));
  const urls = Object.values(PAGES).flatMap((p) => ['fr', 'en'].map((l) => `  <url><loc>${BASE + p[l]}</loc>${['fr', 'en'].map((h) => `<xhtml:link rel="alternate" hreflang="${h}" href="${BASE + p[h]}"/>`).join('')}</url>`));
  write('/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
  write('/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
  // adresses courtes faciles à partager
  write('/_redirects', `/telecharger /sknedu-studio/telecharger/ 301
/tarifs /sknedu-studio/tarifs/ 301
/commander /sknedu-studio/commander/ 301
/logiciel /sknedu-studio/ 301
/sknedu /sknedu-studio/ 301
`);
  // favicon.ico (icône PNG 32 px dans un conteneur ICO) : évite une erreur 404 à chaque visite
  const png = fs.readFileSync(path.join(OUT, 'img', 'zinta-32.png'));
  const ico = Buffer.alloc(22); ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
  ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(OUT, 'favicon.ico'), Buffer.concat([ico, png]));
  // Politique de sécurité du contenu : seul le petit script en ligne (classe « js ») est autorisé, par son empreinte
  const inlineHash = crypto.createHash('sha256').update(INLINE_JS).digest('base64');
  const csp = `default-src 'self'; script-src 'self' 'sha256-${inlineHash}'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.github.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`;
  write('/_headers', `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/img/*
  Cache-Control: public, max-age=604800
`);
  console.log(`Site généré dans ${OUT} (version des ressources ${ASSET_V}).`);
}
build();

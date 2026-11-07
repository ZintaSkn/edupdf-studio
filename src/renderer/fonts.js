/* EduPDF Studio — polices : reconnaissance de la police d'origine et réécriture Unicode (tous alphabets) */
'use strict';

// Fichiers de police Windows : [normal, gras, italique, gras italique]
const FONT_FAMILIES = {
  'Arial': ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'],
  'Arial Narrow': ['ARIALN.TTF', 'ARIALNB.TTF', 'ARIALNI.TTF', 'ARIALNBI.TTF'],
  'Times New Roman': ['times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf'],
  'Calibri': ['calibri.ttf', 'calibrib.ttf', 'calibrii.ttf', 'calibriz.ttf'],
  'Cambria': ['cambria.ttc#0', 'cambriab.ttf', 'cambriai.ttf', 'cambriaz.ttf'],
  'Cambria Math': ['cambria.ttc#1', 'cambria.ttc#1', 'cambria.ttc#1', 'cambria.ttc#1'],
  'Candara': ['Candara.ttf', 'Candarab.ttf', 'Candarai.ttf', 'Candaraz.ttf'],
  'Century Gothic': ['GOTHIC.TTF', 'GOTHICB.TTF', 'GOTHICI.TTF', 'GOTHICBI.TTF'],
  'Comic Sans MS': ['comic.ttf', 'comicbd.ttf', 'comici.ttf', 'comicz.ttf'],
  'Consolas': ['consola.ttf', 'consolab.ttf', 'consolai.ttf', 'consolaz.ttf'],
  'Constantia': ['constan.ttf', 'constanb.ttf', 'constani.ttf', 'constanz.ttf'],
  'Corbel': ['corbel.ttf', 'corbelb.ttf', 'corbeli.ttf', 'corbelz.ttf'],
  'Courier New': ['cour.ttf', 'courbd.ttf', 'couri.ttf', 'courbi.ttf'],
  'Franklin Gothic Medium': ['framd.ttf', 'framd.ttf', 'framdit.ttf', 'framdit.ttf'],
  'Garamond': ['GARA.TTF', 'GARABD.TTF', 'GARAIT.TTF', 'GARABD.TTF'],
  'Georgia': ['georgia.ttf', 'georgiab.ttf', 'georgiai.ttf', 'georgiaz.ttf'],
  'Book Antiqua': ['BKANT.TTF', 'ANTQUAB.TTF', 'ANTQUAI.TTF', 'ANTQUABI.TTF'],
  'Impact': ['impact.ttf', 'impact.ttf', 'impact.ttf', 'impact.ttf'],
  'Lucida Console': ['lucon.ttf', 'lucon.ttf', 'lucon.ttf', 'lucon.ttf'],
  'Palatino Linotype': ['pala.ttf', 'palab.ttf', 'palai.ttf', 'palabi.ttf'],
  'Segoe UI': ['segoeui.ttf', 'segoeuib.ttf', 'segoeuii.ttf', 'segoeuiz.ttf'],
  'Segoe UI Symbol': ['seguisym.ttf', 'seguisym.ttf', 'seguisym.ttf', 'seguisym.ttf'],
  'Tahoma': ['tahoma.ttf', 'tahomabd.ttf', 'tahoma.ttf', 'tahomabd.ttf'],
  'Trebuchet MS': ['trebuc.ttf', 'trebucbd.ttf', 'trebucit.ttf', 'trebucbi.ttf'],
  'Verdana': ['verdana.ttf', 'verdanab.ttf', 'verdanai.ttf', 'verdanaz.ttf']
};

// Polices de secours pour les caractères absents (grec, cyrillique, symboles, maths, alphabets africains, arabe, indiens, chinois, coréen, japonais)
const FALLBACK_FILES = ['segoeui.ttf', 'seguisym.ttf', 'cambria.ttc#1', 'ebrima.ttf', 'Nirmala.ttc#0', 'nirmala.ttf',
  'msyh.ttc#0', 'malgun.ttf', 'YuGothR.ttc#0', 'seguiemj.ttf', 'arial.ttf'];

// Noms de polices PDF → famille Windows équivalente
const FONT_ALIASES = [
  [/cambriamath/, 'Cambria Math'], [/cambria|caladea/, 'Cambria'],
  [/arialnarrow|helveticanarrow|helveticacondensed/, 'Arial Narrow'],
  [/helvetica|arial|arimo|liberationsans|nimbussans|helv|swiss/, 'Arial'],
  [/timesnewroman|times|tinos|liberationserif|nimbusrom|tirom|roman/, 'Times New Roman'],
  [/couriernew|courier|cousine|liberationmono|nimbusmono|cour/, 'Courier New'],
  [/calibri|carlito/, 'Calibri'], [/candara/, 'Candara'], [/constantia/, 'Constantia'], [/corbel/, 'Corbel'],
  [/georgia/, 'Georgia'], [/verdana/, 'Verdana'], [/tahoma/, 'Tahoma'], [/segoeuisymbol|symbol/, 'Segoe UI Symbol'],
  [/segoe/, 'Segoe UI'], [/trebuchet/, 'Trebuchet MS'], [/comicsans|comic/, 'Comic Sans MS'],
  [/centurygothic/, 'Century Gothic'], [/garamond/, 'Garamond'], [/bookantiqua|antiqua/, 'Book Antiqua'],
  [/palatino|pala/, 'Palatino Linotype'], [/consolas/, 'Consolas'], [/lucidaconsole/, 'Lucida Console'],
  [/impact/, 'Impact'], [/franklin/, 'Franklin Gothic Medium']
];

/** Déduit la famille, le gras et l'italique d'une police PDF (objet police de PDF.js). */
function matchFont(raw = {}) {
  const n = String(raw.name || '').replace(/^[A-Z]{6}\+/, '').toLowerCase().replace(/[^a-z]/g, '');
  let family = null;
  for (const [re, fam] of FONT_ALIASES) if (re.test(n)) { family = fam; break; }
  if (!family) family = raw.fallbackName === 'serif' ? 'Times New Roman' : raw.fallbackName === 'monospace' ? 'Courier New' : 'Arial';
  const bold = !!(raw.bold || raw.black) || /bold|black|heavy|semibold|demibold|bd$|bdmt$/.test(n);
  const italic = !!raw.italic || /italic|oblique|it$|itmt$/.test(n);
  return { family, bold, italic };
}

const cssFont = (f) => `"${(f && f.family) || 'Arial'}", Arial, sans-serif`;

const _fontBytes = new Map();
const _fkFonts = new Map();
async function fontBytes(spec) {
  if (!_fontBytes.has(spec)) {
    let b = null;
    try { b = await window.api.fontFile(spec); } catch { b = null; }
    _fontBytes.set(spec, b ? new Uint8Array(b) : null);
  }
  return _fontBytes.get(spec);
}
async function fkFont(spec) {
  if (!_fkFonts.has(spec)) {
    let f = null;
    try { const b = await fontBytes(spec); f = b && fontkit.create(b); if (f && f.fonts) f = f.fonts[0]; } catch { f = null; }
    _fkFonts.set(spec, f);
  }
  return _fkFonts.get(spec);
}
/** Fichier de police pour une famille / un style, avec repli sur le style normal puis Arial. */
async function specFor(font) {
  const fam = FONT_FAMILIES[font && font.family] || FONT_FAMILIES.Arial;
  const i = (font && font.bold ? 1 : 0) + (font && font.italic ? 2 : 0);
  for (const s of [fam[i], fam[i & 1], fam[0], 'arial.ttf', 'segoeui.ttf']) if (s && await fontBytes(s)) return s;
  return null;
}
/** Découpe un texte en segments, chacun avec une police qui contient tous ses caractères. */
async function fontRuns(text, font) {
  const primary = await specFor(font);
  const runs = [];
  for (const ch of String(text).replace(/\t/g, '    ')) {
    const cp = ch.codePointAt(0);
    let spec = null;
    if (!primary) spec = null;
    else if (/\s/.test(ch)) spec = runs.length && runs[runs.length - 1].spec ? runs[runs.length - 1].spec : primary;
    else {
      for (const s of [primary, ...FALLBACK_FILES]) { const f = await fkFont(s); if (f && f.hasGlyphForCodePoint(cp)) { spec = s; break; } }
      if (!spec) spec = primary;
    }
    const last = runs[runs.length - 1];
    if (last && last.spec === spec) last.text += ch; else runs.push({ spec, text: ch });
  }
  return runs;
}

/** Intégration des polices dans un document pdf-lib (sous-ensembles : fichiers légers). */
function fontEmbedder(doc) {
  doc.registerFontkit(fontkit);
  const cache = new Map();
  return {
    get(spec) {
      if (!cache.has(spec)) cache.set(spec, spec ? fontBytes(spec).then((b) => doc.embedFont(b, { subset: true })) : doc.embedFont(PDFLib.StandardFonts.Helvetica));
      return cache.get(spec);
    }
  };
}

/** Écrit un texte Unicode (police d'origine + secours) ; retourne la largeur écrite. */
async function drawUnicode(page, emb, text, { x, y, size, font, rotate = 0, color, opacity }) {
  const runs = await fontRuns(text, font);
  const rad = rotate * Math.PI / 180;
  let cx = x, cy = y, total = 0;
  for (const r of runs) {
    const f = await emb.get(r.spec);
    const t = r.spec ? r.text : cleanLatin(f, r.text);
    const opts = { x: cx, y: cy, size, font: f, rotate: PDFLib.degrees(rotate) };
    if (color) opts.color = color;
    if (opacity !== undefined) opts.opacity = opacity;
    page.drawText(t, opts);
    const w = f.widthOfTextAtSize(t, size);
    cx += w * Math.cos(rad); cy += w * Math.sin(rad); total += w;
  }
  return total;
}

/** Largeur d'un texte (en points) avec la police choisie et ses secours. */
async function measureText(text, font, size) {
  let w = 0;
  for (const r of await fontRuns(text, font)) {
    const f = r.spec && await fkFont(r.spec);
    w += f ? f.layout(r.text).advanceWidth / f.unitsPerEm * size : r.text.length * size * 0.5;
  }
  return w;
}

// Dernier recours (aucune police Windows disponible) : alphabet latin seulement
const _encOk = new Map();
function cleanLatin(font, s) {
  s = String(s).replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...');
  let out = '';
  for (const ch of s) {
    if (!_encOk.has(ch)) { try { font.encodeText(ch); _encOk.set(ch, true); } catch { _encOk.set(ch, false); } }
    out += _encOk.get(ch) ? ch : '?';
  }
  return out;
}

/*
 * Data model: profile, documents, normalisation of anything coming from
 * storage or from an imported JSON file, and amount computation.
 */
(function (root) {
  'use strict';

  var M = typeof module !== 'undefined' && module.exports ? require('./money.js') : root.EDF.money;

  var DOC_TYPES = { devis: 'Devis', facture: 'Facture' };
  var DEFAULT_ACCEPTANCE = 'Bon pour accord, date et signature du client :';

  function uid() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function str(value, max) {
    return typeof value === 'string' ? value.slice(0, max || 5000) : '';
  }

  function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function isoDate(value) {
    var s = str(value, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  /** Only inline raster/SVG images are accepted (rendered through <img>, so no script can run). */
  function imageData(value) {
    var s = typeof value === 'string' ? value : '';
    return s.length <= 700000 && /^data:image\/(svg\+xml|png|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(s) ? s : '';
  }

  function todayISO() {
    var d = new Date();
    var p = function (n) {
      return String(n).padStart(2, '0');
    };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function formatDateFR(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  /**
   * Document name = file name: letters, digits and "_" only. Accents are removed
   * (Mac and Windows do not encode them the same way), spaces become "_".
   * A trailing "_" is kept so it can be typed; use cleanName() to finish.
   */
  function fileName(text) {
    return String(text == null ? '' : text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+/, '')
      .slice(0, 40);
  }

  function cleanName(text) {
    return fileName(text).replace(/_+$/, '');
  }

  /** Suggested name when the user did not type one: Devis_0001_Association_Exemple. */
  function autoName(doc) {
    var parts = [DOC_TYPES[doc.type] || 'Devis', doc.number, String(doc.recipient || '').split('\n')[0]]
      .map(cleanName)
      .filter(Boolean);
    return cleanName(parts.join('_')) || DOC_TYPES[doc.type] || 'Devis';
  }

  /** Logo size as a percentage of its reserved space (anything unusable = 100). */
  function brandScale(value) {
    var n = Number(value);
    if (value === '' || value == null || !isFinite(n)) {
      return 100;
    }
    return Math.max(20, Math.min(150, Math.round(n)));
  }

  var FONTS = ['sans', 'serif', 'round'];

  function docFont(value) {
    return FONTS.indexOf(value) !== -1 ? value : 'sans';
  }

  function blankItem() {
    return { id: uid(), label: '', qty: '1', price: '' };
  }

  function normalizeItem(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      id: uid(),
      label: str(raw.label, 500),
      qty: str(raw.qty, 20),
      price: str(raw.price, 30),
    };
  }

  /** Fictional defaults only: real details live in the user's browser / JSON drafts. */
  function defaultProfile() {
    return {
      legalName: 'Camille Exemple',
      isEI: true,
      showIdentity: true,
      address: "1 rue de l'Exemple\n00000 Ville-Exemple",
      siret: 'SIRET : 000 000 000 00000',
      otherIds: 'N° MDA : X000000',
      baseline: 'Votre baseline // à modifier dans le profil',
      vatMention: 'TVA non applicable, art. 293 B du CGI',
      footer: 'E / contact@exemple.invalid // T : +33 0 00 00 00 00\nPortfolio : www.exemple.invalid',
      defaultPaymentTerms: 'Règlement par virement bancaire à réception de la facture.',
      headerImage: '',
      headerScale: 100,
      font: 'sans',
      logoImage: '',
    };
  }

  function normalizeProfile(raw) {
    var d = defaultProfile();
    raw = raw && typeof raw === 'object' ? raw : {};
    var pick = function (key, max) {
      return typeof raw[key] === 'string' ? str(raw[key], max) : d[key];
    };
    return {
      legalName: pick('legalName', 200),
      isEI: bool(raw.isEI, d.isEI),
      showIdentity: bool(raw.showIdentity, d.showIdentity),
      address: pick('address', 500),
      siret: pick('siret', 200),
      otherIds: pick('otherIds', 500),
      /* texte libre sous le logo ; absent d'un ancien profil enregistré = rien à afficher */
      baseline: typeof raw.baseline === 'string' ? str(raw.baseline, 200) : '',
      vatMention: pick('vatMention', 300),
      footer: pick('footer', 600),
      defaultPaymentTerms: pick('defaultPaymentTerms', 600),
      headerImage: imageData(raw.headerImage),
      headerScale: brandScale(raw.headerScale),
      font: docFont(raw.font),
      logoImage: imageData(raw.logoImage),
    };
  }

  function newDoc(type, profile) {
    var isInvoice = type === 'facture';
    return {
      id: uid(),
      type: isInvoice ? 'facture' : 'devis',
      name: '',
      number: '',
      issueDate: todayISO(),
      recipient: '',
      title: '',
      serviceDate: '',
      description: '',
      items: [blankItem()],
      totalLabel: 'TOTAL :',
      showVat: true,
      validityDate: '',
      acceptance: !isInvoice,
      acceptanceText: DEFAULT_ACCEPTANCE,
      dueDate: '',
      paymentTerms: isInvoice && profile ? profile.defaultPaymentTerms : '',
      refQuote: '',
      refPO: '',
      refCommitment: '',
    };
  }

  function normalizeDoc(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var items = Array.isArray(raw.items) ? raw.items.slice(0, 200).map(normalizeItem) : [];
    if (items.length === 0) {
      items.push(blankItem());
    }
    return {
      id: uid(),
      type: raw.type === 'facture' ? 'facture' : 'devis',
      name: cleanName(raw.name),
      number: str(raw.number, 40),
      issueDate: isoDate(raw.issueDate),
      recipient: str(raw.recipient, 1000),
      title: str(raw.title, 300),
      serviceDate: str(raw.serviceDate, 200),
      description: str(raw.description, 10000),
      items: items,
      totalLabel: typeof raw.totalLabel === 'string' ? str(raw.totalLabel, 200) : 'TOTAL :',
      showVat: bool(raw.showVat, true),
      validityDate: isoDate(raw.validityDate),
      acceptance: bool(raw.acceptance, raw.type !== 'facture'),
      acceptanceText: typeof raw.acceptanceText === 'string' ? str(raw.acceptanceText, 300) : DEFAULT_ACCEPTANCE,
      dueDate: isoDate(raw.dueDate),
      paymentTerms: str(raw.paymentTerms, 1000),
      refQuote: str(raw.refQuote, 100),
      refPO: str(raw.refPO, 100),
      refCommitment: str(raw.refCommitment, 100),
    };
  }

  /** Independent copy: nothing is shared with the source quote. */
  function invoiceFromQuote(quote, profile) {
    var inv = normalizeDoc(JSON.parse(JSON.stringify(quote)));
    inv.id = uid();
    inv.type = 'facture';
    inv.name = '';
    inv.number = '';
    inv.issueDate = todayISO();
    inv.refQuote = quote.number || '';
    inv.refPO = '';
    inv.refCommitment = '';
    inv.dueDate = '';
    inv.validityDate = '';
    inv.acceptance = false;
    inv.paymentTerms = profile ? profile.defaultPaymentTerms : '';
    var stripped = inv.title.replace(/^\s*devis\s+pour\s+(?:(?:un|une|le|la|les|des)\s+|l['’]\s*)?/i, '');
    if (stripped !== inv.title && stripped !== '') {
      inv.title = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
    return inv;
  }

  /**
   * @returns {{rows: Array, totalCents: number, hasErrors: boolean}}
   * rows keep the editor index; blank rows (no label, no price) are ignored.
   */
  function compute(doc) {
    var rows = [];
    var total = 0;
    var hasErrors = false;
    doc.items.forEach(function (item, index) {
      var label = item.label.trim();
      var priceRaw = item.price.trim();
      var qtyRaw = item.qty.trim();
      if (label === '' && priceRaw === '') {
        rows.push({ index: index, blank: true, errors: {} });
        return;
      }
      var errors = {};
      var qty = { ok: true, milli: 1000 };
      if (qtyRaw !== '') {
        qty = M.parseQuantity(qtyRaw);
        if (!qty.ok) {
          errors.qty = 'Quantité invalide (ex. 2 ou 1,5)';
        }
      }
      var price = M.parseAmount(priceRaw);
      if (!price.ok) {
        errors.price = price.empty ? 'Prix à saisir' : 'Montant invalide (ex. 12,50)';
      }
      if (label === '') {
        errors.label = 'Libellé à saisir';
      }
      var row = { index: index, blank: false, label: label, errors: errors };
      if (Object.keys(errors).length > 0) {
        hasErrors = true;
      } else {
        row.qtyMilli = qty.milli;
        row.unitCents = price.cents;
        row.totalCents = M.lineTotalCents(qty.milli, price.cents);
        total += row.totalCents;
      }
      rows.push(row);
    });
    return { rows: rows, totalCents: total, hasErrors: hasErrors };
  }

  function sampleDoc(profile) {
    var d = newDoc('devis', profile);
    d.number = '0001';
    d.issueDate = '2026-01-15';
    d.recipient = 'Association Exemple\n12 rue des Lilas\n00000 Ville-Exemple';
    d.title = "Devis pour un atelier d'initiation de deux heures";
    d.serviceDate = '20 février 2026';
    d.description = "Pour un atelier de 10 participants.\nSoit 1 kit par personne, comprenant le matériel de base.";
    d.items = [
      { id: uid(), label: 'Animation de l’atelier (2 heures)', qty: '1', price: '300,00' },
      { id: uid(), label: 'Kit de matériel par participant', qty: '10', price: '4,50' },
    ];
    d.totalLabel = 'TOTAL (10 personnes) :';
    d.validityDate = '2026-02-15';
    return d;
  }

  function slug(text) {
    return (
      String(text || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || ''
    );
  }

  var api = {
    DOC_TYPES: DOC_TYPES,
    uid: uid,
    todayISO: todayISO,
    formatDateFR: formatDateFR,
    blankItem: blankItem,
    defaultProfile: defaultProfile,
    normalizeProfile: normalizeProfile,
    newDoc: newDoc,
    normalizeDoc: normalizeDoc,
    invoiceFromQuote: invoiceFromQuote,
    compute: compute,
    sampleDoc: sampleDoc,
    slug: slug,
    brandScale: brandScale,
    docFont: docFont,
    fileName: fileName,
    cleanName: cleanName,
    autoName: autoName,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.EDF = root.EDF || {};
    root.EDF.model = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

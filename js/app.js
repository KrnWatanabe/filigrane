/*
 * Application glue: state, form binding, persistence (localStorage, best
 * effort), toolbar actions, JSON drafts, preview and printing.
 * User text is only ever written with textContent / value (never innerHTML).
 */
(function () {
  'use strict';

  var EDF = window.EDF;
  var M = EDF.money;
  var Mo = EDF.model;
  var R = EDF.render;

  var STORAGE_KEY = 'edf.state.v1';
  var DRAFT_FORMAT = 'edf-draft';
  var MAX_IMPORT_BYTES = 2 * 1024 * 1024;

  var state = null;
  var computed = null;
  var renderTimer = null;
  var saveTimer = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function currentDoc() {
    return state.docs.filter(function (d) {
      return d.id === state.currentId;
    })[0];
  }

  /* ---------- persistence ---------- */

  function seed() {
    var profile = Mo.defaultProfile();
    var doc = Mo.sampleDoc(profile);
    return { profile: profile, docs: [doc], currentId: doc.id };
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        var docs = (Array.isArray(data.docs) ? data.docs : []).slice(0, 500).map(function (d) {
          var n = Mo.normalizeDoc(d);
          n.id = typeof d.id === 'string' && d.id ? d.id.slice(0, 40) : n.id;
          return n;
        });
        if (docs.length) {
          var current = docs.filter(function (d) {
            return d.id === data.currentId;
          })[0];
          return {
            profile: Mo.normalizeProfile(data.profile),
            docs: docs,
            currentId: (current || docs[0]).id,
          };
        }
      }
    } catch (e) {
      /* storage unavailable or corrupted: start from the fictional seed */
    }
    return seed();
  }

  function saveNow() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 1, profile: state.profile, docs: state.docs, currentId: state.currentId }),
      );
      setStatus('');
    } catch (e) {
      setStatus('Stockage du navigateur indisponible : exportez vos brouillons (JSON)');
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }

  function setStatus(text) {
    $('#status').textContent = text;
  }

  /* ---------- form <-> state ---------- */

  function readField(input) {
    return input.type === 'checkbox' ? input.checked : input.value;
  }

  function writeField(input, value) {
    if (input.type === 'checkbox') {
      input.checked = !!value;
    } else {
      input.value = value == null ? '' : value;
    }
  }

  function fillForm() {
    var doc = currentDoc();
    $$('[data-profile]').forEach(function (input) {
      writeField(input, state.profile[input.dataset.profile]);
    });
    $$('[data-doc]').forEach(function (input) {
      writeField(input, doc[input.dataset.doc]);
    });
    $('#docName').value = doc.name;
    syncTypeVisibility();
    buildItemsEditor();
    refreshHeader();
    refreshImageState();
  }

  function syncTypeVisibility() {
    var doc = currentDoc();
    $$('[data-only]').forEach(function (el) {
      el.hidden = el.dataset.only !== doc.type;
    });
    $('[data-action="to-invoice"]').hidden = doc.type !== 'devis';
  }

  function bindForm() {
    $$('[data-profile]').forEach(function (input) {
      input.addEventListener('input', function () {
        state.profile[input.dataset.profile] = readField(input);
        changed();
      });
    });
    $$('[data-doc]').forEach(function (input) {
      var evt = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
      input.addEventListener(evt, function () {
        var doc = currentDoc();
        doc[input.dataset.doc] = readField(input);
        if (input.dataset.doc === 'type') {
          syncTypeVisibility();
          if (doc.type === 'facture' && !doc.paymentTerms.trim()) {
            doc.paymentTerms = state.profile.defaultPaymentTerms;
            writeField($('[data-doc="paymentTerms"]'), doc.paymentTerms);
          }
        }
        changed();
      });
    });
  }

  /* ---------- brand images (header and footer logo) ---------- */

  var IMAGE_SPECS = {
    headerImage: { ratio: null, label: 'en-tête', state: '#headerState', file: '#headerFile' },
    logoImage: { ratio: 29.9 / 18.8, label: 'petit logo', state: '#logoState', file: '#logoFile' },
  };
  var MAX_IMAGE_BYTES = 400 * 1024;

  function refreshImageState() {
    Object.keys(IMAGE_SPECS).forEach(function (key) {
      $(IMAGE_SPECS[key].state).textContent = state.profile[key]
        ? 'Image importée (enregistrée dans ce navigateur et dans les brouillons JSON).'
        : 'Image par défaut anonyme : importez la vôtre.';
    });
  }

  function importImage(key, file) {
    var spec = IMAGE_SPECS[key];
    if (!file) {
      return;
    }
    if (!/\.(svg|png|jpe?g)$/i.test(file.name)) {
      window.alert('Format non pris en charge : utilisez un SVG, un PNG ou un JPEG.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert('Image trop lourde (400 Ko maximum). Un SVG vectorisé est bien plus léger.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var url = String(reader.result);
      if (/\.svg$/i.test(file.name)) {
        url = url.replace(/^data:[^;,]*/, 'data:image/svg+xml');
      }
      var probe = new Image();
      probe.onload = function () {
        var ratio = probe.naturalWidth / probe.naturalHeight;
        var off = spec.ratio ? Math.abs(ratio / spec.ratio - 1) : 0;
        if (spec.ratio && probe.naturalHeight && off > 0.25) {
          var msg =
            'Proportions différentes de celles attendues pour ' + spec.label + ' (' + spec.ratio.toFixed(1).replace('.', ',') +
            ' : 1). L\u2019image sera réduite pour tenir dans son cadre. Continuer ?';
          if (!window.confirm(msg)) {
            return;
          }
        }
        applyImage(key, url);
      };
      probe.onerror = function () {
        window.alert("Cette image n'a pas pu être lue.");
      };
      probe.src = url;
    };
    reader.readAsDataURL(file);
  }

  function applyImage(key, url) {
    state.profile[key] = url;
    var normalized = Mo.normalizeProfile(state.profile)[key];
    if (url && !normalized) {
      state.profile[key] = '';
      window.alert('Image refusée (format ou taille).');
    }
    refreshImageState();
    changed();
  }

  function bindImages() {
    Object.keys(IMAGE_SPECS).forEach(function (key) {
      var spec = IMAGE_SPECS[key];
      $(spec.file).addEventListener('change', function (e) {
        importImage(key, e.target.files[0]);
        e.target.value = '';
      });
    });
    $('#headerReset').addEventListener('click', function () {
      applyImage('headerImage', '');
    });
    $('#logoReset').addEventListener('click', function () {
      applyImage('logoImage', '');
    });
  }

  /* ---------- items editor ---------- */

  function buildItemsEditor() {
    var doc = currentDoc();
    var box = $('#items');
    box.replaceChildren();
    doc.items.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'item';
      row.dataset.index = String(index);

      var label = textInput('label', item.label, 'Libellé de la prestation');
      label.placeholder = 'Libellé';
      var qty = textInput('qty', item.qty, 'Quantité');
      qty.placeholder = 'Qté';
      qty.inputMode = 'decimal';
      var price = textInput('price', item.price, 'Prix unitaire en euros');
      price.placeholder = 'Prix unit. (€)';
      price.inputMode = 'decimal';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon danger';
      del.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg>';
      del.title = 'Supprimer cette ligne';
      del.setAttribute('aria-label', 'Supprimer la ligne ' + (index + 1));
      del.addEventListener('click', function () {
        doc.items.splice(index, 1);
        if (doc.items.length === 0) {
          doc.items.push(Mo.blankItem());
        }
        buildItemsEditor();
        changed();
      });

      [label, qty, price].forEach(function (input) {
        input.addEventListener('input', function () {
          item[input.dataset.key] = input.value;
          changed();
        });
      });

      var errors = document.createElement('div');
      errors.className = 'item__errors';
      row.append(
        itemCell('label', 'Libellé', label),
        itemCell('qty', 'Qté', qty),
        itemCell('price', 'Prix unit. (€)', price),
        del,
        errors,
      );
      box.append(row);
    });
  }

  /** Field + caption. The caption is only shown on phones (on desktop the header row labels the columns). */
  function itemCell(key, caption, input) {
    var cell = document.createElement('label');
    cell.className = 'item__cell';
    cell.dataset.cell = key;
    var text = document.createElement('span');
    text.className = 'item__cap';
    text.textContent = caption;
    cell.append(text, input);
    return cell;
  }

  function textInput(key, value, aria) {
    var input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.dataset.key = key;
    input.setAttribute('aria-label', aria);
    return input;
  }

  function showItemErrors() {
    $$('#items .item').forEach(function (row) {
      var info = computed.rows[Number(row.dataset.index)];
      var errors = info ? info.errors : {};
      $$('input', row).forEach(function (input) {
        input.classList.toggle('is-invalid', !!errors[input.dataset.key]);
      });
      var holder = $('.item__errors', row);
      holder.replaceChildren();
      $$('input', row).forEach(function (input) {
        input.removeAttribute('aria-describedby');
        input.setAttribute('aria-invalid', errors[input.dataset.key] ? 'true' : 'false');
      });
      Object.keys(errors).forEach(function (key) {
        var span = document.createElement('span');
        span.className = 'err';
        span.id = 'err-' + row.dataset.index + '-' + key;
        span.textContent = errors[key];
        holder.append(span);
        var field = $('[data-key="' + key + '"]', row);
        if (field) {
          field.setAttribute('aria-describedby', span.id);
        }
      });
    });
  }

  /* ---------- document list ---------- */

  /** Name shown and used for the PDF file: the typed name, else a suggestion. */
  function displayName(doc) {
    return doc.name || Mo.autoName(doc);
  }

  function refreshHeader() {
    var doc = currentDoc();
    $('#docName').placeholder = Mo.autoName(doc);
    $('#typeBadge').textContent = Mo.DOC_TYPES[doc.type].toUpperCase();
  }

  function buildDocsList() {
    var list = $('#docsList');
    var query = $('#docSearch').value.trim().toLowerCase();
    list.replaceChildren();
    [
      ['devis', 'Devis'],
      ['facture', 'Factures'],
    ].forEach(function (group) {
      var docs = state.docs
        .filter(function (d) {
          var haystack = [displayName(d), d.number, d.recipient, d.title].join(' ').toLowerCase();
          return d.type === group[0] && haystack.indexOf(query) !== -1;
        })
        .reverse();
      if (!docs.length) {
        return;
      }
      var title = document.createElement('div');
      title.className = 'menu__group';
      title.textContent = group[1];
      list.append(title);
      docs.forEach(function (d) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'menu__item menu__item--doc';
        item.setAttribute('aria-current', d.id === state.currentId ? 'true' : 'false');
        item.textContent = displayName(d);
        var meta = document.createElement('small');
        meta.textContent = (d.number.trim() ? 'n° ' + d.number.trim() : 'sans numéro') + ' · ' + Mo.formatDateFR(d.issueDate);
        item.append(meta);
        item.addEventListener('click', function () {
          closeMenus();
          selectDoc(d.id);
          setTab('edit');
        });
        list.append(item);
      });
    });
    if (!list.children.length) {
      var empty = document.createElement('div');
      empty.className = 'menu__empty';
      empty.textContent = 'Aucun document';
      list.append(empty);
    }
  }

  function selectDoc(id) {
    state.currentId = id;
    fillForm();
    renderNow();
    scheduleSave();
  }

  /** Document name field: letters, digits and "_" only, cleaned while typing. */
  function bindName() {
    var input = $('#docName');
    var before = '';
    input.addEventListener('focus', function () {
      before = currentDoc().name;
      input.select();
    });
    input.addEventListener('input', function () {
      var clean = Mo.fileName(input.value);
      if (clean !== input.value) {
        var caret = Math.max(0, (input.selectionStart || 0) - (input.value.length - clean.length));
        input.value = clean;
        input.setSelectionRange(caret, caret);
      }
      currentDoc().name = clean;
      changed();
    });
    input.addEventListener('blur', function () {
      var doc = currentDoc();
      doc.name = Mo.cleanName(doc.name);
      input.value = doc.name;
      changed();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        currentDoc().name = before;
        input.value = before;
        input.blur();
      }
    });
  }

  /* ---------- rendering ---------- */

  function changed() {
    refreshHeader();
    scheduleRender();
    scheduleSave();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderNow, 80);
  }

  function renderNow() {
    clearTimeout(renderTimer);
    var doc = currentDoc();
    document.documentElement.dataset.docFont = Mo.docFont(state.profile.font);
    detectFont();
    computed = Mo.compute(doc);
    var result = R.buildPages(doc, state.profile, computed, $('#measure'));
    $('#preview').replaceChildren.apply($('#preview'), result.pages);
    $('#totalDisplay').textContent = computed.hasErrors ? 'à corriger' : M.formatCents(computed.totalCents);
    $('#layoutWarn').hidden = !result.overflow;
    showItemErrors();
    fitPreview();
  }

  function isMobile() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function fitPreview() {
    var pane = $('#previewPane');
    if (!pane.clientWidth) {
      return; /* pane hidden (mobile "Saisie" tab): fitted when shown */
    }
    var mm = 96 / 25.4;
    var pad = isMobile() ? 16 : 32;
    var fitWidth = (pane.clientWidth - pad) / (210 * mm);
    var z = fitWidth;
    if (!isMobile() && ui.zoom === 'page') {
      z = Math.min(fitWidth, (pane.clientHeight - pad) / (296.6 * mm));
    } else if (!isMobile() && typeof ui.zoom === 'number') {
      z = ui.zoom;
    } else {
      z = Math.min(1, fitWidth) * (isMobile() ? mobileZoom : 1);
    }
    $('#preview').style.setProperty('--z', String(Math.max(0.2, z)));
  }

  /* ---------- fonts ---------- */

  /* Families tried for each choice (same order as the CSS stacks in document.css). */
  var FONT_FAMILIES = {
    sans: ['Open Sans'],
    serif: ['Lora', 'Georgia', 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', 'Liberation Serif'],
    round: ['Montserrat'],
  };
  var GOOGLE_FONTS = ['Open Sans', 'Lora', 'Montserrat'];

  function detectFont() {
    var info = $('#fontNote');
    var key = Mo.docFont(state.profile.font);
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      var sample = 'Atelier Kirigami 0123456789 wmil';
      var width = function (family) {
        ctx.font = '40px ' + family;
        return ctx.measureText(sample).width;
      };
      var base = width('monospace');
      var found = FONT_FAMILIES[key].filter(function (name) {
        var css = name === 'ui-rounded' ? name : '"' + name + '"';
        return width(css + ', monospace') !== base;
      })[0];
      if (found) {
        info.textContent =
          'Police utilisée : ' + found + (GOOGLE_FONTS.indexOf(found) !== -1 ? ' (Google Fonts).' : '.');
      } else {
        info.textContent = 'Police de repli utilisée (les Google Fonts ne sont pas chargées : connexion requise).';
      }
    } catch (e) {
      info.textContent = '';
    }
  }

  /* ---------- actions ---------- */

  function addDoc(doc) {
    state.docs.push(doc);
    state.currentId = doc.id;
    fillForm();
    renderNow();
    saveNow();
    setTab('edit');
  }

  /** Asks first: the invoice is an independent copy, the quote is never touched. */
  function requestInvoiceFromQuote() {
    var quote = currentDoc();
    var number = quote.number.trim();
    askConfirm(
      'Créer une facture à partir du devis' + (number ? ' n° ' + number : '') + ' ?',
      "Une copie indépendante est créée : le devis n'est pas modifié. Il restera à saisir le numéro de la facture.",
      'Créer la facture',
      createInvoiceFromQuote,
    );
  }

  function askConfirm(title, text, okLabel, onOk) {
    var dialog = $('#confirmDialog');
    if (typeof dialog.showModal !== 'function') {
      if (window.confirm(title + '\n\n' + text)) {
        onOk();
      }
      return;
    }
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okLabel;
    dialog.returnValue = '';
    dialog.addEventListener(
      'close',
      function () {
        if (dialog.returnValue === 'ok') {
          onOk();
        }
      },
      { once: true },
    );
    dialog.showModal();
  }

  function createInvoiceFromQuote() {
    var quote = currentDoc();
    var invoice = Mo.invoiceFromQuote(quote, state.profile);
    addDoc(invoice);
    $('#fNumber').focus();
    setStatus('Facture créée à partir du devis : saisissez son numéro, vérifiez le titre et les dates.');
  }

  function duplicateDoc() {
    var source = currentDoc();
    var copy = Mo.normalizeDoc(JSON.parse(JSON.stringify(source)));
    copy.name = source.name ? Mo.cleanName(source.name + '_copie') : '';
    copy.number = '';
    addDoc(copy);
  }

  function deleteDoc() {
    var doc = currentDoc();
    if (!window.confirm('Supprimer définitivement « ' + displayName(doc) + ' » de ce navigateur ?')) {
      return;
    }
    state.docs = state.docs.filter(function (d) {
      return d.id !== doc.id;
    });
    if (state.docs.length === 0) {
      state.docs.push(Mo.newDoc('devis', state.profile));
    }
    state.currentId = state.docs[0].id;
    fillForm();
    renderNow();
    saveNow();
  }

  function exportDraft() {
    var doc = currentDoc();
    var payload = {
      format: DRAFT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: state.profile,
      document: doc,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileBase(doc) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 1000);
  }

  function importDraftText(text) {
    var data = JSON.parse(text);
    var rawDoc = data && data.format === DRAFT_FORMAT ? data.document : data;
    if (!rawDoc || typeof rawDoc !== 'object' || !Array.isArray(rawDoc.items)) {
      throw new Error('Fichier non reconnu');
    }
    if (data.format === DRAFT_FORMAT && data.profile && typeof data.profile === 'object') {
      if (window.confirm('Ce brouillon contient un profil de l’émetteur. Remplacer le profil actuel ?')) {
        state.profile = Mo.normalizeProfile(data.profile);
      }
    }
    addDoc(Mo.normalizeDoc(rawDoc));
  }

  function importFile(file) {
    if (!file) {
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      window.alert('Fichier trop volumineux pour un brouillon.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        importDraftText(String(reader.result));
        setStatus('Brouillon ouvert.');
      } catch (e) {
        window.alert("Ce fichier n'est pas un brouillon valide.");
      }
    };
    reader.readAsText(file);
  }

  function fileBase(doc) {
    return displayName(doc);
  }

  function printDoc() {
    renderNow();
    var doc = currentDoc();
    if (computed.hasErrors) {
      window.alert('Corrigez les montants signalés en rouge avant d’imprimer.');
      return;
    }
    if (!doc.number.trim() && !window.confirm('Le numéro du document est vide. Générer le PDF quand même ?')) {
      return;
    }
    if (isMobile()) {
      setStatus('Dans la fenêtre qui s’ouvre, choisissez « Enregistrer au format PDF », puis partagez le fichier.');
    }
    var previous = document.title;
    document.title = fileBase(doc);
    window.addEventListener(
      'afterprint',
      function () {
        document.title = previous;
      },
      { once: true },
    );
    window.print();
  }

  /* ---------- boot ---------- */

  /* ---------- interface chrome: menus, drawer, splitter, tabs, zoom ---------- */

  var UI_KEY = 'edf.ui.v1';
  var DEFAULT_COL = 380;
  var MIN_COL = 200;
  var ZOOMS = [0.75, 1, 1.25];
  var ui = { col: DEFAULT_COL, zoom: 'fit' };
  var mobileZoom = 1; /* multiplier of the fit-to-width scale, phones only */

  function loadUi() {
    try {
      var data = JSON.parse(window.localStorage.getItem(UI_KEY) || '{}');
      if (typeof data.col === 'number') {
        ui.col = data.col;
      }
      if (data.zoom === 'fit' || data.zoom === 'page' || ZOOMS.indexOf(data.zoom) !== -1) {
        ui.zoom = data.zoom;
      }
    } catch (e) {
      /* defaults */
    }
  }

  function saveUi() {
    try {
      window.localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch (e) {
      /* best effort */
    }
  }

  function closeMenus() {
    $$('.menu__panel').forEach(function (panel) {
      panel.hidden = true;
    });
    $$('[data-menu]').forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function bindMenus() {
    $$('[data-menu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panel = btn.parentElement.querySelector('.menu__panel');
        var wasOpen = !panel.hidden;
        closeMenus();
        if (wasOpen) {
          return;
        }
        if (panel.querySelector('#docsList')) {
          $('#docSearch').value = '';
          buildDocsList();
        }
        panel.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        if (panel.querySelector('#docSearch')) {
          $('#docSearch').focus();
        }
        if (panel.getAttribute('role') === 'menu') {
          var first = $$('.menu__item', panel).filter(function (el) {
            return !el.hidden;
          })[0];
          if (first) {
            first.focus();
          }
        }
      });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.menu')) {
        closeMenus();
      }
    });
    $('#docSearch').addEventListener('input', buildDocsList);
    $$('.menu').forEach(function (menu) {
      var trigger = menu.querySelector('[data-menu]');
      var panel = menu.querySelector('.menu__panel');
      panel.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeMenus();
          trigger.focus();
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(e.key) === -1) {
          return;
        }
        var items = $$('.menu__item', panel).filter(function (el) {
          return !el.hidden;
        });
        if (!items.length) {
          return;
        }
        e.preventDefault();
        var at = items.indexOf(document.activeElement);
        var step = e.key === 'ArrowDown' ? 1 : -1;
        var next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + step + items.length) % items.length;
        items[next].focus();
      });
    });

    var actions = {
      'new-quote': function () {
        addDoc(Mo.newDoc('devis', state.profile));
      },
      'new-invoice': function () {
        addDoc(Mo.newDoc('facture', state.profile));
      },
      'to-invoice': requestInvoiceFromQuote,
      duplicate: duplicateDoc,
      import: function () {
        $('#fileImport').click();
      },
      export: exportDraft,
      delete: deleteDoc,
    };
    $$('[data-action]').forEach(function (item) {
      item.addEventListener('click', function () {
        closeMenus();
        actions[item.dataset.action]();
      });
    });
    $$('[data-mzoom]').forEach(function (item) {
      item.addEventListener('click', function () {
        closeMenus();
        mobileZoom = Number(item.dataset.mzoom);
        $('#mzoomLabel').textContent = mobileZoom === 1 ? 'Largeur' : Math.round(mobileZoom * 100) + ' %';
        $$('[data-mzoom]').forEach(function (other) {
          other.setAttribute('aria-current', String(other === item));
        });
        fitPreview();
      });
    });
    $$('[data-zoom]').forEach(function (item) {
      item.addEventListener('click', function () {
        closeMenus();
        var value = item.dataset.zoom;
        ui.zoom = value === 'fit' || value === 'page' ? value : Number(value);
        refreshZoomLabel();
        fitPreview();
        saveUi();
      });
    });
  }

  function refreshZoomLabel() {
    $('#zoomLabel').textContent =
      ui.zoom === 'fit' ? 'Largeur' : ui.zoom === 'page' ? 'Page entière' : Math.round(ui.zoom * 100) + ' %';
    $$('[data-zoom]').forEach(function (item) {
      item.setAttribute('aria-current', String(item.dataset.zoom === String(ui.zoom)));
    });
  }

  function openDrawer() {
    $('#drawer').hidden = false;
    $('#drawerBackdrop').hidden = false;
    $('.app').inert = true;
    $('#drawerClose').focus();
  }

  function closeDrawer() {
    if ($('#drawer').hidden) {
      return;
    }
    $('#drawer').hidden = true;
    $('#drawerBackdrop').hidden = true;
    $('.app').inert = false;
    $('#btnProfile').focus();
  }

  function setTab(tab) {
    $('.app').dataset.tab = tab;
    $$('[data-show]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.show === tab));
    });
    if (tab === 'preview') {
      fitPreview();
    }
  }

  function setColumn(px, persist) {
    if (isMobile()) {
      return; /* single column on small screens */
    }
    var max = Math.floor($('#workspace').clientWidth * 0.6);
    ui.col = Math.round(Math.max(MIN_COL, Math.min(max || px, px)));
    $('#workspace').style.setProperty('--col', ui.col + 'px');
    var bar = $('#splitter');
    bar.setAttribute('aria-valuenow', String(ui.col));
    bar.setAttribute('aria-valuemin', String(MIN_COL));
    bar.setAttribute('aria-valuemax', String(max));
    fitPreview();
    if (persist) {
      saveUi();
    }
  }

  function bindSplitter() {
    var bar = $('#splitter');
    var workspace = $('#workspace');
    bar.addEventListener('pointerdown', function (e) {
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('is-dragging');
    });
    bar.addEventListener('pointermove', function (e) {
      if (bar.hasPointerCapture(e.pointerId)) {
        setColumn(e.clientX - workspace.getBoundingClientRect().left, false);
      }
    });
    function stop(e) {
      if (bar.hasPointerCapture(e.pointerId)) {
        bar.releasePointerCapture(e.pointerId);
      }
      bar.classList.remove('is-dragging');
      saveUi();
    }
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
    bar.addEventListener('dblclick', function () {
      setColumn(DEFAULT_COL, true);
    });
    bar.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setColumn(ui.col + (e.key === 'ArrowRight' ? 16 : -16), true);
      }
    });
  }

  function bindChrome() {
    loadUi();
    bindMenus();
    bindName();
    bindSplitter();
    refreshZoomLabel();
    setColumn(ui.col, false);
    $('#btnProfile').addEventListener('click', openDrawer);
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenus();
        closeDrawer();
      }
    });
    $$('[data-show]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTab(btn.dataset.show);
      });
    });
    $('#tabPdf').addEventListener('click', printDoc);
    window.addEventListener('resize', function () {
      setColumn(ui.col, false);
    });
  }

  function init() {
    state = load();
    bindForm();
    bindImages();
    fillForm();
    bindChrome();
    $('#fileImport').addEventListener('change', function (e) {
      importFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#btnPrint').addEventListener('click', printDoc);
    $('#btnAddItem').addEventListener('click', function () {
      currentDoc().items.push(Mo.blankItem());
      buildItemsEditor();
      changed();
      var inputs = $$('#items .item:last-child input');
      if (inputs[0]) {
        inputs[0].focus();
      }
    });
    window.addEventListener('resize', fitPreview);
    renderNow();
    saveNow();
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', scheduleRender);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        renderNow();
      });
    }
  }

  /* Small surface used by tests and by drafts loaded programmatically. */
  EDF.app = {
    getState: function () {
      return state;
    },
    importDraftText: importDraftText,
    renderNow: renderNow,
    createInvoiceFromQuote: createInvoiceFromQuote,
    setProfile: function (profile) {
      state.profile = Mo.normalizeProfile(profile);
      fillForm();
      renderNow();
    },
  };

  init();
})();

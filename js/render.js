/*
 * Document rendering and pagination.
 *
 * The document is described as a list of blocks. Each block is measured in a
 * hidden container, then blocks are poured into fixed A4 pages so that nothing
 * ever crosses the footer zone. The preview and the print output use the very
 * same page elements.
 */
(function (root) {
  'use strict';

  var EDF = root.EDF;
  var M = EDF.money;
  var Mo = EDF.model;

  var MM_PX = 96 / 25.4;
  var L = {
    pageH: 296.6, // slightly under 297 so browsers never add a blank page
    bodyBottom: 262, // footer logo starts at 268.9 mm
    contTop: 22, // top of the flow on pages 2+
    headMin: 57.9,
    headGap: 10.0,
    metaTop: 10.6,
    lineH: 8.467, // 12 pt x 2
    footLines: 2,
    footLineH: 4.59,
    logoTop: 268.86,
    footTextOffset: 8.14,
  };

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) {
      e.className = cls;
    }
    if (text != null) {
      e.textContent = text;
    }
    return e;
  }

  function lines(text) {
    return String(text || '')
      .split('\n')
      .map(function (l) {
        return l.replace(/\s+$/, '');
      });
  }

  function nonEmptyLines(text) {
    return lines(text).filter(function (l) {
      return l.trim() !== '';
    });
  }

  function docLabel(doc) {
    var base = Mo.DOC_TYPES[doc.type];
    return doc.number.trim() ? base + ' #' + doc.number.trim() : base;
  }

  function metaLines(doc, profile) {
    var out = [docLabel(doc)];
    var date = Mo.formatDateFR(doc.issueDate);
    if (date) {
      out.push(date);
    }
    if (doc.type === 'facture') {
      if (doc.refQuote.trim()) {
        out.push('Devis : ' + doc.refQuote.trim());
      }
      if (doc.refPO.trim()) {
        out.push('Bon de commande : ' + doc.refPO.trim());
      }
      if (doc.refCommitment.trim()) {
        out.push('Engagement : ' + doc.refCommitment.trim());
      }
    }
    if (profile.showIdentity) {
      if (profile.legalName.trim()) {
        out.push(profile.legalName.trim() + (profile.isEI ? ' EI' : ''));
      }
      Array.prototype.push.apply(out, nonEmptyLines(profile.address));
    }
    Array.prototype.push.apply(out, nonEmptyLines(profile.siret));
    Array.prototype.push.apply(out, nonEmptyLines(profile.otherIds));
    var recipient = nonEmptyLines(doc.recipient);
    if (recipient.length) {
      out.push(null);
      Array.prototype.push.apply(out, recipient);
    }
    return out;
  }

  /* ---------- block builders ---------- */

  function headSpec(doc, profile) {
    var spec = { gap: 0, H: null };
    spec.build = function () {
      var head = h('div', 'head');
      var brand = h('div', 'head__brand');
      brand.style.setProperty('--brand-scale', String(Mo.brandScale(profile.headerScale) / 100));
      var img = h('img', 'head__logo');
      img.src = profile.headerImage || 'assets/header.svg';
      img.alt = '';
      brand.append(img);
      if (profile.baseline.trim()) {
        brand.append(h('div', 'head__baseline', profile.baseline.trim()));
      }
      head.append(brand);
      var meta = h('div', 'head__meta');
      metaLines(doc, profile).forEach(function (line) {
        var row = h('div', line === null ? 'head__blank' : 'head__line', line === null ? '' : line);
        meta.append(row);
      });
      head.append(meta);
      if (spec.H != null) {
        head.style.height = spec.H + 'mm';
      }
      return head;
    };
    spec.fit = function (head) {
      var meta = head.querySelector('.head__meta');
      var brand = head.querySelector('.head__brand');
      var bottom = Math.max(meta.offsetTop + meta.offsetHeight, brand.offsetTop + brand.offsetHeight) / MM_PX;
      spec.H = Math.max(L.headMin, bottom + L.headGap);
      head.style.height = spec.H + 'mm';
    };
    return spec;
  }

  function titleSpec(doc) {
    return {
      gap: 0,
      build: function () {
        var box = h('div', 'title');
        if (doc.title.trim()) {
          box.append(h('div', 'title__main', doc.title.trim()));
        }
        if (doc.serviceDate.trim()) {
          box.append(h('div', 'title__sub', doc.serviceDate.trim()));
        }
        return box;
      },
    };
  }

  function paragraphSpec(text, gap) {
    return {
      gap: gap,
      text: text,
      splittable: true,
      build: function (override) {
        var t = override != null ? override : text;
        return h('p', 'desc', t === '' ? ' ' : t);
      },
    };
  }

  function rowEl(row) {
    var el = h('div', 'row');
    var label = row.label;
    if (row.totalCents != null && row.qtyMilli !== 1000) {
      label += ' (' + M.formatQuantity(row.qtyMilli) + ' × ' + M.formatCents(row.unitCents) + ')';
    }
    el.append(h('span', 'row__label', label));
    el.append(h('span', 'row__amount', row.totalCents != null ? M.formatCents(row.totalCents) : '?'));
    return el;
  }

  function rowSpec(row, gap) {
    return {
      gap: gap,
      build: function () {
        return rowEl(row);
      },
    };
  }

  function tailSpec(row, totalLabel, totalText, gap) {
    return {
      gap: gap,
      build: function () {
        var box = h('div', 'tail');
        if (row) {
          box.append(rowEl(row));
        }
        var rule = h('div', 'rule');
        if (!row) {
          rule.style.marginTop = '0';
        }
        box.append(rule);
        var total = h('div', 'total');
        total.append(h('span', 'total__label', totalLabel));
        total.append(h('span', 'total__amount', totalText));
        box.append(total);
        return box;
      },
    };
  }

  function noteSpec(text, gap, withSignature) {
    return {
      gap: gap,
      build: function () {
        var box = h('div', 'note');
        box.append(h('div', 'note__text', text));
        if (withSignature) {
          box.append(h('div', 'note__sign'));
        }
        return box;
      },
    };
  }

  function buildSpecs(doc, profile, computed) {
    var specs = [headSpec(doc, profile)];
    if (doc.title.trim() || doc.serviceDate.trim()) {
      specs.push(titleSpec(doc));
    }
    var first = true;
    var descLines = lines(doc.description);
    while (descLines.length && descLines[descLines.length - 1].trim() === '') {
      descLines.pop();
    }
    descLines.forEach(function (line) {
      specs.push(paragraphSpec(line, first ? 15.4 : 0));
      first = false;
    });
    var rows = computed.rows.filter(function (r) {
      return !r.blank;
    });
    var totalText = computed.hasErrors ? '?' : M.formatCents(computed.totalCents);
    var gapItems = first ? 15.4 : 11.3;
    rows.slice(0, -1).forEach(function (row, i) {
      specs.push(rowSpec(row, i === 0 ? gapItems : 0));
    });
    var lastRow = rows.length ? rows[rows.length - 1] : null;
    specs.push(tailSpec(lastRow, doc.totalLabel, totalText, rows.length > 1 ? 0 : gapItems));

    var notes = [];
    if (doc.showVat && profile.vatMention.trim()) {
      notes.push({ text: profile.vatMention.trim() });
    }
    if (doc.type === 'devis') {
      if (doc.validityDate) {
        notes.push({ text: "Devis valable jusqu'au " + Mo.formatDateFR(doc.validityDate) + '.' });
      }
      if (doc.acceptance) {
        notes.push({ text: doc.acceptanceText.trim() || 'Bon pour accord :', sign: true });
      }
    } else {
      if (doc.dueDate) {
        notes.push({ text: 'Échéance de paiement : ' + Mo.formatDateFR(doc.dueDate) });
      }
      if (doc.paymentTerms.trim()) {
        notes.push({ text: doc.paymentTerms.trim() });
      }
    }
    notes.forEach(function (n, i) {
      specs.push(noteSpec(n.text, i === 0 ? 13 : 5, !!n.sign));
    });
    return specs;
  }

  /* ---------- measuring and pagination ---------- */

  function measureSpec(spec, container, text) {
    var wrap = h('div', 'blk');
    var content = spec.build(text);
    wrap.append(content);
    container.append(wrap);
    if (spec.fit && spec.H == null) {
      spec.fit(content);
    }
    var height = wrap.getBoundingClientRect().height / MM_PX;
    wrap.remove();
    return height;
  }

  function splitText(spec, text, maxLines, container) {
    var tokens = text.split(/(\s+)/);
    var lo = 1;
    var hi = tokens.length;
    var best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var candidate = tokens.slice(0, mid).join('').replace(/\s+$/, '');
      if (measureSpec(spec, container, candidate) <= maxLines * L.lineH + 0.2) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (!best) {
      return null;
    }
    var first = tokens.slice(0, best).join('').replace(/\s+$/, '');
    var rest = tokens.slice(best).join('').replace(/^\s+/, '');
    return first && rest ? [first, rest] : null;
  }

  function paginate(specs, container, bodyBottom) {
    var pages = [[]];
    var used = 0;
    var overflow = false;
    var queue = specs.map(function (spec) {
      return { spec: spec, text: spec.text, gap: spec.gap, height: null };
    });
    var guard = 0;
    while (queue.length && guard++ < 5000) {
      var item = queue.shift();
      var page = pages[pages.length - 1];
      var first = page.length === 0;
      var gap = first ? 0 : item.gap;
      if (item.height == null) {
        item.height = measureSpec(item.spec, container, item.text);
      }
      if (used + gap + item.height <= bodyBottom + 0.05) {
        page.push({ spec: item.spec, text: item.text, gap: gap });
        used += gap + item.height;
        continue;
      }
      if (item.spec.splittable) {
        var total = Math.round(item.height / L.lineH);
        var room = Math.floor((bodyBottom - used - gap + 0.05) / L.lineH);
        var take = Math.min(room, total - 2);
        if (take >= 2 && total >= 4) {
          var parts = splitText(item.spec, item.text, take, container);
          if (parts) {
            page.push({ spec: item.spec, text: parts[0], gap: gap });
            queue.unshift({ spec: item.spec, text: parts[1], gap: 0, height: null });
            pages.push([]);
            used = L.contTop;
            continue;
          }
        }
      }
      if (first) {
        overflow = true;
        page.push({ spec: item.spec, text: item.text, gap: gap });
        used += gap + item.height;
        continue;
      }
      pages.push([]);
      used = L.contTop;
      queue.unshift(item);
    }
    return { pages: pages, overflow: overflow };
  }

  /* ---------- page assembly ---------- */

  function footBuild(profile, shift) {
    var foot = h('div', 'foot');
    foot.style.top = L.logoTop - shift + 'mm';
    var logo = h('img', 'foot__logo');
    logo.src = profile.logoImage || 'assets/logo.svg';
    logo.alt = '';
    foot.append(logo);
    var text = profile.footer.trim();
    if (text) {
      var t = h('div', 'foot__text', text);
      foot.append(t);
    }
    return foot;
  }

  function footShift(profile, container) {
    var text = profile.footer.trim();
    if (!text) {
      return 0;
    }
    var probe = h('div', 'foot__text', text);
    container.append(probe);
    var lineCount = Math.round(probe.getBoundingClientRect().height / MM_PX / L.footLineH);
    probe.remove();
    return Math.max(0, lineCount - L.footLines) * L.footLineH;
  }

  function buildPages(doc, profile, computed, container) {
    var shift = footShift(profile, container);
    var specs = buildSpecs(doc, profile, computed);
    var result = paginate(specs, container, L.bodyBottom - shift);
    var count = result.pages.length;
    var pages = result.pages.map(function (blocks, idx) {
      var page = h('div', 'page doc');
      var flow = h('div', 'flow');
      flow.style.top = (idx === 0 ? 0 : L.contTop) + 'mm';
      blocks.forEach(function (b) {
        var wrap = h('div', 'blk');
        if (b.gap) {
          wrap.style.paddingTop = b.gap + 'mm';
        }
        wrap.append(b.spec.build(b.text));
        flow.append(wrap);
      });
      page.append(flow);
      if (idx > 0) {
        page.append(h('div', 'cont', docLabel(doc) + ' - page ' + (idx + 1) + '/' + count));
      }
      page.append(footBuild(profile, shift));
      return page;
    });
    return { pages: pages, overflow: result.overflow };
  }

  EDF.render = { buildPages: buildPages, docLabel: docLabel, layout: L };
})(window);

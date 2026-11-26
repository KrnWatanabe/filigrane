/*
 * Money helpers. All amounts are handled as integer cents, quantities as
 * integer thousandths, so no floating point drift can reach a total.
 */
(function (root) {
  'use strict';

  var NBSP = ' ';

  /** @returns {{ok:boolean, empty?:boolean, cents?:number}} */
  function parseAmount(input) {
    var s = String(input == null ? '' : input).replace(/[\s  €]/g, '');
    if (s === '') {
      return { ok: false, empty: true };
    }
    if (s.indexOf(',') !== -1) {
      s = s.replace(/\./g, '');
      if (s.split(',').length > 2) {
        return { ok: false };
      }
      s = s.replace(',', '.');
    }
    var m = /^([-+]?)(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) {
      return { ok: false };
    }
    var cents = parseInt(m[2], 10) * 100 + parseInt(((m[3] || '') + '00').slice(0, 2), 10);
    return { ok: true, cents: m[1] === '-' ? -cents : cents };
  }

  /** @returns {{ok:boolean, empty?:boolean, milli?:number}} */
  function parseQuantity(input) {
    var s = String(input == null ? '' : input).replace(/[\s  ]/g, '');
    if (s === '') {
      return { ok: false, empty: true };
    }
    var m = /^(\d{1,6})(?:[.,](\d{1,3}))?$/.exec(s);
    if (!m) {
      return { ok: false };
    }
    return { ok: true, milli: parseInt(m[1], 10) * 1000 + parseInt(((m[2] || '') + '000').slice(0, 3), 10) };
  }

  function lineTotalCents(milli, cents) {
    return Math.round((milli * cents) / 1000);
  }

  function formatCents(cents) {
    var abs = Math.abs(cents);
    var whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    var frac = String(abs % 100);
    if (frac.length < 2) {
      frac = '0' + frac;
    }
    return (cents < 0 ? '-' : '') + whole + ',' + frac + '€';
  }

  function formatQuantity(milli) {
    if (milli % 1000 === 0) {
      return String(milli / 1000);
    }
    return (milli / 1000).toFixed(3).replace(/0+$/, '').replace('.', ',');
  }

  var api = {
    parseAmount: parseAmount,
    parseQuantity: parseQuantity,
    lineTotalCents: lineTotalCents,
    formatCents: formatCents,
    formatQuantity: formatQuantity,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.EDF = root.EDF || {};
    root.EDF.money = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

(function () {
  const param  = new URLSearchParams(location.search).get('lang');
  const stored = localStorage.getItem('vf_lang');
  const lang   = param || stored || 'en';

  if (param && param !== stored) localStorage.setItem('vf_lang', param);

  // Synchronous load so window.t() is ready before any other script runs
  let dict = {};
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'i18n/' + lang + '.json', false);
  try {
    xhr.send();
    if (xhr.status === 200) dict = JSON.parse(xhr.responseText);
  } catch (e) {
    console.warn('[i18n] could not load', lang, e);
  }

  window.t = function (key) {
    const val = key.split('.').reduce(function (o, k) { return o && o[k]; }, dict);
    return val !== undefined ? val : key;
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const v = window.t(el.getAttribute('data-i18n'));
      if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const v = window.t(el.getAttribute('data-i18n-title'));
      if (v) el.title = v;
    });

    // Sync page title
    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) {
      const v = window.t(titleEl.getAttribute('data-i18n'));
      if (v) document.title = v;
    }

  });
}());

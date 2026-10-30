// jsPsych and its plugins come from the CDN as classic scripts (index.html)
// and register globals; this module turns them into ordinary imports.
// If the CDN failed or a file did not match its integrity hash, they are
// undefined and main.js shows an error instead of starting.

export const initJsPsych = globalThis.initJsPsych;
export const HtmlButtonResponse = globalThis.jsPsychHtmlButtonResponse;

export const libsLoaded = Boolean(initJsPsych && HtmlButtonResponse);

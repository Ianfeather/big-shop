import { parse } from 'node-html-parser';

// Keep the LLM's input bounded - a full recipe page can be hundreds of KB, almost all of it
// script/style/nav noise that costs tokens without adding signal.
const MAX_HTML_LENGTH = 60000;
const NOISE_SELECTOR = 'script, style, svg, noscript, iframe, link, meta, head';

export function htmlToInput(html) {
  const document = parse(html);
  document.querySelectorAll(NOISE_SELECTOR).forEach((el) => el.remove());
  return { type: 'text', text: document.toString().slice(0, MAX_HTML_LENGTH) };
}

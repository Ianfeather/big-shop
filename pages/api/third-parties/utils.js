import {decode} from 'html-entities';

const clean = (str) => {
  // We decode because some sites encode all non-az characters as hex (including spaces)
  return decode(
    // Sometimes we bring in unnecessary line breaks and tabs because we're parsing raw html
    str.replace(/[\n|\r\t]/g, ' ')
    // Remove multiple spaces
    .replace(/ +(?= )/g,'')
    // Some blogs inlcude pointless faux checkboxes
    .replace(/&#x25a2;/g, '')
    // Replace nice but pointless words
    .replace(/\sof\s /, ' ')
    // Replace unit conversions in parentheses (somewhat risky)
    .replace(/\(([^\)]+)\)/g, '')
    .trim()
  );
}

export {
  clean
};

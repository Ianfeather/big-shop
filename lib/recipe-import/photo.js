export function imageToInput(base64) {
  return { type: 'image', source: 'page', base64 };
}

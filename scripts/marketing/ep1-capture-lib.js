'use strict';

function customizeConstellation(source, {word, accent}) {
  const withBrand = source.replaceAll('NEBULA', word);
  const withWord = withBrand.replace(/word:\s*'[^']+'/, `word: '${word}'`);
  return withWord.replace(/--accent:\s*#[0-9a-fA-F]{6}/, `--accent:${accent}`);
}

function validateSegments(segments) {
  const total = segments.reduce((sum, segment) => sum + segment.duration, 0);
  if (total !== 270) {
    throw new Error(`Ep1 evidence capture must total 270 seconds; got ${total}`);
  }
  return total;
}

function quoteConcatPath(file) {
  return file.replace(/'/g, "'\\''");
}

function buildConcatManifest(segments) {
  validateSegments(segments);
  return segments.map(({file}) => `file '${quoteConcatPath(file)}'\n`).join('');
}

module.exports = {
  buildConcatManifest,
  customizeConstellation,
  validateSegments,
};

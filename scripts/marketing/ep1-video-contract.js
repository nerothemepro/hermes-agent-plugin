'use strict';

const fps = 30;

const heroes = [
  {id: 'aurora', label: 'Ember aurora', path: '/packs/hero1/hero-aurora.html'},
  {id: 'orbit', label: 'Floating 3D product', path: '/packs/hero1/hero-orbit.html'},
  {id: 'liquid', label: 'Liquid metal', path: '/packs/hero1/hero-liquid.html'},
  {id: 'constellation', label: 'Particle swarm: SDTK', path: '/packs/hero1/hero-constellation.html'},
  {id: 'scrollfilm', label: 'Scroll-driven film', path: '/packs/hero1/hero-scrollfilm.html'},
  {id: 'kinetic', label: 'Kinetic typography', path: '/packs/hero1/hero-kinetic.html'},
];

const longForm = {
  size: {width: 1920, height: 1080},
  durationSeconds: 300,
  showcaseCutSeconds: 10 / 3,
  shots: [
    {id: 'cold-open', start: 0, end: 3},
    {id: 'bumper', start: 3, end: 5},
    {id: 'showcase', start: 5, end: 45},
    {id: 'get-the-pack', start: 45, end: 135},
    {id: 'reskin', start: 135, end: 225},
    {id: 'honest-proof', start: 225, end: 270},
    {id: 'cta', start: 270, end: 300},
  ],
};

const downloadChapter = {
  durationSeconds: 90,
  stages: [
    {id: 'landing', start: 0, end: 18},
    {id: 'download', start: 18, end: 30},
    {id: 'unzip', start: 30, end: 55},
    {id: 'offline', start: 55, end: 90},
  ],
};

const shortForm = {
  size: {width: 1440, height: 2560},
  durationSeconds: 55,
  actionSeconds: 52,
  ctaSeconds: 3,
  captureBand: {top: 620, height: 810},
  minCaptionFontSize: 72,
  minCtaFontSize: 72,
};

module.exports = {
  fps,
  motion: {maxStaticSeconds: 5},
  heroes,
  downloadChapter,
  palettes: ['ember', 'aurora', 'nebula', 'rose', 'jade', 'azure'],
  themes: ['lantern-night', 'daybreak'],
  longForm,
  shortForm,
  ctaUrl: 'https://sdtk.dev/heroes?utm_source=youtube&utm_medium=video&utm_campaign=tutorials-s1',
  music: {
    license: 'CC0-1.0',
    source: 'Operator-generated original SDTK ambient bed rendered deterministically with FFmpeg.',
  },
};

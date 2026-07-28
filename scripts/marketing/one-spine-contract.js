'use strict';

const fps = 30;

const shots = [
  {id: 'cold-open', startSeconds: 0, endSeconds: 4},
  {id: 'pain', startSeconds: 4, endSeconds: 9},
  {id: 'villain', startSeconds: 9, endSeconds: 11},
  {id: 'flip', startSeconds: 11, endSeconds: 11 + 1 / fps, durationFrames: 1, transition: 'hard-cut'},
  {id: 'design', startSeconds: 11, endSeconds: 24},
  {id: 'wiki', startSeconds: 24, endSeconds: 36},
  {id: 'kanban', startSeconds: 36, endSeconds: 48},
  {id: 'gate', startSeconds: 48, endSeconds: 58, maxStaticSeconds: 4},
  {id: 'proof', startSeconds: 58, endSeconds: 68},
  {id: 'close', startSeconds: 68, endSeconds: 75},
];

module.exports = {
  fps,
  longForm: {size: {width: 1920, height: 1080}, durationSeconds: 75},
  vertical: {size: {width: 1080, height: 1920}, durationSeconds: 45},
  camera: {
    zoomPerFrame: 0.0018,
    minimumPanPixelsOn3840Canvas: 380,
    captureScaleRange: [1.1, 1.25],
  },
  shots,
  truth: {
    kanbanOwner: 'sdtk-wiki',
    kanbanDescription: 'sdtk-wiki kanban renders the viewer dash panel from SHARED_PLANNING.md and QUALITY_CHECKLIST.md.',
  },
};

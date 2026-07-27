import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {IntroBrand} from './IntroBrand';

const FPS = 30;
const toFrame = (seconds) => seconds * FPS;
const CTA = 'sdtk.dev/heroes?utm_source=youtube&utm_medium=video&utm_campaign=tutorials-s1';
const HEROES = [
  'EMBER AURORA',
  'FLOATING 3D PRODUCT',
  'LIQUID METAL',
  'PARTICLE SWARM · SDTK',
  'SCROLL-DRIVEN FILM',
  'KINETIC TYPOGRAPHY',
];

const fade = (frame, duration) => interpolate(
  frame,
  [0, 10, duration - 10, duration],
  [0, 1, 1, 0],
  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
);

const Pill = ({children}) => (
  <div style={{
    background: 'rgba(11,17,26,.9)',
    border: '2px solid rgba(255,106,43,.72)',
    color: '#fff7f1',
    padding: '14px 22px',
    fontSize: 28,
    fontWeight: 800,
    borderRadius: 6,
    boxShadow: '0 12px 38px rgba(0,0,0,.35)',
  }}>{children}</div>
);

const Caption = ({children, maxWidth = 1500, fontSize = 34}) => (
  <div style={{
    alignSelf: 'center',
    maxWidth,
    background: 'rgba(4,9,15,.9)',
    borderTop: '3px solid #ff6a2b',
    color: '#fff7f1',
    padding: '18px 28px',
    fontSize,
    fontWeight: 700,
    lineHeight: 1.22,
    textAlign: 'center',
    boxShadow: '0 18px 60px rgba(0,0,0,.45)',
  }}>{children}</div>
);

const Overlay = ({children, justifyContent = 'flex-end', padding = 44}) => (
  <AbsoluteFill style={{pointerEvents: 'none', justifyContent, padding}}>{children}</AbsoluteFill>
);

const MotionRail = () => {
  const frame = useCurrentFrame();
  const x = (frame * 16) % 2320 - 360;
  return (
    <AbsoluteFill style={{
      zIndex: 20,
      background: 'radial-gradient(circle 440px at ' + x + 'px 12%, rgba(255,106,43,.2), rgba(255,106,43,.06) 42%, rgba(255,106,43,0) 72%)',
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute',
        top: 14,
        left: x,
        width: 360,
        height: 10,
        background: 'linear-gradient(90deg, rgba(255,106,43,0), #ff6a2b 35%, #ffb07a 70%, rgba(255,176,122,0))',
        boxShadow: '0 0 22px rgba(255,106,43,.72)',
      }} />
    </AbsoluteFill>
  );
};

const SectionCard = ({eyebrow, title, detail}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#0b111a', color: '#fff7f1', justifyContent: 'center', padding: 110, opacity: fade(frame, 60)}}>
      <div style={{height: 8, width: 170, background: '#ff6a2b', marginBottom: 30}} />
      <div style={{fontSize: 25, color: '#ffb07a', fontWeight: 800, letterSpacing: 3}}>{eyebrow}</div>
      <div style={{fontSize: 84, fontWeight: 850, lineHeight: 1.02, maxWidth: 1480, marginTop: 18}}>{title}</div>
      <div style={{fontSize: 32, color: '#b9c4d1', marginTop: 26, maxWidth: 1360}}>{detail}</div>
    </AbsoluteFill>
  );
};

const CaptureLayer = ({capture}) => {
  const frame = useCurrentFrame();
  const inShowcase = frame >= toFrame(5) && frame < toFrame(45);
  const closeCut = inShowcase && Math.floor((frame - toFrame(5)) / 100) % 2 === 1;
  const driftScale = 1.012 + Math.sin((frame / FPS) * Math.PI / 5) * 0.006;
  const scale = closeCut ? 1.06 : driftScale;
  return (
    <OffthreadVideo
      src={staticFile(capture)}
      style={{
        height: '100%',
        width: '100%',
        objectFit: 'cover',
        transform: 'scale(' + scale + ')',
        transformOrigin: closeCut ? '54% 48%' : '50% 50%',
      }}
    />
  );
};

const ShowcaseOverlay = () => {
  const frame = useCurrentFrame();
  const index = Math.min(HEROES.length - 1, Math.floor(frame / 200));
  return (
    <Overlay justifyContent="space-between">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
        <Pill>SDTK-DESIGN · FREE HERO PACK</Pill>
        <Pill>{String(index + 1).padStart(2, '0')} / 06</Pill>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
        <div style={{fontSize: 66, color: '#fff7f1', fontWeight: 900, textShadow: '0 4px 24px #000'}}>{HEROES[index]}</div>
        <Caption>Six real WebGL heroes. Each one runs from a self-contained HTML file.</Caption>
      </div>
    </Overlay>
  );
};

const DownloadOverlay = () => {
  const frame = useCurrentFrame();
  const seconds = frame / FPS;
  const railX = ((frame % toFrame(5)) / toFrame(5)) * 1680;
  let caption = 'Open sdtk.dev/heroes — the whole pack is free.';
  if (seconds >= 18 && seconds < 30) caption = 'Click Download — the real ZIP appears and is verified locally.';
  if (seconds >= 30 && seconds < 55) caption = 'Run unzip, then list the extracted HTML, docs, and bundled JavaScript.';
  if (seconds >= 55) caption = 'Open the extracted hero file. It runs offline — no CDN request.';
  return (
    <Overlay justifyContent="space-between">
      <div style={{position: 'absolute', top: 0, left: railX, width: 240, height: 6, background: '#ff6a2b', boxShadow: '0 0 20px #ffb07a'}} />
      <Pill>CHAPTER 01 · GET THE PACK</Pill>
      <Caption>{caption}</Caption>
    </Overlay>
  );
};

const ReskinOverlay = () => {
  const seconds = useCurrentFrame() / FPS;
  let caption = 'Find the design token: --accent.';
  if (seconds >= 12 && seconds < 24) caption = 'Change one CSS variable — reload the same local file.';
  if (seconds >= 24 && seconds < 60) caption = 'The whole scene reskins: glow, controls, type, and WebGL particles.';
  if (seconds >= 60) caption = 'Six palettes × two themes — still the same HTML.';
  return <Overlay justifyContent="space-between"><Pill>CHAPTER 02 · ONE-VARIABLE RESKIN</Pill><Caption>{caption}</Caption></Overlay>;
};

const HonestOverlay = () => {
  const seconds = useCurrentFrame() / FPS;
  const caption = seconds < 15
    ? 'Toggle prefers-reduced-motion: reduce.'
    : 'Motion stops. The canvas hides. The designed poster remains.';
  return (
    <Overlay justifyContent="space-between">
      <Pill>CHAPTER 03 · THE HONEST GATE</Pill>
      <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
        <Caption>{caption}</Caption>
        <Caption>Every line AI-generated. None passed first try — 12 human review passes.</Caption>
      </div>
    </Overlay>
  );
};

const Cta = () => {
  const frame = useCurrentFrame();
  const glowX = interpolate(frame, [0, toFrame(30)], [-500, 2200]);
  return (
    <AbsoluteFill style={{background: '#0b111a', color: '#fff7f1', alignItems: 'center', justifyContent: 'center', opacity: fade(frame, toFrame(30)), fontFamily: 'Arial, Helvetica, sans-serif', overflow: 'hidden'}}>
      <div style={{position: 'absolute', width: 540, height: 540, left: glowX, top: 250, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,106,43,.28), rgba(255,106,43,0) 70%)'}} />
      <div style={{fontSize: 37, color: '#ffb07a', fontWeight: 800, letterSpacing: 2}}>TAKE THE WHOLE PACK</div>
      <div style={{fontSize: 104, fontWeight: 900, marginTop: 18}}>FREE · NO EMAIL WALL</div>
      <div style={{fontSize: 34, color: '#b9c4d1', marginTop: 28}}>Six WebGL heroes · six palettes · two themes</div>
      <div style={{fontSize: 29, color: '#ffb07a', marginTop: 52}}>{CTA}</div>
      <div style={{position: 'absolute', bottom: 64, fontSize: 22, color: '#718095'}}>Real gates for AI-written code.</div>
    </AbsoluteFill>
  );
};

const ShortCta = () => {
  const frame = useCurrentFrame();
  const glowY = interpolate(frame, [0, toFrame(3)], [-400, 2300]);
  return (
    <AbsoluteFill style={{background: '#0b111a', color: '#fff7f1', alignItems: 'center', justifyContent: 'center', padding: 86, overflow: 'hidden'}}>
      <div style={{position: 'absolute', width: 900, height: 900, left: 270, top: glowY, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,106,43,.3), rgba(255,106,43,0) 70%)'}} />
      <div style={{fontSize: 122, fontWeight: 900, textAlign: 'center', lineHeight: 1.04}}>6 FREE<br />WEBGL HEROES</div>
      <div style={{fontSize: 76, color: '#ffb07a', marginTop: 58, fontWeight: 800}}>No email wall.</div>
      <div style={{fontSize: 76, color: '#fff7f1', marginTop: 76, textAlign: 'center', fontWeight: 850}}>sdtk.dev/heroes</div>
    </AbsoluteFill>
  );
};

export const TutorialEp = ({capture}) => (
  <AbsoluteFill style={{background: '#0b111a', fontFamily: 'Arial, Helvetica, sans-serif'}}>
    <Sequence from={0} durationInFrames={toFrame(270)}>
      <CaptureLayer capture={capture} />
    </Sequence>
    <Audio src={staticFile('audio/sdtk-cc0-ambient.m4a')} volume={0.12} />
    <Sequence from={0} durationInFrames={toFrame(3)}><Overlay><Caption>AI wrote this. First try? Failed.</Caption></Overlay></Sequence>
    <Sequence from={toFrame(3)} durationInFrames={toFrame(2)}><IntroBrand compact /></Sequence>
    <Sequence from={toFrame(5)} durationInFrames={toFrame(40)}><ShowcaseOverlay /></Sequence>
    <Sequence from={toFrame(45)} durationInFrames={60}><SectionCard eyebrow="REAL WORKFLOW" title="Download it. Open it. Own it." detail="The next screen is the public ZIP running locally — not a mockup." /></Sequence>
    <Sequence from={toFrame(45)} durationInFrames={toFrame(90)}><DownloadOverlay /></Sequence>
    <Sequence from={toFrame(135)} durationInFrames={60}><SectionCard eyebrow="THE TECHNIQUE" title="One CSS variable reskins the scene." detail="Watch the same offline file respond to --accent, palettes, and themes." /></Sequence>
    <Sequence from={toFrame(135)} durationInFrames={toFrame(90)}><ReskinOverlay /></Sequence>
    <Sequence from={toFrame(225)} durationInFrames={toFrame(45)}><HonestOverlay /></Sequence>
    <Sequence from={toFrame(270)} durationInFrames={toFrame(30)}><Cta /></Sequence>
    <MotionRail />
  </AbsoluteFill>
);

export const TutorialEpShort = ({capture}) => (
  <AbsoluteFill style={{background: '#0b111a', fontFamily: 'Arial, Helvetica, sans-serif', overflow: 'hidden'}}>
    <Sequence from={0} durationInFrames={toFrame(3)}>
      <div style={{position: 'absolute', top: 620, left: 0, width: 1440, height: 810, background: '#05090f'}}>
        <OffthreadVideo src={staticFile(capture)} style={{height: '100%', width: '100%', objectFit: 'contain'}} />
      </div>
      <Overlay justifyContent="space-between" padding={84}>
        <div style={{fontSize: 92, lineHeight: 1.05, color: '#fff7f1', fontWeight: 900}}>AI WROTE THIS.<br /><span style={{color: '#ff6a2b'}}>FIRST TRY? FAILED.</span></div>
        <Caption maxWidth={1260} fontSize={78}>Particle swarm spells the full SDTK wordmark.</Caption>
      </Overlay>
    </Sequence>
    <Sequence from={toFrame(3)} durationInFrames={toFrame(49)}>
      <div style={{position: 'absolute', top: 620, left: 0, width: 1440, height: 810, background: '#05090f'}}>
        <OffthreadVideo src={staticFile(capture)} startFrom={toFrame(147)} style={{height: '100%', width: '100%', objectFit: 'contain'}} />
      </div>
      <Overlay justifyContent="space-between" padding={84}>
        <div style={{fontSize: 86, lineHeight: 1.04, color: '#fff7f1', fontWeight: 900}}>ONE CSS VARIABLE<br /><span style={{color: '#ffb07a'}}>RESKINS THE SCENE</span></div>
        <Caption maxWidth={1260} fontSize={76}>Change --accent. Six palettes × two themes.</Caption>
      </Overlay>
    </Sequence>
    <Sequence from={toFrame(52)} durationInFrames={toFrame(3)}><ShortCta /></Sequence>
    <Audio src={staticFile('audio/sdtk-cc0-ambient.m4a')} volume={0.12} />
    <MotionRail />
  </AbsoluteFill>
);

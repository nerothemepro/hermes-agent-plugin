import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {IntroBrand} from './IntroBrand';

const CAPTURE_START = 240;
const HEROES = [
  'ember aurora',
  'floating 3D product',
  'liquid metal',
  'particle swarm · spells SDTK',
  'scroll-driven film',
  'kinetic type',
];

const baseStyle = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  color: '#fff7f1',
};

const fade = (frame, start, end) => interpolate(
  frame,
  [start, start + 12, end - 12, end],
  [0, 1, 1, 0],
  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
);

const LowerThird = ({label}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: 'none', justifyContent: 'flex-end', padding: '0 72px 72px', ...baseStyle}}>
      <div style={{alignSelf: 'flex-start', background: 'rgba(11, 17, 26, 0.88)', borderLeft: '7px solid #ff6a2b', boxShadow: '0 10px 32px rgba(0, 0, 0, 0.4)', opacity: fade(frame, 0, 220), padding: '20px 28px'}}>
        <div style={{color: '#ffb07a', fontSize: 18, fontWeight: 700, letterSpacing: 3}}>FREE HERO PACK</div>
        <div style={{fontSize: 42, fontWeight: 800, marginTop: 7}}>{label}</div>
      </div>
    </AbsoluteFill>
  );
};

export const HeroShowcase = ({capture}) => (
  <AbsoluteFill style={{background: '#0b111a', overflow: 'hidden', ...baseStyle}}>
    {capture ? (
      <Sequence from={CAPTURE_START} durationInFrames={1800}>
        <OffthreadVideo src={staticFile(capture)} style={{height: '100%', width: '100%', objectFit: 'cover'}} />
      </Sequence>
    ) : null}

    <Sequence durationInFrames={90}>
      <IntroBrand />
    </Sequence>

    <Sequence from={90} durationInFrames={150}>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 96}}>
        <div style={{fontSize: 23, fontWeight: 700, color: '#ffb07a', letterSpacing: 4}}>SDTK FREE PACK</div>
        <div style={{fontSize: 88, fontWeight: 800, lineHeight: 1.03, marginTop: 22}}>6 free WebGL hero sections</div>
        <div style={{fontSize: 34, color: '#c9d4df', marginTop: 22}}>for landing pages — no email wall</div>
      </AbsoluteFill>
    </Sequence>

    {HEROES.map((label, index) => (
      <Sequence key={label} from={CAPTURE_START + index * 240} durationInFrames={220}>
        <LowerThird label={label} />
      </Sequence>
    ))}

    <Sequence from={1680} durationInFrames={360}>
      <AbsoluteFill style={{pointerEvents: 'none', justifyContent: 'flex-start', padding: '74px 72px'}}>
        <div style={{alignSelf: 'flex-start', background: 'rgba(11, 17, 26, 0.9)', border: '1px solid rgba(255, 176, 122, 0.7)', padding: '18px 26px', fontSize: 34, fontWeight: 800}}>
          Re-skin any effect — one CSS variable.
        </div>
      </AbsoluteFill>
    </Sequence>

    <Sequence from={2040} durationInFrames={240}>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', background: '#0b111a', padding: 150, textAlign: 'center'}}>
        <div style={{fontSize: 30, color: '#ffb07a', fontWeight: 700, letterSpacing: 3}}>HONEST SCORECARD</div>
        <div style={{fontSize: 58, fontWeight: 800, lineHeight: 1.18, marginTop: 26}}>Every line was AI-generated. None passed on the first try — 12 human review passes cleared them.</div>
      </AbsoluteFill>
    </Sequence>

    <Sequence from={2280} durationInFrames={180}>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', background: '#0b111a', textAlign: 'center'}}>
        <div style={{fontSize: 116, fontWeight: 900, letterSpacing: 3}}><span style={{color: '#ffb07a'}}>S</span>DTK</div>
        <div style={{fontSize: 48, fontWeight: 800, marginTop: 26}}>Free — no email wall.</div>
        <div style={{fontSize: 38, color: '#ffb07a', marginTop: 15}}>sdtk.dev/heroes</div>
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>
);

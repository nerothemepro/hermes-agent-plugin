import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';

const FPS = 30;
const frameAt = (seconds) => Math.round(seconds * FPS);
const INK = '#05090f';
const CREAM = '#fff7f1';
const EMBER = '#ff6a2b';
const capture = (captures, key) => captures && captures[key] ? staticFile(captures[key]) : null;

const Typed = ({text, start = 0, cps = 18, style = {}}) => {
  const frame = useCurrentFrame();
  const length = Math.max(0, Math.min(text.length, Math.floor(((frame - start) / FPS) * cps)));
  return <span style={style}>{text.slice(0, length)}<span style={{opacity: length < text.length ? 1 : 0}}>|</span></span>;
};

const Camera = ({children, duration, direction = 1, still = false}) => {
  const frame = useCurrentFrame();
  const active = Math.min(frame, duration);
  // The calibration floor is 0.0018/frame; R2 raises it after the measured gate failure.
  const scale = still ? 1.12 : 1.12 + active * 0.0048;
  const x = still ? 0 : interpolate(active, [0, duration], [-760 * direction, 760 * direction]);
  const y = still ? 0 : interpolate(active, [0, duration], [120, -120]);
  return <div style={{position: 'absolute', inset: '-10%', transform: 'translate3d(' + x + 'px,' + y + 'px,0) rotateZ(' + (direction * 1.8) + 'deg) scale(' + scale + ')', transformOrigin: '50% 50%'}}>{children}</div>;
};

const MotionField = () => {
  const frame = useCurrentFrame();
  const quietGate = frame >= frameAt(48) && frame < frameAt(52);
  const quietOpacity = quietGate ? 0.055 : 0.18;
  const sweep = interpolate(frame % 84, [0, 84], [-1700, 2100]);
  const sweepBack = interpolate(frame % 111, [0, 111], [2100, -1700]);
  return <><div style={{position: "absolute", zIndex: 40, left: -420, top: -360, width: 820, height: 1800, pointerEvents: "none", opacity: quietOpacity, background: "linear-gradient(90deg, transparent, rgba(255,106,43,.52), transparent)", transform: "translateX(" + sweep + "px) rotate(18deg)", mixBlendMode: "screen"}} /><div style={{position: "absolute", zIndex: 39, right: -500, bottom: -460, width: 980, height: 1300, pointerEvents: "none", opacity: quietGate ? 0.045 : 0.14, background: "linear-gradient(90deg, transparent, rgba(255,176,122,.62), transparent)", transform: "translateX(" + sweepBack + "px) rotate(-24deg)", mixBlendMode: "overlay"}} /></>;
};

const Connector = ({start = 0, from, to, color = EMBER}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [start, start + 42], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const length = 2500;
  return <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible'}}>
    <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color} strokeWidth={5} strokeDasharray={length} strokeDashoffset={length * (1 - progress)} />
  </svg>;
};

const Clip = ({src, duration, direction = 1, background = false, label, still = false}) => src ? <Camera duration={duration} direction={direction} still={still}>
  <div style={{position: 'absolute', inset: 0, perspective: 2200, opacity: background ? 0.42 : 1}}>
    <OffthreadVideo src={src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: 'rotateY(-8deg) rotateX(3deg)', boxShadow: '0 38px 100px rgba(0,0,0,.58)', border: '2px solid rgba(255,176,122,.58)'}} />
    {label ? <div style={{position: 'absolute', left: 64, top: 58, padding: '12px 18px', color: CREAM, background: 'rgba(4,9,15,.86)', borderLeft: '6px solid ' + EMBER, fontSize: 22, fontWeight: 900, letterSpacing: 2}}>{label}</div> : null}
  </div>
</Camera> : null;

const Card = ({children, start = 0, left, top, light = false}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [start, start + 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <div style={{position: 'absolute', left, top, padding: '18px 25px', color: light ? INK : CREAM, background: light ? 'rgba(255,247,241,.94)' : 'rgba(15,25,37,.94)', borderLeft: '8px solid ' + EMBER, boxShadow: '0 24px 60px rgba(0,0,0,.32)', opacity: progress, transform: 'translateY(' + ((1 - progress) * 72) + 'px) scale(' + (.94 + progress * .06) + ')'}}>{children}</div>;
};

const Title = ({children, sub}) => <div style={{position: 'absolute', left: 98, top: 80, color: INK, zIndex: 5}}><div style={{fontSize: 58, fontWeight: 950}}>{children}</div>{sub ? <div style={{fontSize: 28, marginTop: 10, color: '#613422', fontWeight: 750}}>{sub}</div> : null}</div>;
const Wordmark = ({dark = false}) => <div style={{fontSize: 146, fontWeight: 950, letterSpacing: 7, color: dark ? CREAM : INK}}><span style={{color: EMBER}}>S</span>DTK</div>;

const ColdOpen = ({terminal}) => <AbsoluteFill style={{background: INK, color: CREAM, overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif'}}>
  <Clip src={terminal} duration={frameAt(4)} label="REAL CHECK" />
  <div style={{position: 'absolute', left: 126, bottom: 104, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 46}}><Typed text="unedited screen recording" cps={17} /><div style={{color: '#ff9696', fontSize: 32, marginTop: 20}}><Typed text="✗ check: unverifiable claim" start={50} cps={25} /></div></div>
  <div style={{position: 'absolute', right: 150, top: 145, padding: '14px 24px', border: '9px solid #ff4b55', color: '#ff4b55', fontSize: 60, fontWeight: 950, transform: 'rotate(-9deg)', boxShadow: '0 0 34px rgba(255,75,85,.38)'}}>✗ BLOCKED</div>
</AbsoluteFill>;

const Pain = () => <AbsoluteFill style={{background: INK, color: CREAM, overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif'}}><Camera duration={frameAt(5)}><Card left={160} top={160}><b>SPEC DOC</b><br /><span style={{color: '#ff9696'}}>missing acceptance evidence</span></Card><Card left={680} top={405} start={3}><b>CODE DIFF</b><br /><span style={{color: '#ff9696'}}>unreviewed change</span></Card><Card left={1170} top={220} start={6}><b>MARKETING POST</b><br /><span style={{color: '#ff9696'}}>claim not verified</span></Card></Camera><div style={{position: 'absolute', left: 130, bottom: 105, fontSize: 80, fontWeight: 950}}>Agents ship fast.<br /><span style={{color: '#ffb07a'}}>Nothing checks them.</span></div></AbsoluteFill>;
const Villain = () => <AbsoluteFill style={{background: INK, color: CREAM, alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, Helvetica, sans-serif'}}><Camera duration={frameAt(2)}><div style={{fontSize: 92, fontWeight: 950, transform: 'scale(1.06)'}}>The gap isn't speed. It's <span style={{color: EMBER}}>proof.</span></div></Camera></AbsoluteFill>;
const Flip = () => <AbsoluteFill style={{background: CREAM, color: INK, alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, Helvetica, sans-serif'}}><Wordmark /><div style={{fontSize: 44, marginTop: 13, fontWeight: 850}}><Typed text="Build fast. Prove it." cps={24} /></div></AbsoluteFill>;

const Design = ({design, gallery}) => <AbsoluteFill style={{background: CREAM, overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif'}}><Clip src={gallery} duration={frameAt(13)} direction={-1} background label="STYLE GALLERY" /><Clip src={design} duration={frameAt(13)} direction={1} label="PREVIEW STUDIO · LIVE RESKIN" /><Title sub="sdtk.dev/heroes">One click. Six palettes.</Title><Connector from={[230, 720]} to={[1650, 410]} start={34} color="#e65c25" /></AbsoluteFill>;
const Wiki = ({graphDocs, ask}) => <AbsoluteFill style={{background: '#f4f7fb', overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif'}}><Clip src={graphDocs} duration={frameAt(9)} direction={1} label="GRAPH → DOCS · ONE CONTINUOUS TAKE" /><Sequence from={frameAt(9)} durationInFrames={frameAt(3)}><Clip src={ask} duration={frameAt(3)} direction={1} label="ASK · REAL REPO QUERY" /></Sequence><Title sub="Ask it. It answers from the files.">Your repo, as a graph.</Title><Connector from={[250, 650]} to={[1620, 430]} start={42} color="#e65c25" /></AbsoluteFill>;
const Kanban = ({kanban}) => <AbsoluteFill style={{background: '#edf2f8', overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif'}}><Clip src={kanban} duration={frameAt(12)} direction={-1} label="SDTK-WIKI KANBAN · DASH" /><Title sub="A human opens each one.">Every phase has a gate.</Title><div style={{position: 'absolute', right: 80, bottom: 64, fontSize: 22, fontWeight: 800, color: '#613422'}}>sdtk-wiki kanban · SHARED_PLANNING.md + QUALITY_CHECKLIST.md</div><Connector from={[220, 470]} to={[1660, 470]} start={30} color="#e65c25" /><GatePass /></AbsoluteFill>;
const GatePass = () => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, frameAt(12)], [-560, 2080]);
  const pulse = 0.76 + 0.24 * Math.sin(frame / 5);
  return <><div style={{position: 'absolute', zIndex: 12, top: 690, left: -180, width: 2280, height: 5, opacity: .82, background: 'linear-gradient(90deg, transparent, ' + EMBER + ', transparent)', transform: 'translateX(' + (x * .18) + 'px)'}} /><div style={{position: 'absolute', zIndex: 13, top: 632, left: 0, width: 390, padding: '17px 24px', color: INK, background: '#b9f6c8', border: '3px solid #16733f', boxShadow: '0 14px 34px rgba(14,98,50,.38)', fontSize: 29, fontWeight: 950, letterSpacing: 1.5, transform: 'translateX(' + x + 'px) scale(' + pulse + ')'}}>GATE PASSED ✓</div></>;
};

const Gate = ({terminal}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: INK, color: CREAM, fontFamily: 'Arial, Helvetica, sans-serif'}}><Clip src={terminal} duration={frameAt(10)} still={frame < frameAt(4)} label="REAL CHECK · INTENTIONAL QUIET BEAT" /><div style={{position: 'absolute', left: 112, bottom: 86, fontSize: 52, fontWeight: 950, transform: 'translateX(' + Math.max(0, frame - frameAt(4)) * 4 + 'px)'}}><div style={{color: '#ff7e86'}}>✗ "unedited"</div><div style={{color: '#8de4a8', marginTop: 14}}>✓ "composited from real captures"</div></div></AbsoluteFill>;
};
const Proof = ({facts = {}}) => <AbsoluteFill style={{background: CREAM, color: INK, overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif'}}><Camera duration={frameAt(10)}><div style={{position: 'absolute', inset: 0, background: 'radial-gradient(circle at 20% 16%, rgba(255,106,43,.25), transparent 34%), radial-gradient(circle at 76% 74%, rgba(255,176,122,.36), transparent 28%)'}} /></Camera>{[
  'sdtk-kit ' + (facts.kitVersion || 'live'),
  'sdtk-design ' + (facts.designVersion || 'live'),
  'sdtk-wiki ' + (facts.wikiVersion || 'live'),
  'sdtk-agent ' + (facts.agentVersion || 'live'),
  '6 heroes · ' + (facts.zipBytes || 'verified ZIP') + ' bytes',
  'no account · no email',
].map((line, index) => <Card key={line} start={index * 2} left={108 + (index % 2) * 810} top={155 + Math.floor(index / 2) * 215} light><div style={{fontSize: 37, fontWeight: 950}}>{line}</div></Card>)}<Connector from={[245, 260]} to={[1650, 790]} start={42} color="#e65c25" /></AbsoluteFill>;
const Close = () => <AbsoluteFill style={{background: CREAM, color: INK, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif'}}><Camera duration={frameAt(7)} direction={-1}><AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}><Wordmark /><div style={{fontSize: 44, fontWeight: 850, marginTop: 14}}><Typed text="Build fast. Prove it." cps={20} /></div><div style={{fontSize: 42, color: '#b14720', marginTop: 32, fontWeight: 900}}>sdtk.dev</div></AbsoluteFill></Camera></AbsoluteFill>;

export const OneSpine = ({captures = {}, facts = {}}) => <AbsoluteFill style={{background: INK}}>
  <Sequence from={0} durationInFrames={frameAt(4)}><ColdOpen terminal={capture(captures, 'terminal')} /></Sequence>
  <Sequence from={frameAt(4)} durationInFrames={frameAt(5)}><Pain /></Sequence>
  <Sequence from={frameAt(9)} durationInFrames={frameAt(2)}><Villain /></Sequence>
  <Sequence from={frameAt(11)} durationInFrames={1}><Flip /></Sequence>{/* hard-cut */}
  <Sequence from={frameAt(11)} durationInFrames={frameAt(13)}><Design design={capture(captures, 'design')} gallery={capture(captures, 'gallery')} /></Sequence>
  <Sequence from={frameAt(24)} durationInFrames={frameAt(12)}><Wiki graphDocs={capture(captures, 'graphDocs')} ask={capture(captures, 'ask')} /></Sequence>
  <Sequence from={frameAt(36)} durationInFrames={frameAt(12)}><Kanban kanban={capture(captures, 'kanban')} /></Sequence>
  <Sequence from={frameAt(48)} durationInFrames={frameAt(10)}><Gate terminal={capture(captures, 'terminal')} /></Sequence>
  <Sequence from={frameAt(58)} durationInFrames={frameAt(10)}><Proof facts={facts} /></Sequence>
  <Sequence from={frameAt(68)} durationInFrames={frameAt(7)}><Close /></Sequence>
  <MotionField />
</AbsoluteFill>;

const VerticalPanel = ({children}) => <div style={{position: 'absolute', top: 530, left: 0, width: 1080, height: 720, background: '#05090f'}}>{children}</div>;
export const OneSpineVertical = ({captures = {}, facts = {}}) => <AbsoluteFill style={{background: INK, overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif'}}>
  <Sequence from={0} durationInFrames={frameAt(5)}><AbsoluteFill><VerticalPanel><Clip src={capture(captures, 'terminal')} duration={frameAt(5)} label="REAL CHECK" /></VerticalPanel><div style={{position: 'absolute', top: 105, left: 76, color: CREAM, fontSize: 70, fontWeight: 950}}>BUILD FAST.<br /><span style={{color: EMBER}}>PROVE IT.</span></div></AbsoluteFill></Sequence>
  <Sequence from={frameAt(5)} durationInFrames={frameAt(10)}><AbsoluteFill><VerticalPanel><Clip src={capture(captures, 'design')} duration={frameAt(10)} label="LIVE RESKIN" /></VerticalPanel><div style={{position: 'absolute', top: 115, left: 76, color: CREAM, fontSize: 68, fontWeight: 950}}>ONE CLICK.<br /><span style={{color: '#ffb07a'}}>SIX PALETTES.</span></div></AbsoluteFill></Sequence>
  <Sequence from={frameAt(15)} durationInFrames={frameAt(10)}><AbsoluteFill><VerticalPanel><Clip src={capture(captures, 'graphDocs')} duration={frameAt(10)} label="GRAPH → DOCS" /></VerticalPanel><div style={{position: 'absolute', top: 110, left: 76, color: CREAM, fontSize: 67, fontWeight: 950}}>YOUR REPO,<br /><span style={{color: '#ffb07a'}}>AS A GRAPH.</span></div></AbsoluteFill></Sequence>
  <Sequence from={frameAt(25)} durationInFrames={frameAt(8)}><AbsoluteFill><VerticalPanel><Clip src={capture(captures, 'kanban')} duration={frameAt(8)} label="SDTK-WIKI KANBAN" /></VerticalPanel><div style={{position: 'absolute', top: 116, left: 76, color: CREAM, fontSize: 66, fontWeight: 950}}>EVERY PHASE<br />HAS A GATE.</div></AbsoluteFill></Sequence>
  <Sequence from={frameAt(33)} durationInFrames={frameAt(7)}><Proof facts={facts} /></Sequence>
  <Sequence from={frameAt(40)} durationInFrames={frameAt(5)}><Close /></Sequence>
</AbsoluteFill>;

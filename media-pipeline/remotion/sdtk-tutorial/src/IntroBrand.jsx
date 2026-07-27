import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

const letters = ['S', 'D', 'T', 'K'];

export const IntroBrand = ({compact = false}) => {
  const rawFrame = useCurrentFrame();
  const frame = compact ? rawFrame * 3 : rawFrame;
  const {fps} = useVideoConfig();
  const taglineOpacity = interpolate(frame, [54, 82, 155, 175], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const lineScale = interpolate(frame, [20, 60], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const exitOpacity = interpolate(frame, [150, 180], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{background: '#0b111a', alignItems: 'center', justifyContent: 'center', color: '#fff7f1', fontFamily: 'Arial, Helvetica, sans-serif', opacity: exitOpacity, overflow: 'hidden'}}>
      <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 9, background: '#ff6a2b'}} />
      <div style={{position: 'absolute', width: 920, height: 1, background: '#ffb07a', opacity: 0.78, transform: 'scaleX(' + lineScale + ')', transformOrigin: 'center'}} />
      <div style={{display: 'flex', gap: 18, letterSpacing: 2, zIndex: 1}}>
        {letters.map((letter, index) => {
          const progress = spring({frame: Math.max(0, frame - index * 9), fps, config: {damping: 18, stiffness: 150, mass: 0.65}});
          return <span key={letter} style={{fontSize: 258, fontWeight: 800, lineHeight: 0.9, color: index === 0 ? '#ffb07a' : '#fff7f1', transform: 'translateY(' + (1 - progress) * 95 + 'px)', opacity: progress, textShadow: index === 0 ? '0 0 30px #ff6a2b' : 'none'}}>{letter}</span>;
        })}
      </div>
      <div style={{position: 'absolute', marginTop: 385, fontSize: 42, fontWeight: 600, letterSpacing: 1, color: '#ffb07a', opacity: taglineOpacity}}>Real gates for AI-written code.</div>
      <div style={{position: 'absolute', bottom: 72, fontSize: 20, letterSpacing: 4, color: '#9fb0c4'}}>LOCAL-FIRST DELIVERY TOOLKIT</div>
    </AbsoluteFill>
  );
};

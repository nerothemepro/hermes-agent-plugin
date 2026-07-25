import {AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame} from 'remotion';

export const Tutorial = ({capture, input, title}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{backgroundColor: '#07111f', color: '#f8fbff', fontFamily: 'Arial, sans-serif'}}>
      <OffthreadVideo src={staticFile(capture)} style={{height: '100%', width: '100%', objectFit: 'contain'}} />
      <AbsoluteFill style={{pointerEvents: 'none', padding: 48, justifyContent: 'space-between', opacity}}>
        <div style={{alignSelf: 'flex-start', background: 'rgba(3, 12, 24, 0.84)', border: '1px solid rgba(124, 194, 255, 0.45)', borderRadius: 12, padding: '16px 22px', fontSize: 34, fontWeight: 700}}>{title}</div>
        <div style={{alignSelf: 'stretch', background: 'rgba(3, 12, 24, 0.88)', borderRadius: 12, padding: '18px 24px', fontSize: 28, lineHeight: 1.35}}>{input}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

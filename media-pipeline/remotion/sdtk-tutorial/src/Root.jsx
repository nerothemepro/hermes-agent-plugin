import {Composition} from 'remotion';
import {Tutorial} from './Tutorial';
import {IntroBrand} from './IntroBrand';

export const Root = () => (
  <>
    <Composition
      id="SdtkTutorial"
      component={Tutorial}
      durationInFrames={600}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{capture: '', input: 'Run sdtk usage to inspect local CLI usage.', title: 'SDTK Usage: Read-only local metering'}}
    />
    <Composition
      id="IntroBrand"
      component={IntroBrand}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);

import {Composition} from 'remotion';
import {Tutorial} from './Tutorial';
import {IntroBrand} from './IntroBrand';
import {HeroShowcase} from './HeroShowcase';
import {TutorialEp, TutorialEpShort} from './TutorialEp';

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
    <Composition
      id="HeroShowcase"
      component={HeroShowcase}
      durationInFrames={2460}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{capture: ''}}
    />
    <Composition
      id="TutorialEp"
      component={TutorialEp}
      durationInFrames={9000}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{capture: ''}}
    />
    <Composition
      id="TutorialEpShort"
      component={TutorialEpShort}
      durationInFrames={1650}
      fps={30}
      width={1440}
      height={2560}
      defaultProps={{capture: ''}}
    />
  </>
);

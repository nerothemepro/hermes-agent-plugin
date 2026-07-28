import {Composition} from 'remotion';
import {Tutorial} from './Tutorial';
import {IntroBrand} from './IntroBrand';
import {HeroShowcase} from './HeroShowcase';
import {TutorialEp, TutorialEpShort} from './TutorialEp';
import {OneSpine, OneSpineVertical} from './OneSpine';

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
    <Composition
      id="OneSpine"
      component={OneSpine}
      durationInFrames={2250}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{captures: {}, facts: {}}}
    />
    <Composition
      id="OneSpineVertical"
      component={OneSpineVertical}
      durationInFrames={1350}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{captures: {}, facts: {}}}
    />
  </>
);

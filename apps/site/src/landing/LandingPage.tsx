import { BrowserSupport } from './BrowserSupport';
import { ControllerSection } from './ControllerSection';
import { Features } from './Features';
import { FinalCta } from './FinalCta';
import { Hero } from './Hero';
import { Platforms } from './Platforms';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { SoundDemo } from './SoundDemo';
import { Workflow } from './Workflow';

export function LandingPage() {
  return (
    <div id="top" className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Hero />
        <Features />
        <Workflow />
        <SoundDemo />
        <ControllerSection />
        <Platforms />
        <BrowserSupport />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

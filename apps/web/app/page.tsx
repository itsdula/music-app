import { BrowserSupport } from '../components/landing/BrowserSupport';
import { ControllerSection } from '../components/landing/ControllerSection';
import { Features } from '../components/landing/Features';
import { FinalCta } from '../components/landing/FinalCta';
import { Hero } from '../components/landing/Hero';
import { PortableSection } from '../components/landing/PortableSection';
import { SiteFooter } from '../components/landing/SiteFooter';
import { SiteHeader } from '../components/landing/SiteHeader';
import { VocalSection } from '../components/landing/VocalSection';

export default function LandingPage() {
  return (
    <div id="top" className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Hero />
        <Features />
        <ControllerSection />
        <VocalSection />
        <PortableSection />
        <BrowserSupport />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

import { FeatureGrid } from './landing/FeatureGrid'
import { HeroSection } from './landing/HeroSection'
import { LandingFooter } from './landing/LandingFooter'
import { LandingNav } from './landing/LandingNav'

export function Landing() {
  return (
    <>
      <LandingNav />
      <main>
        <HeroSection />
        <FeatureGrid />
      </main>
      <LandingFooter />
    </>
  )
}

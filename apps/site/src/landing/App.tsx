import { LocaleProvider } from "./i18n";
import Header from "./components/Header";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import ControlRoom from "./components/ControlRoom";
import Features from "./components/Features";
import Surfaces from "./components/Surfaces";
import Install from "./components/Install";
import Footer from "./components/Footer";

export default function App() {
  return (
    <LocaleProvider>
      <div className="noise min-h-screen bg-paper">
        <Header />
        <main>
          <Hero />
          <HowItWorks />
          <ControlRoom />
          <Features />
          <Surfaces />
          <Install />
        </main>
        <Footer />
      </div>
    </LocaleProvider>
  );
}

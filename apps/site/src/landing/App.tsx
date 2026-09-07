import { LocaleProvider } from "./i18n";
import Header from "./components/Header";
import Hero from "./components/Hero";
import Flow from "./components/Flow";
import ControlRoom from "./components/ControlRoom";
import Systems from "./components/Systems";
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
          <Flow />
          <ControlRoom />
          <Systems />
          <Surfaces />
          <Install />
        </main>
        <Footer />
      </div>
    </LocaleProvider>
  );
}

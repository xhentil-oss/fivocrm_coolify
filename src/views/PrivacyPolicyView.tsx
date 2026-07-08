import React from 'react';

/**
 * Politika e Privatësisë — faqe publike (pa login) e kërkuar nga Google Play
 * dhe App Store. URL: https://fivocrm.com/privacy
 */
const PrivacyPolicyView: React.FC = () => {
  const updated = '8 Korrik 2026';

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Politika e Privatësisë</h1>
          <p className="text-sm text-gray-500 mt-2">FivoCRM · Përditësuar më {updated}</p>
        </div>

        <div className="space-y-8 leading-relaxed text-[15px]">
          <section>
            <p>
              FivoCRM ("ne", "aplikacioni") është një platformë për menaxhimin e biznesit
              (CRM, fatura, projekte, komunikim). Kjo politikë shpjegon çfarë të dhënash
              mbledhim, si i përdorim dhe si i mbrojmë. Duke përdorur FivoCRM ju pranoni
              praktikat e përshkruara këtu.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Të dhënat që mbledhim</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Të dhëna llogarie:</strong> emër, email dhe fjalëkalim (i enkriptuar) kur regjistroheni.</li>
              <li><strong>Të dhëna biznesi që ju vetë i futni:</strong> klientë, lead-e, fatura, projekte, detyra, mesazhe dhe dokumente.</li>
              <li><strong>Të dhëna përdorimi:</strong> veprime brenda aplikacionit për funksionalitet dhe siguri.</li>
              <li><strong>Të dhëna pajisjeje:</strong> identifikues i pajisjes për njoftime push (kur i aktivizoni).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Si i përdorim të dhënat</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Për të ofruar dhe mirëmbajtur shërbimet e platformës.</li>
              <li>Për autentifikim, siguri dhe parandalim abuzimi.</li>
              <li>Për të dërguar njoftime dhe email-e që lidhen me punën tuaj.</li>
              <li>Për të përmirësuar funksionalitetin dhe përvojën e përdoruesit.</li>
            </ul>
            <p className="mt-3">
              <strong>Nuk i shesim të dhënat tuaja</strong> palëve të treta dhe nuk i përdorim
              për reklama.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Shërbime të palëve të treta</h2>
            <p className="mb-3">Përdorim ofrues të besuar për të mundësuar funksionet:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Google Firebase</strong> — autentifikim, bazë të dhënash, ruajtje skedarësh dhe njoftime push.</li>
              <li><strong>Stripe</strong> — përpunim pagesash (nuk ruajmë të dhëna karte).</li>
              <li><strong>Meta / WhatsApp Business API</strong> — komunikim me klientët (kur e aktivizoni).</li>
              <li><strong>OpenAI</strong> — asistenti me inteligjencë artificiale (vetëm teksti që i dërgoni).</li>
            </ul>
            <p className="mt-3">Secili ofrues ka politikën e vet të privatësisë.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Ruajtja dhe siguria</h2>
            <p>
              Të dhënat ruhen në serverë të sigurt (Google Cloud / Firebase) me enkriptim gjatë
              transmetimit. Aksesi është i kufizuar sipas rolit dhe biznesit. Ndonëse zbatojmë
              masa mbrojtëse, asnjë sistem nuk është 100% i pacenueshëm.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Të drejtat tuaja</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Të aksesoni, korrigjoni ose fshini të dhënat tuaja.</li>
              <li>Të kërkoni fshirjen e llogarisë dhe të dhënave përkatëse.</li>
              <li>Të tërhiqni pëlqimin për njoftime në çdo kohë.</li>
            </ul>
            <p className="mt-3">
              Për të ushtruar këto të drejta, na kontaktoni në email-in më poshtë.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Fshirja e të dhënave</h2>
            <p>
              Mund të kërkoni fshirjen e plotë të llogarisë dhe të dhënave tuaja duke dërguar një
              email te <a href="mailto:social@fivo.al" className="text-blue-600 underline">social@fivo.al</a>.
              Të dhënat fshihen brenda 30 ditëve, përveç atyre që ligji kërkon t'i mbajmë.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Fëmijët</h2>
            <p>Aplikacioni nuk u drejtohet personave nën 16 vjeç dhe nuk mbledhim me vetëdije të dhëna të tyre.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Ndryshime</h2>
            <p>
              Këtë politikë mund ta përditësojmë herë pas here. Ndryshimet publikohen në këtë faqe
              me datën e re të përditësimit.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Kontakti</h2>
            <p>
              Për çdo pyetje rreth privatësisë:<br />
              <strong>Email:</strong> <a href="mailto:social@fivo.al" className="text-blue-600 underline">social@fivo.al</a><br />
              <strong>Faqja:</strong> <a href="https://fivocrm.com" className="text-blue-600 underline">fivocrm.com</a>
            </p>
          </section>

          <div className="pt-6 border-t text-sm text-gray-500">
            © {new Date().getFullYear()} FivoCRM. Të gjitha të drejtat e rezervuara.
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyView;

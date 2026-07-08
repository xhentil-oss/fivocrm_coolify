import React from 'react';

/**
 * Fshirja e Llogarisë — faqe publike (pa login) e kërkuar nga Google Play
 * për fushën "Delete account URL" te Data Safety.
 * URL: https://fivocrm.com/delete-account
 *
 * Duhet të: (1) referojë emrin e app-it/zhvilluesit, (2) tregojë hapat për
 * të kërkuar fshirjen, (3) specifikojë çfarë fshihet/mbahet dhe afatet.
 */
const DeleteAccountView: React.FC = () => {
  const updated = '8 Korrik 2026';
  const subject = encodeURIComponent('Kërkesë për fshirjen e llogarisë — FivoCRM');
  const body = encodeURIComponent(
    'Përshëndetje,\n\nKërkoj fshirjen e llogarisë sime dhe të të dhënave përkatëse në FivoCRM.\n\nEmail i llogarisë: \nEmri i biznesit (nëse ka): \n\nFaleminderit.'
  );

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Fshirja e Llogarisë</h1>
          <p className="text-sm text-gray-500 mt-2">FivoCRM · Zhvilluar nga Fivo · Përditësuar më {updated}</p>
        </div>

        <div className="space-y-8 leading-relaxed text-[15px]">
          <section>
            <p>
              Kjo faqe shpjegon si të kërkoni fshirjen e llogarisë suaj në{' '}
              <strong>FivoCRM</strong> (zhvilluar nga <strong>Fivo</strong>) dhe çfarë ndodh
              me të dhënat tuaja pas kërkesës.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Si të kërkoni fshirjen e llogarisë</h2>
            <p className="mb-3">Ndiqni këto hapa:</p>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                Dërgoni një email te{' '}
                <a
                  href={`mailto:social@fivo.al?subject=${subject}&body=${body}`}
                  className="text-blue-600 underline"
                >
                  social@fivo.al
                </a>{' '}
                nga adresa e email-it me të cilën jeni regjistruar.
              </li>
              <li>Në subjekt shkruani: <strong>"Kërkesë për fshirjen e llogarisë — FivoCRM"</strong>.</li>
              <li>Përfshini email-in e llogarisë suaj (dhe emrin e biznesit, nëse ka), që të verifikojmë identitetin.</li>
              <li>Ne e verifikojmë kërkesën dhe e përpunojmë brenda afateve më poshtë.</li>
            </ol>
            <div className="mt-5">
              <a
                href={`mailto:social@fivo.al?subject=${subject}&body=${body}`}
                className="inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-white font-medium hover:bg-blue-700 transition-colors"
              >
                Kërko fshirjen e llogarisë
              </a>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Çfarë të dhënash fshihen</h2>
            <p className="mb-3">Pas verifikimit, fshijmë përfundimisht:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Llogarinë tuaj dhe kredencialet e hyrjes (email, autentifikim).</li>
              <li>Të dhënat e profilit: emër, email, numër telefoni, foto profili.</li>
              <li>Përmbajtjen që keni krijuar: klientë, lead-e, fatura, projekte, detyra, mesazhe dhe dokumente të ngarkuara.</li>
              <li>Identifikuesit e pajisjes për njoftime push.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Çfarë të dhënash mund të mbahen</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Të dhëna që ligji na detyron t'i ruajmë (p.sh. të dhëna faturimi/kontabiliteti)
                mbahen për periudhën e kërkuar ligjërisht dhe fshihen më pas.
              </li>
              <li>
                Kopjet rezervë (backups) mund të përmbajnë të dhëna deri në <strong>90 ditë</strong>,
                pas së cilës mbishkruhen automatikisht.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Afatet</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Kërkesën e konfirmojmë brenda <strong>72 orëve</strong>.</li>
              <li>Të dhënat aktive fshihen brenda <strong>30 ditëve</strong> nga verifikimi i kërkesës.</li>
              <li>Kopjet rezervë pastrohen plotësisht brenda <strong>90 ditëve</strong>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Fshirje pjesore (pa fshirë llogarinë)</h2>
            <p>
              Nëse doni të fshini vetëm një pjesë të të dhënave (p.sh. një klient, projekt apo
              dokument) pa mbyllur llogarinë, mund ta bëni direkt brenda aplikacionit, ose të na
              kontaktoni në të njëjtin email për ndihmë.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Kontakti</h2>
            <p>
              Për çdo pyetje rreth fshirjes së të dhënave:<br />
              <strong>Email:</strong>{' '}
              <a href="mailto:social@fivo.al" className="text-blue-600 underline">social@fivo.al</a><br />
              <strong>Faqja:</strong>{' '}
              <a href="https://fivocrm.com" className="text-blue-600 underline">fivocrm.com</a>
            </p>
          </section>

          <div className="pt-6 border-t text-sm text-gray-500">
            © {new Date().getFullYear()} FivoCRM (Fivo). Të gjitha të drejtat e rezervuara.
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteAccountView;

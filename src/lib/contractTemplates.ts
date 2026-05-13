export interface ContractParties {
  // Provider (our company)
  companyName: string;
  companyAddress: string;
  companyNipt: string;
  companyRep: string;
  // Client (from CRM)
  clientName: string;
  clientCompany?: string;
  clientAddress?: string;
  clientNipt?: string;
  clientEmail?: string;
  clientPhone?: string;
}

export interface ContractTemplate {
  id: string;
  label: string;
  description: string;
  getHTML: (parties: ContractParties) => string;
}

function providerBlock(p: ContractParties) {
  return `<strong>OFRUESI I SHËRBIMIT:</strong> ${p.companyName}${p.companyAddress ? `, me seli në ${p.companyAddress}` : ''}${p.companyNipt ? `, NIPT: <strong>${p.companyNipt}</strong>` : ''}${p.companyRep ? `, i përfaqësuar nga <strong>${p.companyRep}</strong>` : ''}, hereinafter "<strong>Ofruesi</strong>"`;
}

function clientBlock(p: ContractParties) {
  const co = p.clientCompany ? ` (${p.clientCompany})` : '';
  const nipt = p.clientNipt ? `, NIPT: <strong>${p.clientNipt}</strong>` : '';
  const addr = p.clientAddress ? `, me adresë ${p.clientAddress}` : '';
  return `<strong>KLIENTI:</strong> <strong>${p.clientName}</strong>${co}${nipt}${addr}, hereinafter "<strong>Klienti</strong>"`;
}

const today = () => new Date().toLocaleDateString('sq-AL', { day: '2-digit', month: 'long', year: 'numeric' });
const year = () => new Date().getFullYear();

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: 'service',
    label: 'Kontratë Shërbimi',
    description: 'Kontratë standarde për shërbime të përgjithshme',
    getHTML: (p) => `<h1 style="text-align:center">KONTRATË SHËRBIMI</h1>
<p style="text-align:center"><em>Nr. ________ / ${year()}</em></p>
<p>&nbsp;</p>
<p>Kjo kontratë shërbimi lidhet sot, <strong>${today()}</strong>, ndërmjet palëve:</p>
<p>&nbsp;</p>
<p>${providerBlock(p)}</p>
<p>&nbsp;</p>
<p>${clientBlock(p)}</p>
<p>&nbsp;</p>
<hr>
<h2>NENI 1 — OBJEKTI I KONTRATËS</h2>
<p>Ofruesi zotohet të ofrojë për Klientin shërbimet e specifikuara në Shtojcën A, sipas kushteve dhe afateve të kësaj kontrate.</p>
<h2>NENI 2 — ÇMIMI DHE KUSHTET E PAGESËS</h2>
<p>Çmimi i shërbimeve është sipas ofertës/preventivës së bashkëlidhur. Pagesat kryhen brenda <strong>15 ditëve kalendarike</strong> nga data e lëshimit të faturës.</p>
<ul>
  <li>Vonesa në pagesë mbi 15 ditë mund të rezultojë në ndërprerje të shërbimeve</li>
  <li>Çmimet nuk përfshijnë TVSH-në (nëse aplikohet)</li>
</ul>
<h2>NENI 3 — AFATI I KONTRATËS</h2>
<p>Kontrata hyn në fuqi nga data e nënshkrimit dhe mbetet e vlefshme për <strong>12 (dymbëdhjetë) muaj</strong>. Pas skadimit, rinovohet automatikisht nëse njëra palë nuk njofton ndërprerjen me <strong>30 ditë paralajmërim me shkrim</strong>.</p>
<h2>NENI 4 — DETYRIMET E PALËVE</h2>
<p><strong>Ofruesi detyrohet të:</strong></p>
<ul>
  <li>Ofrojë shërbimet sipas standardeve dhe afateve të dakordësuara</li>
  <li>Raportojë rezultatet çdo muaj</li>
  <li>Mbajë konfidenciale të gjitha informacionet e Klientit</li>
  <li>Njoftojë Klientin për çdo vonesë ose pengesë teknike</li>
</ul>
<p><strong>Klienti detyrohet të:</strong></p>
<ul>
  <li>Kryejë pagesat sipas afateve të dakordësuara</li>
  <li>Ofrojë materialet, akseset dhe informacionet e nevojshme në kohë</li>
  <li>Komunikojë ndryshimet e kërkesave me njoftim paraprak</li>
</ul>
<h2>NENI 5 — KONFIDENCIALITETI</h2>
<p>Të dyja palët bien dakord të mbajnë rreptësisht konfidenciale çdo informacion të ndarë gjatë bashkëpunimit, duke përfshirë strategjitë e biznesit, të dhënat e klientëve dhe informacionet financiare. Kjo detyrim mbetet në fuqi edhe pas përfundimit të kontratës.</p>
<h2>NENI 6 — NDËRPRERJA E PARAKOHSHME</h2>
<p>Secila palë ka të drejtë ta ndërpresë kontratën me njoftim <strong>30-ditor me shkrim</strong>. Shërbimet e kryera deri në datën e ndërprerjes do të faturihen proporcionalisht.</p>
<h2>NENI 7 — ZGJIDHJA E MOSMARRËVESHJEVE</h2>
<p>Çdo mosmarrëveshje do të zgjidhet fillimisht me negociata miqësore. Nëse palët nuk arrijnë marrëveshje brenda 30 ditëve, mosmarrëveshja do t'i nënshtrohet juridiksionit të gjykatave kompetente shqiptare.</p>
<p>&nbsp;</p>
<hr>
<h2>PRANIMI DHE NËNSHKRIMI</h2>
<p>Duke nënshkruar këtë kontratë, të dyja palët konfirmojnë se kanë lexuar, kuptuar dhe pranuar plotësisht të gjitha kushtet e mësipërme.</p>
<p>&nbsp;</p>
<p><strong>Ofruesi — ${p.companyName}:</strong> _______________________</p>
<p><strong>Klienti — ${p.clientName}:</strong> _______________________</p>`,
  },

  {
    id: 'marketing',
    label: 'Kontratë Marketingu Dixhital',
    description: 'Social media, reklama dhe menaxhim online',
    getHTML: (p) => `<h1 style="text-align:center">KONTRATË MARKETINGU DIXHITAL</h1>
<p style="text-align:center"><em>Nr. ________ / ${year()}</em></p>
<p>&nbsp;</p>
<p>Kjo kontratë lidhet sot, <strong>${today()}</strong>, ndërmjet:</p>
<p>${providerBlock(p)}</p>
<p>${clientBlock(p)}</p>
<p>&nbsp;</p>
<hr>
<h2>NENI 1 — SHËRBIMET E MARKETINGUT</h2>
<p>Ofruesi do të menaxhojë dhe zbatojë shërbimet e mëposhtme të marketingut dixhital:</p>
<ul>
  <li><strong>Menaxhim Social Media</strong> — Krijim dhe postim i përmbajtjes organike</li>
  <li><strong>Reklamat Meta (Facebook &amp; Instagram)</strong> — Krijim, menaxhim dhe optimizim i fushatave</li>
  <li><strong>Reklamat Google</strong> — Google Ads, SEA dhe remarketing</li>
  <li><strong>Optimizim SEO</strong> — Optimizim organik i motorëve të kërkimit</li>
  <li><strong>Raportim mujor</strong> — Analiza e performancës dhe rekomandime</li>
</ul>
<h2>NENI 2 — BUXHETI I REKLAMAVE</h2>
<p>Buxheti i reklamave (ad spend) <strong>nuk përfshihet</strong> në tarifën e menaxhimit dhe paguhet drejtpërdrejt nga Klienti tek platformat përkatëse (Meta, Google). Ofruesi mban përgjegjësi vetëm për menaxhimin e fushatave.</p>
<h2>NENI 3 — PRONARËSIA E MATERIALEVE</h2>
<p>Të gjitha materialet e krijuara (grafikë, video, tekste) mbeten pronë e Klientit pas përfundimit të kontratës, me kusht që të gjitha detyrimet financiare të jenë shlyer.</p>
<h2>NENI 4 — AKSESAT E NEVOJSHME</h2>
<p>Klienti detyrohet të japë aksesin e nevojshëm te:</p>
<ul>
  <li>Business Manager i Facebook/Instagram</li>
  <li>Google Ads &amp; Google Analytics</li>
  <li>Website/CMS (nëse nevojitet)</li>
  <li>Materialet vizuale, logon dhe brand guidelines</li>
</ul>
<h2>NENI 5 — AFATI DHE PAGESA</h2>
<p>Kontrata është aktive për <strong>12 muaj</strong> me pagesë mujore. Pagesa kryhet çdo muaj brenda datës 5 të muajit vijues. Ndërprerja e hershme kërkon <strong>30 ditë njoftim paraprak</strong>.</p>
<h2>NENI 6 — PERFORMANCA</h2>
<p>Ofruesi nuk garanton rezultate specifike (numër ndjekësish, konvertime, shitje), pasi performanca varet edhe nga faktori i tregut, cilësisë së produktit dhe buxhetit të reklamave. Ofruesi garanton angazhim profesional dhe transparencë të plotë.</p>
<p>&nbsp;</p>
<hr>
<p><strong>Ofruesi — ${p.companyName}:</strong> _______________________&nbsp;&nbsp;&nbsp;&nbsp;<strong>Klienti — ${p.clientName}:</strong> _______________________</p>`,
  },

  {
    id: 'seo',
    label: 'Kontratë SEO & Prezencë Online',
    description: 'Optimizim për motorët e kërkimit',
    getHTML: (p) => `<h1 style="text-align:center">KONTRATË SEO &amp; PREZENCË ONLINE</h1>
<p style="text-align:center"><em>Nr. ________ / ${year()}</em></p>
<p>&nbsp;</p>
<p>Kjo kontratë lidhet sot, <strong>${today()}</strong>, ndërmjet:</p>
<p>${providerBlock(p)}</p>
<p>${clientBlock(p)}</p>
<p>&nbsp;</p>
<hr>
<h2>NENI 1 — SHËRBIMET SEO</h2>
<p>Paketa e shërbimeve SEO përfshin:</p>
<ul>
  <li><strong>Auditim i plotë SEO</strong> — Analizë fillestare e website-it dhe konkurrencës</li>
  <li><strong>Optimizim On-Page</strong> — Meta tags, tituj, permbajtje, struktura URL</li>
  <li><strong>Optimizim teknik</strong> — Shpejtësia e faqes, mobile-friendly, sitemap, robots.txt</li>
  <li><strong>Link Building</strong> — Ndërtim i lidhjes autentike nga burime të besueshme</li>
  <li><strong>Krijim i Permbajtjes</strong> — Artikuj blog, faqe shërbimesh, tekste SEO-friendly</li>
  <li><strong>Raportim mujor</strong> — Google Search Console, Analytics, raporti i pozicionimeve</li>
</ul>
<h2>NENI 2 — AFATI I REZULTATEVE</h2>
<p>Rezultatet e SEO zakonisht shfaqen pas <strong>3–6 muajve</strong> pune konsistente. Ofruesi nuk garanton pozicion specifik në Google, pasi algoritmet e motorëve të kërkimit ndryshojnë vazhdimisht. Ofruesi garanton zbatimin e praktikave më të mira SEO sipas standardeve të Google.</p>
<h2>NENI 3 — AKSESAT E NEVOJSHME</h2>
<ul>
  <li>Google Search Console (me të drejta të plota)</li>
  <li>Google Analytics 4</li>
  <li>Akses CMS/WordPress (admin)</li>
  <li>Hosting/cPanel (nëse nevojiten ndryshime teknike)</li>
</ul>
<h2>NENI 4 — AFATI DHE PAGESA</h2>
<p>Kontrata me afat minimal <strong>6 muaj</strong> (rekomandohet 12 muaj për rezultate optimale). Pagesa mujore e dakordësuar, brenda datës 5 të çdo muaji.</p>
<p>&nbsp;</p>
<hr>
<p><strong>Ofruesi — ${p.companyName}:</strong> _______________________&nbsp;&nbsp;&nbsp;&nbsp;<strong>Klienti — ${p.clientName}:</strong> _______________________</p>`,
  },

  {
    id: 'nda',
    label: 'Marrëveshje Konfidencialiteti (NDA)',
    description: 'Ruajtja e sekretit tregtar dhe informacioneve konfidenciale',
    getHTML: (p) => `<h1 style="text-align:center">MARRËVESHJE KONFIDENCIALITETI</h1>
<p style="text-align:center"><em>(Non-Disclosure Agreement — NDA)</em></p>
<p style="text-align:center"><em>Nr. ________ / ${year()}</em></p>
<p>&nbsp;</p>
<p>Kjo marrëveshje konfidencialiteti lidhet sot, <strong>${today()}</strong>, ndërmjet:</p>
<p>${providerBlock(p)} ("Pala Zbuluese")</p>
<p>${clientBlock(p)} ("Pala Marrëse")</p>
<p>&nbsp;</p>
<hr>
<h2>NENI 1 — INFORMACIONI KONFIDENCIAL</h2>
<p>"Informacion Konfidencial" nënkupton çdo informacion teknik, tregtar, financiar, strategjik ose të natyrës tjetër, duke përfshirë pa u kufizuar:</p>
<ul>
  <li>Strategjitë e biznesit dhe planet e zhvillimit</li>
  <li>Listën e klientëve, çmimet dhe kushtet e kontratave</li>
  <li>Teknologjinë, kodin burimor dhe metodologjitë e punës</li>
  <li>Informacionet financiare dhe raportet e brendshme</li>
  <li>Çdo informacion tjetër të etiketuar si "Konfidencial"</li>
</ul>
<h2>NENI 2 — DETYRIMET E PALËS MARRËSE</h2>
<ul>
  <li>Të mbajë informacionin konfidencial rreptësisht sekret</li>
  <li>Të mos e zbulojë palëve të treta pa miratim të shkruar paraprak</li>
  <li>Të përdorë informacionin vetëm për qëllimet e bashkëpunimit</li>
  <li>Të marrë masa të arsyeshme sigurie për mbrojtjen e informacionit</li>
</ul>
<h2>NENI 3 — AFATI I DETYRIMEVE</h2>
<p>Detyrimet e konfidencialitetit qëndrojnë në fuqi gjatë gjithë periudhës së bashkëpunimit dhe për <strong>3 (tre) vite</strong> pas përfundimit të tij.</p>
<h2>NENI 4 — PASOJAT E SHKELJES</h2>
<p>Shkelja e kësaj marrëveshjeje i jep të drejtë Palës Zbuluese të kërkojë dëmshpërblim sipas legjislacionit civil shqiptar, si dhe ndërprerjen e menjëhershme të të gjitha marrëdhënieve kontraktuale.</p>
<p>&nbsp;</p>
<hr>
<p><strong>Pala Zbuluese — ${p.companyName}:</strong> _______________________&nbsp;&nbsp;&nbsp;&nbsp;<strong>Pala Marrëse — ${p.clientName}:</strong> _______________________</p>`,
  },

  {
    id: 'maintenance',
    label: 'Kontratë Mirëmbajtjeje & Mbështetjeje',
    description: 'Mirëmbajtje teknike dhe mbështetje e vazhdueshme',
    getHTML: (p) => `<h1 style="text-align:center">KONTRATË MIRËMBAJTJEJE &amp; MBËSHTETJEJE TEKNIKE</h1>
<p style="text-align:center"><em>Nr. ________ / ${year()}</em></p>
<p>&nbsp;</p>
<p>Kjo kontratë lidhet sot, <strong>${today()}</strong>, ndërmjet:</p>
<p>${providerBlock(p)}</p>
<p>${clientBlock(p)}</p>
<p>&nbsp;</p>
<hr>
<h2>NENI 1 — SHËRBIMET E MIRËMBAJTJES</h2>
<ul>
  <li><strong>Mirëmbajtje preventive</strong> — Kontrolle periodike dhe optimizim i sistemeve</li>
  <li><strong>Backup i rregullt</strong> — Kopje rezervë ditore/javore të të dhënave</li>
  <li><strong>Përditësime sigurimi</strong> — Patch-et e sigurisë dhe përditësimet e sistemit</li>
  <li><strong>Monitorim 24/7</strong> — Njoftim i menjëhershëm për probleme teknike</li>
  <li><strong>Mbështetje teknike</strong> — Help desk gjatë orarit të punës (09:00–18:00)</li>
</ul>
<h2>NENI 2 — NIVELET E SHËRBIMIT (SLA)</h2>
<ul>
  <li><strong>Problem kritik (down-time):</strong> Reagim brenda <strong>2 orëve</strong></li>
  <li><strong>Problem i rëndësishëm:</strong> Reagim brenda <strong>4 orëve</strong> gjatë orarit të punës</li>
  <li><strong>Problem i zakonshëm:</strong> Reagim brenda <strong>1 dite pune</strong></li>
</ul>
<h2>NENI 3 — SHËRBIMET JASHTË KONTRATËS</h2>
<p>Zhvillimet e reja dhe ndryshimet e mëdha strukturore <strong>nuk përfshihen</strong> në tarifën e mirëmbajtjes dhe kotizohen veçmas.</p>
<h2>NENI 4 — AFATI DHE RINOVIMI</h2>
<p>Kontrata vlen për <strong>12 muaj</strong> dhe rinovohet automatikisht nëse njëra palë nuk njofton ndërprerjen me 30 ditë paralajmërim.</p>
<p>&nbsp;</p>
<hr>
<p><strong>Ofruesi — ${p.companyName}:</strong> _______________________&nbsp;&nbsp;&nbsp;&nbsp;<strong>Klienti — ${p.clientName}:</strong> _______________________</p>`,
  },
];

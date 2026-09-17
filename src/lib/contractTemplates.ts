import { SEO_ADVANCED_IT_TEMPLATE } from './contractTemplateSeoAdvancedIt';

export interface ContractParties {
  // Provider (our company)
  companyName: string;
  companyAddress: string;
  companyNipt: string;
  companyRep: string;
  companyEmail: string;
  companyPhone: string;
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

const blank = (n = 30) => '_'.repeat(n);
const year = () => new Date().getFullYear();

function providerBlock(p: ContractParties) {
  return `<strong>OFRUESI I SHËRBIMIT:</strong> ${p.companyName}${p.companyAddress ? `, me seli në ${p.companyAddress}` : ''}${p.companyNipt ? `, NIPT: <strong>${p.companyNipt}</strong>` : ''}${p.companyRep ? `, i përfaqësuar nga <strong>${p.companyRep}</strong>` : ''}, hereinafter "<strong>Ofruesi</strong>"`;
}

function clientBlock(p: ContractParties) {
  const co = p.clientCompany ? ` (${p.clientCompany})` : '';
  const nipt = p.clientNipt ? `, NIPT: <strong>${p.clientNipt}</strong>` : '';
  const addr = p.clientAddress ? `, me adresë ${p.clientAddress}` : '';
  return `<strong>KLIENTI:</strong> <strong>${p.clientName}</strong>${co}${nipt}${addr}, hereinafter "<strong>Klienti</strong>"`;
}

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: 'marketing',
    label: 'Kontratë Shërbimi Marketingu',
    description: 'Kontratë profesionale e plotë — 19 nene + aneks',
    getHTML: (p) => `<h1 style="text-align:center">KONTRATË SHËRBIMI MARKETINGU</h1>
<p>Sot, më datë ___ / ___ / 20__, në ____________, palët e mëposhtme, me vullnet të lirë, të plotë dhe të pavesuar, bien dakord të lidhin këtë kontratë shërbimi marketingu, sipas kushteve dhe përcaktimeve të mëposhtme:</p>
<h2>Neni 1</h2>
<p><strong>Palët Kontraktuese</strong></p>
<p><strong>1.1 Ofruesi i Shërbimit</strong></p>
<p><strong>${p.companyName || blank(20)}</strong><br>Përfaqësuar nga: ${p.companyRep || blank(25)}<br>NIPT: ${p.companyNipt || blank(15)}<br>Email: ${p.companyEmail || blank(25)}<br>Telefon: ${p.companyPhone || blank(20)}<br>Adresa: ${p.companyAddress || blank(30)}</p>
<p>Në vijim do të quhet <strong>"Ofruesi i Shërbimit"</strong>.</p>
<p><strong>1.2 Klienti</strong></p>
<p>Emri / Subjekti: <strong>${p.clientName || blank(30)}</strong><br>Përfaqësuesi ligjor: ${blank(30)}<br>NIPT / ID: ${p.clientNipt || blank(30)}<br>Email: ${p.clientEmail || blank(30)}<br>Telefon: ${p.clientPhone || blank(30)}<br>Adresa: ${p.clientAddress || blank(30)}</p>
<p>Në vijim do të quhet <strong>"Klienti"</strong>.</p>
<p>Ofruesi i Shërbimit dhe Klienti, së bashku, do të quhen <strong>"Palët"</strong>.</p>
<h2>Neni 2</h2>
<p><strong>Objekti i Kontratës</strong></p>
<p>2.1 Objekti i kësaj kontrate është ofrimi i shërbimeve profesionale të marketingut nga Ofruesi i Shërbimit për Klientin, sipas nevojave, objektivave dhe marrëveshjes ndërmjet Palëve.</p>
<p>2.2 Shërbimet konkrete që do të ofrohen do të përcaktohen në mënyrë të detajuar në Nenin 3 të kësaj kontrate ose në një aneks të veçantë të nënshkruar nga Palët.</p>
<p>2.3 Kjo kontratë rregullon marrëdhënien ndërmjet Palëve për ofrimin, ekzekutimin, pagesën, dorëzimin, përgjegjësitë, të drejtat dhe detyrimet që lidhen me shërbimet e marketingut.</p>
<h2>Neni 3</h2>
<p><strong>Shërbimet që do të Ofrohen</strong></p>
<p>Ofruesi i Shërbimit do të kryejë për Klientin shërbimet e mëposhtme:</p>
<p><strong>3.1 Shënime mbi shërbimet</strong></p>
<p>Shërbimet mund të përfshijnë, por nuk kufizohen vetëm në:</p>
<ul>
  <li>Menaxhim të rrjeteve sociale;</li>
  <li>Krijim përmbajtjeje vizuale dhe tekstuale;</li>
  <li>Strategji marketingu;</li>
  <li>Fushata reklamuese online;</li>
  <li>Google Ads;</li>
  <li>Meta Ads;</li>
  <li>Krijim dhe optimizim website;</li>
  <li>Branding;</li>
  <li>Dizajne grafike;</li>
  <li>Raportime performance;</li>
  <li>Konsulencë marketingu;</li>
  <li>Shërbime të tjera të dakorduara me shkrim ndërmjet Palëve.</li>
</ul>
<p>3.2 Çdo shërbim që nuk është përfshirë shprehimisht në këtë kontratë ose në anekset e saj, nuk konsiderohet pjesë e detyrimeve të Ofruesit të Shërbimit, përveç rasteve kur Palët bien dakord ndryshe me shkrim.</p>
<h2>Neni 4</h2>
<p><strong>Kohëzgjatja e Kontratës</strong></p>
<p>4.1 Kjo kontratë hyn në fuqi në datën e nënshkrimit nga Palët.</p>
<p>4.2 Kohëzgjatja e kontratës do të jetë:</p>
<p>Nga data: ___ / ___ / 20__<br>Deri më datë: ___ / ___ / 20__</p>
<p>ose</p>
<p>☐ Me afat mujor të përsëritshëm<br>☐ Me afat të pacaktuar<br>☐ Për një projekt të vetëm<br>☐ Tjetër: ${blank(30)}</p>
<p>4.3 Në rast se kontrata është mujore ose me afat të pacaktuar, ajo rinovohet automatikisht, përveç rastit kur njëra Palë njofton tjetrën me shkrim për ndërprerjen e saj sipas Nenit 13 të kësaj kontrate.</p>
<h2>Neni 5</h2>
<p><strong>Pagesa dhe Kushtet Financiare</strong></p>
<p>5.1 Për shërbimet e përcaktuara në këtë kontratë, Klienti do t'i paguajë Ofruesit të Shërbimit shumën:</p>
<p>Vlera mujore / totale: ${blank(25)}<br>Monedha: ${blank(20)}<br>Mënyra e pagesës: ${blank(25)}<br>Data e pagesës: ${blank(20)}</p>
<p>5.2 Pagesa do të kryhet:</p>
<p>☐ Në fillim të muajit<br>☐ Në fund të muajit<br>☐ Para nisjes së projektit<br>☐ Sipas fazave të projektit<br>☐ Tjetër: ${blank(30)}</p>
<p>5.3 Nëse nuk është dakorduar ndryshe me shkrim, pagesa për shërbimet mujore kryhet paraprakisht.</p>
<p>5.4 Buxhetet e reklamave në platforma si Meta, Instagram, Facebook, Google, TikTok, LinkedIn apo platforma të tjera nuk përfshihen në tarifën e shërbimit, përveç rastit kur përcaktohet ndryshe me shkrim.</p>
<p>5.5 Çdo kosto shtesë, përfshirë por pa u kufizuar në pagesa për platforma, hosting, domain, fotografi, video, aktorë, influencerë, produksion, licenca, aplikacione, mjete digjitale apo palë të treta, do të paguhet nga Klienti, përveç rasteve kur Palët bien dakord ndryshe.</p>
<h2>Neni 6</h2>
<p><strong>Detyrimet e Ofruesit të Shërbimit</strong></p>
<p>Ofruesi i Shërbimit merr përsipër:</p>
<p>6.1 Të kryejë shërbimet me profesionalizëm, kujdes dhe në përputhje me standardet e zakonshme të fushës së marketingut.</p>
<p>6.2 Të respektojë afatet e dakorduara, për aq sa Klienti ka dorëzuar në kohë materialet, informacionet dhe miratimet e nevojshme.</p>
<p>6.3 Të informojë Klientin mbi ecurinë e punës, kur kjo kërkohet ose është pjesë e shërbimit të dakorduar.</p>
<p>6.4 Të ruajë konfidencialitetin e të dhënave, informacioneve dhe materialeve të Klientit.</p>
<p>6.5 Të përdorë informacionet dhe materialet e Klientit vetëm për qëllimin e përmbushjes së kësaj kontrate.</p>
<p>6.6 Të mos garantojë rezultate absolute ose të paracaktuara tregtare, pasi performanca e marketingut ndikohet edhe nga faktorë të jashtëm, përfshirë tregun, konkurrencën, buxhetin, ofertën, produktin, sezonin, sjelljen e konsumatorit dhe algoritmet e platformave.</p>
<h2>Neni 7</h2>
<p><strong>Detyrimet e Klientit</strong></p>
<p>Klienti merr përsipër:</p>
<p>7.1 Të dorëzojë në kohë të gjitha informacionet, materialet, akseset, logot, fotot, videot, tekstet, çmimet, ofertat dhe të dhënat e nevojshme për kryerjen e shërbimeve.</p>
<p>7.2 Të sigurojë që materialet e dorëzuara te Ofruesi i Shërbimit nuk cenojnë të drejtat e autorit, markat tregtare, të dhënat personale ose të drejtat e palëve të treta.</p>
<p>7.3 Të japë miratime, komente ose kërkesa për ndryshime brenda një afati të arsyeshëm.</p>
<p>7.4 Të kryejë pagesat sipas afateve të përcaktuara në këtë kontratë.</p>
<p>7.5 Të mos kërkojë nga Ofruesi i Shërbimit kryerjen e veprimeve të paligjshme, mashtruese, diskriminuese, fyese ose në kundërshtim me politikat e platformave digjitale.</p>
<p>7.6 Të mbajë përgjegjësi për saktësinë e informacionit tregtar, ligjor, financiar, teknik ose promocional që i jep Ofruesit të Shërbimit për përdorim në materiale marketingu.</p>
<h2>Neni 8</h2>
<p><strong>Miratimet, Ndryshimet dhe Rishikimet</strong></p>
<p>8.1 Materialet e krijuara nga Ofruesi i Shërbimit do t'i dërgohen Klientit për miratim, kur kjo është e nevojshme ose e dakorduar.</p>
<p>8.2 Klienti ka të drejtë të kërkojë ndryshime të arsyeshme mbi materialet, brenda kufijve të shërbimit të kontraktuar.</p>
<p>8.3 Numri i rishikimeve të përfshira në çmim është: ${blank(10)}</p>
<p>8.4 Çdo ndryshim shtesë, jashtë volumit të dakorduar, mund të faturohet veçmas nga Ofruesi i Shërbimit.</p>
<p>8.5 Nëse Klienti nuk përgjigjet brenda ${blank(5)} ditëve pune nga dërgimi i materialit për miratim, materiali mund të konsiderohet i miratuar, përveç rastit kur Palët bien dakord ndryshe me shkrim.</p>
<h2>Neni 9</h2>
<p><strong>Akseset, Llogaritë dhe Platformat</strong></p>
<p>9.1 Klienti është përgjegjës për sigurimin e aksesit në llogaritë e nevojshme, përfshirë por pa u kufizuar në rrjete sociale, faqe web, Business Manager, Google Ads, Google Analytics, email, hosting, domain ose platforma të tjera.</p>
<p>9.2 Ofruesi i Shërbimit nuk mban përgjegjësi për bllokime, kufizime, pezullime, refuzime reklamash, ndryshime algoritmesh ose vendime të marra nga platformat e palëve të treta.</p>
<p>9.3 Në përfundim të kontratës, Ofruesi i Shërbimit do t'i kthejë ose dorëzojë Klientit akseset përkatëse, për aq sa ato janë administruar nga Ofruesi i Shërbimit.</p>
<h2>Neni 10</h2>
<p><strong>Të Drejtat e Autorit dhe Pronësia Intelektuale</strong></p>
<p>10.1 Materialet e krijuara posaçërisht për Klientin, pasi të jenë paguar plotësisht, i kalojnë Klientit për përdorim sipas qëllimit të kontratës.</p>
<p>10.2 Deri në kryerjen e pagesës së plotë, materialet, konceptet, dizajnet, tekstet, strategjitë dhe çdo punë tjetër e krijuar nga Ofruesi i Shërbimit mbeten pronë e Ofruesit të Shërbimit.</p>
<p>10.3 Ofruesi i Shërbimit ka të drejtë të përdorë punimet e realizuara për Klientin në portofol, prezantime, rrjete sociale ose materiale promocionale të veta, përveç rasteve kur Klienti kërkon ndryshe me shkrim për arsye konfidencialiteti.</p>
<p>10.4 Materialet, metodat, strukturat, proceset, dokumentet e brendshme, strategjitë e përgjithshme dhe njohuritë profesionale të Ofruesit të Shërbimit mbeten pronë e tij dhe nuk transferohen te Klienti.</p>
<h2>Neni 11</h2>
<p><strong>Konfidencialiteti</strong></p>
<p>11.1 Palët detyrohen të ruajnë konfidencialitetin e çdo informacioni tregtar, financiar, teknik, strategjik, organizativ ose profesional që marrin nga njëra-tjetra gjatë zbatimit të kësaj kontrate.</p>
<p>11.2 Informacionet konfidenciale nuk mund të publikohen, kopjohen, shpërndahen ose përdoren për qëllime të tjera pa miratimin paraprak me shkrim të Palës përkatëse.</p>
<p>11.3 Detyrimi për konfidencialitet mbetet në fuqi edhe pas përfundimit të kësaj kontrate.</p>
<h2>Neni 12</h2>
<p><strong>Përgjegjësia dhe Kufizimet</strong></p>
<p>12.1 Ofruesi i Shërbimit është përgjegjës për kryerjen profesionale të shërbimeve të dakorduara, por nuk mban përgjegjësi për rezultate të garantuara financiare, shitje, klikime, rezervime, ndjekës, fitime apo performancë të caktuar, përveç rasteve kur kjo është parashikuar shprehimisht me shkrim.</p>
<p>12.2 Ofruesi i Shërbimit nuk mban përgjegjësi për pasojat që vijnë nga informacione të pasakta, të paplota ose të vonuara të dhëna nga Klienti.</p>
<p>12.3 Ofruesi i Shërbimit nuk mban përgjegjësi për vendime, pezullime, refuzime ose kufizime të vendosura nga platforma të treta.</p>
<p>12.4 Përgjegjësia maksimale financiare e Ofruesit të Shërbimit, në çdo rast, nuk mund të tejkalojë shumën e paguar nga Klienti për muajin ose projektin përkatës ku ka lindur pretendimi.</p>
<h2>Neni 13</h2>
<p><strong>Ndërprerja e Kontratës</strong></p>
<p>13.1 Secila Palë ka të drejtë të kërkojë ndërprerjen e kësaj kontrate duke njoftuar Palën tjetër me shkrim të paktën ${blank(5)} ditë përpara.</p>
<p>13.2 Ofruesi i Shërbimit ka të drejtë të pezullojë ose ndërpresë shërbimet nëse Klienti nuk kryen pagesën brenda afatit të dakorduar.</p>
<p>13.3 Në rast ndërprerjeje të kontratës, Klienti është i detyruar të paguajë të gjitha shërbimet e kryera deri në datën e ndërprerjes.</p>
<p>13.4 Pagesat e kryera për shërbime të nisura, punë të realizuara, rezervime, fushata, strategji, dizajne, materiale ose kohë pune të konsumuar nuk rimbursohen, përveç rasteve kur Palët bien dakord ndryshe me shkrim.</p>
<h2>Neni 14</h2>
<p><strong>Vonesa në Pagesë</strong></p>
<p>14.1 Në rast vonese në pagesë, Ofruesi i Shërbimit ka të drejtë të pezullojë menjëherë shërbimet deri në shlyerjen e plotë të detyrimit.</p>
<p>14.2 Çdo vonesë mbi ${blank(5)} ditë kalendarike konsiderohet shkelje thelbësore e kontratës.</p>
<p>14.3 Në rast vonese të përsëritur, Ofruesi i Shërbimit ka të drejtë të ndërpresë kontratën pa mbajtur përgjegjësi për pasojat që mund të vijnë nga pezullimi ose ndërprerja e shërbimeve.</p>
<h2>Neni 15</h2>
<p><strong>Forca Madhore</strong></p>
<p>15.1 Asnjëra Palë nuk mban përgjegjësi për moszbatim ose vonesë në zbatimin e detyrimeve, kur kjo vjen si pasojë e rrethanave jashtë kontrollit të saj të arsyeshëm, përfshirë fatkeqësi natyrore, luftë, trazira, pandemi, ndërprerje të internetit, ndërprerje të energjisë, vendime shtetërore, bllokime platformash ose ngjarje të tjera të jashtëzakonshme.</p>
<p>15.2 Pala e prekur nga forca madhore duhet të njoftojë Palën tjetër sa më shpejt të jetë e mundur.</p>
<h2>Neni 16</h2>
<p><strong>Marrëdhënia ndërmjet Palëve</strong></p>
<p>16.1 Kjo kontratë nuk krijon marrëdhënie punësimi, ortakërie, përfaqësimi tregtar ekskluziv apo marrëdhënie varësie ndërmjet Palëve.</p>
<p>16.2 Ofruesi i Shërbimit vepron si kontraktor i pavarur dhe organizon punën, stafin, mjetet dhe proceset e veta në mënyrë të pavarur.</p>
<h2>Neni 17</h2>
<p><strong>Mosmarrëveshjet</strong></p>
<p>17.1 Palët do të përpiqen që çdo mosmarrëveshje që lind nga kjo kontratë ta zgjidhin fillimisht me mirëkuptim dhe negociim.</p>
<p>17.2 Në rast se mosmarrëveshja nuk zgjidhet me mirëkuptim, ajo do t'i nënshtrohet gjykatës kompetente sipas legjislacionit në fuqi të Republikës së Shqipërisë.</p>
<p>17.3 Ligji i zbatueshëm për këtë kontratë është ligji shqiptar.</p>
<h2>Neni 18</h2>
<p><strong>Njoftimet</strong></p>
<p>18.1 Çdo njoftim ndërmjet Palëve do të bëhet me shkrim në adresat elektronike ose fizike të përcaktuara në këtë kontratë.</p>
<p>18.2 Njoftimet me email konsiderohen të vlefshme nëse dërgohen në adresat zyrtare të deklaruara nga Palët.</p>
<p>Email i Ofruesit të Shërbimit: ${p.companyEmail || blank(25)}</p>
<p>Email i Klientit: ${p.clientEmail || blank(25)}</p>
<h2>Neni 19</h2>
<p><strong>Dispozita të Fundit</strong></p>
<p>19.1 Kjo kontratë përbën marrëveshjen e plotë ndërmjet Palëve dhe zëvendëson çdo komunikim, ofertë ose marrëveshje të mëparshme, me gojë ose me shkrim, lidhur me objektin e saj.</p>
<p>19.2 Çdo ndryshim ose shtesë në këtë kontratë do të jetë i vlefshëm vetëm nëse bëhet me shkrim dhe nënshkruhet nga të dyja Palët.</p>
<p>19.3 Nëse ndonjë dispozitë e kësaj kontrate rezulton e pavlefshme ose e pazbatueshme, dispozitat e tjera mbeten në fuqi.</p>
<p>19.4 Kjo kontratë hartohet në dy kopje origjinale me të njëjtën fuqi juridike, nga një për secilën Palë.</p>
<hr>
<h2>Nënshkrimet e Palëve</h2>
<p><strong>Ofruesi i Shërbimit</strong></p>
<p>${p.companyName || blank(25)}<br>Përfaqësuar nga: ${p.companyRep || blank(25)}<br><br>Nënshkrimi: ___________________________<br><br>Data: ___ / ___ / 20__<br><br>Vula: _________________________________</p>
<p><strong>Klienti</strong></p>
<p>Emri / Subjekti: ${p.clientName || blank(25)}<br>Përfaqësuesi: ${blank(25)}<br><br>Nënshkrimi: ___________________________<br><br>Data: ___ / ___ / 20__<br><br>Vula: _________________________________</p>
<hr>
<h2>ANEKS 1</h2>
<p><strong>Përshkrimi i Shërbimeve</strong></p>
<p>Ky aneks është pjesë përbërëse e Kontratës së Shërbimit të Marketingut ndërmjet <strong>${p.companyName}</strong> dhe <strong>${p.clientName}</strong>.</p>
<p>Shërbimet e përfshira: ${blank(40)}<br>Afatet e dorëzimit: ${blank(30)}<br>Numri i materialeve / postimeve / fushatave: ${blank(20)}<br>Raportimi: ${blank(30)}<br>Çmimi: ${blank(20)}<br>Shënime të tjera: ${blank(40)}</p>`,
  },

  {
    id: 'service',
    label: 'Kontratë Shërbimi',
    description: 'Kontratë standarde për shërbime të përgjithshme',
    getHTML: (p) => `<h1 style="text-align:center">KONTRATË SHËRBIMI</h1>
<p style="text-align:center"><em>Nr. ________ / ${year()}</em></p>
<p>Kjo kontratë shërbimi lidhet sot, <strong>${new Date().toLocaleDateString('sq-AL', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>, ndërmjet palëve:</p>
<p>${providerBlock(p)}</p>
<p>${clientBlock(p)}</p>
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
</ul>
<p><strong>Klienti detyrohet të:</strong></p>
<ul>
  <li>Kryejë pagesat sipas afateve të dakordësuara</li>
  <li>Ofrojë materialet, akseset dhe informacionet e nevojshme në kohë</li>
</ul>
<h2>NENI 5 — KONFIDENCIALITETI</h2>
<p>Të dyja palët bien dakord të mbajnë rreptësisht konfidenciale çdo informacion të ndarë gjatë bashkëpunimit.</p>
<h2>NENI 6 — NDËRPRERJA</h2>
<p>Secila palë ka të drejtë ta ndërpresë kontratën me njoftim <strong>30-ditor me shkrim</strong>.</p>
<hr>
<p><strong>Ofruesi — ${p.companyName}:</strong> _______________________&nbsp;&nbsp;&nbsp;&nbsp;<strong>Klienti — ${p.clientName}:</strong> _______________________</p>`,
  },

  {
    id: 'seo',
    label: 'Kontratë SEO & Prezencë Online',
    description: 'Optimizim për motorët e kërkimit',
    getHTML: (p) => `<h1 style="text-align:center">KONTRATË SEO &amp; PREZENCË ONLINE</h1>
<p style="text-align:center"><em>Nr. ________ / ${year()}</em></p>
<p>Kjo kontratë lidhet sot, <strong>${new Date().toLocaleDateString('sq-AL', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>, ndërmjet:</p>
<p>${providerBlock(p)}</p>
<p>${clientBlock(p)}</p>
<hr>
<h2>NENI 1 — SHËRBIMET SEO</h2>
<ul>
  <li><strong>Auditim i plotë SEO</strong> — Analizë fillestare e website-it dhe konkurrencës</li>
  <li><strong>Optimizim On-Page</strong> — Meta tags, tituj, permbajtje, struktura URL</li>
  <li><strong>Optimizim teknik</strong> — Shpejtësia e faqes, mobile-friendly, sitemap</li>
  <li><strong>Link Building</strong> — Ndërtim i lidhjes autentike nga burime të besueshme</li>
  <li><strong>Krijim i Permbajtjes</strong> — Artikuj blog, faqe shërbimesh, tekste SEO-friendly</li>
  <li><strong>Raportim mujor</strong> — Google Search Console, Analytics, pozicionime</li>
</ul>
<h2>NENI 2 — AFATI I REZULTATEVE</h2>
<p>Rezultatet e SEO zakonisht shfaqen pas <strong>3–6 muajve</strong> pune konsistente. Ofruesi nuk garanton pozicion specifik në Google. Ofruesi garanton zbatimin e praktikave më të mira SEO sipas standardeve të Google.</p>
<h2>NENI 3 — AKSESAT E NEVOJSHME</h2>
<ul>
  <li>Google Search Console (me të drejta të plota)</li>
  <li>Google Analytics 4</li>
  <li>Akses CMS/WordPress (admin)</li>
  <li>Hosting/cPanel (nëse nevojiten ndryshime teknike)</li>
</ul>
<h2>NENI 4 — AFATI DHE PAGESA</h2>
<p>Kontrata me afat minimal <strong>6 muaj</strong>. Pagesa mujore e dakordësuar, brenda datës 5 të çdo muaji.</p>
<hr>
<p><strong>Ofruesi — ${p.companyName}:</strong> _______________________&nbsp;&nbsp;&nbsp;&nbsp;<strong>Klienti — ${p.clientName}:</strong> _______________________</p>`,
  },

  SEO_ADVANCED_IT_TEMPLATE,

  {
    id: 'nda',
    label: 'Marrëveshje Konfidencialiteti (NDA)',
    description: 'Ruajtja e sekretit tregtar dhe informacioneve konfidenciale',
    getHTML: (p) => `<h1 style="text-align:center">MARRËVESHJE KONFIDENCIALITETI</h1>
<p style="text-align:center"><em>(Non-Disclosure Agreement — NDA) &nbsp; Nr. ________ / ${year()}</em></p>
<p>Kjo marrëveshje lidhet sot, <strong>${new Date().toLocaleDateString('sq-AL', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>, ndërmjet:</p>
<p>${providerBlock(p)} ("Pala Zbuluese")</p>
<p>${clientBlock(p)} ("Pala Marrëse")</p>
<hr>
<h2>NENI 1 — INFORMACIONI KONFIDENCIAL</h2>
<ul>
  <li>Strategjitë e biznesit dhe planet e zhvillimit</li>
  <li>Listën e klientëve, çmimet dhe kushtet e kontratave</li>
  <li>Teknologjinë, kodin burimor dhe metodologjitë e punës</li>
  <li>Informacionet financiare dhe raportet e brendshme</li>
</ul>
<h2>NENI 2 — DETYRIMET E PALËS MARRËSE</h2>
<ul>
  <li>Të mbajë informacionin konfidencial rreptësisht sekret</li>
  <li>Të mos e zbulojë palëve të treta pa miratim të shkruar paraprak</li>
  <li>Të përdorë informacionin vetëm për qëllimet e bashkëpunimit</li>
</ul>
<h2>NENI 3 — AFATI DHE PASOJAT E SHKELJES</h2>
<p>Detyrimet e konfidencialitetit qëndrojnë në fuqi për <strong>3 (tre) vite</strong> pas përfundimit të bashkëpunimit. Shkelja i jep të drejtë Palës Zbuluese të kërkojë dëmshpërblim sipas legjislacionit civil shqiptar.</p>
<hr>
<p><strong>Pala Zbuluese — ${p.companyName}:</strong> _______________________&nbsp;&nbsp;&nbsp;&nbsp;<strong>Pala Marrëse — ${p.clientName}:</strong> _______________________</p>`,
  },

  {
    id: 'maintenance',
    label: 'Kontratë Mirëmbajtjeje & Mbështetjeje',
    description: 'Mirëmbajtje teknike dhe mbështetje e vazhdueshme',
    getHTML: (p) => `<h1 style="text-align:center">KONTRATË MIRËMBAJTJEJE &amp; MBËSHTETJEJE TEKNIKE</h1>
<p style="text-align:center"><em>Nr. ________ / ${year()}</em></p>
<p>Kjo kontratë lidhet sot, <strong>${new Date().toLocaleDateString('sq-AL', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>, ndërmjet:</p>
<p>${providerBlock(p)}</p>
<p>${clientBlock(p)}</p>
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
  <li><strong>Problem kritik:</strong> Reagim brenda <strong>2 orëve</strong></li>
  <li><strong>Problem i rëndësishëm:</strong> Reagim brenda <strong>4 orëve</strong></li>
  <li><strong>Problem i zakonshëm:</strong> Reagim brenda <strong>1 dite pune</strong></li>
</ul>
<h2>NENI 3 — AFATI DHE PAGESA</h2>
<p>Kontrata vlen për <strong>12 muaj</strong> dhe rinovohet automatikisht nëse njëra palë nuk njofton ndërprerjen me 30 ditë paralajmërim.</p>
<hr>
<p><strong>Ofruesi — ${p.companyName}:</strong> _______________________&nbsp;&nbsp;&nbsp;&nbsp;<strong>Klienti — ${p.clientName}:</strong> _______________________</p>`,
  },
];

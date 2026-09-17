import type { ContractParties, ContractTemplate } from './contractTemplates';

/**
 * "Contratto di servizi SEO Advanced & AI Visibility" — the Italian-language
 * contract used for Italian B2B clients (first signed with ACTWO, Sep 2026).
 *
 * Only the PARTIES are templated (provider from teamSettings, client from the
 * CRM record). The commercial terms (dates, fee, duration) are written as the
 * deal was agreed and are meant to be edited in the contract editor per client —
 * they are grouped in `TERMS` below so the defaults are easy to change.
 */
const TERMS = {
  onboarding: "l'ultima settimana di settembre 2026",
  startDate: '1° ottobre 2026',
  endDate: '31 marzo 2027',
  months: '6 (sei)',
  monthsShort: '6',
  monthlyFee: '€800,00',
  monthlyFeeShort: '€800',
  totalFee: '€4.800,00',
  totalFeeShort: '€4.800',
  paymentDays: '7',
  firstInvoiceMonth: 'ottobre 2026',
};

const placeholder = '[●]';
const sig = '__________________________';

const li = (items: string[]) => `<ul>\n${items.map(i => `  <li>${i}</li>`).join('\n')}\n</ul>`;

export const SEO_ADVANCED_IT_TEMPLATE: ContractTemplate = {
  id: 'seo-advanced-it',
  label: 'Contratto SEO Advanced & AI Visibility (IT)',
  description: 'Kontratë në italisht — 32 artikuj + riepilogo commerciale (SEO, GEO/AEO, backlink, reporting)',
  getHTML: (p: ContractParties) => {
    const provider = p.companyName || '[Fornitore]';
    // The contract refers to the client by a short name throughout ("ACTWO").
    const client = p.clientCompany || p.clientName || '[Cliente]';
    const clientFull = p.clientCompany && p.clientName && p.clientCompany !== p.clientName
      ? `${p.clientCompany} (${p.clientName})`
      : client;
    const providerSeat = p.companyAddress || placeholder;
    const providerRep = p.companyRep || placeholder;
    const providerPhone = p.companyPhone || placeholder;
    const clientSeat = p.clientAddress || placeholder;
    const clientVat = p.clientNipt || placeholder;
    const emailLink = p.companyEmail
      ? `<a href="mailto:${p.companyEmail}">${p.companyEmail}</a>`
      : placeholder;

    return `<h1 style="text-align:center">CONTRATTO DI SERVIZI SEO ADVANCED &amp; AI VISIBILITY</h1>
<h2>TRA</h2>
<p><strong>${provider}</strong>, con sede in <strong>${providerSeat}</strong>, rappresentata da <strong>${providerRep}</strong>, di seguito denominata <strong>“Fornitore”</strong> o <strong>“${provider}”</strong>.</p>
<p><strong>Contatti ${provider}:</strong><br>Telefono: <strong>${providerPhone}</strong><br>E-mail: <strong>${emailLink}</strong></p>
<p style="text-align:center">e</p>
<p><strong>${clientFull}</strong>, con sede legale in <strong>${clientSeat}</strong>, P.IVA / numero di registrazione <strong>${clientVat}</strong>, rappresentata da ${placeholder}, di seguito denominata <strong>“Cliente”</strong> o <strong>“${client}”</strong>.</p>
<p>${provider} e ${client} sono di seguito denominate singolarmente la <strong>“Parte”</strong> e congiuntamente le <strong>“Parti”</strong>.</p>
<hr>
<h2>PREMESSE</h2>
<p>Considerato che:</p>
<p>a) ${client} intende rafforzare la propria presenza digitale, aumentare la visibilità organica sui motori di ricerca e sviluppare progressivamente la propria presenza nei nuovi sistemi di ricerca basati sull’Intelligenza Artificiale;</p>
<p>b) ${provider} opera nel settore del digital marketing, SEO, web marketing, performance marketing e sviluppo di strategie di visibilità digitale;</p>
<p>c) a seguito degli incontri intercorsi tra le Parti e della proposta commerciale presentata da ${provider}, ${client} ha confermato la propria volontà di procedere con il servizio;</p>
<p>d) le Parti intendono avviare un percorso strategico della durata minima di <strong>${TERMS.months} mesi</strong>, con inizio operativo fissato al <strong>${TERMS.startDate}</strong>;</p>
<p>e) ${TERMS.onboarding} sarà utilizzata come <strong>fase preparatoria e di onboarding</strong>, finalizzata alla raccolta degli accessi, delle informazioni, dei materiali e dei dati necessari per l’avvio operativo del progetto;</p>
<p>le premesse costituiscono parte integrante e sostanziale del presente Contratto.</p>
<hr>
<h2>ART. 1 – OGGETTO DEL CONTRATTO</h2>
<p>Il presente Contratto disciplina la fornitura da parte di ${provider} di servizi professionali di:</p>
<p><strong>SEO Strategy, Technical SEO, On-Page SEO, Content Optimization, Backlink Analysis, Domain Authority Growth, Competitor Monitoring, AI SEO, GEO, AEO, Analytics, Reporting e consulenza strategica digitale collegata alla presenza organica e ai canali social.</strong></p>
<p>Le attività saranno svolte progressivamente durante l'intero periodo contrattuale, sulla base delle priorità individuate attraverso audit, analisi dei dati, evoluzione del progetto e risultati ottenuti.</p>
<h2>ART. 2 – SEO AUDIT &amp; STRATEGY</h2>
<p>${provider} svolgerà un'analisi iniziale e periodica del progetto SEO di ${client}, comprendente, tra le altre, le seguenti attività:</p>
${li([
  'Audit SEO iniziale;',
  'analisi tecnica del sito;',
  'analisi del posizionamento organico esistente;',
  "analisi della struttura e dell'architettura del sito;",
  'individuazione di errori tecnici;',
  'individuazione di opportunità SEO;',
  'analisi delle principali criticità;',
  'definizione delle priorità operative;',
  'sviluppo della roadmap SEO;',
  'revisione della strategia sulla base dei dati raccolti.',
])}
<p>La roadmap potrà essere modificata durante il progetto qualora i dati, gli aggiornamenti degli algoritmi o le priorità commerciali di ${client} rendano opportuno un diverso ordine di intervento.</p>
<h2>ART. 3 – KEYWORD RESEARCH &amp; SEARCH INTENT</h2>
<p>Il servizio comprenderà:</p>
${li([
  `ricerca delle keyword relative ai servizi e ai settori strategici di ${client};`,
  'analisi delle keyword B2B a maggiore rilevanza commerciale;',
  'analisi del Search Intent;',
  'Keyword Mapping;',
  'ricerca di Long-Tail Keywords;',
  'analisi delle keyword utilizzate dai principali competitor;',
  'individuazione di Content Gap;',
  'individuazione di nuove opportunità di posizionamento;',
  'aggiornamento periodico delle keyword strategiche sulla base delle performance.',
])}
<h2>ART. 4 – ON-PAGE SEO</h2>
<p>${provider} interverrà progressivamente sulle principali pagine strategiche del sito, con attività che potranno comprendere:</p>
${li([
  'Title Tag;',
  'Meta Description;',
  'H1, H2 e H3;',
  'struttura degli URL;',
  'Internal Linking;',
  'ALT Tag delle immagini;',
  'ottimizzazione semantica dei contenuti;',
  'ottimizzazione delle pagine servizio;',
  'miglioramento della rilevanza semantica delle pagine;',
  'ottimizzazione per keyword commerciali;',
  'ottimizzazione per keyword informative;',
  'ottimizzazione della struttura dei contenuti;',
  "miglioramento dell'esperienza di navigazione in funzione SEO.",
])}
<p>Le pagine da ottimizzare saranno definite secondo priorità strategiche e non necessariamente tutte contemporaneamente.</p>
<h2>ART. 5 – TECHNICAL SEO</h2>
<p>Le attività di Technical SEO potranno includere:</p>
${li([
  "analisi dell'indicizzazione;",
  'controllo Google Search Console;',
  'Sitemap XML;',
  'Robots.txt;',
  'Canonical URL;',
  'Redirect;',
  'Errori 404;',
  'contenuti duplicati;',
  'Core Web Vitals;',
  'performance del sito;',
  'Mobile SEO;',
  'struttura HTML;',
  'Structured Data e Schema Markup;',
  'Crawl Budget;',
  'struttura interna dei link;',
  'problemi di scansione;',
  'problemi di indicizzazione;',
  'monitoraggio di eventuali anomalie tecniche.',
])}
<p>Qualora vengano rilevati interventi tecnici che richiedano modifiche strutturali, sviluppo software complesso, modifica di funzionalità custom o interventi non riconducibili alla normale attività SEO, tali interventi potranno essere oggetto di quotazione separata.</p>
<h2>ART. 6 – SEO CONTENT STRATEGY</h2>
<p>${provider} svilupperà una strategia finalizzata a rafforzare progressivamente la rilevanza tematica e l'autorevolezza organica di ${client}.</p>
<p>Le attività potranno comprendere:</p>
${li([
  'identificazione dei Topic Cluster;',
  'pianificazione di contenuti SEO;',
  'ottimizzazione dei contenuti esistenti;',
  'miglioramento delle pagine servizio;',
  'sviluppo e ottimizzazione di FAQ;',
  'identificazione di contenuti informativi;',
  'identificazione di contenuti tecnici;',
  'sviluppo di strutture per Case Study;',
  'individuazione di argomenti ad alto potenziale SEO;',
  'definizione di nuove landing page strategiche;',
  'aggiornamento di contenuti esistenti.',
])}
<p>L'obiettivo è aumentare progressivamente il numero e la qualità delle keyword rilevanti per cui ${client} è presente nei risultati di ricerca.</p>
<p>La quantità delle attività realizzate mensilmente sarà determinata dalle priorità SEO e dalla roadmap del progetto e non da un numero fisso di interventi o contenuti.</p>
<h2>ART. 7 – AI SEO, GEO &amp; AEO</h2>
<p>Una parte specifica del progetto sarà dedicata alla preparazione della presenza digitale di ${client} per l'evoluzione della ricerca online basata sull'Intelligenza Artificiale.</p>
<p>Le attività potranno essere orientate verso piattaforme e sistemi quali:</p>
${li([
  'ChatGPT;',
  'Google AI Overviews;',
  'Gemini;',
  'Perplexity;',
  'Bing Copilot;',
  'altri sistemi AI Search emergenti.',
])}
<p>Il servizio potrà comprendere:</p>
${li([
  '<strong>GEO – Generative Engine Optimization</strong>;',
  '<strong>AEO – Answer Engine Optimization</strong>;',
  'ottimizzazione dei contenuti per AI Search;',
  'strutturazione di contenuti facilmente interpretabili dai sistemi AI;',
  'ottimizzazione di FAQ e risposte dirette;',
  'Entity SEO;',
  "rafforzamento dell'associazione tra brand, competenze, servizi e settori;",
  'Structured Data avanzati;',
  'miglioramento dei segnali relativi a Experience, Expertise, Authoritativeness e Trustworthiness;',
  'miglioramento della struttura informativa del sito;',
  "ottimizzazione finalizzata ad aumentare le possibilità di presenza e citazione nei risultati generati dall'AI;",
  'monitoraggio, quando tecnicamente possibile, della presenza del brand nelle risposte generate dai sistemi AI.',
])}
<h3>Obiettivo</h3>
<p>L'attività sarà finalizzata ad aumentare progressivamente la possibilità che ${client} venga correttamente <strong>riconosciuta, associata, citata o suggerita</strong> dai sistemi AI per argomenti e query pertinenti alla propria attività.</p>
<p>Le Parti riconoscono che ${provider} non controlla gli algoritmi, i modelli linguistici o i criteri utilizzati dalle piattaforme di terze parti e pertanto non può garantire la citazione di ${client} all'interno di una specifica risposta generata dall'AI.</p>
<h2>ART. 8 – BACKLINK &amp; DOMAIN AUTHORITY</h2>
<p>${provider} svolgerà attività di analisi e monitoraggio del profilo backlink del dominio.</p>
<p>Le attività potranno comprendere:</p>
${li([
  'analisi del profilo backlink attuale;',
  'analisi dei backlink dei competitor;',
  'individuazione di opportunità;',
  'monitoraggio dei nuovi backlink;',
  'individuazione di backlink persi;',
  'analisi dei Referring Domains;',
  'monitoraggio della qualità dei backlink;',
  'individuazione di link potenzialmente dannosi;',
  'verifica di link esistenti;',
  "strategie finalizzate a favorire l'acquisizione naturale di backlink;",
  "monitoraggio dell'evoluzione dell'autorevolezza del dominio.",
])}
<h3>Esclusioni</h3>
<p><strong>Non sono incluse nel canone mensile pubblicazioni a pagamento, articoli sponsorizzati, Guest Post, PR digitali a pagamento o acquisto di backlink su portali esterni.</strong></p>
<p>Eventuali attività di questo tipo potranno essere valutate separatamente e realizzate esclusivamente previa approvazione del Cliente.</p>
<h2>ART. 9 – DOMAIN AUTHORITY &amp; BRAND AUTHORITY</h2>
<p>Durante il progetto ${provider} monitorerà progressivamente KPI e metriche rilevanti, che potranno comprendere:</p>
${li([
  'Domain Authority;',
  'Domain Rating;',
  'Referring Domains;',
  'Backlink Profile;',
  'Organic Keywords;',
  'Organic Traffic;',
  'Brand Mentions;',
  'Topical Authority;',
  'ranking delle keyword strategiche;',
  'visibilità organica;',
  'presenza digitale del brand.',
])}
<p>Le Parti riconoscono che alcune metriche, quali Domain Authority e Domain Rating, sono metriche sviluppate da piattaforme di terze parti e non costituiscono metriche ufficiali utilizzate direttamente da Google.</p>
<h2>ART. 10 – COMPETITOR MONITORING</h2>
<p>${provider} potrà monitorare periodicamente i principali competitor di ${client} con particolare riferimento a:</p>
${li([
  'keyword;',
  'ranking organico;',
  'nuovi contenuti;',
  'backlink;',
  'Referring Domains;',
  'Domain Authority;',
  'Domain Rating;',
  'pagine indicizzate;',
  'Content Gap;',
  'opportunità SEO;',
  'strategie di posizionamento;',
  'presenza organica e digitale.',
])}
<p>I competitor prioritari potranno essere definiti congiuntamente dalle Parti e aggiornati durante il progetto.</p>
<h2>ART. 11 – GOOGLE SEARCH CONSOLE, ANALYTICS &amp; MONITORAGGIO</h2>
<p>Quando disponibili e correttamente configurati, saranno utilizzati strumenti quali:</p>
${li([
  'Google Search Console;',
  'Google Analytics 4;',
  'Bing Webmaster Tools;',
  `strumenti professionali SEO utilizzati da ${provider}.`,
])}
<p>Saranno monitorate, ove disponibili:</p>
${li([
  'visite organiche;',
  'impression;',
  'click;',
  'CTR;',
  'keyword;',
  'Landing Page;',
  'ranking;',
  'conversioni SEO;',
  'performance delle pagine;',
  'eventuali anomalie.',
])}
<h2>ART. 12 – STRATEGIA SOCIAL MEDIA</h2>
<p>Come concordato tra le Parti, la componente strategica del progetto potrà includere anche indicazioni relative alla <strong>presenza e alla strategia social di ${client}</strong>, quando queste risultino funzionali al rafforzamento del brand, della Brand Authority, della distribuzione dei contenuti e della strategia SEO/AI.</p>
<p>La consulenza potrà comprendere:</p>
${li([
  'analisi strategica dei canali social;',
  'raccomandazioni sui contenuti;',
  'coordinamento tra contenuti SEO e contenuti social;',
  'individuazione di temi strategici;',
  'suggerimenti per rafforzare Brand Authority ed Expertise;',
  'allineamento della comunicazione digitale con la strategia SEO e AI.',
])}
<h3>Non sono inclusi, salvo accordo separato:</h3>
${li([
  'gestione quotidiana dei profili social;',
  'pubblicazione dei contenuti;',
  'Community Management;',
  'produzione continuativa di grafiche;',
  'produzione foto/video;',
  'gestione operativa delle campagne Meta Ads, LinkedIn Ads o altre campagne social;',
  'budget pubblicitari.',
])}
<p>Eventuali servizi aggiuntivi potranno essere regolati mediante separata proposta commerciale.</p>
<h2>ART. 13 – REPORTING MENSILE</h2>
<p>${provider} fornirà un report periodico sull'andamento del progetto.</p>
<p>Il report potrà includere:</p>
${li([
  'andamento del traffico organico;',
  'crescita delle keyword;',
  'keyword in Top 3;',
  'keyword in Top 10;',
  'keyword in Top 20;',
  'click;',
  'impression;',
  'CTR;',
  'backlink;',
  'Referring Domains;',
  'Domain Authority / Domain Rating;',
  'performance delle principali pagine;',
  'attività realizzate;',
  'visibilità AI, ove misurabile;',
  'criticità rilevate;',
  'opportunità individuate;',
  'priorità operative successive.',
])}
<h2>ART. 14 – OBIETTIVI DEL PROGETTO</h2>
<p>La strategia sarà finalizzata a:</p>
<ol>
  <li>aumentare la visibilità organica di ${client};</li>
  <li>migliorare il posizionamento delle principali pagine servizio;</li>
  <li>aumentare il traffico organico qualificato;</li>
  <li>favorire nuove opportunità commerciali B2B;</li>
  <li>rafforzare nel tempo l'autorevolezza digitale del dominio;</li>
  <li>migliorare la Topical Authority;</li>
  <li>migliorare il profilo backlink;</li>
  <li>aumentare la presenza digitale di ${client} nei nuovi sistemi AI;</li>
  <li>preparare il sito all'evoluzione della ricerca online;</li>
  <li>trasformare progressivamente il sito in un canale continuativo di acquisizione organica.</li>
</ol>
<h2>ART. 15 – FASE PREPARATORIA, DATA DI AVVIO E DURATA</h2>
<p>Durante <strong>${TERMS.onboarding}</strong>, le Parti svolgeranno una fase preliminare di <strong>onboarding e raccolta delle informazioni necessarie all'avvio del progetto</strong>.</p>
<p>Durante tale fase ${provider} potrà richiedere ad ${client}, a titolo esemplificativo:</p>
${li([
  'accessi al sito web e al CMS;',
  'accesso a Google Search Console;',
  'accesso a Google Analytics 4;',
  'accesso a Bing Webmaster Tools;',
  'eventuali account e strumenti digitali rilevanti;',
  'informazioni relative ai principali servizi offerti;',
  'mercati e Paesi prioritari;',
  'target commerciali;',
  'competitor principali;',
  'materiali aziendali;',
  'presentazioni, brochure e documentazione tecnica;',
  'informazioni sui progetti e Case Study;',
  'indicazioni sulle priorità commerciali;',
  "eventuali dati storici utili all'analisi SEO e digitale.",
])}
<p>Questa fase avrà lo scopo di consentire a ${provider} di organizzare correttamente il progetto, raccogliere i dati necessari e predisporre le prime attività operative.</p>
<h3>Data ufficiale di avvio delle attività: ${TERMS.startDate}</h3>
<p>La durata minima del servizio sarà di <strong>${TERMS.months} mesi</strong>, dal:</p>
<p><strong>${TERMS.startDate} al ${TERMS.endDate}.</strong></p>
<p>La fase preparatoria svolta durante ${TERMS.onboarding} <strong>non riduce la durata dei ${TERMS.monthsShort} mesi di servizio</strong> e deve essere considerata come attività preliminare di onboarding necessaria per consentire il corretto avvio operativo del progetto.</p>
<p>Le attività SEO saranno pianificate e sviluppate progressivamente nel corso dell'intero periodo contrattuale.</p>
<p>Alla scadenza del <strong>${TERMS.endDate}</strong>, le Parti potranno concordare per iscritto il rinnovo o la prosecuzione del rapporto.</p>
<p>In assenza di rinnovo concordato, il Contratto terminerà alla naturale scadenza.</p>
<h2>ART. 16 – CORRISPETTIVO</h2>
<p>Per i servizi oggetto del presente Contratto il Cliente riconoscerà a ${provider} il seguente compenso:</p>
<h3>${TERMS.monthlyFee} al mese</h3>
<p>per una durata minima di <strong>${TERMS.monthsShort} mesi</strong>.</p>
<p><strong>Valore complessivo del contratto:</strong></p>
<h3>${TERMS.totalFee}</h3>
<p>oltre eventuali imposte applicabili, ove dovute.</p>
<p>Il corrispettivo comprende:</p>
<p><strong>SEO Strategy + Technical SEO + On-Page SEO + Content Optimization + Backlink Analysis + Domain Authority Growth + AI SEO / GEO / AEO + Monitoring + Reporting + consulenza strategica collegata ai social media.</strong></p>
<h2>ART. 17 – FATTURAZIONE E PAGAMENTI</h2>
<p>La fatturazione avverrà con cadenza <strong>mensile</strong>, a partire dal mese di <strong>${TERMS.firstInvoiceMonth}</strong>.</p>
<p>Il primo pagamento dovrà essere effettuato all'avvio operativo del progetto e comunque secondo quanto indicato nella relativa fattura.</p>
<p>Le fatture successive saranno emesse mensilmente secondo il ciclo concordato tra le Parti.</p>
<p>Salvo diverso accordo riportato in fattura, il pagamento dovrà essere effettuato entro <strong>${TERMS.paymentDays} giorni dalla data di emissione della fattura</strong>.</p>
<p>In caso di ritardo significativo nei pagamenti, ${provider} si riserva il diritto, previa comunicazione al Cliente, di sospendere temporaneamente le attività fino alla regolarizzazione della posizione.</p>
<p>L'eventuale sospensione dovuta a mancato pagamento non comporterà automaticamente l'estensione della durata contrattuale.</p>
<h2>ART. 18 – DURATA MINIMA E RECESSO ANTICIPATO</h2>
<p>Il Cliente riconosce che la tariffa e l'organizzazione del progetto sono state definite sulla base di un impegno minimo di <strong>${TERMS.monthsShort} mesi</strong>.</p>
<p>Pertanto, salvo giusta causa, grave inadempimento di ${provider} o diverso accordo scritto tra le Parti, l'eventuale interruzione anticipata richiesta dal Cliente non elimina gli obblighi economici previsti per il periodo minimo contrattualmente concordato, nei limiti consentiti dalla normativa applicabile.</p>
<p>Qualora ${provider} commetta un grave inadempimento rispetto agli obblighi contrattuali, il Cliente dovrà comunicarlo per iscritto e concedere a ${provider} un termine ragionevole per porvi rimedio.</p>
<h2>ART. 19 – OBBLIGHI DEL CLIENTE</h2>
<p>Per consentire la corretta esecuzione delle attività e rispettare la data di avvio prevista per il <strong>${TERMS.startDate}</strong>, ${client} si impegna a collaborare con ${provider} già durante ${TERMS.onboarding}.</p>
<p>${client} si impegna, in particolare, a fornire tempestivamente, ove disponibili e necessari:</p>
${li([
  'accessi al sito web;',
  'accesso al CMS;',
  'Google Search Console;',
  'Google Analytics;',
  'Bing Webmaster Tools;',
  'eventuali strumenti già utilizzati;',
  'informazioni sui servizi;',
  'documentazione aziendale;',
  'materiali tecnici;',
  'immagini;',
  'informazioni sui mercati target;',
  'indicazioni sui competitor;',
  'Case Study e referenze utili;',
  'informazioni relative alle priorità commerciali;',
  'autorizzazioni necessarie per modifiche e implementazioni.',
])}
<p>${client} si impegna inoltre a fornire feedback e approvazioni in tempi ragionevoli.</p>
<p>Qualora parte delle informazioni o degli accessi richiesti non sia disponibile entro l'inizio delle attività, ${provider} procederà con le attività che potranno essere svolte con i dati disponibili, adeguando la roadmap operativa.</p>
<p>Eventuali ritardi dovuti alla mancata fornitura di accessi, informazioni, materiali o approvazioni da parte del Cliente non saranno considerati inadempimento di ${provider}.</p>
<h2>ART. 20 – NATURA DELLE ATTIVITÀ E ASSENZA DI GARANZIA DI POSIZIONAMENTO</h2>
<p>${client} riconosce che SEO e AI Search dipendono da numerosi fattori esterni non direttamente controllabili da ${provider}, inclusi, a titolo esemplificativo:</p>
${li([
  'algoritmi dei motori di ricerca;',
  'aggiornamenti Google;',
  'attività dei competitor;',
  'modifiche delle piattaforme;',
  'qualità e anzianità del dominio;',
  'comportamento degli utenti;',
  'evoluzione dei sistemi AI;',
  'modifiche tecniche effettuate da soggetti terzi;',
  'disponibilità e interpretazione dei dati da parte dei motori di ricerca.',
])}
<p>${provider} si impegna a svolgere le attività con professionalità, competenza e secondo le migliori pratiche applicabili, ma <strong>non garantisce specifiche posizioni su Google, un determinato volume di traffico, un numero preciso di lead, un valore specifico di Domain Authority/Domain Rating o la citazione garantita da parte di ChatGPT, Google AI, Gemini, Perplexity o altri sistemi AI.</strong></p>
<p>Eventuali previsioni o obiettivi sono da intendersi come obiettivi strategici e non come garanzia di risultato.</p>
<h2>ART. 21 – MODIFICHE DEGLI ALGORITMI E DELLE PIATTAFORME</h2>
<p>Le piattaforme digitali e i motori di ricerca possono modificare algoritmi, sistemi di ranking, criteri di indicizzazione e modalità di presentazione dei risultati senza preavviso.</p>
<p>In tali circostanze ${provider} potrà modificare la strategia operativa al fine di adattarla alle nuove condizioni del mercato e delle piattaforme, mantenendo gli obiettivi generali del presente Contratto.</p>
<h2>ART. 22 – SERVIZI NON INCLUSI</h2>
<p>Salvo specifico accordo scritto, non sono inclusi nel canone:</p>
${li([
  'sviluppo completo o redesign del sito web;',
  'sviluppo di software o funzionalità custom;',
  'acquisto di backlink;',
  'articoli sponsorizzati;',
  'Guest Post a pagamento;',
  'PR digitali a pagamento;',
  'budget pubblicitari;',
  'Google Ads;',
  'Meta Ads;',
  'LinkedIn Ads;',
  'gestione operativa continuativa dei social media;',
  'produzione continuativa di foto e video;',
  'costi di hosting;',
  'licenze software di terze parti acquistate specificamente per il Cliente;',
  'traduzioni professionali massive;',
  'attività aggiuntive non riconducibili allo scope definito dal presente Contratto.',
])}
<p>Eventuali attività aggiuntive saranno preventivamente concordate.</p>
<h2>ART. 23 – PROPRIETÀ INTELLETTUALE</h2>
<p>A seguito del pagamento dei relativi corrispettivi, ${client} potrà utilizzare i contenuti e i materiali sviluppati specificamente per il proprio progetto.</p>
<p>Restano di proprietà esclusiva di ${provider}:</p>
${li([
  'metodologie interne;',
  'framework;',
  'procedure;',
  'sistemi;',
  'template;',
  'strumenti proprietari;',
  'know-how;',
  'processi operativi;',
  'documentazione metodologica generale;',
  'tecnologie sviluppate precedentemente al presente Contratto.',
])}
<h2>ART. 24 – RISERVATEZZA</h2>
<p>Le Parti si impegnano a mantenere riservate tutte le informazioni commerciali, tecniche, strategiche, finanziarie e operative apprese durante la collaborazione.</p>
<p>Tali informazioni non potranno essere comunicate a soggetti terzi se non quando necessario per l'esecuzione del Contratto, per obbligo di legge o previa autorizzazione della Parte interessata.</p>
<p>L'obbligo di riservatezza continuerà anche successivamente alla cessazione del rapporto.</p>
<h2>ART. 25 – PROTEZIONE DEI DATI</h2>
<p>Le Parti si impegnano a rispettare la normativa applicabile in materia di protezione dei dati personali.</p>
<p>Qualora l'esecuzione del servizio comporti un trattamento di dati personali per conto del Cliente tale da richiedere specifici accordi ai sensi della normativa applicabile, le Parti potranno sottoscrivere separatamente la documentazione necessaria.</p>
<h2>ART. 26 – RESPONSABILITÀ</h2>
<p>${provider} sarà responsabile esclusivamente per danni diretti derivanti da dolo o grave inadempimento direttamente imputabile al Fornitore, nei limiti consentiti dalla normativa applicabile.</p>
<p>${provider} non sarà responsabile per interruzioni, penalizzazioni, perdite di dati, modifiche del ranking o altri effetti derivanti da:</p>
${li([
  'piattaforme di terze parti;',
  'hosting provider;',
  'modifiche effettuate dal Cliente o da altri fornitori;',
  'aggiornamenti dei motori di ricerca;',
  'cyber attack;',
  'problemi tecnici esterni;',
  'indisponibilità di API o strumenti esterni;',
  `eventi non ragionevolmente controllabili da ${provider}.`,
])}
<h2>ART. 27 – FORZA MAGGIORE</h2>
<p>Nessuna delle Parti sarà considerata responsabile per l'impossibilità o il ritardo nell'adempimento derivante da eventi di forza maggiore o circostanze ragionevolmente al di fuori del proprio controllo.</p>
<h2>ART. 28 – COMUNICAZIONI</h2>
<p>Le principali comunicazioni operative potranno avvenire tramite:</p>
${li([
  'e-mail;',
  'videoconferenza;',
  'telefono;',
  'strumenti di Project Management concordati;',
  'altri sistemi di comunicazione concordati tra le Parti.',
])}
<p>Per ${provider}, i principali recapiti sono:</p>
<p><strong>E-mail:</strong> ${emailLink}<br><strong>Telefono:</strong> ${providerPhone}</p>
<p>Le comunicazioni relative a variazioni contrattuali, recesso, contestazioni o modifiche economiche dovranno essere effettuate per iscritto.</p>
<h2>ART. 29 – MODIFICHE AL CONTRATTO</h2>
<p>Qualsiasi modifica sostanziale al presente Contratto dovrà essere concordata tra le Parti per iscritto.</p>
<p>Eventuali richieste aggiuntive rispetto allo scope potranno essere oggetto di un nuovo preventivo o di un'integrazione contrattuale.</p>
<h2>ART. 30 – LEGGE APPLICABILE E CONTROVERSIE</h2>
<p>Le Parti si impegnano a tentare preliminarmente una risoluzione amichevole di qualsiasi eventuale controversia relativa all'interpretazione o esecuzione del presente Contratto.</p>
<p>Qualora non sia possibile raggiungere una soluzione amichevole, la legge applicabile e il foro competente saranno:</p>
<p><strong>Legge applicabile:</strong> ${placeholder}</p>
<p><strong>Foro competente:</strong> ${placeholder}</p>
<p>salvo eventuali disposizioni inderogabili di legge.</p>
<h2>ART. 31 – INTERO ACCORDO</h2>
<p>Il presente Contratto, unitamente alla proposta commerciale precedentemente condivisa e alle eventuali integrazioni scritte accettate da entrambe le Parti, rappresenta l'accordo tra ${provider} e ${client} relativamente ai servizi oggetto del rapporto.</p>
<p>In caso di differenze tra comunicazioni commerciali precedenti e il presente Contratto, prevalgono le disposizioni del presente Contratto, salvo diversa indicazione scritta e sottoscritta dalle Parti.</p>
<h2>ART. 32 – ACCETTAZIONE</h2>
<p>Con la sottoscrizione del presente documento, le Parti dichiarano di aver letto, compreso e accettato integralmente il contenuto del Contratto.</p>
<hr>
<h2>PER ${provider.toUpperCase()}</h2>
<p><strong>Nome:</strong> ${providerRep}<br><strong>Ruolo:</strong> CEO / Rappresentante<br><strong>Sede:</strong> ${providerSeat}<br><strong>E-mail:</strong> ${emailLink}<br><strong>Telefono:</strong> ${providerPhone}</p>
<p><strong>Data:</strong> ${sig}</p>
<p><strong>Firma:</strong></p>
<p><br></p>
<hr>
<h2>PER ${client.toUpperCase()}</h2>
<p><strong>Ragione sociale:</strong> ${p.clientCompany || sig}<br><strong>Nome e Cognome:</strong> ${sig}<br><strong>Ruolo:</strong> ${sig}<br><strong>Data:</strong> ${sig}</p>
<p><strong>Firma:</strong></p>
<p><br></p>
<hr>
<h2>RIEPILOGO COMMERCIALE</h2>
<p><strong>Servizio:</strong> SEO Advanced &amp; AI Visibility<br>
<strong>Cliente:</strong> ${client}<br>
<strong>Fase di onboarding:</strong> ${TERMS.onboarding}<br>
<strong>Data di avvio operativo:</strong> ${TERMS.startDate}<br>
<strong>Periodo contrattuale:</strong> ${TERMS.startDate} – ${TERMS.endDate}<br>
<strong>Durata minima:</strong> ${TERMS.monthsShort} mesi<br>
<strong>Canone mensile:</strong> ${TERMS.monthlyFeeShort}<br>
<strong>Investimento complessivo:</strong> ${TERMS.totalFeeShort}<br>
<strong>Fatturazione:</strong> Mensile<br>
<strong>Servizi principali:</strong> SEO Strategy, Technical SEO, On-Page SEO, Content Optimization, Backlink Analysis, Domain Authority Growth, AI SEO / GEO / AEO, Competitor Monitoring, Analytics, Monthly Reporting e consulenza strategica relativa all'integrazione SEO/Social Media.</p>`;
  },
};

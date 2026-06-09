#!/usr/bin/env python3
import re

with open('src/views/landing/WebsiteMaintenanceLandingPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the entire IT object
old_it = r"const IT: Copy = \{[\s\S]*?(?=const COPY:)"
new_it = """const IT: Copy = {
  langName: 'Italiano',
  hero: {
    badge: 'Manutenzione sito web',
    h1: 'Non preoccuparti più del tuo sito',
    sub: 'Patch di sicurezza, backup giornalieri, ottimizzazione velocità e monitoraggio 24/7. La tua tranquillità è la nostra responsabilità.',
    cta: '✓ Proteggi il tuo sito ora',
  },
  problem: {
    kicker: 'Perché la manutenzione è importante',
    title: 'Un sito trascurato è una responsabilità',
    subtitle: '💰 Un sito non funzionante costa molto più della manutenzione stessa.',
    items: [
      { icon: '🔓', title: 'Hacking e malware', desc: 'Software obsoleto è un invito aperto per gli hacker di rubare dati clienti e danneggiare la reputazione.' },
      { icon: '⚡', title: 'Downtime e crash', desc: 'Senza monitoraggio, il server cade. Ogni minuto offline = vendite perse e clienti frustrati.' },
      { icon: '🐌', title: 'Velocità di caricamento', desc: 'Plugin vecchi e file non ottimizzati rallentano il sito. I visitatori se ne vanno in 3 secondi al competitor.' },
      { icon: '📉', title: 'Penalità Google', desc: 'Google penalizza siti lenti e insicuri. Cattiva manutenzione = invisibilità nei risultati di ricerca.' },
    ],
  },
  maintenance: {
    kicker: 'Piani di manutenzione',
    title: 'Scegli il tuo livello di protezione',
    sub: 'Ogni piano include ore di supporto dedicate — quando ti serve, siamo lì. Hai bisogno di più? Siamo una telefonata di distanza.',
    monthly: '/mese',
    choose: 'Scegli questo piano →',
    chosen: '✓ Selezionato',
    note: '✓ Tutti i piani: Monitoraggio 24/7 · Backup sicuri · Riparazioni veloci · Supporto durante l\'orario lavorativo',
    list: [
      {
        id: 'maintenance-starter',
        name: 'Starter',
        tagline: 'Siti nuovi o blog piccoli',
        price: 50,
        badge: 'Ideale per iniziare',
        included: ['✓ Aggiornamenti mensili CMS/plugin', '✓ Backup settimanali sicuri', '✓ Monitoraggio uptime 24/7', '✓ Patch di sicurezza di base', '✓ 3 ore supporto/mese', '✓ Email support durante orario lavoro'],
        excluded: ['Ottimizzazione velocità', 'Supporto premium 24/7', 'Backup giornalieri'],
      },
      {
        id: 'maintenance-basic',
        name: 'Essenziale',
        tagline: 'Aziende in crescita',
        price: 120,
        included: ['✓ Aggiornamenti prioritari', '✓ Backup settimanali + extra mensile', '✓ Monitoraggio uptime e alert', '✓ Hardening sicurezza', '✓ 8 ore supporto/mese', '✓ Report mensile prestazioni'],
        excluded: ['Ottimizzazione avanzata', 'Monitoraggio premium'],
      },
      {
        id: 'maintenance-standard',
        name: 'Professionale',
        tagline: 'Siti web critici per vendite',
        price: 220,
        badge: 'La più scelta dalle aziende',
        popular: true,
        included: ['✓ Tutto da Essenziale, più:', '✓ Backup automatici giornalieri', '✓ Ottimizzazione velocità e SEO mensile', '✓ Audit di sicurezza', '✓ 15 ore supporto/mese', '✓ Chat + email support'],
        excluded: ['Revisionioni contenuti grandi', 'Risposta emergenza 24/7'],
      },
      {
        id: 'maintenance-premium',
        name: 'Enterprise',
        tagline: 'Tempo di inattività zero = non negoziabile',
        price: 420,
        included: ['✓ Tutto da Professionale, più:', '✓ Monitoraggio 24/7 e risposta emergenza', '✓ Ottimizzazione continua e test A/B', '✓ Backup giornalieri con ridondanza', '✓ 28 ore supporto/mese', '✓ Supporto telefonico 24/7 priorità'],
        excluded: [],
      },
    ],
  },
  social: {
    title: 'Fidato da 340+ aziende',
    items: [
      { text: 'Prima della manutenzione, il sito crollava ogni trimestre. Ora funziona perfettamente. Lo stress è sparito.', author: 'Luca Rossi', role: 'Azienda IT, Milano' },
      { text: 'Ho chiamato con un problema urgente. Risolto in 10 minuti. È così che dovrebbe essere il supporto.', author: 'Elena Moretti', role: 'Ristorante Group, Roma' },
      { text: 'Le nostre vendite sono aumentate del 21% dopo l\'ottimizzazione velocità. Migliore ROI che abbiamo mai visto.', author: 'Marco Bianchi', role: 'E-commerce, Firenze' },
    ],
    stats: [
      { number: '340+', label: 'Siti mantenuti' },
      { number: '99.8%', label: 'Uptime medio' },
      { number: '<85m', label: 'Tempo medio fix' },
      { number: '97%', label: 'Tasso retention' },
    ],
  },
  contact: {
    kicker: 'Fine della preoccupazione',
    title: 'Inizia la protezione oggi',
    sub: 'Un piano manutenzione = tranquillità. Non aspettare — ogni giorno di negletto è un giorno di rischio.',
    urgency: '⚠️ Se il tuo sito cade oggi, quante ore di guadagni perdi? Proteggiti adesso.',
    formTitle: 'Inizia manutenzione',
    selected: 'Pacchetto selezionato',
    change: 'Modifica',
    name: 'Nome completo *',
    namePh: 'Nome Cognome',
    email: 'Email *',
    phone: 'Telefono',
    phonePh: '+39 3XX XXX XXXX',
    website: 'URL sito (se disponibile)',
    websitePh: 'https://example.com',
    message: 'Messaggio (opzionale)',
    messagePh: 'Qual è la tua preoccupazione maggiore per il sito?',
    submit: '✓ Sì, voglio protezione',
    submitting: 'Proteggendo...',
    privacy: 'Niente spam. Solo un preventivo personalizzato e un piano di sicurezza.',
    successTitle: 'Perfetto! 🎉',
    successBody: 'La tua richiesta è stata ricevuta. Entro 2 ore, riceverai un piano manutenzione personalizzato per il tuo sito.',
    error: 'Qualcosa è andato storto. Riprova o chiamaci direttamente.',
  },
};

"""

content = re.sub(old_it, new_it, content)

with open('src/views/landing/WebsiteMaintenanceLandingPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Italian section updated successfully")

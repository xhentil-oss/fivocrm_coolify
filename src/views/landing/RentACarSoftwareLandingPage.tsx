import React, { useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   RENTOS — faqe shitjeje për sistemin e menaxhimit të agjencive rent a car.

   Ndryshe nga faqet e tjera në këtë dosje, kjo NUK është ndërtuar me
   Tailwind: dizajni vjen nga një artefakt me CSS të vetin (paletë e errët
   "dhomë kontrolli" + mockup-e të ndritshme të produktit brenda kornizave
   si screenshot). Për ta ruajtur pa e përkthyer klasë-për-klasë, CSS-i
   është i njëjti, por I GJITHË i skopuar nën `.rentos` — pa asnjë rregull
   mbi `html`/`body`/`:root` — që të mos rrjedhë në pjesën tjetër të app-it.
   Nëse shtohet një rregull i re, ruaje prefiksin `.rentos`.
   ═══════════════════════════════════════════════════════════════════════ */
const RENTOS_CSS = `@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&display=swap');

.rentos{
  --ink:      #04141A;
  --ink-2:    #082129;
  --ink-3:    #0D2E37;
  --line:     #17414C;
  --line-2:   #0F3039;
  --teal:     #14A5BC;
  --teal-lo:  #0C7A8C;
  --teal-hi:  #6FD3E2;
  --coral:    #FF7A45;
  --sand:     #EFE7D5;
  --text:     #E4EFF1;
  --muted:    #8CA9B0;
  --muted-2:  #5F8189;
  --ok:       #34C08C;
  --warn:     #F5B33C;
  --bad:      #F0604D;

  --maxw: 1180px;
  --pad: clamp(20px, 5vw, 56px);

  --f-display: "Archivo", "Arial Narrow", system-ui, sans-serif;
  --f-body: "Instrument Sans", system-ui, -apple-system, sans-serif;
  --f-mono: "IBM Plex Mono", ui-monospace, monospace;
}

.rentos *{box-sizing:border-box}
.rentos{scroll-behavior:smooth; -webkit-text-size-adjust:100%}
.rentos{
  margin:0;
  background:var(--ink);
  color:var(--text);
  font-family:var(--f-body);
  font-size:17px;
  line-height:1.62;
  -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
.rentos img{max-width:100%;display:block}
.rentos a{color:inherit}


.rentos .h1, .rentos .h2, .rentos .h3, .rentos .h4{
  font-family:var(--f-display);
  font-weight:800;
  font-stretch:118%;
  letter-spacing:-.022em;
  line-height:1.02;
  margin:0;
  text-wrap:balance;
}
.rentos .h1{font-size:clamp(38px,6.6vw,80px)}
.rentos .h2{font-size:clamp(29px,4.2vw,52px); line-height:1.06}
.rentos .h3{font-size:clamp(21px,2.4vw,30px); line-height:1.14; font-stretch:110%}
.rentos .h4{font-size:19px; font-stretch:105%; letter-spacing:-.01em}
.rentos .lead{font-size:clamp(17px,2vw,21px); color:#BCD2D6; line-height:1.58; max-width:62ch}
.rentos p{margin:0}

.rentos .eyebrow{
  font-family:var(--f-mono);
  font-size:11.5px;
  font-weight:500;
  letter-spacing:.20em;
  text-transform:uppercase;
  color:var(--teal-hi);
  display:flex;
  align-items:center;
  gap:10px;
}
.rentos .eyebrow::before{
  content:"";
  width:22px; height:1px;
  background:var(--teal);
  flex:none;
}
.rentos .eyebrow-coral{color:var(--coral)}
.rentos .eyebrow-coral::before{background:var(--coral)}

.rentos .mono{font-family:var(--f-mono); font-variant-numeric:tabular-nums}


.rentos .wrap{max-width:var(--maxw); margin-inline:auto; padding-inline:var(--pad)}
.rentos .sec{padding-block:clamp(64px,9vw,124px); position:relative}
.rentos .sec-line{border-top:1px solid var(--line-2)}
.rentos .stack{display:flex; flex-direction:column}
.rentos .g8{gap:8px}.rentos .g12{gap:12px}.rentos .g16{gap:16px}.rentos .g20{gap:20px}.rentos .g28{gap:28px}.rentos .g40{gap:40px}.rentos .g56{gap:56px}


.rentos .btn{
  font-family:var(--f-body);
  font-weight:600;
  font-size:16px;
  display:inline-flex;
  align-items:center;
  gap:10px;
  padding:14px 24px;
  border-radius:2px;
  border:1px solid transparent;
  text-decoration:none;
  cursor:pointer;
  transition:transform .16s ease, background .16s ease, border-color .16s ease;
}
.rentos .btn:focus-visible{outline:2px solid var(--teal-hi); outline-offset:3px}
.rentos .btn-primary{background:var(--coral); color:#22150E; border-color:var(--coral)}
.rentos .btn-primary:hover{background:#FF8F62; transform:translateY(-2px)}
.rentos .btn-ghost{background:transparent; color:var(--text); border-color:var(--line)}
.rentos .btn-ghost:hover{border-color:var(--teal); color:var(--teal-hi)}
.rentos .btn-sm{padding:10px 18px; font-size:14.5px}


.rentos .nav{
  position:sticky; top:0; z-index:60;
  background:rgba(4,20,26,.86);
  backdrop-filter:blur(14px);
  border-bottom:1px solid var(--line-2);
}
.rentos .nav-in{
  max-width:var(--maxw); margin-inline:auto; padding:13px var(--pad);
  display:flex; align-items:center; gap:28px;
}
.rentos .logo{
  font-family:var(--f-display); font-weight:900; font-stretch:125%;
  font-size:19px; letter-spacing:.02em; text-decoration:none;
  display:flex; align-items:center; gap:9px;
}
.rentos .logo-dot{width:9px;height:9px;background:var(--coral);border-radius:50%;flex:none}
.rentos .nav-links{display:flex; gap:26px; margin-left:auto; font-size:14.5px; color:var(--muted)}
.rentos .nav-links a{text-decoration:none; transition:color .15s}
.rentos .nav-links a:hover{color:var(--teal-hi)}
@media(max-width:900px){.rentos .nav-links{display:none} .rentos .nav .btn{margin-left:auto}}


.rentos .hero{position:relative; overflow:hidden; padding-block:clamp(56px,8vw,96px) clamp(48px,6vw,72px)}
.rentos .hero-glow{
  position:absolute; inset:-30% -10% auto -10%; height:720px;
  background:radial-gradient(60% 60% at 50% 0%, rgba(20,165,188,.22), transparent 70%);
  pointer-events:none;
}
.rentos .hero-grid-bg{
  position:absolute; inset:0;
  background-image:linear-gradient(var(--line-2) 1px,transparent 1px),linear-gradient(90deg,var(--line-2) 1px,transparent 1px);
  background-size:64px 64px;
  mask-image:radial-gradient(70% 55% at 50% 12%, #000 0%, transparent 78%);
  opacity:.5; pointer-events:none;
}
.rentos .hero-in{position:relative}
.rentos .hero h1 .accent{color:var(--coral)}
.rentos .hero-cta{display:flex; flex-wrap:wrap; gap:14px; align-items:center}
.rentos .hero-note{font-size:14px; color:var(--muted-2)}

.rentos .ticker{
  display:flex; flex-wrap:wrap; gap:8px 0;
  border-top:1px solid var(--line-2); border-bottom:1px solid var(--line-2);
  padding-block:14px; margin-top:8px;
}
.rentos .ticker span{
  font-family:var(--f-mono); font-size:12px; letter-spacing:.06em;
  color:var(--muted); padding-inline:18px;
  border-right:1px solid var(--line-2);
}
.rentos .ticker span:first-child{padding-left:0}
.rentos .ticker span:last-child{border-right:0}
.rentos .ticker b{color:var(--teal-hi); font-weight:600}


.rentos .shot{
  margin:0;
  border:1px solid var(--line);
  border-radius:8px;
  background:var(--ink-2);
  box-shadow:0 30px 70px -30px rgba(0,0,0,.9), 0 0 0 1px rgba(20,165,188,.07), 0 0 90px -50px rgba(20,165,188,.5);
  overflow:hidden;
}
.rentos .shot-chrome{
  display:flex; align-items:center; gap:10px;
  padding:9px 13px;
  background:#061B22;
  border-bottom:1px solid var(--line-2);
}
.rentos .dots{display:flex; gap:6px}
.rentos .dots i{width:9px;height:9px;border-radius:50%;background:#1D4A55;display:block}
.rentos .shot-url{
  font-family:var(--f-mono); font-size:11px; color:var(--muted-2);
  background:#04141A; border:1px solid var(--line-2);
  border-radius:3px; padding:3px 12px; flex:1; text-align:center;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.rentos .shot-scroll{overflow-x:auto; overflow-y:hidden}
.rentos .shot-cap{
  font-family:var(--f-mono); font-size:11.5px; letter-spacing:.05em;
  color:var(--muted-2); padding:10px 14px;
  border-top:1px solid var(--line-2); background:#061B22;
}


.rentos .ui{
  --p-bg:#F3EDE0; --p-card:#FFFFFF; --p-fg:#0B3138; --p-mut:#65868C;
  --p-pri:#0FA0B2; --p-acc:#FF8552; --p-bd:#DED7C7; --p-side:#0A2F37;
  --p-ok:#1E9E76; --p-warn:#E9A317; --p-bad:#DC3B2C;
  background:var(--p-bg); color:var(--p-fg);
  font-family:var(--f-body); font-size:12.5px; line-height:1.45;
  min-width:760px;
  display:grid; grid-template-columns:168px 1fr;
}
.rentos .ui-full{grid-template-columns:1fr}
.rentos .ui-side{background:var(--p-side); color:#CFE6EA; padding:14px 0}
.rentos .ui-brand{
  font-family:var(--f-display); font-weight:900; font-stretch:120%; font-size:14px;
  color:#fff; padding:0 16px 14px; display:flex; align-items:center; gap:7px;
}
.rentos .ui-brand i{width:7px;height:7px;background:var(--p-acc);border-radius:50%;display:block}
.rentos .ui-nav{display:flex; flex-direction:column; gap:1px}
.rentos .ui-nav a{
  padding:7px 16px; font-size:12px; color:#9FC2C9; text-decoration:none;
  display:flex; align-items:center; gap:9px; border-left:2px solid transparent;
}
.rentos .ui-nav a.on{background:rgba(15,160,178,.20); color:#fff; border-left-color:var(--p-pri); font-weight:600}
.rentos .ui-nav .sep{
  font-family:var(--f-mono); font-size:9px; letter-spacing:.14em; text-transform:uppercase;
  color:#4E757D; padding:12px 16px 4px;
}
.rentos .ui-main{padding:16px 18px; display:flex; flex-direction:column; gap:14px; min-width:0}
.rentos .ui-top{display:flex; align-items:center; gap:12px; flex-wrap:wrap}
.rentos .ui-title{font-family:var(--f-display); font-weight:800; font-stretch:110%; font-size:17px; letter-spacing:-.01em}
.rentos .ui-sub{font-size:11.5px; color:var(--p-mut)}
.rentos .ui-spacer{margin-left:auto}
.rentos .ui-btn{
  background:var(--p-pri); color:#fff; border-radius:3px; padding:6px 12px;
  font-size:11.5px; font-weight:600; display:inline-flex; align-items:center; gap:6px;
}
.rentos .ui-btn.alt{background:#fff; color:var(--p-fg); border:1px solid var(--p-bd)}
.rentos .ui-btn.acc{background:var(--p-acc); color:#2A1508}
.rentos .ui-search{
  background:#fff; border:1px solid var(--p-bd); border-radius:3px;
  padding:6px 11px; font-size:11.5px; color:var(--p-mut); min-width:180px;
}

.rentos .ui-kpis{display:grid; grid-template-columns:repeat(4,1fr); gap:10px}
.rentos .kpi{background:var(--p-card); border:1px solid var(--p-bd); border-radius:4px; padding:11px 12px; display:flex; flex-direction:column; gap:3px}
.rentos .kpi .lab{font-size:10.5px; color:var(--p-mut); text-transform:uppercase; letter-spacing:.07em; font-family:var(--f-mono)}
.rentos .kpi .val{font-family:var(--f-display); font-weight:800; font-stretch:108%; font-size:23px; letter-spacing:-.02em; font-variant-numeric:tabular-nums}
.rentos .kpi .dl{font-size:10.5px; font-weight:600}
.rentos .up{color:var(--p-ok)} .rentos .dn{color:var(--p-bad)}

.rentos .ui-card{background:var(--p-card); border:1px solid var(--p-bd); border-radius:4px; overflow:hidden}
.rentos .ui-card-h{
  padding:9px 12px; border-bottom:1px solid var(--p-bd);
  display:flex; align-items:center; gap:9px;
  font-weight:600; font-size:12px;
}
.rentos .ui-card-h .tag{
  margin-left:auto; font-family:var(--f-mono); font-size:10px; color:var(--p-mut);
  text-transform:uppercase; letter-spacing:.08em;
}
.rentos .ui-card-b{padding:12px}

.rentos .ui-cols{display:grid; grid-template-columns:1.55fr 1fr; gap:10px}

.rentos table.ui-tb{width:100%; border-collapse:collapse; font-size:11.5px}
.rentos .ui-tb th{
  text-align:left; font-family:var(--f-mono); font-size:9.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--p-mut); font-weight:500;
  padding:7px 12px; border-bottom:1px solid var(--p-bd); background:#FAF7EF; white-space:nowrap;
}
.rentos .ui-tb td{padding:8px 12px; border-bottom:1px solid #EDE7DA; vertical-align:middle; white-space:nowrap}
.rentos .ui-tb tr:last-child td{border-bottom:0}
.rentos .ui-tb .num{font-family:var(--f-mono); font-variant-numeric:tabular-nums; font-weight:600}
.rentos .who{display:flex; align-items:center; gap:8px}
.rentos .av{
  width:22px;height:22px;border-radius:50%;flex:none;
  background:linear-gradient(135deg,#0FA0B2,#0A2F37); color:#fff;
  font-size:9.5px; font-weight:700; display:grid; place-items:center;
  font-family:var(--f-mono);
}
.rentos .sub{font-size:10px; color:var(--p-mut)}

.rentos .pill{
  display:inline-flex; align-items:center; gap:5px;
  font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase;
  font-family:var(--f-mono);
  padding:3px 8px; border-radius:99px;
}
.rentos .pill::before{content:""; width:5px;height:5px;border-radius:50%; background:currentColor}
.rentos .p-ok{background:rgba(30,158,118,.13); color:#157A5B}
.rentos .p-wait{background:rgba(233,163,23,.15); color:#9C6C05}
.rentos .p-live{background:rgba(15,160,178,.14); color:#08707E}
.rentos .p-bad{background:rgba(220,59,44,.12); color:#B32C1F}
.rentos .p-off{background:#EFEADD; color:#7A8B8E}


.rentos .cal{display:grid; grid-template-columns:repeat(7,1fr); border-left:1px solid var(--p-bd); border-top:1px solid var(--p-bd)}
.rentos .cal .dow{
  font-family:var(--f-mono); font-size:9.5px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--p-mut); padding:6px 7px; background:#FAF7EF;
  border-right:1px solid var(--p-bd); border-bottom:1px solid var(--p-bd);
}
.rentos .cal .cell{
  min-height:60px; padding:5px 6px; background:#fff;
  border-right:1px solid var(--p-bd); border-bottom:1px solid var(--p-bd);
  display:flex; flex-direction:column; gap:3px;
}
.rentos .cal .cell.dim{background:#F7F3E9; color:#B3AE9F}
.rentos .cal .d{font-family:var(--f-mono); font-size:10px; color:var(--p-mut)}
.rentos .cal .cell.today .d{background:var(--p-pri); color:#fff; border-radius:3px; padding:0 5px; align-self:flex-start; font-weight:700}
.rentos .bar{
  font-size:9.5px; font-weight:600; color:#fff; border-radius:2px;
  padding:2px 5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.rentos .bar.b1{background:#0FA0B2} .rentos .bar.b2{background:#FF8552; color:#2A1508} .rentos .bar.b3{background:#1E9E76} .rentos .bar.b4{background:#3F6E7A}


.rentos .rule{display:flex; align-items:center; gap:11px; padding:10px 12px; border-bottom:1px solid #EDE7DA; background:#fff}
.rentos .rule:last-child{border-bottom:0}
.rentos .rule-ic{
  width:30px;height:30px;border-radius:4px;flex:none; display:grid; place-items:center;
  font-family:var(--f-mono); font-size:11px; font-weight:700;
  background:rgba(15,160,178,.11); color:#08707E;
}
.rentos .rule-ic.acc{background:rgba(255,133,82,.16); color:#B44A16}
.rentos .rule-nm{font-weight:600; font-size:12px}
.rentos .rule-mt{font-size:10.5px; color:var(--p-mut); font-family:var(--f-mono)}
.rentos .rule-val{font-family:var(--f-display); font-weight:800; font-size:16px; margin-left:auto; font-variant-numeric:tabular-nums}
.rentos .tgl{width:30px;height:17px;border-radius:99px;background:var(--p-pri);position:relative;flex:none}
.rentos .tgl::after{content:"";position:absolute;top:2px;right:2px;width:13px;height:13px;border-radius:50%;background:#fff}
.rentos .tgl.off{background:#CFC8B8}
.rentos .tgl.off::after{right:auto;left:2px}


.rentos .exp{display:flex; align-items:center; gap:11px; padding:9px 12px; border-bottom:1px solid #EDE7DA; background:#fff}
.rentos .exp:last-child{border-bottom:0}
.rentos .exp-stripe{width:3px; align-self:stretch; border-radius:2px; flex:none}
.rentos .s-bad{background:var(--p-bad)} .rentos .s-warn{background:var(--p-warn)} .rentos .s-ok{background:var(--p-ok)}
.rentos .exp-nm{font-weight:600; font-size:12px}
.rentos .plate{
  font-family:var(--f-mono); font-size:9.5px; letter-spacing:.08em; font-weight:600;
  border:1px solid var(--p-bd); border-radius:2px; padding:1px 5px; color:var(--p-mut); background:#FAF7EF;
}
.rentos .exp-days{margin-left:auto; text-align:right}
.rentos .exp-days .n{font-family:var(--f-display); font-weight:800; font-size:15px; font-variant-numeric:tabular-nums}


.rentos .meter{height:5px; background:#E9E3D5; border-radius:99px; overflow:hidden}
.rentos .meter i{display:block; height:100%; border-radius:99px; background:var(--p-pri)}
.rentos .meter i.acc{background:var(--p-acc)}


.rentos .pub{background:#F3EDE0; min-width:760px; font-family:var(--f-body); color:#0B3138}
.rentos .pub-nav{display:flex; align-items:center; gap:18px; padding:11px 20px; background:#fff; border-bottom:1px solid #DED7C7; font-size:11.5px}
.rentos .pub-nav .lg{font-family:var(--f-display); font-weight:900; font-stretch:120%; font-size:14px}
.rentos .pub-nav .ln{color:#65868C}
.rentos .langs{margin-left:auto; display:flex; gap:5px}
.rentos .langs span{font-family:var(--f-mono); font-size:9.5px; border:1px solid #DED7C7; border-radius:2px; padding:2px 6px; color:#65868C}
.rentos .langs span.on{background:#0FA0B2; color:#fff; border-color:#0FA0B2; font-weight:600}
.rentos .pub-hero{padding:26px 20px; display:flex; flex-direction:column; gap:14px; background:linear-gradient(160deg,#0A2F37,#0FA0B2)}
.rentos .pub-hero h3{font-family:var(--f-display); font-weight:800; font-stretch:112%; font-size:26px; color:#fff; margin:0; letter-spacing:-.02em}
.rentos .pub-hero p{color:#BFE6EC; font-size:12px; max-width:46ch}
.rentos .srch{background:#fff; border-radius:5px; padding:11px; display:grid; grid-template-columns:1.2fr 1fr 1fr auto; gap:9px; box-shadow:0 12px 30px -14px rgba(0,0,0,.5)}
.rentos .fld{display:flex; flex-direction:column; gap:2px; border-right:1px solid #EDE7DA; padding-right:9px}
.rentos .fld:last-of-type{border-right:0}
.rentos .fld .l{font-family:var(--f-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:#65868C}
.rentos .fld .v{font-size:12px; font-weight:600}
.rentos .pub-cars{display:grid; grid-template-columns:repeat(3,1fr); gap:11px; padding:16px 20px}
.rentos .ccard{background:#fff; border:1px solid #DED7C7; border-radius:5px; overflow:hidden}
.rentos .cimg{height:66px; background:linear-gradient(135deg,#DCE9EB,#F0E9DA); display:grid; place-items:center; border-bottom:1px solid #EDE7DA}
.rentos .cbody{padding:9px 11px; display:flex; flex-direction:column; gap:6px}
.rentos .cname{font-weight:700; font-size:12.5px}
.rentos .cspecs{display:flex; gap:8px; font-size:10px; color:#65868C; font-family:var(--f-mono)}
.rentos .cprice{display:flex; align-items:baseline; gap:5px; margin-top:2px}
.rentos .cprice b{font-family:var(--f-display); font-weight:800; font-size:18px}
.rentos .cprice s{color:#A8A093; font-size:11px}
.rentos .cprice span{font-size:10px; color:#65868C}


.rentos .pain-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(258px,1fr)); gap:1px; background:var(--line-2); border:1px solid var(--line-2)}
.rentos .pain{background:var(--ink); padding:24px 22px; display:flex; flex-direction:column; gap:9px}
.rentos .pain-n{font-family:var(--f-mono); font-size:11px; color:var(--bad); letter-spacing:.1em}
.rentos .pain h4{font-family:var(--f-display); font-weight:700; font-stretch:106%; font-size:17.5px; margin:0; letter-spacing:-.01em}
.rentos .pain p{font-size:14.5px; color:var(--muted); line-height:1.55}


.rentos .split{display:grid; grid-template-columns:1fr 1fr; gap:clamp(24px,4vw,56px); align-items:center}
.rentos .split-wide{grid-template-columns:1fr 1.28fr}
.rentos .split-rev .split-a{order:2}
@media(max-width:940px){
  .rentos .split, .rentos .split-wide{grid-template-columns:1fr}
  .rentos .split-rev .split-a{order:0}
}


.rentos .flist{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:11px}
.rentos .flist li{display:flex; gap:11px; font-size:15.5px; color:#C6DADE; line-height:1.5}
.rentos .flist li::before{
  content:""; width:6px; height:6px; margin-top:9px; flex:none;
  background:var(--teal); transform:rotate(45deg);
}
.rentos .flist b{color:var(--text); font-weight:600}


.rentos .arch{display:grid; grid-template-columns:1fr auto 1fr; gap:0; align-items:stretch; border:1px solid var(--line-2)}
.rentos .arch-col{padding:26px 24px; display:flex; flex-direction:column; gap:14px}
.rentos .arch-mid{
  width:1px; background:var(--line-2); position:relative;
}
.rentos .arch-mid::after{
  content:"⇄"; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  background:var(--ink); color:var(--teal); padding:8px 6px; font-size:16px;
}
.rentos .arch-tag{font-family:var(--f-mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted-2)}
.rentos .chips{display:flex; flex-wrap:wrap; gap:7px}
.rentos .chip{
  font-family:var(--f-mono); font-size:11.5px; letter-spacing:.03em;
  border:1px solid var(--line); border-radius:2px; padding:5px 10px; color:#B4CBD0;
}
.rentos .chip-hot{border-color:rgba(255,122,69,.45); color:var(--coral)}
@media(max-width:820px){
  .rentos .arch{grid-template-columns:1fr}
  .rentos .arch-mid{width:auto; height:1px}
  .rentos .arch-mid::after{padding:4px 8px; transform:translate(-50%,-50%) rotate(90deg)}
}


.rentos .mod{display:flex; flex-direction:column; gap:26px}
.rentos .mod + .mod{margin-top:clamp(56px,7vw,96px); padding-top:clamp(56px,7vw,96px); border-top:1px solid var(--line-2)}
.rentos .mod-head{display:grid; grid-template-columns:1fr 1fr; gap:clamp(20px,4vw,52px); align-items:end}
@media(max-width:860px){.rentos .mod-head{grid-template-columns:1fr; align-items:start}}


.rentos .calc{
  border:1px solid var(--line); background:linear-gradient(180deg,var(--ink-2),var(--ink));
  padding:clamp(22px,3.5vw,38px);
  display:grid; grid-template-columns:1fr 1fr; gap:clamp(24px,4vw,48px);
}
@media(max-width:880px){.rentos .calc{grid-template-columns:1fr}}
.rentos .ctrl{display:flex; flex-direction:column; gap:7px}
.rentos .ctrl-top{display:flex; align-items:baseline; gap:10px}
.rentos .ctrl-lab{font-size:14.5px; color:var(--muted)}
.rentos .ctrl-val{margin-left:auto; font-family:var(--f-display); font-weight:800; font-size:21px; color:var(--teal-hi); font-variant-numeric:tabular-nums}
.rentos input[type=range]{
  -webkit-appearance:none; appearance:none; width:100%; height:3px;
  background:var(--line); border-radius:99px; outline:none; margin:8px 0;
}
.rentos input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none; width:19px; height:19px; border-radius:50%;
  background:var(--coral); border:3px solid var(--ink); cursor:pointer;
  box-shadow:0 0 0 1px var(--coral);
}
.rentos input[type=range]::-moz-range-thumb{
  width:15px; height:15px; border-radius:50%; background:var(--coral);
  border:3px solid var(--ink); cursor:pointer; box-shadow:0 0 0 1px var(--coral);
}
.rentos input[type=range]:focus-visible{box-shadow:0 0 0 3px rgba(20,165,188,.35)}
.rentos .calc-out{display:flex; flex-direction:column; gap:16px; justify-content:center}
.rentos .out-row{display:flex; align-items:baseline; gap:14px; border-bottom:1px dashed var(--line-2); padding-bottom:12px}
.rentos .out-lab{font-size:14.5px; color:var(--muted)}
.rentos .out-val{margin-left:auto; font-family:var(--f-display); font-weight:800; font-size:clamp(22px,3vw,30px); font-variant-numeric:tabular-nums; letter-spacing:-.02em}
.rentos .out-big{
  background:rgba(255,122,69,.09); border:1px solid rgba(255,122,69,.32);
  padding:16px 18px; display:flex; flex-direction:column; gap:2px;
}
.rentos .out-big .out-val{color:var(--coral); font-size:clamp(30px,5vw,46px)}
.rentos .calc-note{font-size:12.5px; color:var(--muted-2); line-height:1.5}


.rentos .steps{display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:1px; background:var(--line-2); border:1px solid var(--line-2)}
.rentos .step{background:var(--ink); padding:26px 22px; display:flex; flex-direction:column; gap:10px; position:relative}
.rentos .step-n{
  font-family:var(--f-display); font-weight:900; font-stretch:125%; font-size:44px;
  line-height:1; color:transparent; -webkit-text-stroke:1px var(--line);
}
.rentos .step h4{font-family:var(--f-display); font-weight:700; font-stretch:106%; font-size:17px; margin:0}
.rentos .step p{font-size:14.5px; color:var(--muted); line-height:1.55}
.rentos .step .when{font-family:var(--f-mono); font-size:11px; color:var(--teal); letter-spacing:.07em; text-transform:uppercase}


.rentos .plans{display:grid; grid-template-columns:repeat(3,1fr); gap:16px}
@media(max-width:940px){.rentos .plans{grid-template-columns:1fr}}
.rentos .plan{
  border:1px solid var(--line-2); background:var(--ink-2);
  padding:26px 24px; display:flex; flex-direction:column; gap:16px;
}
.rentos .plan-hot{border-color:var(--coral); background:linear-gradient(180deg,rgba(255,122,69,.07),var(--ink-2)); position:relative}
.rentos .plan-badge{
  position:absolute; top:-1px; right:-1px;
  background:var(--coral); color:#22150E;
  font-family:var(--f-mono); font-size:10px; font-weight:600; letter-spacing:.11em;
  text-transform:uppercase; padding:5px 11px;
}
.rentos .plan-nm{font-family:var(--f-mono); font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--teal-hi)}
.rentos .plan-hot .plan-nm{color:var(--coral)}
.rentos .plan-price{display:flex; align-items:baseline; gap:7px}
.rentos .plan-price b{font-family:var(--f-display); font-weight:900; font-stretch:112%; font-size:clamp(34px,4.5vw,44px); letter-spacing:-.03em}
.rentos .plan-price span{font-size:14px; color:var(--muted)}
.rentos .plan-for{font-size:14px; color:var(--muted); border-bottom:1px solid var(--line-2); padding-bottom:14px}
.rentos .plan ul{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; flex:1}
.rentos .plan li{font-size:14.5px; color:#C6DADE; display:flex; gap:9px; line-height:1.45}
.rentos .plan li::before{content:"→"; color:var(--teal); flex:none; font-family:var(--f-mono); font-size:13px}
.rentos .plan .btn{justify-content:center; width:100%}


.rentos .faq{border-top:1px solid var(--line-2)}
.rentos .faq details{border-bottom:1px solid var(--line-2)}
.rentos .faq summary{
  cursor:pointer; list-style:none;
  padding:19px 40px 19px 0; position:relative;
  font-family:var(--f-display); font-weight:700; font-stretch:104%;
  font-size:clamp(16.5px,2vw,20px); letter-spacing:-.01em;
}
.rentos .faq summary::-webkit-details-marker{display:none}
.rentos .faq summary::after{
  content:"+"; position:absolute; right:6px; top:50%; transform:translateY(-50%);
  color:var(--teal); font-family:var(--f-mono); font-size:20px; font-weight:400;
}
.rentos .faq details[open] summary::after{content:"–"}
.rentos .faq summary:focus-visible{outline:2px solid var(--teal-hi); outline-offset:2px}
.rentos .faq .ans{padding:0 48px 20px 0; color:var(--muted); font-size:15.5px; line-height:1.62; max-width:70ch}


.rentos .proof{display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:1px; background:var(--line-2); border:1px solid var(--line-2)}
.rentos .pf{background:var(--ink); padding:22px 20px; display:flex; flex-direction:column; gap:4px}
.rentos .pf b{font-family:var(--f-display); font-weight:900; font-stretch:112%; font-size:clamp(28px,3.6vw,38px); letter-spacing:-.03em; color:var(--teal-hi)}
.rentos .pf span{font-size:13.5px; color:var(--muted); line-height:1.4}


.rentos .final{
  border:1px solid var(--line); position:relative; overflow:hidden;
  background:linear-gradient(150deg,var(--ink-3),var(--ink) 62%);
  padding:clamp(32px,6vw,68px);
}
.rentos .final::before{
  content:""; position:absolute; inset:auto -20% -60% 40%; height:420px;
  background:radial-gradient(50% 50% at 50% 50%, rgba(255,122,69,.16), transparent 70%);
  pointer-events:none;
}
.rentos .final-in{position:relative; display:flex; flex-direction:column; gap:24px; max-width:760px}
.rentos .contact-row{display:flex; flex-wrap:wrap; gap:12px}
.rentos .cbtn{
  display:flex; align-items:center; gap:11px; text-decoration:none;
  border:1px solid var(--line); padding:13px 18px; border-radius:2px;
  transition:border-color .15s, transform .15s;
}
.rentos .cbtn:hover{border-color:var(--teal); transform:translateY(-2px)}
.rentos .cbtn .k{font-family:var(--f-mono); font-size:10.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--muted-2); display:block}
.rentos .cbtn .v{font-size:15.5px; font-weight:600}


.rentos .foot{border-top:1px solid var(--line-2); padding-block:34px; color:var(--muted-2); font-size:13.5px}
.rentos .foot-in{display:flex; flex-wrap:wrap; gap:16px; align-items:center; justify-content:space-between}


.rentos .rv{opacity:0; transform:translateY(18px); transition:opacity .7s cubic-bezier(.22,.7,.3,1), transform .7s cubic-bezier(.22,.7,.3,1)}
.rentos .rv.in{opacity:1; transform:none}
@media(prefers-reduced-motion:reduce){
  .rentos .rv{opacity:1; transform:none; transition:none}
  .rentos{scroll-behavior:auto}
}

/* ============================================================
   SHTESA për montimin brenda FivoCRM (nuk ishin në artefakt):
   scroll i qetë, menu mobile në ngjyrat e faqes, formulari i demos.
   ============================================================ */
html:has(.rentos){scroll-behavior:smooth}
.rentos{min-height:100vh}

.rentos .nav-burger{
  display:none; align-items:center; gap:8px; margin-left:10px;
  background:transparent; color:var(--text); border:1px solid var(--line);
  border-radius:2px; padding:9px 12px; cursor:pointer;
  font-family:var(--f-mono); font-size:11.5px; letter-spacing:.14em; text-transform:uppercase;
}
.rentos .nav-burger:focus-visible{outline:2px solid var(--teal-hi); outline-offset:2px}
.rentos .nav-mobile{display:none}
@media(max-width:900px){
  .rentos .nav-burger{display:inline-flex}
  .rentos .nav-mobile.open{
    display:flex; flex-direction:column;
    border-top:1px solid var(--line-2); background:rgba(4,20,26,.97);
  }
  .rentos .nav-mobile a{
    padding:14px var(--pad); text-decoration:none; font-size:16px;
    border-bottom:1px solid var(--line-2); color:var(--text);
  }
}

.rentos .frm{display:grid; grid-template-columns:1fr 1fr; gap:13px}
.rentos .frm .full{grid-column:1 / -1}
.rentos .frm label{
  display:flex; flex-direction:column; gap:6px;
  font-family:var(--f-mono); font-size:10.5px; letter-spacing:.13em;
  text-transform:uppercase; color:var(--muted-2);
}
.rentos .frm input, .rentos .frm textarea, .rentos .frm select{
  width:100%; background:rgba(4,20,26,.55); border:1px solid var(--line);
  border-radius:2px; color:var(--text); font-family:var(--f-body);
  font-size:16px; padding:11px 13px;
}
.rentos .frm textarea{resize:vertical; min-height:88px}
.rentos .frm input:focus, .rentos .frm textarea:focus, .rentos .frm select:focus{
  outline:none; border-color:var(--teal);
}
.rentos .frm-sep{border-top:1px solid var(--line-2); padding-top:24px}
.rentos .frm-err{color:var(--bad); font-size:14.5px}
.rentos .frm-ok{
  border:1px solid rgba(52,192,140,.45); background:rgba(52,192,140,.08);
  padding:20px 22px; display:flex; flex-direction:column; gap:8px;
}
.rentos .frm-ok b{font-family:var(--f-display); font-stretch:110%; font-size:20px}
@media(max-width:640px){.rentos .frm{grid-template-columns:1fr}}
`;

/** Plani Pro × 12 — baza e llogaritjes së kursimit në kalkulator. */
const SYSTEM_YEAR_COST = 249 * 12;
const eur = (n: number) => `${Math.round(n).toLocaleString('de-DE')} €`;

const NAV_LINKS = [
  { href: '#problemi', label: 'Problemi' },
  { href: '#sistemi', label: 'Sistemi' },
  { href: '#llogarit', label: 'Llogarit kursimin' },
  { href: '#cmimet', label: 'Çmimet' },
  { href: '#pyetje', label: 'Pyetje' },
];

export default function RentACarSoftwareLandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  /* Kalkulatori i komisioneve */
  const [bookings, setBookings] = useState(60);
  const [avgValue, setAvgValue] = useState(280);
  const [portalShare, setPortalShare] = useState(45);
  const [portalFee, setPortalFee] = useState(18);

  const yearRevenue = bookings * avgValue * 12;
  const commission = yearRevenue * (portalShare / 100) * (portalFee / 100);
  /* Supozim konservator: vetëm gjysma e rezervimeve zhvendoset në faqen e klientit. */
  const netSaving = commission * 0.5 - SYSTEM_YEAR_COST;

  /* Formulari i demos */
  const [formData, setFormData] = useState({ name: '', company: '', email: '', phone: '', fleet: '', message: '' });
  const [formSent, setFormSent] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'RENTOS — Sistem menaxhimi për agjenci rent a car | FivoCRM';
  }, []);

  /* Zbulimi gradual i seksioneve (klasa `.rv` vjen bashkë me CSS-in e artefaktit). */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('.rv'));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach(el => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    items.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(''); setSubmitting(true);
    try {
      const res = await fetch('/api/landing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          company: formData.company,
          message: [formData.fleet && `Flota: ${formData.fleet} makina`, formData.message].filter(Boolean).join(' — '),
          packageId: 'rentos-demo',
          packageName: 'RENTOS — demo 20 minuta',
          source: 'RENTOS Landing Page',
          category: 'Software',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Diçka shkoi keq');
      setFormSent(true);
    } catch (err: any) {
      setFormError(err.message || 'Diçka shkoi keq. Provoni përsëri.');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="rentos" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: RENTOS_CSS }} />

      {/* ═══ NAV ═══ */}
      <nav className="nav">
        <div className="nav-in">
          <a className="logo" href="#top"><span className="logo-dot"></span>RENTOS</a>
          <div className="nav-links">
            {NAV_LINKS.map(l => <a key={l.href} href={l.href}>{l.label}</a>)}
          </div>
          <a className="btn btn-primary btn-sm" href="#demo">Rezervo demo</a>
          <button
            type="button"
            className="nav-burger"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Mbyll menunë' : 'Hap menunë'}
            onClick={() => setMenuOpen(o => !o)}
          >
            {menuOpen ? '✕ Mbyll' : '☰ Menu'}
          </button>
        </div>
        <div className={`nav-mobile${menuOpen ? ' open' : ''}`}>
          {NAV_LINKS.map(l => (
            <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>{l.label}</a>
          ))}
        </div>
      </nav>

      {/* ═══ HERO · PROBLEMI · ARKITEKTURA · MODULET ═══ */}


      <header className="hero" id="top">
        <div className="hero-grid-bg"></div>
        <div className="hero-glow"></div>
        <div className="wrap hero-in stack g40">

          <div className="stack g20 rv">
            <div className="eyebrow">Software për agjenci rent a car · Shqipëri</div>
            <h1 className="h1">Flota jote.<br />Rezervimet e tua.<br /><span className="accent">Zero komisione.</span></h1>
            <p className="lead">
              Një sistem i vetëm që zëvendëson Excel-in, fletoren dhe varësinë nga portalet:
              <b>faqe publike me rezervim online në 5 gjuhë</b> + <b>panel administrimi me 18 module</b>
              për flotën, çmimet, faturat dhe raportet. I ndërtuar dhe i përdorur çdo ditë në tregun shqiptar.
            </p>
            <div className="hero-cta">
              <a className="btn btn-primary" href="#demo">Rezervo një demo 20-minutëshe</a>
              <a className="btn btn-ghost" href="#sistemi">Shiko sistemin nga brenda ↓</a>
            </div>
            <p className="hero-note">Demo live mbi të dhënat e tua · pa prezantim me slide · pa detyrim</p>
          </div>

          <div className="ticker rv">
            <span><b>18</b> module admin</span>
            <span><b>5</b> gjuhë</span>
            <span><b>7</b> lloje rregullash çmimi</span>
            <span>import nga <b>VikRentCar</b></span>
            <span>hosting-u &amp; të dhënat <b>tuajat</b></span>
          </div>


          <figure className="shot rv">
            <div className="shot-chrome">
              <div className="dots"><i></i><i></i><i></i></div>
              <div className="shot-url">agjencia-juaj.al/admin/dashboard</div>
            </div>
            <div className="shot-scroll">
              <div className="ui">
                <aside className="ui-side">
                  <div className="ui-brand"><i></i>ADMIN</div>
                  <nav className="ui-nav">
                    <a className="on">▦ Dashboard</a>
                    <a>▤ Rezervime</a>
                    <a>▧ Kalendari</a>
                    <a>◈ Makinat</a>
                    <a>◍ Klientët</a>
                    <span className="sep">Operacione</span>
                    <a>⚙ Flota</a>
                    <a>€ Financa</a>
                    <a>% Çmimet</a>
                    <a>✦ Ekstrat</a>
                    <span className="sep">Marketing</span>
                    <a>↗ Raporte</a>
                    <a>✎ Blogu</a>
                    <a>★ Vlerësimet</a>
                  </nav>
                </aside>
                <main className="ui-main">
                  <div className="ui-top">
                    <div>
                      <div className="ui-title">Dashboard</div>
                      <div className="ui-sub">Gusht 2026 · përditësuar tani</div>
                    </div>
                    <div className="ui-spacer"></div>
                    <span className="ui-search">Kërko rezervim, klient, targë…</span>
                    <span className="ui-btn">+ Rezervim i ri</span>
                  </div>

                  <div className="ui-kpis">
                    <div className="kpi"><span className="lab">Makina totale</span><span className="val">34</span><span className="dl up">28 aktive · 6 servis</span></div>
                    <div className="kpi"><span className="lab">Rezervime aktive</span><span className="val">41</span><span className="dl up">▲ 12 këtë javë</span></div>
                    <div className="kpi"><span className="lab">Të ardhura (muaj)</span><span className="val">18.740 €</span><span className="dl up">▲ 23% vs korrik</span></div>
                    <div className="kpi"><span className="lab">Shkalla e zënies</span><span className="val">82%</span><span className="dl up">▲ 9 pikë</span></div>
                  </div>

                  <div className="ui-cols">
                    <div className="ui-card">
                      <div className="ui-card-h">Të ardhurat · 12 javët e fundit <span className="tag">EUR</span></div>
                      <div className="ui-card-b">
                        <svg viewBox="0 0 520 132" width="100%" height="132" role="img" aria-label="Grafik i të ardhurave javore në rritje">
                          <defs>
                            <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#0FA0B2" stopOpacity=".34"/>
                              <stop offset="100%" stopColor="#0FA0B2" stopOpacity="0"/>
                            </linearGradient>
                          </defs>
                          <g stroke="#EDE7DA" strokeWidth="1">
                            <line x1="0" y1="26" x2="520" y2="26"/><line x1="0" y1="60" x2="520" y2="60"/>
                            <line x1="0" y1="94" x2="520" y2="94"/><line x1="0" y1="126" x2="520" y2="126"/>
                          </g>
                          <path d="M0,108 L47,101 L94,104 L141,88 L188,79 L235,84 L282,62 L329,50 L376,54 L423,33 L470,24 L520,17 L520,132 L0,132 Z" fill="url(#ga)"/>
                          <path d="M0,108 L47,101 L94,104 L141,88 L188,79 L235,84 L282,62 L329,50 L376,54 L423,33 L470,24 L520,17"
                                fill="none" stroke="#0FA0B2" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>
                          <circle cx="520" cy="17" r="4.5" fill="#FF8552" stroke="#fff" strokeWidth="2"/>
                        </svg>
                      </div>
                    </div>
                    <div className="ui-card">
                      <div className="ui-card-h">Nga vijnë klientët <span className="tag">30 ditë</span></div>
                      <div className="ui-card-b" style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                        <div><div style={{ display: 'flex', fontSize: '11px' }}><span>Itali</span><span className="num" style={{ marginLeft: 'auto' }}>31%</span></div><div className="meter"><i style={{ width: '31%' }}></i></div></div>
                        <div><div style={{ display: 'flex', fontSize: '11px' }}><span>Gjermani</span><span className="num" style={{ marginLeft: 'auto' }}>24%</span></div><div className="meter"><i style={{ width: '24%' }}></i></div></div>
                        <div><div style={{ display: 'flex', fontSize: '11px' }}><span>Kosovë</span><span className="num" style={{ marginLeft: 'auto' }}>18%</span></div><div className="meter"><i style={{ width: '18%' }}></i></div></div>
                        <div><div style={{ display: 'flex', fontSize: '11px' }}><span>Shqipëri</span><span className="num" style={{ marginLeft: 'auto' }}>15%</span></div><div className="meter"><i className="acc" style={{ width: '15%' }}></i></div></div>
                        <div><div style={{ display: 'flex', fontSize: '11px' }}><span>Të tjera</span><span className="num" style={{ marginLeft: 'auto' }}>12%</span></div><div className="meter"><i style={{ width: '12%' }}></i></div></div>
                      </div>
                    </div>
                  </div>

                  <div className="ui-card">
                    <div className="ui-card-h">Rezervimet e fundit <span className="tag">live</span></div>
                    <table className="ui-tb">
                      <thead><tr><th>Klienti</th><th>Makina</th><th>Marrja</th><th>Kthimi</th><th>Burimi</th><th>Statusi</th><th>Totali</th></tr></thead>
                      <tbody>
                        <tr>
                          <td><div className="who"><span className="av">MR</span><div><div>Marco Rossi</div><div className="sub">Rinas · fluturimi W6 3021</div></div></div></td>
                          <td>VW Golf 8 <span className="plate">AA 421 KT</span></td>
                          <td className="num">22 Gsh · 09:30</td><td className="num">29 Gsh · 18:00</td>
                          <td><span className="pill p-live">Web</span></td>
                          <td><span className="pill p-ok">Konfirmuar</span></td>
                          <td className="num">385 €</td>
                        </tr>
                        <tr>
                          <td><div className="who"><span className="av">LK</span><div><div>Lena Krüger</div><div className="sub">Tiranë qendër</div></div></div></td>
                          <td>Toyota C-HR <span className="plate">AA 907 LR</span></td>
                          <td className="num">23 Gsh · 12:00</td><td className="num">27 Gsh · 12:00</td>
                          <td><span className="pill p-live">Web</span></td>
                          <td><span className="pill p-wait">Në pritje</span></td>
                          <td className="num">268 €</td>
                        </tr>
                        <tr>
                          <td><div className="who"><span className="av">AH</span><div><div>Arben Hoxha</div><div className="sub">Klient i përsëritur · 7 qira</div></div></div></td>
                          <td>Dacia Duster <span className="plate">AA 118 MM</span></td>
                          <td className="num">24 Gsh · 08:00</td><td className="num">31 Gsh · 20:00</td>
                          <td><span className="pill p-off">Telefon</span></td>
                          <td><span className="pill p-ok">Konfirmuar</span></td>
                          <td className="num">301 €</td>
                        </tr>
                        <tr>
                          <td><div className="who"><span className="av">SD</span><div><div>Sophie Dubois</div><div className="sub">Rinas · ulëse fëmije ×1</div></div></div></td>
                          <td>Fiat 500 <span className="plate">AA 552 NB</span></td>
                          <td className="num">25 Gsh · 15:45</td><td className="num">28 Gsh · 10:00</td>
                          <td><span className="pill p-live">Web</span></td>
                          <td><span className="pill p-ok">Konfirmuar</span></td>
                          <td className="num">174 €</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </main>
              </div>
            </div>
            <figcaption className="shot-cap">PANELI KRYESOR — të ardhurat, zënia e flotës dhe rezervimet e fundit në një ekran</figcaption>
          </figure>

        </div>
      </header>


      <section className="sec sec-line" id="problemi">
        <div className="wrap stack g40">
          <div className="stack g16 rv" style={{ maxWidth: '64ch' }}>
            <div className="eyebrow eyebrow-coral">Ku po humbet paraja</div>
            <h2 className="h2">Sezoni mbaron. Ti nuk e di saktë sa fitove.</h2>
            <p className="lead">Nëse të paktën tre nga këto pika të duken të njohura, problemi nuk është puna — është mjeti me të cilin e mban.</p>
          </div>

          <div className="pain-grid rv">
            <div className="pain">
              <div className="pain-n">01</div>
              <h4>15–25% shkojnë te portalet</h4>
              <p>Për çdo rezervim që vjen nga një portal, një çerek i fitimit largohet para se makina të lëvizë. Dhe klienti mbetet i tyre, jo i yti.</p>
            </div>
            <div className="pain">
              <div className="pain-n">02</div>
              <h4>Mbi-rezervime dhe telefonata</h4>
              <p>Disponueshmëria jeton në kokën e dikujt ose në një Excel të hapur në dy kompjuterë. Një dyfishim në gusht ta prish emrin për vite.</p>
            </div>
            <div className="pain">
              <div className="pain-n">03</div>
              <h4>Një çmim fiks gjithë vitin</h4>
              <p>Gushti kushton sa nëntori. Nuk ka rregull sezoni, as zbritje për qira të gjatë, as çmim më të lartë në fundjavë. Paraja lihet mbi tavolinë.</p>
            </div>
            <div className="pain">
              <div className="pain-n">04</div>
              <h4>Sigurimi skadon pa lajmërim</h4>
              <p>Kolaudimi, sigurimi dhe servisi mbahen mend me kujtesë. E merr vesh nga gjoba, ose nga makina që nuk niset ditën e marrjes.</p>
            </div>
            <div className="pain">
              <div className="pain-n">05</div>
              <h4>Faturat dhe depozitat “në kokë”</h4>
              <p>Kush ka paguar? Sa depozitë mbahet? Cila faturë është e hapur? Përgjigja kërkon 20 minuta kërkim nëpër dosje dhe chat-e.</p>
            </div>
            <div className="pain">
              <div className="pain-n">06</div>
              <h4>Klienti i huaj largohet</h4>
              <p>Gjermani, italiani dhe francezi kërkojnë në gjuhën e tyre. Nëse faqja jote nuk shfaqet atje ku kërkojnë, ata rezervojnë te tjetri.</p>
            </div>
          </div>
        </div>
      </section>


      <section className="sec sec-line" id="sistemi">
        <div className="wrap stack g40">
          <div className="stack g16 rv" style={{ maxWidth: '64ch' }}>
            <div className="eyebrow">Zgjidhja</div>
            <h2 className="h2">Dy gjysma që punojnë si një.</h2>
            <p className="lead">
              Klienti rezervon vetë në faqen tënde. Rezervimi shfaqet menjëherë në panel, makina bllokohet
              në kalendar, fatura krijohet dhe email-i niset — pa asnjë hap manual.
            </p>
          </div>

          <div className="arch rv">
            <div className="arch-col">
              <span className="arch-tag">Përpara — çfarë sheh klienti</span>
              <h3 className="h3">Faqja publike</h3>
              <div className="chips">
                <span className="chip">Kërkim &amp; disponueshmëri live</span>
                <span className="chip">Rezervim online 24/7</span>
                <span className="chip chip-hot">5 gjuhë</span>
                <span className="chip">Faqe SEO për çdo kategori</span>
                <span className="chip">Blog</span>
                <span className="chip">Vlerësime + Google Reviews</span>
                <span className="chip">Llogaria ime</span>
                <span className="chip">WhatsApp float</span>
                <span className="chip">Chat</span>
                <span className="chip">Cookie consent (GDPR)</span>
              </div>
            </div>
            <div className="arch-mid"></div>
            <div className="arch-col">
              <span className="arch-tag">Prapa — çfarë kontrollon ti</span>
              <h3 className="h3">Paneli i administrimit</h3>
              <div className="chips">
                <span className="chip">Rezervime</span>
                <span className="chip">Kalendar</span>
                <span className="chip">Makinat</span>
                <span className="chip">Klientët</span>
                <span className="chip chip-hot">Çmime dinamike</span>
                <span className="chip">Flota &amp; mirëmbajtja</span>
                <span className="chip">Financa &amp; fatura</span>
                <span className="chip">Depozita</span>
                <span className="chip">Ekstrat</span>
                <span className="chip">Tarifa mujore</span>
                <span className="chip">Raporte</span>
                <span className="chip">Media</span>
                <span className="chip">Blog</span>
                <span className="chip">Përdorues &amp; role</span>
                <span className="chip">Import CSV</span>
                <span className="chip">Cilësimet</span>
              </div>
            </div>
          </div>
        </div>
      </section>


      <section className="sec sec-line">
        <div className="wrap">


          <article className="mod rv">
            <div className="mod-head">
              <div className="stack g16">
                <div className="eyebrow">Rezervime &amp; kalendar</div>
                <h3 className="h3">Nuk dyfishohet asnjë makinë. Kurrë.</h3>
              </div>
              <ul className="flist">
                <li><b>Disponueshmëria llogaritet vetë</b> nga sasia e çdo modeli — nëse ke 3 Golf-a, sistemi lejon saktësisht 3.</li>
                <li><b>Orari i marrjes dhe i kthimit</b>, numri i fluturimit dhe lokacioni ruhen për çdo rezervim.</li>
                <li>Statuset <b>Në pritje → Konfirmuar → Përfunduar</b> me email automatik në çdo hap.</li>
                <li>Rezervim manual nga telefoni ose sporteli në 20 sekonda.</li>
              </ul>
            </div>

            <figure className="shot">
              <div className="shot-chrome"><div className="dots"><i></i><i></i><i></i></div><div className="shot-url">agjencia-juaj.al/admin/calendar</div></div>
              <div className="shot-scroll">
                <div className="ui ui-full">
                  <main className="ui-main">
                    <div className="ui-top">
                      <div><div className="ui-title">Kalendari · Gusht 2026</div><div className="ui-sub">Gjithsej këtë muaj: 63 rezervime</div></div>
                      <div className="ui-spacer"></div>
                      <span className="pill p-ok">41 Konfirmuara</span>
                      <span className="pill p-wait">14 Në pritje</span>
                      <span className="pill p-off">8 Përfunduar</span>
                      <span className="ui-btn alt">‹ Korrik</span><span className="ui-btn alt">Shtator ›</span>
                    </div>
                    <div className="cal">
                      <div className="dow">Hën</div><div className="dow">Mar</div><div className="dow">Mër</div><div className="dow">Enj</div><div className="dow">Pre</div><div className="dow">Sht</div><div className="dow">Die</div>

                      <div className="cell dim"><span className="d">27</span></div>
                      <div className="cell dim"><span className="d">28</span></div>
                      <div className="cell dim"><span className="d">29</span></div>
                      <div className="cell dim"><span className="d">30</span></div>
                      <div className="cell dim"><span className="d">31</span></div>
                      <div className="cell"><span className="d">1</span><span className="bar b1">Golf 8 · Rossi</span></div>
                      <div className="cell"><span className="d">2</span><span className="bar b1">Golf 8 · Rossi</span><span className="bar b3">Duster · Hoxha</span></div>

                      <div className="cell"><span className="d">3</span><span className="bar b1">Golf 8 · Rossi</span><span className="bar b3">Duster · Hoxha</span></div>
                      <div className="cell"><span className="d">4</span><span className="bar b3">Duster · Hoxha</span><span className="bar b2">C-HR · Krüger</span></div>
                      <div className="cell"><span className="d">5</span><span className="bar b2">C-HR · Krüger</span><span className="bar b4">Fiat 500 · Dubois</span></div>
                      <div className="cell"><span className="d">6</span><span className="bar b2">C-HR · Krüger</span><span className="bar b4">Fiat 500 · Dubois</span></div>
                      <div className="cell"><span className="d">7</span><span className="bar b2">C-HR · Krüger</span><span className="bar b1">Passat · Weber</span></div>
                      <div className="cell"><span className="d">8</span><span className="bar b1">Passat · Weber</span><span className="bar b3">Duster · Marku</span></div>
                      <div className="cell"><span className="d">9</span><span className="bar b1">Passat · Weber</span><span className="bar b3">Duster · Marku</span></div>

                      <div className="cell"><span className="d">10</span><span className="bar b3">Duster · Marku</span></div>
                      <div className="cell"><span className="d">11</span><span className="bar b4">Yaris · Petit</span></div>
                      <div className="cell"><span className="d">12</span><span className="bar b4">Yaris · Petit</span><span className="bar b1">Golf 8 · Nushi</span></div>
                      <div className="cell"><span className="d">13</span><span className="bar b1">Golf 8 · Nushi</span><span className="bar b2">Tiguan · Lopez</span></div>
                      <div className="cell"><span className="d">14</span><span className="bar b2">Tiguan · Lopez</span><span className="bar b3">C-HR · Bauer</span></div>
                      <div className="cell"><span className="d">15</span><span className="bar b2">Tiguan · Lopez</span><span className="bar b3">C-HR · Bauer</span></div>
                      <div className="cell"><span className="d">16</span><span className="bar b3">C-HR · Bauer</span></div>

                      <div className="cell today"><span className="d">21</span><span className="bar b1">Golf 8 · Rossi</span><span className="bar b2">C-HR · Krüger</span></div>
                      <div className="cell"><span className="d">22</span><span className="bar b1">Golf 8 · Rossi</span><span className="bar b3">Duster · Hoxha</span></div>
                      <div className="cell"><span className="d">23</span><span className="bar b1">Golf 8 · Rossi</span><span className="bar b2">C-HR · Krüger</span></div>
                      <div className="cell"><span className="d">24</span><span className="bar b3">Duster · Hoxha</span><span className="bar b4">Fiat 500 · Dubois</span></div>
                      <div className="cell"><span className="d">25</span><span className="bar b4">Fiat 500 · Dubois</span><span className="bar b1">Passat · Weber</span></div>
                      <div className="cell"><span className="d">26</span><span className="bar b1">Passat · Weber</span><span className="bar b3">Duster · Hoxha</span></div>
                      <div className="cell"><span className="d">27</span><span className="bar b3">Duster · Hoxha</span><span className="bar b2">C-HR · Krüger</span></div>
                    </div>
                  </main>
                </div>
              </div>
              <figcaption className="shot-cap">KALENDARI — çdo makinë, çdo ditë, një pamje e vetme</figcaption>
            </figure>
          </article>


          <article className="mod rv">
            <div className="mod-head">
              <div className="stack g16">
                <div className="eyebrow">Çmime dinamike</div>
                <h3 className="h3">Çmimi që ndryshon vetë, si te portalet e mëdha.</h3>
              </div>
              <ul className="flist">
                <li><b>7 lloje rregullash:</b> sezonale, early bird, last minute, qira e gjatë, fundjavë, kod promocional, mbiçmim.</li>
                <li>Zbritje në përqindje ose në shumë fikse, e kufizuar sipas <b>kategorisë, datave dhe prioritetit</b>.</li>
                <li>Kodet promocionale që i jep vetëm klientëve që i do — dhe i mat.</li>
                <li><b>Tarifa mujore</b> të veçanta për qiratë afatgjata dhe kontratat me kompani.</li>
              </ul>
            </div>

            <figure className="shot">
              <div className="shot-chrome"><div className="dots"><i></i><i></i><i></i></div><div className="shot-url">agjencia-juaj.al/admin/pricing-rules</div></div>
              <div className="shot-scroll">
                <div className="ui ui-full">
                  <main className="ui-main">
                    <div className="ui-top">
                      <div><div className="ui-title">Rregullat e çmimit</div><div className="ui-sub">6 gjithsej · 4 aktive tani · 1 e ardhshme</div></div>
                      <div className="ui-spacer"></div>
                      <span className="ui-search">Kërko rregull…</span>
                      <span className="ui-btn">+ Krijo rregullin</span>
                    </div>

                    <div className="ui-kpis">
                      <div className="kpi"><span className="lab">Aktive tani</span><span className="val">4</span><span className="dl up">po aplikohen</span></div>
                      <div className="kpi"><span className="lab">Nga rregullat</span><span className="val">+2.910 €</span><span className="dl up">▲ këtë muaj</span></div>
                      <div className="kpi"><span className="lab">Kode të përdorura</span><span className="val">37</span><span className="dl">nga 120 të lëshuara</span></div>
                      <div className="kpi"><span className="lab">Çmimi mes./ditë</span><span className="val">48 €</span><span className="dl up">▲ 6 € vs qershor</span></div>
                    </div>

                    <div className="ui-card">
                      <div className="ui-card-h">Rregullat <span className="tag">sipas prioritetit</span></div>
                      <div className="rule">
                        <div className="rule-ic">SZ</div>
                        <div><div className="rule-nm">Ofertë Verore 2026</div><div className="rule-mt">seasonal · 01 Kor → 15 Sht · Të gjitha kategoritë</div></div>
                        <div className="rule-val" style={{ color: '#B44A16' }}>+18%</div>
                        <div className="tgl"></div>
                      </div>
                      <div className="rule">
                        <div className="rule-ic acc">EB</div>
                        <div><div className="rule-nm">Early Bird −15%</div><div className="rule-mt">early_bird · rezervim ≥ 30 ditë përpara</div></div>
                        <div className="rule-val" style={{ color: '#157A5B' }}>−15%</div>
                        <div className="tgl"></div>
                      </div>
                      <div className="rule">
                        <div className="rule-ic">LS</div>
                        <div><div className="rule-nm">Qira e gjatë 7+ ditë</div><div className="rule-mt">length_of_stay · ≥ 7 ditë · Ekonomike, Familjare</div></div>
                        <div className="rule-val" style={{ color: '#157A5B' }}>−10%</div>
                        <div className="tgl"></div>
                      </div>
                      <div className="rule">
                        <div className="rule-ic">WE</div>
                        <div><div className="rule-nm">Mbiçmim fundjave</div><div className="rule-mt">weekend · Pre–Die · Luksoze, SUV</div></div>
                        <div className="rule-val" style={{ color: '#B44A16' }}>+12%</div>
                        <div className="tgl"></div>
                      </div>
                      <div className="rule">
                        <div className="rule-ic acc">PR</div>
                        <div><div className="rule-nm">Kodi <span className="plate">VERA26</span></div><div className="rule-mt">promo_code · klienti e fut gjatë rezervimit</div></div>
                        <div className="rule-val" style={{ color: '#157A5B' }}>−20 €</div>
                        <div className="tgl"></div>
                      </div>
                      <div className="rule">
                        <div className="rule-ic">LM</div>
                        <div><div className="rule-nm">Last minute 48h</div><div className="rule-mt">last_minute · e planifikuar për shtator</div></div>
                        <div className="rule-val" style={{ color: '#7A8B8E' }}>−12%</div>
                        <div className="tgl off"></div>
                      </div>
                    </div>
                  </main>
                </div>
              </div>
              <figcaption className="shot-cap">ÇMIMET DINAMIKE — rregulla që aplikohen automatikisht, pa e prekur çmimin bazë</figcaption>
            </figure>
          </article>


          <article className="mod rv">
            <div className="mod-head">
              <div className="stack g16">
                <div className="eyebrow">Flota &amp; mirëmbajtja</div>
                <h3 className="h3">Sistemi të kujton para se të të kujtojë gjoba.</h3>
              </div>
              <ul className="flist">
                <li>Pesë regjistra për çdo makinë: <b>servise, sigurime, kolaudim/regjistrim, karburant, dëmtime</b>.</li>
                <li>Numërim ditësh deri në skadencë, me sinjalizim <b>të kuqe / portokalli / jeshile</b>.</li>
                <li>Kosto totale për makinë — e di saktësisht cila makinë të sjell fitim dhe cila jo.</li>
                <li>Raporte dëmtimesh me foto, të lidhura me rezervimin dhe klientin përkatës.</li>
              </ul>
            </div>

            <figure className="shot">
              <div className="shot-chrome"><div className="dots"><i></i><i></i><i></i></div><div className="shot-url">agjencia-juaj.al/admin/fleet</div></div>
              <div className="shot-scroll">
                <div className="ui ui-full">
                  <main className="ui-main">
                    <div className="ui-top">
                      <div><div className="ui-title">Menaxhimi i flotës</div><div className="ui-sub">34 makina · 3 skadenca kritike</div></div>
                      <div className="ui-spacer"></div>
                      <span className="ui-btn alt">Sigurimet</span><span className="ui-btn alt">Kolaudimi</span><span className="ui-btn alt">Karburanti</span><span className="ui-btn">+ Regjistrim i ri</span>
                    </div>

                    <div className="ui-kpis">
                      <div className="kpi"><span className="lab">Kosto mirëmbajtjeje</span><span className="val">4.280 €</span><span className="dl dn">▲ 8% vs muaji kaluar</span></div>
                      <div className="kpi"><span className="lab">Litër gjithsej</span><span className="val">2.140 L</span><span className="dl">18 karburantime</span></div>
                      <div className="kpi"><span className="lab">Dëmtime të hapura</span><span className="val">2</span><span className="dl dn">1 pa faturuar</span></div>
                      <div className="kpi"><span className="lab">Në servis tani</span><span className="val">3</span><span className="dl">bllokuar në kalendar</span></div>
                    </div>

                    <div className="ui-cols">
                      <div className="ui-card">
                        <div className="ui-card-h">Skadenca të afërta <span className="tag">sigurim · kolaudim</span></div>
                        <div className="exp">
                          <span className="exp-stripe s-bad"></span>
                          <div><div className="exp-nm">Sigurimi TPL · VW Passat</div><div className="sub"><span className="plate">AA 340 GG</span> Sigal · 380 €/vit</div></div>
                          <div className="exp-days"><div className="n" style={{ color: '#B32C1F' }}>4</div><div className="sub">ditë mbetur</div></div>
                        </div>
                        <div className="exp">
                          <span className="exp-stripe s-bad"></span>
                          <div><div className="exp-nm">Kolaudimi · Dacia Duster</div><div className="sub"><span className="plate">AA 118 MM</span> DPSHTRR</div></div>
                          <div className="exp-days"><div className="n" style={{ color: '#B32C1F' }}>9</div><div className="sub">ditë mbetur</div></div>
                        </div>
                        <div className="exp">
                          <span className="exp-stripe s-warn"></span>
                          <div><div className="exp-nm">Sigurimi Kasko · Toyota C-HR</div><div className="sub"><span className="plate">AA 907 LR</span> Albsig · 640 €/vit</div></div>
                          <div className="exp-days"><div className="n" style={{ color: '#9C6C05' }}>23</div><div className="sub">ditë mbetur</div></div>
                        </div>
                        <div className="exp">
                          <span className="exp-stripe s-ok"></span>
                          <div><div className="exp-nm">Servis 90.000 km · VW Golf 8</div><div className="sub"><span className="plate">AA 421 KT</span> planifikuar 14 Sht</div></div>
                          <div className="exp-days"><div className="n" style={{ color: '#157A5B' }}>54</div><div className="sub">ditë mbetur</div></div>
                        </div>
                      </div>

                      <div className="ui-card">
                        <div className="ui-card-h">Kostoja për makinë <span className="tag">viti 2026</span></div>
                        <div className="ui-card-b" style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                          <div><div style={{ display: 'flex', fontSize: '11px' }}><span>VW Passat</span><span className="num" style={{ marginLeft: 'auto' }}>2.140 €</span></div><div className="meter"><i className="acc" style={{ width: '88%' }}></i></div></div>
                          <div><div style={{ display: 'flex', fontSize: '11px' }}><span>Dacia Duster</span><span className="num" style={{ marginLeft: 'auto' }}>1.510 €</span></div><div className="meter"><i style={{ width: '62%' }}></i></div></div>
                          <div><div style={{ display: 'flex', fontSize: '11px' }}><span>Toyota C-HR</span><span className="num" style={{ marginLeft: 'auto' }}>1.180 €</span></div><div className="meter"><i style={{ width: '48%' }}></i></div></div>
                          <div><div style={{ display: 'flex', fontSize: '11px' }}><span>VW Golf 8</span><span className="num" style={{ marginLeft: 'auto' }}>890 €</span></div><div className="meter"><i style={{ width: '36%' }}></i></div></div>
                          <div><div style={{ display: 'flex', fontSize: '11px' }}><span>Fiat 500</span><span className="num" style={{ marginLeft: 'auto' }}>610 €</span></div><div className="meter"><i style={{ width: '25%' }}></i></div></div>
                        </div>
                      </div>
                    </div>
                  </main>
                </div>
              </div>
              <figcaption className="shot-cap">FLOTA — skadencat, kostot dhe dëmtimet për çdo automjet</figcaption>
            </figure>
          </article>


          <article className="mod rv">
            <div className="mod-head">
              <div className="stack g16">
                <div className="eyebrow">Financa</div>
                <h3 className="h3">Kush ka paguar, kush jo, dhe sa mbaj në depozitë.</h3>
              </div>
              <ul className="flist">
                <li><b>Fatura automatike</b> për çdo rezervim, me numër serial, datë maturimi dhe status pagese.</li>
                <li><b>Depozitat</b> ndiqen veçmas: mbajtur, kthyer, ose përdorur për dëmtim.</li>
                <li>Gjoba vonese që llogariten vetë kur makina nuk kthehet në orar.</li>
                <li>Kontratë me <b>nënshkrim digjital</b> në ekran — pa printer te sporteli.</li>
              </ul>
            </div>

            <figure className="shot">
              <div className="shot-chrome"><div className="dots"><i></i><i></i><i></i></div><div className="shot-url">agjencia-juaj.al/admin/finance</div></div>
              <div className="shot-scroll">
                <div className="ui ui-full">
                  <main className="ui-main">
                    <div className="ui-top">
                      <div><div className="ui-title">Financa</div><div className="ui-sub">Faturat · Depozitat · Vonesat</div></div>
                      <div className="ui-spacer"></div>
                      <span className="ui-search">Kërko faturë, klient, makinë…</span>
                      <span className="ui-btn alt">Eksporto CSV</span>
                    </div>

                    <div className="ui-kpis">
                      <div className="kpi"><span className="lab">Të ardhura totale</span><span className="val">18.740 €</span><span className="dl up">54 fatura</span></div>
                      <div className="kpi"><span className="lab">Pa paguar</span><span className="val">2.310 €</span><span className="dl dn">7 fatura të hapura</span></div>
                      <div className="kpi"><span className="lab">Depozita mbajtura</span><span className="val">5.400 €</span><span className="dl">18 aktive</span></div>
                      <div className="kpi"><span className="lab">Gjoba vonesa</span><span className="val">185 €</span><span className="dl dn">3 aktive</span></div>
                    </div>

                    <div className="ui-card">
                      <div className="ui-card-h">Faturat <span className="tag">gusht 2026</span></div>
                      <table className="ui-tb">
                        <thead><tr><th>Nr. Faturës</th><th>Klienti</th><th>Makina</th><th>Data lëshimit</th><th>Maturimi</th><th>Statusi</th><th>Totali</th></tr></thead>
                        <tbody>
                          <tr><td className="num">INV-2026-0412</td><td>Marco Rossi</td><td>VW Golf 8</td><td className="num">22 Gsh 2026</td><td className="num">29 Gsh 2026</td><td><span className="pill p-ok">Paguar</span></td><td className="num">385,00 €</td></tr>
                          <tr><td className="num">INV-2026-0411</td><td>Lena Krüger</td><td>Toyota C-HR</td><td className="num">21 Gsh 2026</td><td className="num">27 Gsh 2026</td><td><span className="pill p-wait">Pjesërisht</span></td><td className="num">268,00 €</td></tr>
                          <tr><td className="num">INV-2026-0410</td><td>Arben Hoxha</td><td>Dacia Duster</td><td className="num">20 Gsh 2026</td><td className="num">31 Gsh 2026</td><td><span className="pill p-ok">Paguar</span></td><td className="num">301,00 €</td></tr>
                          <tr><td className="num">INV-2026-0409</td><td>Sophie Dubois</td><td>Fiat 500</td><td className="num">19 Gsh 2026</td><td className="num">24 Gsh 2026</td><td><span className="pill p-bad">Vonuar</span></td><td className="num">174,00 €</td></tr>
                          <tr><td className="num">INV-2026-0408</td><td>Thomas Weber</td><td>VW Passat</td><td className="num">18 Gsh 2026</td><td className="num">25 Gsh 2026</td><td><span className="pill p-ok">Paguar</span></td><td className="num">452,00 €</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </main>
                </div>
              </div>
              <figcaption className="shot-cap">FINANCA — faturat, depozitat dhe gjobat e vonesës në një regjistër të vetëm</figcaption>
            </figure>
          </article>


          <article className="mod rv">
            <div className="mod-head">
              <div className="stack g16">
                <div className="eyebrow eyebrow-coral">Faqja publike</div>
                <h3 className="h3">Klienti rezervon vetë. Ti e gjen mëngjesin tjetër në panel.</h3>
              </div>
              <ul className="flist">
                <li><b>Shqip, anglisht, italisht, frëngjisht, spanjisht</b> — të njëjtat makina, gjuha e klientit.</li>
                <li>Faqe të dedikuara SEO: makina me qira Tiranë, aeroport, SUV, automatike, luksoze.</li>
                <li>Ekstra dhe sigurime që klienti i shton vetë — <b>çdo rezervim rritet në vlerë</b>.</li>
                <li>Analitikë e brendshme: nga cili shtet vjen trafiku, cila makinë hapet më shumë, sa klikime WhatsApp.</li>
              </ul>
            </div>

            <figure className="shot">
              <div className="shot-chrome"><div className="dots"><i></i><i></i><i></i></div><div className="shot-url">agjencia-juaj.al</div></div>
              <div className="shot-scroll">
                <div className="pub">
                  <div className="pub-nav">
                    <span className="lg">AGJENCIA JUAJ</span>
                    <span className="ln">Flota</span><span className="ln">Zyrat</span><span className="ln">Vlerësime</span><span className="ln">Blog</span><span className="ln">Kontakt</span>
                    <span className="langs"><span className="on">SQ</span><span>EN</span><span>IT</span><span>FR</span><span>ES</span></span>
                  </div>
                  <div className="pub-hero">
                    <div>
                      <h3>Makina me qira në Tiranë,<br />pa surpriza në çmim.</h3>
                      <p>Marrje falas në Aeroportin e Rinasit. Anulim pa pagesë deri 48 orë para nisjes.</p>
                    </div>
                    <div className="srch">
                      <div className="fld"><span className="l">Marrja</span><span className="v">Aeroporti i Rinasit</span></div>
                      <div className="fld"><span className="l">Data e nisjes</span><span className="v">22 Gsh · 09:30</span></div>
                      <div className="fld"><span className="l">Data e kthimit</span><span className="v">29 Gsh · 18:00</span></div>
                      <span className="ui-btn acc" style={{ alignSelf: 'center' }}>Kërko makinat</span>
                    </div>
                  </div>
                  <div className="pub-cars">
                    <div className="ccard">
                      <div className="cimg"><svg width="86" height="34" viewBox="0 0 86 34" aria-hidden="true"><path d="M6 26h74M14 26a6 6 0 1 0 12 0 6 6 0 1 0-12 0M60 26a6 6 0 1 0 12 0 6 6 0 1 0-12 0M8 26V17l8-9h34l12 9h12a4 4 0 0 1 4 4v5" fill="none" stroke="#0A2F37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55"/></svg></div>
                      <div className="cbody">
                        <div><div className="cname">VW Golf 8</div><div className="sub">Ekonomike · 2023</div></div>
                        <div className="cspecs"><span>⚙ Auto</span><span>◉ 5 vende</span><span>⛽ Naftë</span></div>
                        <div className="cprice"><b>42 €</b><s>55 €</s><span>/ ditë</span></div>
                      </div>
                    </div>
                    <div className="ccard">
                      <div className="cimg"><svg width="86" height="34" viewBox="0 0 86 34" aria-hidden="true"><path d="M6 26h74M14 26a6 6 0 1 0 12 0 6 6 0 1 0-12 0M60 26a6 6 0 1 0 12 0 6 6 0 1 0-12 0M8 26V16l9-10h36l13 10h11a4 4 0 0 1 4 4v6" fill="none" stroke="#0A2F37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55"/></svg></div>
                      <div className="cbody">
                        <div><div className="cname">Toyota C-HR</div><div className="sub">SUV · 2024</div></div>
                        <div className="cspecs"><span>⚙ Auto</span><span>◉ 5 vende</span><span>⛽ Hibrid</span></div>
                        <div className="cprice"><b>58 €</b><span>/ ditë</span></div>
                      </div>
                    </div>
                    <div className="ccard">
                      <div className="cimg"><svg width="86" height="34" viewBox="0 0 86 34" aria-hidden="true"><path d="M10 26h68M18 26a6 6 0 1 0 12 0 6 6 0 1 0-12 0M56 26a6 6 0 1 0 12 0 6 6 0 1 0-12 0M12 26V18l7-8h28l10 8h9a4 4 0 0 1 4 4v4" fill="none" stroke="#0A2F37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55"/></svg></div>
                      <div className="cbody">
                        <div><div className="cname">Fiat 500</div><div className="sub">Ekonomike · 2022</div></div>
                        <div className="cspecs"><span>⚙ Manual</span><span>◉ 4 vende</span><span>⛽ Benzinë</span></div>
                        <div className="cprice"><b>29 €</b><span>/ ditë</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <figcaption className="shot-cap">FAQJA PUBLIKE — kërkim, disponueshmëri live dhe rezervim në 5 gjuhë</figcaption>
            </figure>
          </article>

        </div>
      </section>

      {/* ═══ KALKULATORI ═══ */}
      <section className="sec sec-line" id="llogarit">
        <div className="wrap stack g40">
          <div className="stack g16 rv" style={{ maxWidth: '62ch' }}>
            <div className="eyebrow eyebrow-coral">Llogarit vetë</div>
            <h2 className="h2">Sa të kushtojnë komisionet çdo vit?</h2>
            <p className="lead">Lëviz shiritat sipas biznesit tënd. Numri poshtë është paraja që sot largohet për rezervime që mund t’i merrje vetë.</p>
          </div>

          <div className="calc rv">
            <div className="stack g28">
              <div className="ctrl">
                <div className="ctrl-top"><span className="ctrl-lab">Rezervime në muaj</span><span className="ctrl-val">{bookings}</span></div>
                <input type="range" min={10} max={300} step={5} value={bookings}
                  onChange={e => setBookings(+e.target.value)} aria-label="Rezervime në muaj" />
              </div>
              <div className="ctrl">
                <div className="ctrl-top"><span className="ctrl-lab">Vlera mesatare e një rezervimi</span><span className="ctrl-val">{avgValue} €</span></div>
                <input type="range" min={80} max={1200} step={10} value={avgValue}
                  onChange={e => setAvgValue(+e.target.value)} aria-label="Vlera mesatare e rezervimit në euro" />
              </div>
              <div className="ctrl">
                <div className="ctrl-top"><span className="ctrl-lab">Sa % e rezervimeve vijnë nga portalet</span><span className="ctrl-val">{portalShare}%</span></div>
                <input type="range" min={0} max={100} step={5} value={portalShare}
                  onChange={e => setPortalShare(+e.target.value)} aria-label="Përqindja e rezervimeve nga portalet" />
              </div>
              <div className="ctrl">
                <div className="ctrl-top"><span className="ctrl-lab">Komisioni mesatar i portalit</span><span className="ctrl-val">{portalFee}%</span></div>
                <input type="range" min={5} max={30} step={1} value={portalFee}
                  onChange={e => setPortalFee(+e.target.value)} aria-label="Komisioni i portalit në përqindje" />
              </div>
            </div>

            <div className="calc-out">
              <div className="out-row"><span className="out-lab">Qarkullim vjetor</span><span className="out-val">{eur(yearRevenue)}</span></div>
              <div className="out-row"><span className="out-lab">Komision i paguar në vit</span><span className="out-val" style={{ color: 'var(--bad)' }}>{eur(commission)}</span></div>
              <div className="out-row"><span className="out-lab">Kosto e sistemit (Pro, 12 muaj)</span><span className="out-val">{eur(SYSTEM_YEAR_COST)}</span></div>
              <div className="out-big">
                <span className="out-lab">Nëse zhvendos vetëm gjysmën e këtyre rezervimeve në faqen tënde</span>
                <span className="out-val" style={{ color: netSaving >= 0 ? 'var(--coral)' : 'var(--muted)' }}>
                  {(netSaving >= 0 ? '+' : '−') + eur(Math.abs(netSaving))}
                </span>
                <span className="calc-note">kursim neto në vitin e parë, pas kostos së sistemit</span>
              </div>
              <p className="calc-note">
                Llogaritje treguese, e bazuar në vlerat që fut ti. Nuk përfshin fitimin shtesë nga
                çmimet dinamike, ekstrat dhe klientët e përsëritur — të cilët në praktikë e rrisin edhe më shumë diferencën.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ PROOF · HAPAT · ÇMIMET · FAQ ═══ */}
      <section className="sec sec-line">
        <div className="wrap stack g40">
          <div className="stack g16 rv" style={{ maxWidth: '60ch' }}>
            <div className="eyebrow">Çfarë merr konkretisht</div>
            <h2 className="h2">Jo një prototip. Një sistem në punë.</h2>
          </div>

          <div className="proof rv">
            <div className="pf"><b>18</b><span>module në panelin e administrimit</span></div>
            <div className="pf"><b>25+</b><span>tabela të dhënash në MySQL</span></div>
            <div className="pf"><b>5</b><span>gjuhë në faqen publike</span></div>
            <div className="pf"><b>7</b><span>email-e automatike drejt klientit</span></div>
            <div className="pf"><b>4</b><span>role përdoruesish me leje të ndara</span></div>
            <div className="pf"><b>100%</b><span>i të dhënave në serverin tënd</span></div>
          </div>

          <div className="split rv" style={{ alignItems: 'start' }}>
            <ul className="flist">
              <li><b>Role dhe leje:</b> admin, menaxher, staf, kontabilist — secili sheh vetëm atë që i takon.</li>
              <li><b>Regjistër aktiviteti:</b> kush e ndryshoi çmimin, kush e anuloi rezervimin, në cilën orë.</li>
              <li><b>Import me një klikim</b> nga VikRentCar ose Excel/CSV — historiku nuk humbet.</li>
              <li><b>Dokumente klienti:</b> pasaportë, patentë dhe kontrata të ruajtura pranë profilit.</li>
            </ul>
            <ul className="flist">
              <li><b>Email SMTP i yti:</b> konfirmime, kujtesa marrjeje dhe fatura nga adresa jote.</li>
              <li><b>Shumë lokacione</b> me tarifa të veçanta dhe kontroll marrje/kthim për secilin.</li>
              <li><b>Blog dhe faqe SEO</b> të redaktueshme nga paneli, pa programues.</li>
              <li><b>Rezervë e të dhënave</b> dhe përditësime pa ndërprerje të punës.</li>
            </ul>
          </div>
        </div>
      </section>


      <section className="sec sec-line">
        <div className="wrap stack g40">
          <div className="stack g16 rv" style={{ maxWidth: '60ch' }}>
            <div className="eyebrow">Nga takimi te sistemi live</div>
            <h2 className="h2">Shtatë ditë. Katër hapa.</h2>
            <p className="lead">Ti vazhdon punën normalisht. Ne e ngremë sistemin paralelisht dhe kalojmë kur gjithçka është gati.</p>
          </div>

          <div className="steps rv">
            <div className="step">
              <span className="step-n">1</span>
              <span className="when">Dita 1 · 20 min</span>
              <h4>Demo mbi rastin tënd</h4>
              <p>Të tregojmë sistemin live me flotën dhe çmimet e tua reale. Ti pyet, ne përgjigjemi. Pa slide.</p>
            </div>
            <div className="step">
              <span className="step-n">2</span>
              <span className="when">Ditët 2–3</span>
              <h4>Ngarkohen të dhënat</h4>
              <p>Makinat, çmimet, lokacionet dhe klientët importohen nga Excel-i ose sistemi yt i vjetër.</p>
            </div>
            <div className="step">
              <span className="step-n">3</span>
              <span className="when">Ditët 4–5</span>
              <h4>Brandi dhe domain-i yt</h4>
              <p>Logo, ngjyra, tekstet, zyrat, kushtet dhe email-et — faqja del me identitetin tënd, jo tonin.</p>
            </div>
            <div className="step">
              <span className="step-n">4</span>
              <span className="when">Ditët 6–7</span>
              <h4>Trajnim dhe kalim live</h4>
              <p>Dy orë me stafin tënd, pastaj sistemi shkon në ajër. Mbështetje e drejtpërdrejtë muajin e parë.</p>
            </div>
          </div>
        </div>
      </section>


      <section className="sec sec-line" id="cmimet">
        <div className="wrap stack g40">
          <div className="stack g16 rv" style={{ maxWidth: '62ch' }}>
            <div className="eyebrow eyebrow-coral">Investimi</div>
            <h2 className="h2">Më pak se komisioni i tre rezervimeve në muaj.</h2>
            <p className="lead">Pa kontratë vjetore. Anulon kur të duash dhe të dhënat i merr me vete në një skedar.</p>
          </div>

          <div className="plans rv">
            <div className="plan">
              <span className="plan-nm">Start</span>
              <div className="plan-price"><b>149 €</b><span>/ muaj</span></div>
              <p className="plan-for">Për agjenci deri në 15 makina që po kalojnë nga Excel-i.</p>
              <ul>
                <li>Faqe publike me rezervim online</li>
                <li>Rezervime, kalendar, klientë</li>
                <li>Fatura dhe depozita</li>
                <li>2 përdorues</li>
                <li>Shqip + anglisht</li>
              </ul>
              <a className="btn btn-ghost" href="#demo">Nis me Start</a>
            </div>

            <div className="plan plan-hot">
              <span className="plan-badge">Më i zgjedhuri</span>
              <span className="plan-nm">Pro</span>
              <div className="plan-price"><b>249 €</b><span>/ muaj</span></div>
              <p className="plan-for">Për agjenci 15–50 makina që duan të rrisin çmimin mesatar.</p>
              <ul>
                <li>Gjithçka nga Start</li>
                <li><b>Çmime dinamike</b> — 7 lloje rregullash</li>
                <li>Flota: servise, sigurime, kolaudim, karburant</li>
                <li>Raporte dhe analitikë e klientëve</li>
                <li><b>5 gjuhë</b> + faqe SEO + blog</li>
                <li>Përdorues të pakufizuar me role</li>
                <li>Import nga VikRentCar / CSV</li>
              </ul>
              <a className="btn btn-primary" href="#demo">Rezervo demo për Pro</a>
            </div>

            <div className="plan">
              <span className="plan-nm">White label</span>
              <div className="plan-price"><b>4.900 €</b><span>një herë</span></div>
              <p className="plan-for">Për flota mbi 50 makina ose kush e do sistemin plotësisht të vetin.</p>
              <ul>
                <li>Gjithçka nga Pro</li>
                <li><b>Kodi burimor i yti</b></li>
                <li>Hosting dhe bazë të dhënash e jotja</li>
                <li>Personalizime sipas kërkesës</li>
                <li>Mirëmbajtje opsionale 99 €/muaj</li>
              </ul>
              <a className="btn btn-ghost" href="#demo">Flisim për detajet</a>
            </div>
          </div>

          <p className="calc-note rv" style={{ fontSize: '14px' }}>
            Instalimi dhe migrimi i të dhënave: <b style={{ color: 'var(--text)' }}>490 €</b> —
            <b style={{ color: 'var(--coral)' }}>falas për agjencitë që nisin këtë tremujor.</b>
            Çmimet pa TVSH.
          </p>
        </div>
      </section>


      <section className="sec sec-line" id="pyetje">
        <div className="wrap stack g40">
          <div className="stack g16 rv" style={{ maxWidth: '58ch' }}>
            <div className="eyebrow">Para se të pyesësh</div>
            <h2 className="h2">Pyetjet që bëjnë të gjithë.</h2>
          </div>

          <div className="faq rv">
            <details open>
              <summary>Nuk jam i zoti me kompjuter. A do ta përdor dot?</summary>
              <p className="ans">Po. Paneli është ndërtuar për sporteli, jo për programues: lista, butona dhe formularë në shqip. Trajnimi zgjat dy orë dhe pas tij stafi punon vetë. Muajin e parë je i mbuluar me mbështetje të drejtpërdrejtë në WhatsApp.</p>
            </details>
            <details>
              <summary>Po të dhënat që kam sot në Excel apo në VikRentCar?</summary>
              <p className="ans">Importohen. Sistemi ka një modul importi që lexon skedarë CSV me rezervimet, klientët dhe makinat — përfshirë formatin e VikRentCar. Historiku yt nuk fillon nga zero.</p>
            </details>
            <details>
              <summary>Ku ruhen të dhënat e klientëve të mi?</summary>
              <p className="ans">Në serverin dhe bazën e të dhënave që kontrollon ti (MySQL). Ne nuk i mbajmë të dhënat e tua në një platformë të përbashkët me agjenci të tjera, dhe konkurrentët e tu nuk kanë asnjë mënyrë t’i shohin. Faqja publike ka pëlqim për cookie-t sipas GDPR-së.</p>
            </details>
            <details>
              <summary>A punon nga telefoni?</summary>
              <p className="ans">Po. Si faqja publike ashtu edhe paneli janë të përshtatur për telefon dhe tablet. Rezervimin e konfirmon nga makina, dhe kalendarin e sheh nga aeroporti.</p>
            </details>
            <details>
              <summary>Po nëse dua diçka që sistemi nuk e ka?</summary>
              <p className="ans">Sistemi është modular, ndaj shtesat janë punë ditësh, jo muajsh. Kërkesat e vogla hyjnë në përditësimet e rregullta; ato më të mëdhaja i çmojmë veçmas para se të nisim. Në planin White label kodi është i yti dhe mund ta zhvillojë kush të duash.</p>
            </details>
            <details>
              <summary>A më lidh me kontratë të gjatë?</summary>
              <p className="ans">Jo. Pagesa është mujore dhe e ndërpret kur të duash. Nëse largohesh, të dhënat i eksporton në CSV dhe i merr me vete — pa pengesa dhe pa tarifë dalje.</p>
            </details>
            <details>
              <summary>A do të bjerë faqja në kulmin e sezonit?</summary>
              <p className="ans">Sistemi punon sot mbi trafik real veror. Ka kufizim kërkesash, kompresim, cache dhe monitorim gabimesh; kopjet rezervë bëhen çdo ditë. Nëse diçka prishet, e riktheni brenda orës, jo brenda ditës.</p>
            </details>
          </div>
        </div>
      </section>

      {/* ═══ CTA FINAL ═══ */}
      <section className="sec" id="demo">
        <div className="wrap">
          <div className="final rv">
            <div className="final-in">
              <div className="eyebrow eyebrow-coral">Hapi tjetër</div>
              <h2 className="h2">20 minuta. Ekrani im, pyetjet e tua.</h2>
              <p className="lead">
                Të tregoj sistemin live me makinat dhe çmimet e agjencisë sate. Nëse në fund të duket
                se nuk të hyn në punë, e themi hapur dhe mbaron aty — pa ndjekje, pa telefonata.
              </p>

              <div className="contact-row">
                <a className="cbtn" href="https://wa.me/355693972707?text=P%C3%ABrsh%C3%ABndetje!%20Dua%20nj%C3%AB%20demo%20t%C3%AB%20sistemit%20p%C3%ABr%20rent%20a%20car." target="_blank" rel="noopener noreferrer">
                  <span><span className="k">WhatsApp — përgjigje brenda 1 ore</span><span className="v">+355 69 397 2707</span></span>
                </a>
                <a className="cbtn" href="tel:+355693972707">
                  <span><span className="k">Telefon</span><span className="v">+355 69 397 2707</span></span>
                </a>
                <a className="cbtn" href="mailto:social@fivo.al?subject=Demo%20-%20sistem%20rent%20a%20car">
                  <span><span className="k">Email</span><span className="v">social@fivo.al</span></span>
                </a>
              </div>

              {/* Formulari shkon në /api/landing → krijon Lead në CRM, si faqet e tjera landing. */}
              <div className="frm-sep stack g16">
                <div className="eyebrow">Ose lëri të dhënat dhe të kontaktoj unë</div>
                {formSent ? (
                  <div className="frm-ok">
                    <b>Faleminderit — kërkesa mbërriti.</b>
                    <span className="calc-note">Të kontaktoj brenda një ore të orarit të punës për të caktuar demon 20-minutëshe.</span>
                  </div>
                ) : (
                  <form className="frm" onSubmit={handleSubmit}>
                    <label className="full">
                      Emri dhe mbiemri *
                      <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} autoComplete="name" />
                    </label>
                    <label>
                      Agjencia
                      <input value={formData.company} onChange={e => setFormData({ ...formData, company: e.target.value })} autoComplete="organization" />
                    </label>
                    <label>
                      Sa makina ke në flotë
                      <input value={formData.fleet} onChange={e => setFormData({ ...formData, fleet: e.target.value })} inputMode="numeric" placeholder="p.sh. 22" />
                    </label>
                    <label>
                      Email *
                      <input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} autoComplete="email" />
                    </label>
                    <label>
                      Telefon / WhatsApp
                      <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} autoComplete="tel" inputMode="tel" />
                    </label>
                    <label className="full">
                      Çfarë përdor sot (Excel, VikRentCar, fletore…) dhe çfarë të pengon më shumë
                      <textarea value={formData.message} onChange={e => setFormData({ ...formData, message: e.target.value })} />
                    </label>
                    {formError && <p className="frm-err full">{formError}</p>}
                    <div className="full stack g12">
                      <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? 'Po dërgohet…' : 'Dërgo dhe cakto demon'}
                      </button>
                      <span className="calc-note">Të dhënat shkojnë vetëm te ne, për këtë kërkesë. Pa listë email-esh.</span>
                    </div>
                  </form>
                )}
              </div>

              <p className="hero-note">
                Marrim <b style={{ color: 'var(--text)' }}>10 agjenci të reja</b> për onboarding këtë tremujor, që secila
                të marrë vëmendjen e duhur gjatë kalimit. Pas kësaj, radha kalon në tremujorin tjetër.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="foot">
        <div className="wrap foot-in">
          <span className="mono">RENTOS · Sistem menaxhimi për agjenci rent a car</span>
          <span>Tiranë, Shqipëri · <a href="mailto:social@fivo.al" style={{ color: 'var(--muted)' }}>social@fivo.al</a></span>
        </div>
      </footer>
    </div>
  );
}

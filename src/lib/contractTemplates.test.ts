import { describe, it, expect } from 'vitest';
import { CONTRACT_TEMPLATES, ContractParties } from './contractTemplates';

const EMPTY: ContractParties = {
  companyName: '', companyAddress: '', companyNipt: '', companyRep: '', companyEmail: '', companyPhone: '',
  clientName: '',
};

const FULL: ContractParties = {
  companyName: 'FIVO LLC',
  companyAddress: 'Rruga Aleksandër Moisiu, Tirana, Albania',
  companyNipt: 'L12345678A',
  companyRep: 'Xhentil Kanina',
  companyEmail: 'xhentil@fivo.al',
  companyPhone: '+355 68 20 20 488',
  clientName: 'Mario Rossi',
  clientCompany: 'ACTWO',
  clientAddress: 'Via delle Ginestre 50, Zafferana Etnea (CT), Italia',
  clientNipt: 'IT01234567890',
  clientEmail: 'info@actwo.it',
  clientPhone: '+39 095 000000',
};

describe('CONTRACT_TEMPLATES', () => {
  it('has unique ids', () => {
    const ids = CONTRACT_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CONTRACT_TEMPLATES.map(t => [t.id, t] as const))('%s renders with empty and full parties', (_id, tpl) => {
    for (const parties of [EMPTY, FULL]) {
      const html = tpl.getHTML(parties);
      expect(html).toMatch(/<h1/);
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('${');
    }
  });

  describe('seo-advanced-it', () => {
    const tpl = CONTRACT_TEMPLATES.find(t => t.id === 'seo-advanced-it')!;

    it('fills provider and client from the parties', () => {
      const html = tpl.getHTML(FULL);
      expect(html).toContain('<strong>FIVO LLC</strong>, con sede in <strong>Rruga Aleksandër Moisiu, Tirana, Albania</strong>');
      expect(html).toContain('rappresentata da <strong>Xhentil Kanina</strong>');
      expect(html).toContain('mailto:xhentil@fivo.al');
      expect(html).toContain('ACTWO (Mario Rossi)');
      expect(html).toContain('P.IVA / numero di registrazione <strong>IT01234567890</strong>');
      expect(html).toContain('<h2>PER FIVO LLC</h2>');
      expect(html).toContain('<h2>PER ACTWO</h2>');
      // Every article is present.
      for (let n = 1; n <= 32; n++) expect(html).toContain(`ART. ${n} –`);
      expect(html).toContain('RIEPILOGO COMMERCIALE');
    });

    it('leaves [●] placeholders where the CRM has no data', () => {
      const html = tpl.getHTML(EMPTY);
      expect(html).toContain('[●]');
      expect(html).toContain('[Fornitore]');
      expect(html).toContain('[Cliente]');
    });

    it('refers to the client by company name when set, otherwise by contact name', () => {
      expect(tpl.getHTML({ ...EMPTY, clientName: 'Mario Rossi' })).toContain('a) Mario Rossi intende');
      expect(tpl.getHTML(FULL)).toContain('a) ACTWO intende');
    });
  });
});

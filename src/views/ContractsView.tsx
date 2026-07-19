import React, { useState, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { useCollection, useMutation, getGlobalTeamId } from '../hooks/useFirestore';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import {
  ScrollText, Plus, Send, Eye, Pencil, Trash2, Loader2, FileText,
  User, GripVertical, LayoutTemplate, Package, UserCheck, ChevronsUpDown, Check,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { Separator } from '../components/ui/separator';
import ContractEditor, { ContractEditorHandle } from '../components/ContractEditor';
import { CONTRACT_TEMPLATES, ContractParties } from '../lib/contractTemplates';
import type { Contract, Customer, Quote, Invoice, Service, TeamMember } from '../types';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Sent: 'bg-blue-100 text-blue-700',
  Signed: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Expired: 'bg-orange-100 text-orange-700',
};
const STATUS_LABELS: Record<string, string> = {
  Draft: 'Draft', Sent: 'Dërguar', Signed: 'Nënshkruar', Rejected: 'Refuzuar', Expired: 'Skaduar',
};

function isBodyEmpty(html: string) {
  return !html || html === '<p></p>' || html.replace(/<[^>]*>/g, '').trim() === '';
}

function buildServiceHTML(svc: Service): string {
  const name = svc.name || svc.title || 'Shërbim';
  const cur = svc.currency || 'EUR';
  const price = svc.price > 0 ? ` — <strong>${svc.price.toLocaleString()} ${cur}/muaj</strong>` : '';
  const desc = svc.description ? `<p><em>${svc.description}</em></p>` : '';
  return `<p><strong>${name}</strong>${price}</p>${desc}`;
}

const ContractsView: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const permissions = usePermissions();

  const teamSettings = useTeamSettingsData();
  const { data: contracts, loading } = useCollection<Contract>('contracts');
  // Customers/invoices aren't team-isolated in this app (loaded app-wide with
  // skipTeamFilter elsewhere); mirror that so the full client list shows here.
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: quotes } = useCollection<Quote>('quotes');
  const { data: invoices } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: services, loading: servicesLoading } = useCollection<Service>('services');
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers');
  const contractMutation = useMutation<Contract>('contracts');

  const editorRef = useRef<ContractEditorHandle>(null);
  const draggedService = useRef<Service | null>(null);

  const [statusFilter, setStatusFilter] = useState('__all__');
  const [searchQ, setSearchQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [viewContract, setViewContract] = useState<Contract | null>(null);
  const [editContract, setEditContract] = useState<Contract | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  // Form state
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formQuoteId, setFormQuoteId] = useState('__none__');
  const [formInvoiceId, setFormInvoiceId] = useState('__none__');
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formExpiry, setFormExpiry] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formAssignedToUserId, setFormAssignedToUserId] = useState('');
  const [saving, setSaving] = useState(false);

  // Role-scoped base list: SalesAgent/Member only see their own contracts.
  // Guard: while permissions are loading dataScope defaults to 'assigned' — don't filter yet.
  const roleFilteredContracts = useMemo(() => {
    const list = contracts || [];
    if (!permissions.isLoading && permissions.dataScope === 'assigned' && user?.uid) {
      return list.filter(c => c.assignedToUserId === user.uid || c.createdByUserId === user.uid);
    }
    return list;
  }, [contracts, permissions.dataScope, permissions.isLoading, user?.uid]);

  const filteredContracts = useMemo(() => {
    let list = roleFilteredContracts;
    if (statusFilter !== '__all__') list = list.filter(c => c.status === statusFilter);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        (c.clientEmail || '').toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toDate?.()?.getTime() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toDate?.()?.getTime() ?? 0;
      return tb - ta;
    });
  }, [roleFilteredContracts, statusFilter, searchQ]);

  const customerInvoices = useMemo(
    () => invoices?.filter(inv => inv.customerId === formCustomerId) ?? [],
    [formCustomerId, invoices],
  );

  // Stats reflect the same role-filtered list so SalesAgent sees accurate counts
  const stats = useMemo(() => ({
    total: roleFilteredContracts.length,
    pending: roleFilteredContracts.filter(c => c.status === 'Draft').length,
    sent: roleFilteredContracts.filter(c => c.status === 'Sent').length,
    signed: roleFilteredContracts.filter(c => c.status === 'Signed').length,
  }), [roleFilteredContracts]);

  const buildParties = (cid: string): ContractParties => {
    const cust = customers?.find(c => c.id === cid);
    return {
      companyName: teamSettings?.companyName || '[Emri i Kompanisë]',
      companyAddress: teamSettings?.companyAddress || '',
      companyNipt: teamSettings?.companyNipt || '',
      companyRep: teamSettings?.companyRepresentative || '',
      companyEmail: teamSettings?.companyEmail || '',
      companyPhone: teamSettings?.companyPhone || '',
      clientName: cust?.name || 'Klienti',
      clientCompany: cust?.company || '',
      clientAddress: cust?.address || '',
      clientNipt: (cust as any)?.taxId || '',
      clientEmail: cust?.email || '',
      clientPhone: cust?.phone || '',
    };
  };

  const applyTemplate = (templateId: string) => {
    const tpl = CONTRACT_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    if (!formCustomerId) {
      toast({ title: 'Zgjidh klientin fillimisht', variant: 'destructive' });
      return;
    }
    const parties = buildParties(formCustomerId);
    const html = tpl.getHTML(parties);
    setFormBody(html);
    // setTimeout ensures the editor is mounted before we call setContent
    setTimeout(() => editorRef.current?.setContent(html), 0);
    if (!formTitle) setFormTitle(`${tpl.label} — ${parties.clientName}`);
  };

  const onCustomerChange = (cid: string) => {
    setFormCustomerId(cid);
    setFormQuoteId('__none__');
    setFormInvoiceId('__none__');
    const parties = buildParties(cid);
    const tpl = CONTRACT_TEMPLATES[0];
    const html = tpl.getHTML(parties);
    setFormTitle(`Kontratë Shërbimi — ${parties.clientName}`);
    setFormBody(html);
    setTimeout(() => editorRef.current?.setContent(html), 0);
  };

  const onQuoteChange = (qid: string) => {
    setFormQuoteId(qid);
    if (qid === '__none__') return;
    const q = quotes?.find(x => x.id === qid);
    if (!q) return;
    const cur = q.currency === 'EUR' ? '€' : q.currency === 'USD' ? '$' : 'L';
    const pkgLines = (q.result?.categories || [])
      .filter(c => c.oneTime > 0 || c.monthly > 0)
      .map(c => `<li><strong>${c.category}</strong>: ${c.oneTime > 0 ? `${c.oneTime.toLocaleString()}${cur} (one-time)` : ''}${c.oneTime > 0 && c.monthly > 0 ? ' + ' : ''}${c.monthly > 0 ? `${c.monthly.toLocaleString()}${cur}/muaj` : ''}</li>`)
      .join('');
    const label = q.label || q.result?.suggestedLabel || 'Paketa';
    const parties = buildParties(formCustomerId);
    setFormTitle(`Kontratë — ${label} — ${parties.clientName}`);
    const pkgBlock = `<hr><h2>PAKETA E ZGJEDHUR: ${label}</h2><ul>${pkgLines}</ul><p><strong>Total One-time:</strong> ${(q.result?.totalOneTime ?? 0).toLocaleString()} ${cur}</p><p><strong>Total Mujor:</strong> ${(q.result?.totalMonthly ?? 0).toLocaleString()} ${cur}/muaj</p>${q.result?.grandTotal ? `<p><strong>Grand Total:</strong> ${q.result.grandTotal.toLocaleString()} ${cur}</p>` : ''}`;
    // Append the package block to whatever is already in the editor (the user's
    // chosen template + edits). Only fall back to the default template when the
    // editor is still empty — never wipe existing content.
    const base = formBody?.trim() ? formBody : CONTRACT_TEMPLATES[0].getHTML(parties);
    const html = base + pkgBlock;
    setFormBody(html);
    setTimeout(() => editorRef.current?.setContent(html), 0);
  };

  const resetForm = () => {
    setFormCustomerId('');
    setFormQuoteId('__none__');
    setFormInvoiceId('__none__');
    setFormTitle('');
    setFormBody('');
    setFormExpiry('');
    setFormNotes('');
    setFormAssignedToUserId('');
    setCustomerSearch('');
  };

  const openEdit = (c: Contract) => {
    setEditContract(c);
    setFormCustomerId(c.customerId || '');
    setFormQuoteId(c.quoteId || '__none__');
    setFormInvoiceId(c.invoiceId || '__none__');
    setFormTitle(c.title);
    setFormBody(c.body);
    setFormExpiry(
      c.expiresAt instanceof Date
        ? c.expiresAt.toISOString().split('T')[0]
        : (c.expiresAt as any)?.toDate?.()?.toISOString().split('T')[0] || '',
    );
    setFormNotes(c.notes || '');
    setFormAssignedToUserId(c.assignedToUserId || '');
    // Dialog opens after state updates — give it a tick to mount the editor
    setTimeout(() => editorRef.current?.setContent(c.body), 50);
  };

  const handleSave = async () => {
    if (!formCustomerId || !formTitle.trim() || isBodyEmpty(formBody)) {
      toast({ title: 'Plotëso fushat e detyrueshme', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const cust = customers?.find(c => c.id === formCustomerId);
    const q = formQuoteId !== '__none__' ? quotes?.find(x => x.id === formQuoteId) : null;
    const teamId = getGlobalTeamId() || '';
    const assignedMember = formAssignedToUserId
      ? teamMembers?.find(m => m.userId === formAssignedToUserId)
      : null;

    const packageSummary = q ? {
      label: q.label || q.result?.suggestedLabel || 'Paketa',
      currency: q.currency || 'EUR',
      categories: (q.result?.categories || []).map(cat => ({
        category: cat.category,
        oneTime: cat.oneTime || 0,
        monthly: cat.monthly || 0,
      })),
      totalOneTime: q.result?.totalOneTime ?? 0,
      totalMonthly: q.result?.totalMonthly ?? 0,
      grandTotal: q.result?.grandTotal ?? 0,
      discountLabel: q.result?.bundleDiscountLabel,
      discountAmount: q.result?.bundleDiscountAmount,
    } : undefined;

    try {
      if (editContract) {
        await contractMutation.update(editContract.id, {
          customerId: formCustomerId,
          clientName: cust?.name || formCustomerId,
          clientEmail: cust?.email || undefined,
          quoteId: formQuoteId !== '__none__' ? formQuoteId : undefined,
          invoiceId: formInvoiceId !== '__none__' ? formInvoiceId : undefined,
          title: formTitle.trim(),
          body: formBody,
          notes: formNotes.trim() || undefined,
          expiresAt: formExpiry ? new Date(formExpiry) : undefined,
          packageSummary,
          assignedToUserId: formAssignedToUserId || null,
          assignedToName: formAssignedToUserId ? (assignedMember?.displayName || assignedMember?.email || null) : null,
          updatedAt: new Date(),
        } as any);
        toast({ title: '✅ Kontrata u përditësua!' });
        setEditContract(null);
      } else {
        await contractMutation.create({
          teamId,
          customerId: formCustomerId,
          clientName: cust?.name || formCustomerId,
          clientEmail: cust?.email || undefined,
          leadId: (cust as any)?.leadId || undefined,
          quoteId: formQuoteId !== '__none__' ? formQuoteId : undefined,
          invoiceId: formInvoiceId !== '__none__' ? formInvoiceId : undefined,
          title: formTitle.trim(),
          body: formBody,
          notes: formNotes.trim() || undefined,
          expiresAt: formExpiry ? new Date(formExpiry) : undefined,
          packageSummary,
          assignedToUserId: formAssignedToUserId || undefined,
          assignedToName: assignedMember?.displayName || assignedMember?.email || undefined,
          status: 'Draft',
          createdByUserId: user?.uid || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
        toast({ title: '✅ Kontrata u krijua!' });
        setShowCreate(false);
      }
      resetForm();
    } catch {
      toast({ title: 'Gabim', description: 'Ndodhi një gabim', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (c: Contract) => {
    setSendingId(c.id);
    try {
      await contractMutation.update(c.id, { status: 'Sent', sentAt: new Date(), updatedAt: new Date() } as any);
      toast({ title: '✅ Kontrata u dërgua te klienti!' });
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    } finally {
      setSendingId(null);
    }
  };

  const handleDelete = async (c: Contract) => {
    if (!confirm(`Fshi kontratën "${c.title}"?`)) return;
    setDeletingId(c.id);
    try {
      await contractMutation.remove(c.id);
      toast({ title: 'Kontrata u fshi' });
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (d: any) => {
    if (!d) return '—';
    const date = d instanceof Date ? d : d?.toDate?.();
    if (!date) return '—';
    return date.toLocaleDateString('sq-AL', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const isFormOpen = showCreate || !!editContract;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="w-6 h-6" /> Kontratat
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Krijoni, dërgoni dhe monitoroni kontratat e klientëve
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> Kontratë e Re
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Gjithsej', value: stats.total, color: 'text-foreground' },
          { label: 'Draft', value: stats.pending, color: 'text-gray-600' },
          { label: 'Dërguar', value: stats.sent, color: 'text-blue-600' },
          { label: 'Nënshkruar', value: stats.signed, color: 'text-green-600' },
        ].map(s => (
          <Card key={s.label} className="py-3">
            <CardContent className="px-4 py-0">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Kërko kontratë..."
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Të gjitha</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Sent">Dërguar</SelectItem>
            <SelectItem value="Signed">Nënshkruar</SelectItem>
            <SelectItem value="Rejected">Refuzuar</SelectItem>
            <SelectItem value="Expired">Skaduar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Contract list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredContracts.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {!contracts?.length ? 'Nuk ka kontratat ende. Krijoni të parën!' : 'Nuk u gjet asnjë kontratë.'}
              </p>
            </div>
          ) : (
            <>
            {/* Mobile: stacked cards (the 8-column table is unreadable on a phone) */}
            <div className="sm:hidden divide-y">
              {filteredContracts.map(c => (
                <div key={c.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.title}</div>
                      {c.packageSummary && <div className="text-xs text-muted-foreground truncate">{c.packageSummary.label}</div>}
                    </div>
                    <Badge variant="secondary" className={STATUS_COLORS[c.status] || ''}>{STATUS_LABELS[c.status] || c.status}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{c.clientName}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Krijuar: {formatDate(c.createdAt)}</span>
                    {c.sentAt && <span>Dërguar: {formatDate(c.sentAt)}</span>}
                    {c.signedAt && <span className="text-green-600 font-medium">Nënshkruar: {formatDate(c.signedAt)}</span>}
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => setViewContract(c)}><Eye className="w-4 h-4 mr-1" />Shiko</Button>
                    {c.status === 'Draft' && (
                      <>
                        <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={() => openEdit(c)} title="Edito"><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-blue-600 hover:text-blue-700" onClick={() => handleSend(c)} disabled={sendingId === c.id} title="Dërgo te klienti">{sendingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</Button>
                        <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-red-500 hover:text-red-600" onClick={() => handleDelete(c)} disabled={deletingId === c.id} title="Fshi">{deletingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Titulli</th>
                    <th className="px-4 py-3 text-left font-medium">Klienti</th>
                    <th className="px-4 py-3 text-left font-medium">Agjent</th>
                    <th className="px-4 py-3 text-left font-medium">Statusi</th>
                    <th className="px-4 py-3 text-left font-medium">Krijuar</th>
                    <th className="px-4 py-3 text-left font-medium">Dërguar</th>
                    <th className="px-4 py-3 text-left font-medium">Nënshkruar</th>
                    <th className="px-4 py-3 text-center font-medium">Veprime</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredContracts.map(c => (
                    <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium max-w-[220px] truncate">{c.title}</div>
                        {c.packageSummary && (
                          <div className="text-xs text-muted-foreground">{c.packageSummary.label}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[140px]">{c.clientName}</span>
                        </div>
                        {c.clientEmail && (
                          <div className="text-xs text-muted-foreground truncate max-w-[160px]">{c.clientEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {c.assignedToName || (c.assignedToUserId ? (
                          <span className="text-xs font-mono">{c.assignedToUserId.slice(0, 8)}</span>
                        ) : '—')}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={STATUS_COLORS[c.status] || ''}>
                          {STATUS_LABELS[c.status] || c.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(c.createdAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.sentAt ? formatDate(c.sentAt) : '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.signedAt ? (
                          <span className="text-green-600 font-medium">{formatDate(c.signedAt)}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewContract(c)} title="Shiko">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {c.status === 'Draft' && (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(c)} title="Edito">
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700"
                                onClick={() => handleSend(c)}
                                disabled={sendingId === c.id}
                                title="Dërgo te klienti"
                              >
                                {sendingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                onClick={() => handleDelete(c)}
                                disabled={deletingId === c.id}
                                title="Fshi"
                              >
                                {deletingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── CREATE / EDIT DIALOG ─────────────────────────────────── */}
      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => { if (!open) { editorRef.current?.setContent(''); setShowCreate(false); setEditContract(null); resetForm(); } }}
      >
        <DialogContent className="max-w-[1180px] w-[96vw] h-[90dvh] flex flex-col p-0 gap-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <ScrollText className="w-4 h-4" />
              {editContract ? 'Edito Kontratën' : 'Kontratë e Re'}
            </DialogTitle>
          </DialogHeader>

          {/* Top controls */}
          <div className="px-6 py-3 border-b shrink-0 space-y-3 bg-muted/20">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Customer — searchable combobox */}
              <div className="space-y-1">
                <Label className="text-xs">Klienti <span className="text-red-500">*</span></Label>
                {editContract ? (
                  <div className="h-8 px-3 flex items-center border rounded-md bg-muted/40 text-sm text-muted-foreground">
                    {customers?.find(c => c.id === formCustomerId)?.name || formCustomerId || '—'}
                  </div>
                ) : (
                  <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="h-8 w-full justify-between text-sm font-normal px-3"
                      >
                        <span className="truncate">
                          {formCustomerId
                            ? (customers?.find(c => c.id === formCustomerId)?.name || '...')
                            : 'Zgjidh klientin...'}
                        </span>
                        <ChevronsUpDown className="w-3 h-3 ml-1 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[220px]" align="start">
                      {/* shouldFilter=false: cmdk's built-in filter matches the
                          typed text against each item's `value` (here the random
                          customer id), which hid all results. We filter manually
                          by name/company below instead. */}
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Kërko klient..."
                          value={customerSearch}
                          onValueChange={setCustomerSearch}
                        />
                        <CommandList className="max-h-52">
                          <CommandEmpty>Nuk u gjet asnjë klient.</CommandEmpty>
                          {customers
                            ?.filter(c =>
                              !customerSearch ||
                              c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
                              (c.company || '').toLowerCase().includes(customerSearch.toLowerCase()),
                            )
                            .map(c => (
                              <CommandItem
                                key={c.id}
                                value={c.id}
                                onSelect={() => {
                                  onCustomerChange(c.id);
                                  setCustomerOpen(false);
                                  setCustomerSearch('');
                                }}
                              >
                                <Check className={`w-3.5 h-3.5 mr-2 shrink-0 ${formCustomerId === c.id ? 'opacity-100' : 'opacity-0'}`} />
                                <div className="min-w-0">
                                  <div className="truncate">{c.name}</div>
                                  {c.company && <div className="text-[10px] text-muted-foreground truncate">{c.company}</div>}
                                </div>
                              </CommandItem>
                            ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {/* Template picker */}
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <LayoutTemplate className="w-3 h-3" /> Template
                </Label>
                <Select onValueChange={applyTemplate}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Zgjidh template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TEMPLATES.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        <div>
                          <div className="font-medium">{t.label}</div>
                          <div className="text-xs text-muted-foreground">{t.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Quote */}
              <div className="space-y-1">
                <Label className="text-xs">Preventivë (opsionale)</Label>
                <Select value={formQuoteId} onValueChange={onQuoteChange} disabled={!formCustomerId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Asnjë" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Asnjë</SelectItem>
                    {quotes?.filter(q => q.customerId === formCustomerId).map(q => (
                      <SelectItem key={q.id} value={q.id}>
                        {q.label || q.result?.suggestedLabel || q.id} ({q.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Invoice */}
              <div className="space-y-1">
                <Label className="text-xs">Faturë (opsionale)</Label>
                <Select value={formInvoiceId} onValueChange={setFormInvoiceId} disabled={!formCustomerId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Asnjë" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Asnjë</SelectItem>
                    {customerInvoices.map(inv => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoiceNumber || inv.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Title + Agent */}
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Titulli <span className="text-red-500">*</span></Label>
                <Input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Kontratë Shërbimi — Emri i Klientit"
                  className="h-8 text-sm"
                />
              </div>
              <div className="w-44 space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <UserCheck className="w-3 h-3" /> Agjent
                </Label>
                <Select value={formAssignedToUserId || '__none__'} onValueChange={v => setFormAssignedToUserId(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Pa agjent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Pa agjent</SelectItem>
                    {teamMembers?.filter(m => m.status === 'Active' && m.teamId === getGlobalTeamId()).map(m => (
                      <SelectItem key={m.id} value={m.userId}>
                        {m.displayName || m.email || m.userId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Main: services panel + editor. Stacks vertically on mobile (the fixed
              224px side panel would leave almost no room for the editor on a phone). */}
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
            {/* Services panel — full-width capped strip on mobile, fixed side column on desktop */}
            <div className="w-full md:w-56 max-h-40 md:max-h-none border-b md:border-b-0 md:border-r flex flex-col md:shrink-0 bg-muted/10">
              <div className="px-3 pt-3 pb-2 border-b shrink-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" /> Shërbime
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Tërhiq ose kliko për të shtuar</p>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {servicesLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : !services?.length ? (
                  <p className="text-xs text-muted-foreground px-1 py-2">Nuk ka shërbime.</p>
                ) : (
                  services.map(svc => (
                    <div
                      key={svc.id}
                      draggable
                      onDragStart={() => { draggedService.current = svc; }}
                      onDragEnd={() => { draggedService.current = null; }}
                      className="flex items-start gap-1.5 px-2 py-1.5 rounded-md border bg-white hover:bg-primary/5 hover:border-primary/30 cursor-grab active:cursor-grabbing transition-colors group select-none"
                    >
                      <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{svc.name || svc.title}</p>
                        {svc.price > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            {svc.price.toLocaleString()} {svc.currency || 'EUR'}/muaj
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="text-base md:text-xs text-primary opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity font-medium shrink-0 px-1"
                        onClick={() => editorRef.current?.insertContent(buildServiceHTML(svc))}
                        title="Shto në kontratë"
                        aria-label="Shto shërbimin në kontratë"
                      >
                        +
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Editor drop zone */}
            <div
              className={`flex-1 overflow-hidden p-3 transition-colors ${isDragOver ? 'bg-primary/5 ring-2 ring-primary/30 ring-inset' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (draggedService.current) {
                  editorRef.current?.insertContent(buildServiceHTML(draggedService.current));
                  draggedService.current = null;
                }
              }}
            >
              <ContractEditor
                ref={editorRef}
                content={formBody}
                onChange={setFormBody}
                minHeight="100%"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t shrink-0 flex items-center justify-between gap-4 bg-muted/10">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Skadon:</Label>
                <Input
                  type="date"
                  value={formExpiry}
                  onChange={e => setFormExpiry(e.target.value)}
                  className="h-7 text-xs w-36"
                />
              </div>
              <Input
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                placeholder="Shënime interne..."
                className="h-7 text-xs w-48"
              />
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowCreate(false); setEditContract(null); resetForm(); }}
              >
                Anulo
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                {editContract ? 'Ruaj Ndryshimet' : 'Krijo Kontratën'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── VIEW / PREVIEW DIALOG ───────────────────────────────── */}
      <Dialog open={!!viewContract} onOpenChange={(open) => { if (!open) setViewContract(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewContract && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ScrollText className="w-4 h-4" />
                  {viewContract.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="flex flex-wrap gap-3 text-sm">
                  <div><span className="text-muted-foreground">Klienti: </span><span className="font-medium">{viewContract.clientName}</span></div>
                  <div>
                    <span className="text-muted-foreground">Statusi: </span>
                    <Badge variant="secondary" className={STATUS_COLORS[viewContract.status] || ''}>{STATUS_LABELS[viewContract.status]}</Badge>
                  </div>
                  {viewContract.sentAt && <div><span className="text-muted-foreground">Dërguar: </span><span>{formatDate(viewContract.sentAt)}</span></div>}
                  {viewContract.signedAt && <div><span className="text-muted-foreground">Nënshkruar: </span><span className="text-green-600 font-medium">{formatDate(viewContract.signedAt)}</span></div>}
                </div>

                {viewContract.packageSummary && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Paketa: {viewContract.packageSummary.label}</p>
                      <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                        {viewContract.packageSummary.categories.map((cat, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span>{cat.category}</span>
                            <span className="text-muted-foreground">
                              {cat.oneTime > 0 && `${cat.oneTime.toLocaleString()} ${viewContract.packageSummary!.currency}`}
                              {cat.oneTime > 0 && cat.monthly > 0 && ' + '}
                              {cat.monthly > 0 && `${cat.monthly.toLocaleString()} ${viewContract.packageSummary!.currency}/muaj`}
                            </span>
                          </div>
                        ))}
                        <Separator />
                        <div className="flex justify-between text-sm font-semibold">
                          <span>Grand Total</span>
                          <span>{viewContract.packageSummary.grandTotal.toLocaleString()} {viewContract.packageSummary.currency}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <Separator />

                {/* HTML body */}
                <div className="bg-white border rounded-lg p-5">
                  {viewContract.body.includes('<') ? (
                    <div
                      className="contract-body"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(viewContract.body) }}
                    />
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{viewContract.body}</pre>
                  )}
                </div>

                {viewContract.status === 'Signed' && viewContract.signatureData && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-green-700">✓ Nënshkruar nga klienti</p>
                      {viewContract.signatureType === 'drawn' ? (
                        <img src={viewContract.signatureData} alt="Firma" className="h-16 border rounded bg-white p-1" />
                      ) : (
                        <p className="font-serif text-2xl italic border rounded p-2 bg-white inline-block">
                          {viewContract.signatureData}
                        </p>
                      )}
                      {viewContract.signedByEmail && (
                        <p className="text-xs text-muted-foreground">{viewContract.signedByEmail} — {formatDate(viewContract.signedAt)}</p>
                      )}
                    </div>
                  </>
                )}

                {viewContract.status === 'Rejected' && (
                  <>
                    <Separator />
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                      <strong>Refuzuar:</strong> {viewContract.rejectionReason || 'Pa arsye'}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ContractsView;

import React, { useState } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { DollarSign, Plus, Calendar as CalendarIcon, Building2, Repeat, Trash2, Pencil, Search, Check, X, ThumbsUp, ThumbsDown, Clock } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Switch } from '../components/ui/switch';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useFilteredByOwner, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import type { Expense, Team, Project, TeamMember } from '../types';

const ExpensesView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const { data: rawExpenses, loading: expensesLoading } = useCollection<Expense>('expenses', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only their own expenses
  const expenses = useFilteredByOwner(rawExpenses);
  const { data: teams } = useCollection<Team>('teams');
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  const expenseMutation = useMutation<Expense>('expenses');
  const notificationMutation = useMutation<any>('notifications');

  const handleCreateExpense = async (formData: FormData) => {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const amount = parseFloat(formData.get('amount') as string);
    if (isNaN(amount) || amount < 0) return;
    const currency = formData.get('currency') as string;
    const category = formData.get('category') as string;
    const departmentId = formData.get('departmentId') as string;
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const nextRecurringDate = formData.get('nextRecurringDate') as string;
    const status = formData.get('status') as string;
    const paidDate = formData.get('paidDate') as string;
    const projectId = formData.get('projectId') as string;

    const memberId = formData.get('memberId') as string;

    const isAdminOrManager = permissions.role === 'Admin' || permissions.role === 'Manager';
    await expenseMutation.create({
      title,
      description: description || undefined,
      amount,
      currency: currency || 'ALL',
      category,
      departmentId: departmentId || undefined,
      isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : undefined,
      nextRecurringDate: isRecurring && nextRecurringDate ? new Date(nextRecurringDate) : undefined,
      status: status || 'Active',
      approvalStatus: isAdminOrManager ? 'Approved' : 'Submitted',
      approvedByUserId: isAdminOrManager ? user?.uid : undefined,
      paidDate: paidDate ? new Date(paidDate) : undefined,
      projectId: projectId && projectId !== '__none__' ? projectId : undefined,
      memberId: memberId && memberId !== '__none__' ? memberId : undefined,
    } as any);

    logActivity('expense_added', `Shpenzim: ${title}`, { entityType: 'expense', description: `${amount} ${currency || 'ALL'}` });

    // Notify Admins and Managers about new expense (exclude submitter)
    const adminManagers = (teamMembers || []).filter(m =>
      m.userId !== user?.uid && (m.role === 'Admin' || m.role === 'Manager')
    );
    if (adminManagers.length > 0) {
      await Promise.all(adminManagers.map(m =>
        notificationMutation.create({
          userId: m.userId,
          type: 'expense_submitted',
          title: 'Shpenzim i Ri i Shtuar',
          message: `${title} — ${amount} ${currency || 'ALL'}`,
          isRead: false,
          actionUrl: '/app/expenses',
          actionLabel: 'Shiko Shpenzimet',
        })
      )).catch(err => console.error('[Notifications] expense_submitted dërgim dështoi:', err));
    }

    setIsCreateDialogOpen(false);
  };

  const handleUpdateExpense = async (formData: FormData) => {
    if (!selectedExpense) return;

    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const amount = parseFloat(formData.get('amount') as string);
    if (isNaN(amount) || amount < 0) return;
    const currency = formData.get('currency') as string;
    const category = formData.get('category') as string;
    const departmentId = formData.get('departmentId') as string;
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const nextRecurringDate = formData.get('nextRecurringDate') as string;
    const status = formData.get('status') as string;
    const paidDate = formData.get('paidDate') as string;

    const memberId = formData.get('memberId') as string;

    await expenseMutation.update(selectedExpense.id, {
      title,
      description: description || undefined,
      amount,
      currency: currency || 'ALL',
      category,
      departmentId: departmentId || undefined,
      isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : undefined,
      nextRecurringDate: isRecurring && nextRecurringDate ? new Date(nextRecurringDate) : undefined,
      status: status || 'Active',
      paidDate: paidDate ? new Date(paidDate) : undefined,
      memberId: memberId && memberId !== '__none__' ? memberId : undefined,
    } as any);

    setIsEditDialogOpen(false);
    setSelectedExpense(null);
  };

  const handleApproveExpense = async (id: string) => {
    await expenseMutation.update(id, { approvalStatus: 'Approved', approvedByUserId: user?.uid } as any);
  };

  const handleRejectExpense = async (id: string) => {
    await expenseMutation.update(id, { approvalStatus: 'Rejected', approvedByUserId: user?.uid } as any);
  };

  const handleDeleteExpense = async (id: string) => {
    if (confirm('Je i sigurt që dëshiron të fshish këtë shpenzim?')) {
      await expenseMutation.remove(id);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Salary':
        return 'bg-blue-100 text-blue-800';
      case 'Rent':
        return 'bg-purple-100 text-purple-800';
      case 'Utilities':
        return 'bg-yellow-100 text-yellow-800';
      case 'Office':
        return 'bg-green-100 text-green-800';
      case 'Hosting':
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const totalExpenses = expenses?.reduce((sum, exp) => sum + exp.amount, 0) || 0;
  const activeExpenses = expenses?.filter(e => e.status === 'Active').length || 0;
  const recurringExpenses = expenses?.filter(e => e.isRecurring).length || 0;
  const pendingApprovalCount = expenses?.filter(e => (e as any).approvalStatus === 'Submitted').length || 0;
  const isAdminOrManager = permissions.role === 'Admin' || permissions.role === 'Manager';

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'Salary': return 'Paga';
      case 'Rent': return 'Qira';
      case 'Utilities': return 'Shërbime (Ujë, Dritë)';
      case 'Office': return 'Zyrë';
      case 'Hosting': return 'Hosting & Software';
      case 'Marketing': return 'Marketing';
      case 'Travel': return 'Udhëtim';
      case 'Other': return 'Tjetër';
      default: return category;
    }
  };

  if (expensesLoading) {
    return <div className="flex items-center justify-center h-96">Duke ngarkuar shpenzimet...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-foreground">Shpenzimet</h1>
          <p className="text-body text-muted-foreground mt-1">
            {expenses?.length || 0} shpenzime totale · {activeExpenses} aktive · {recurringExpenses} periodike
            {isAdminOrManager && pendingApprovalCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-600 font-medium">
                <Clock className="w-3.5 h-3.5" />
                {pendingApprovalCount} në pritje miratimi
              </span>
            )}
          </p>
        </div>
        {permissions.canEdit && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Shpenzim i Ri
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Krijo Shpenzim të Ri</DialogTitle>
              </DialogHeader>
              <ExpenseForm onSubmit={handleCreateExpense} teams={teams || []} projects={projects || []} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Shpenzime Totale</p>
            <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-error" />
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium">
            {totalExpenses.toLocaleString()} ALL
          </p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Aktive</p>
            <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium">
            {activeExpenses}
          </p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Periodike</p>
            <Repeat className="w-4 h-4 sm:w-5 sm:h-5 text-tertiary" />
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium">
            {recurringExpenses}
          </p>
        </Card>
      </div>

      {/* Mobile card layout */}
      <div className="sm:hidden space-y-3">
        {expenses?.map((expense) => {
          const team = teams?.find(t => t.id === expense.departmentId);
          return (
            <Card key={expense.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{expense.title}</p>
                  {expense.description && (
                    <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{expense.description}</p>
                  )}
                </div>
                <Badge variant={expense.status === 'Active' ? 'default' : 'secondary'} className="ml-2 shrink-0">
                  {expense.status === 'Active' ? 'Aktiv' : expense.status === 'Inactive' ? 'Joaktiv' : expense.status}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={getCategoryColor(expense.category)}>
                  {getCategoryLabel(expense.category)}
                </Badge>
                <span className="font-semibold text-foreground">
                  {expense.amount.toLocaleString()} {expense.currency || 'ALL'}
                </span>
                {team && <span className="text-xs text-muted-foreground">· {team.name}</span>}
              </div>
              {expense.isRecurring && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Repeat className="w-3 h-3 text-tertiary" />
                  Periodike: {expense.recurringFrequency}
                </div>
              )}
              {(expense as any).approvalStatus && (
                <div className="flex items-center gap-1">
                  {(expense as any).approvalStatus === 'Submitted' && <Badge className="bg-amber-100 text-amber-800 text-xs"><Clock className="w-3 h-3 mr-1" />Në Pritje</Badge>}
                  {(expense as any).approvalStatus === 'Approved' && <Badge className="bg-green-100 text-green-800 text-xs"><Check className="w-3 h-3 mr-1" />Aprovuar</Badge>}
                  {(expense as any).approvalStatus === 'Rejected' && <Badge className="bg-red-100 text-red-800 text-xs"><X className="w-3 h-3 mr-1" />Refuzuar</Badge>}
                </div>
              )}
              {permissions.canEdit && (
                <div className="flex gap-2 pt-1 border-t">
                  <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => { setSelectedExpense(expense); setIsEditDialogOpen(true); }}>
                    <Pencil className="w-3.5 h-3.5" /> Ndrysho
                  </Button>
                  {isAdminOrManager && (expense as any).approvalStatus === 'Submitted' && (
                    <>
                      <Button variant="outline" size="sm" className="text-green-600 hover:text-green-700 border-green-200" onClick={() => handleApproveExpense(expense.id)}>
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 border-red-200" onClick={() => handleRejectExpense(expense.id)}>
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteExpense(expense.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Desktop table */}
      <Card className="overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Shpenzimi
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Kategoria
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Shuma
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Departamenti
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Periodike
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Statusi
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Veprime
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {expenses?.map((expense) => {
                const team = teams?.find(t => t.id === expense.departmentId);
                
                return (
                  <tr
                    key={expense.id}
                    className="hover:bg-muted/50 transition-colors duration-fast"
                  >
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <p className="text-body font-normal text-foreground">{expense.title}</p>
                        {expense.description && (
                          <p className="text-body-sm text-muted-foreground line-clamp-1">
                            {expense.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge className={getCategoryColor(expense.category)}>
                        {getCategoryLabel(expense.category)}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <span className="text-body font-semibold text-foreground">
                          {expense.amount.toLocaleString()}
                        </span>
                        <span className="text-body-sm text-muted-foreground">
                          {expense.currency}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-body text-foreground">
                      {team ? team.name : '-'}
                    </td>
                    <td className="px-6 py-4">
                      {expense.isRecurring ? (
                        <div className="flex items-center gap-2">
                          <Repeat className="w-4 h-4 text-tertiary" />
                          <span className="text-body-sm text-foreground">
                            {expense.recurringFrequency}
                          </span>
                        </div>
                      ) : (
                        <span className="text-body-sm text-muted-foreground">Njëherësh</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <Badge variant={expense.status === 'Active' ? 'default' : 'secondary'}>
                          {expense.status === 'Active' ? 'Aktiv' : expense.status === 'Inactive' ? 'Joaktiv' : expense.status}
                        </Badge>
                        {(expense as any).approvalStatus === 'Submitted' && <Badge className="bg-amber-100 text-amber-800 text-xs w-fit"><Clock className="w-3 h-3 mr-1" />Në Pritje</Badge>}
                        {(expense as any).approvalStatus === 'Approved' && <Badge className="bg-green-100 text-green-800 text-xs w-fit"><Check className="w-3 h-3 mr-1" />Aprovuar</Badge>}
                        {(expense as any).approvalStatus === 'Rejected' && <Badge className="bg-red-100 text-red-800 text-xs w-fit"><X className="w-3 h-3 mr-1" />Refuzuar</Badge>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2 flex-wrap">
                        {permissions.canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedExpense(expense);
                              setIsEditDialogOpen(true);
                            }}
                          >
                            Ndrysho
                          </Button>
                        )}
                        {isAdminOrManager && (expense as any).approvalStatus === 'Submitted' && (
                          <>
                            <Button variant="outline" size="sm" className="text-green-600 hover:text-green-700 border-green-200 gap-1" onClick={() => handleApproveExpense(expense.id)}>
                              <ThumbsUp className="w-3.5 h-3.5" /> Aprovo
                            </Button>
                            <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 border-red-200 gap-1" onClick={() => handleRejectExpense(expense.id)}>
                              <ThumbsDown className="w-3.5 h-3.5" /> Refuzo
                            </Button>
                          </>
                        )}
                        {permissions.canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeleteExpense(expense.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedExpense && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Ndrysho Shpenzimin</DialogTitle>
            </DialogHeader>
            <ExpenseForm onSubmit={handleUpdateExpense} teams={teams || []} projects={projects || []} initialData={selectedExpense} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

const DEFAULT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'Salary', label: 'Paga' },
  { value: 'Rent', label: 'Qira' },
  { value: 'Utilities', label: 'Shërbime (Ujë, Dritë)' },
  { value: 'Office', label: 'Furnizime Zyre' },
  { value: 'Hosting', label: 'Hosting & Software' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Travel', label: 'Udhëtim' },
  { value: 'Other', label: 'Tjetër' },
];

const ExpenseForm: React.FC<{
  onSubmit: (data: FormData) => void;
  teams: Team[];
  projects?: Project[];
  initialData?: Expense;
}> = ({ onSubmit, teams, projects, initialData }) => {
  const [isRecurring, setIsRecurring] = useState(initialData?.isRecurring || false);
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>((initialData as any)?.memberId || '__none__');
  const { data: rawTeamMembersForm } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembersForm);

  // Custom categories stored in Firestore
  const { data: customCategoryDocs } = useCollection<{ id: string; label: string }>('expenseCategories');
  const categoryMutation = useMutation<{ label: string }>('expenseCategories');
  const [selectedCategory, setSelectedCategory] = useState(initialData?.category || 'Office');
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  const allCategories = [
    ...DEFAULT_CATEGORIES,
    ...(customCategoryDocs || []).map(d => ({ value: d.label, label: d.label })),
  ];

  const handleAddCategory = async () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    const alreadyExists = allCategories.some(c => c.value.toLowerCase() === trimmed.toLowerCase());
    if (!alreadyExists) {
      await categoryMutation.create({ label: trimmed });
    }
    setSelectedCategory(trimmed);
    setIsAddingCategory(false);
    setNewCategoryInput('');
  };
  const [selectedProjectId, setSelectedProjectId] = useState<string>((initialData as any)?.projectId || '__none__');
  const [nextRecurringDate, setNextRecurringDate] = useState<Date | undefined>(
    initialData?.nextRecurringDate ? new Date(initialData.nextRecurringDate) : undefined
  );
  const [paidDate, setPaidDate] = useState<Date | undefined>(
    initialData?.paidDate ? new Date(initialData.paidDate) : undefined
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('isRecurring', isRecurring.toString());
    if (nextRecurringDate) {
      formData.set('nextRecurringDate', nextRecurringDate.toISOString());
    }
    if (paidDate) {
      formData.set('paidDate', paidDate.toISOString());
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="title">Titulli i Shpenzimit *</Label>
          <Input id="title" name="title" required defaultValue={initialData?.title} />
        </div>

        <div>
          <Label htmlFor="category">Kategoria *</Label>
          {/* Hidden input so FormData always carries the value */}
          <input type="hidden" name="category" value={selectedCategory} />
          <Select value={selectedCategory} onValueChange={v => { if (v !== '__add__') setSelectedCategory(v); }}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh kategorinë" />
            </SelectTrigger>
            <SelectContent>
              {allCategories.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
              {/* Inline add new category */}
              <div className="border-t mt-1 pt-1">
                {isAddingCategory ? (
                  <div className="flex items-center gap-1 px-2 py-1.5" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      className="flex-1 text-sm bg-transparent outline-none border-b border-border placeholder:text-muted-foreground"
                      placeholder="Emri i kategorisë..."
                      value={newCategoryInput}
                      onChange={e => setNewCategoryInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } if (e.key === 'Escape') { setIsAddingCategory(false); setNewCategoryInput(''); } }}
                    />
                    <button type="button" onClick={handleAddCategory} className="p-0.5 text-green-600 hover:text-green-700"><Check className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => { setIsAddingCategory(false); setNewCategoryInput(''); }} className="p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-primary hover:bg-muted/50 rounded-sm"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setIsAddingCategory(true); }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Shto kategori të re...
                  </button>
                )}
              </div>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="amount">Shuma *</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={initialData?.amount}
          />
        </div>

        <div>
          <Label htmlFor="currency">Monedha *</Label>
          <Select name="currency" defaultValue={initialData?.currency || 'ALL'}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL (Albanian Lek)</SelectItem>
              <SelectItem value="EUR">EUR (Euro)</SelectItem>
              <SelectItem value="USD">USD (US Dollar)</SelectItem>
              <SelectItem value="GBP">GBP (British Pound)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="departmentId">Departamenti (Opsionale)</Label>
        <Select name="departmentId" defaultValue={initialData?.departmentId}>
          <SelectTrigger>
            <SelectValue placeholder="Zgjidh departamentin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Asnjë</SelectItem>
            {teams.map(team => (
              <SelectItem key={team.id} value={team.id}>
                {team.name} {team.department ? `(${team.department})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedCategory === 'Salary' && (
        <div>
          <Label htmlFor="memberId">Anëtar i stafit (Opsionale)</Label>
          <input type="hidden" name="memberId" value={selectedMemberId} />
          <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh anëtarin..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Pa lidhje me anëtar</SelectItem>
              {(teamMembers || []).map(m => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name || m.email || m.userId}
                  {m.monthlySalary ? ` — ${m.monthlySalary.toLocaleString('sq-AL')} L/muaj` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="projectId">Projekti (Opsionale)</Label>
        {/* Hidden input so FormData picks up the value */}
        <input type="hidden" name="projectId" value={selectedProjectId} />
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger>
            <SelectValue placeholder="Lidh me projekt" />
          </SelectTrigger>
          <SelectContent>
            {/* Search box inside dropdown */}
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b">
              <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <input
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                placeholder="Kërko projekt..."
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
              />
            </div>
            <SelectItem value="__none__">Asnjë projekt</SelectItem>
            {projects
              ?.filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
              .map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            {projects?.filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase())).length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">Asnjë rezultat</div>
            )}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="description">Përshkrimi</Label>
        <Textarea id="description" name="description" rows={3} defaultValue={initialData?.description} />
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="isRecurring"
          checked={isRecurring}
          onCheckedChange={setIsRecurring}
        />
        <Label htmlFor="isRecurring">Shpenzim Periodik</Label>
      </div>

      {isRecurring && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="recurringFrequency">Frekuenca *</Label>
            <Select name="recurringFrequency" defaultValue={initialData?.recurringFrequency || 'monthly'}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Javore</SelectItem>
                <SelectItem value="monthly">Mujore</SelectItem>
                <SelectItem value="yearly">Vjetore</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Data e Ardhshme Periodike</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {nextRecurringDate ? nextRecurringDate.toLocaleDateString() : "Zgjidh datën"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={nextRecurringDate} onSelect={setNextRecurringDate} />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="status">Statusi *</Label>
          <Select name="status" defaultValue={initialData?.status || 'Active'}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Aktiv</SelectItem>
              <SelectItem value="Inactive">Joaktiv</SelectItem>
              <SelectItem value="Cancelled">Anuluar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Data e Pagesës (Opsionale)</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {paidDate ? paidDate.toLocaleDateString() : "Zgjidh datën"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar mode="single" selected={paidDate} onSelect={setPaidDate} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Button type="submit" className="w-full">
        {initialData ? 'Përditëso Shpenzimin' : 'Krijo Shpenzimin'}
      </Button>
    </form>
  );
};

export default ExpensesView;

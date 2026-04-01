import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { Globe, Plus, DollarSign, Search, Share2, PenTool, Palette, Package, Edit, Trash2, X, Tag } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import RichTextEditor from '../components/RichTextEditor';
import { sanitizeHtml } from '../lib/utils';
import type { Service } from '../types';

interface ServiceCategory {
  id: string;
  name: string;
  teamId?: string;
  createdAt: Date;
}

const DEFAULT_CATEGORIES = [
  'Web Design',
  'SEO',
  'Social Media Marketing',
  'Content Writing',
  'Branding',
  'Other',
];

const ServicesView: React.FC = () => {
  const permissions = usePermissions();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);

  const { data: services, loading: servicesLoading } = useCollection<Service>('services', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  const serviceMutation = useMutation<Service>('services');

  const { data: customCategories } = useCollection<ServiceCategory>('serviceCategories', {
    orderBy: { field: 'name', direction: 'asc' },
  });
  const categoryMutation = useMutation<ServiceCategory>('serviceCategories');

  const allCategories = useMemo(() => {
    const custom = customCategories?.map(c => c.name) || [];
    const combined = [...DEFAULT_CATEGORIES, ...custom.filter(c => !DEFAULT_CATEGORIES.includes(c))];
    return combined;
  }, [customCategories]);

  const handleAddCategory = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || allCategories.includes(trimmed)) return;
    await categoryMutation.create({ name: trimmed });
  };

  const handleDeleteCategory = async (id: string) => {
    await categoryMutation.remove(id);
  };

  const handleCreateService = async (formData: FormData) => {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const price = parseFloat(formData.get('price') as string);
    const category = formData.get('category') as string;
    const currency = formData.get('currency') as string;

    await serviceMutation.create({
      title,
      description,
      price,
      category,
      currency: currency || 'ALL',
    });

    setIsCreateDialogOpen(false);
  };

  const handleUpdateService = async (formData: FormData) => {
    if (!selectedService) return;

    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const price = parseFloat(formData.get('price') as string);
    const category = formData.get('category') as string;
    const currency = formData.get('currency') as string;

    await serviceMutation.update(selectedService.id, {
      title,
      description,
      price,
      category,
      currency: currency || 'ALL',
    });

    setIsEditDialogOpen(false);
    setSelectedService(null);
  };

  const handleDeleteService = async (id: string) => {
    if (confirm('Are you sure you want to delete this service?')) {
      await serviceMutation.remove(id);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Web Design':
        return 'bg-blue-100 text-blue-800';
      case 'SEO':
        return 'bg-green-100 text-green-800';
      case 'Social Media Marketing':
        return 'bg-purple-100 text-purple-800';
      case 'Content Writing':
        return 'bg-orange-100 text-orange-800';
      case 'Branding':
        return 'bg-pink-100 text-pink-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Web Design':
        return { Icon: Globe, bg: 'bg-blue-100', color: 'text-blue-600' };
      case 'SEO':
        return { Icon: Search, bg: 'bg-green-100', color: 'text-green-600' };
      case 'Social Media Marketing':
        return { Icon: Share2, bg: 'bg-purple-100', color: 'text-purple-600' };
      case 'Content Writing':
        return { Icon: PenTool, bg: 'bg-orange-100', color: 'text-orange-600' };
      case 'Branding':
        return { Icon: Palette, bg: 'bg-pink-100', color: 'text-pink-600' };
      default:
        return { Icon: Package, bg: 'bg-gray-100', color: 'text-gray-600' };
    }
  };

  if (servicesLoading) {
    return <div className="flex items-center justify-center h-96">Loading services...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-foreground">Shërbime</h1>
          <p className="text-body text-muted-foreground mt-1">
            {services?.length || 0} shërbime gjithsej
          </p>
        </div>
        {permissions.canEdit && (
          <div className="flex gap-2 w-full sm:w-auto">
            <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto">
                  <Tag className="w-4 h-4 mr-2" />
                  Kategoritë
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Menaxho Kategoritë</DialogTitle>
                </DialogHeader>
                <CategoryManager
                  customCategories={customCategories || []}
                  allCategories={allCategories}
                  onAdd={handleAddCategory}
                  onDelete={handleDeleteCategory}
                />
              </DialogContent>
            </Dialog>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Shërbim i Ri
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Krijo Shërbim të Ri</DialogTitle>
                </DialogHeader>
                <ServiceForm onSubmit={handleCreateService} categories={allCategories} />
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services?.map((service) => {
          const { Icon: CategoryIcon, bg: iconBg, color: iconColor } = getCategoryIcon(service.category);
          return (
          <Card key={service.id} className="p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${iconBg}`}>
                  <CategoryIcon className={`w-6 h-6 ${iconColor}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">{service.title}</h3>
                  <Badge className={getCategoryColor(service.category)}>
                    {service.category}
                  </Badge>
                </div>
              </div>
            </div>

            {service.description && (
              <div 
                className="text-sm text-muted-foreground line-clamp-3 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(service.description) }}
              />
            )}

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-success" />
                <div>
                  <span className="text-2xl font-bold text-foreground">
                    {service.price.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground ml-2">
                    {service.currency || 'ALL'}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {permissions.canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedService(service);
                      setIsEditDialogOpen(true);
                    }}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                )}
                {permissions.canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteService(service.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
          );
        })}
      </div>

      {selectedService && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Service</DialogTitle>
            </DialogHeader>
            <ServiceForm onSubmit={handleUpdateService} initialData={selectedService} categories={allCategories} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

const CategoryManager: React.FC<{
  customCategories: ServiceCategory[];
  allCategories: string[];
  onAdd: (name: string) => void;
  onDelete: (id: string) => void;
}> = ({ customCategories, allCategories, onAdd, onDelete }) => {
  const [newName, setNewName] = useState('');

  const handleAdd = () => {
    if (newName.trim()) {
      onAdd(newName.trim());
      setNewName('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Emri i kategorisë së re..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        />
        <Button type="button" onClick={handleAdd} disabled={!newName.trim() || allCategories.includes(newName.trim())}>
          <Plus className="w-4 h-4 mr-1" /> Shto
        </Button>
      </div>

      {allCategories.includes(newName.trim()) && newName.trim() && (
        <p className="text-xs text-destructive">Kjo kategori ekziston tashmë</p>
      )}

      <div>
        <Label className="text-sm font-medium mb-2 block">Kategoritë Default</Label>
        <div className="flex flex-wrap gap-1.5">
          {DEFAULT_CATEGORIES.map(cat => (
            <Badge key={cat} variant="secondary" className="text-xs">{cat}</Badge>
          ))}
        </div>
      </div>

      {customCategories.length > 0 && (
        <div>
          <Label className="text-sm font-medium mb-2 block">Kategoritë e Shtuara</Label>
          <div className="flex flex-wrap gap-1.5">
            {customCategories.map(cat => (
              <Badge key={cat.id} variant="outline" className="text-xs flex items-center gap-1 pr-1">
                {cat.name}
                <button
                  type="button"
                  onClick={() => onDelete(cat.id)}
                  className="hover:bg-destructive/10 rounded-full p-0.5"
                >
                  <X className="w-3 h-3 text-destructive" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ServiceForm: React.FC<{
  onSubmit: (data: FormData) => void;
  initialData?: Service;
  categories: string[];
}> = ({ onSubmit, initialData, categories }) => {
  const [htmlContent, setHtmlContent] = useState(initialData?.description || '');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('description', htmlContent);
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="title">Service Title *</Label>
          <Input id="title" name="title" required defaultValue={initialData?.title} />
        </div>

        <div>
          <Label htmlFor="category">Category *</Label>
          <Select name="category" defaultValue={initialData?.category || categories[0] || 'Web Design'}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="price">Price *</Label>
          <Input
            id="price"
            name="price"
            type="number"
            step="0.01"
            required
            defaultValue={initialData?.price}
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
        <Label className="mb-1.5 block">Përshkrimi</Label>
        <RichTextEditor
          content={htmlContent}
          onChange={setHtmlContent}
          placeholder="Shkruaj përshkrimin e shërbimit..."
          minHeight="200px"
        />
      </div>

      <Button type="submit" className="w-full">
        {initialData ? 'Update Service' : 'Create Service'}
      </Button>
    </form>
  );
};

export default ServicesView;

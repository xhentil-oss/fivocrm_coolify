import React, { useState } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { usePermissions } from '../hooks/usePermissions';
import { Globe, Plus, DollarSign, Search, Share2, PenTool, Palette, Package, Edit, Trash2 } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { sanitizeHtml } from '../lib/utils';
import type { Service } from '../types';

const ServicesView: React.FC = () => {
  const permissions = usePermissions();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const { data: services, loading: servicesLoading } = useCollection<Service>('services', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  const serviceMutation = useMutation<Service>('services');

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
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Shërbim i Ri
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Krijo Shërbim të Ri</DialogTitle>
              </DialogHeader>
              <ServiceForm onSubmit={handleCreateService} />
            </DialogContent>
          </Dialog>
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
            <ServiceForm onSubmit={handleUpdateService} initialData={selectedService} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

const ServiceForm: React.FC<{
  onSubmit: (data: FormData) => void;
  initialData?: Service;
}> = ({ onSubmit, initialData }) => {
  const [htmlContent, setHtmlContent] = useState(initialData?.description || '');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

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
          <Select name="category" defaultValue={initialData?.category || 'Web Design'}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Web Design">Web Design</SelectItem>
              <SelectItem value="SEO">SEO</SelectItem>
              <SelectItem value="Social Media Marketing">Social Media Marketing</SelectItem>
              <SelectItem value="Content Writing">Content Writing</SelectItem>
              <SelectItem value="Branding">Branding</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
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
          <Label htmlFor="currency">Currency *</Label>
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
        <Label>Description (HTML Editor)</Label>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'edit' | 'preview')} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="edit">Edit HTML</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="edit" className="mt-2">
            <Textarea
              id="description"
              name="description"
              rows={12}
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              placeholder="Enter HTML content here..."
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              You can use HTML tags like {'<h1>'}, {'<p>'}, {'<ul>'}, {'<strong>'}, {'<em>'}, etc.
            </p>
          </TabsContent>
          <TabsContent value="preview" className="mt-2">
            <div 
              className="border rounded-md p-4 min-h-[200px] prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(htmlContent) }}
            />
          </TabsContent>
        </Tabs>
      </div>

      <Button type="submit" className="w-full">
        {initialData ? 'Update Service' : 'Create Service'}
      </Button>
    </form>
  );
};

export default ServicesView;

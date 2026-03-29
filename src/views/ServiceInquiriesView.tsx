import React, { useState } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import {
  FileText, Search, Building, User, Mail, Phone, Globe, MapPin, Target,
  DollarSign, Clock, FolderOpen, Share2, Megaphone, Palette,
  ExternalLink, Tag, Calendar, CheckCircle2, Eye, AlertCircle,
  Instagram, Facebook, Linkedin, ArrowRight,
} from 'lucide-react';
import type { ServiceInquiry, Lead } from '../types';
import { safeHref } from '../lib/utils';

const ServiceInquiriesView: React.FC = () => {
  usePermissions(); // ensures teamId is synced
  const [selectedInquiry, setSelectedInquiry] = useState<ServiceInquiry | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: inquiries, loading } = useCollection<ServiceInquiry>('serviceInquiries', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  useCollection<Lead>('leads');
  const inquiryMutation = useMutation<ServiceInquiry>('serviceInquiries');

  const filtered = React.useMemo(() => {
    if (!inquiries) return [];
    let result = inquiries;
    if (statusFilter !== 'all') {
      result = result.filter(i => i.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.businessName?.toLowerCase().includes(q) ||
        i.contactName?.toLowerCase().includes(q) ||
        i.email?.toLowerCase().includes(q) ||
        i.servicesInterestedIn?.some(s => s.toLowerCase().includes(q))
      );
    }
    return result;
  }, [inquiries, statusFilter, searchQuery]);

  const stats = React.useMemo(() => {
    if (!inquiries) return { total: 0, new: 0, reviewed: 0, converted: 0 };
    return {
      total: inquiries.length,
      new: inquiries.filter(i => i.status === 'New').length,
      reviewed: inquiries.filter(i => i.status === 'Reviewed').length,
      converted: inquiries.filter(i => i.status === 'Converted').length,
    };
  }, [inquiries]);

  const handleStatusChange = async (id: string, status: string) => {
    await inquiryMutation.update(id, { status: status as ServiceInquiry['status'] });
    if (selectedInquiry?.id === id) {
      setSelectedInquiry(prev => prev ? { ...prev, status: status as any } : null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'New':
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">E Re</Badge>;
      case 'Reviewed':
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Shqyrtuar</Badge>;
      case 'Converted':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Konvertuar</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getBudgetBadge = (budget: string) => {
    const isHigh = ['€1000–€3000', '€3000+'].includes(budget);
    return (
      <Badge className={isHigh
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      }>
        {budget}
      </Badge>
    );
  };

  const formatDate = (date: any) => {
    if (!date) return '—';
    const d = date instanceof Date ? date : date?.toDate?.() ? date.toDate() : new Date(date);
    return d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-48 skeleton rounded" />
            <div className="h-4 w-64 skeleton rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="p-6 bg-card rounded-lg border space-y-3">
              <div className="h-5 w-3/4 skeleton rounded" />
              <div className="h-4 w-full skeleton rounded" />
              <div className="flex gap-2">
                <div className="h-5 w-20 skeleton rounded" />
                <div className="h-5 w-16 skeleton rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Kërkesat e Shërbimeve</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pyetësorët e dorëzuar nga klientët
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Gjithsej</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-blue-600">{stats.new}</div>
          <div className="text-xs text-muted-foreground">Të Reja</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-amber-600">{stats.reviewed}</div>
          <div className="text-xs text-muted-foreground">Të Shqyrtuara</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-green-600">{stats.converted}</div>
          <div className="text-xs text-muted-foreground">Të Konvertuara</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Kërko sipas emrit, email, shërbimit..."
            className="pl-9 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[160px] h-9">
            <SelectValue placeholder="Statusi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha</SelectItem>
            <SelectItem value="New">Të Reja</SelectItem>
            <SelectItem value="Reviewed">Të Shqyrtuara</SelectItem>
            <SelectItem value="Converted">Të Konvertuara</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Inquiry List */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nuk ka kërkesa</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(inquiry => {
            const isUrgent = inquiry.timeline === 'Menjëherë' || inquiry.isUrgent === 'Po';
            const isHighValue = ['€1000–€3000', '€3000+'].includes(inquiry.budgetRange);

            return (
              <Card
                key={inquiry.id}
                className={`cursor-pointer hover:shadow-md transition-all ${
                  isUrgent ? 'border-l-4 border-l-red-500' : isHighValue ? 'border-l-4 border-l-emerald-500' : ''
                }`}
                onClick={() => setSelectedInquiry(inquiry)}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate">{inquiry.businessName}</h3>
                      <p className="text-xs text-muted-foreground truncate">{inquiry.contactName} · {inquiry.email}</p>
                    </div>
                    {getStatusBadge(inquiry.status)}
                  </div>

                  {/* Services */}
                  <div className="flex flex-wrap gap-1">
                    {inquiry.servicesInterestedIn?.map(s => (
                      <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">
                        {s}
                      </Badge>
                    ))}
                  </div>

                  {/* Description preview */}
                  {inquiry.projectNeedDescription && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {inquiry.projectNeedDescription}
                    </p>
                  )}

                  {/* Footer info */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                    <div className="flex items-center gap-3">
                      {getBudgetBadge(inquiry.budgetRange)}
                      {isUrgent && (
                        <span className="flex items-center gap-0.5 text-red-600">
                          <AlertCircle className="w-3 h-3" />
                          Urgjent
                        </span>
                      )}
                    </div>
                    <span>{formatDate(inquiry.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedInquiry} onOpenChange={open => { if (!open) setSelectedInquiry(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Detajet e Kërkesës
            </DialogTitle>
          </DialogHeader>

          {selectedInquiry && (
            <div className="flex-1 overflow-y-auto pr-2">
              <div className="space-y-6 pb-4">
                {/* Status + Actions bar */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(selectedInquiry.status)}
                    <span className="text-xs text-muted-foreground">{formatDate(selectedInquiry.createdAt)}</span>
                  </div>
                  <div className="flex gap-2">
                    {selectedInquiry.status === 'New' && (
                      <Button size="sm" variant="outline" onClick={() => handleStatusChange(selectedInquiry.id, 'Reviewed')}>
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Shëno si Shqyrtuar
                      </Button>
                    )}
                    {selectedInquiry.status !== 'Converted' && (
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleStatusChange(selectedInquiry.id, 'Converted')}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Konverto
                      </Button>
                    )}
                  </div>
                </div>

                {/* Section 1: Basic Info */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <Building className="w-4 h-4" />
                    Informacion Bazë
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/30 rounded-lg p-4">
                    <InfoRow icon={Building} label="Biznesi" value={selectedInquiry.businessName} />
                    <InfoRow icon={User} label="Kontakti" value={selectedInquiry.contactName} />
                    <InfoRow icon={Mail} label="Email" value={selectedInquiry.email} isLink={`mailto:${selectedInquiry.email}`} />
                    <InfoRow icon={Phone} label="Telefon" value={selectedInquiry.phoneNumber} isLink={`tel:${selectedInquiry.phoneNumber}`} />
                    {selectedInquiry.jobTitle && <InfoRow icon={User} label="Pozicioni" value={selectedInquiry.jobTitle} />}
                    <InfoRow icon={Tag} label="Industria" value={selectedInquiry.industry} />
                    <InfoRow icon={MapPin} label="Qyteti" value={selectedInquiry.cityMarket || '—'} />
                    {selectedInquiry.website && <InfoRow icon={Globe} label="Website" value={selectedInquiry.website} isLink={selectedInquiry.website} />}
                  </div>
                  {/* Social links */}
                  {(selectedInquiry.instagramLink || selectedInquiry.facebookLink || selectedInquiry.tiktokLink || selectedInquiry.linkedinLink) && (
                    <div className="flex flex-wrap gap-2">
                      {selectedInquiry.instagramLink && (
                        <a href={safeHref(selectedInquiry.instagramLink)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-pink-600 bg-pink-50 dark:bg-pink-950/30 px-2 py-1 rounded hover:underline">
                          <Instagram className="w-3 h-3" /> Instagram
                        </a>
                      )}
                      {selectedInquiry.facebookLink && (
                        <a href={safeHref(selectedInquiry.facebookLink)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded hover:underline">
                          <Facebook className="w-3 h-3" /> Facebook
                        </a>
                      )}
                      {selectedInquiry.tiktokLink && (
                        <a href={safeHref(selectedInquiry.tiktokLink)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-foreground bg-muted px-2 py-1 rounded hover:underline">
                          <Share2 className="w-3 h-3" /> TikTok
                        </a>
                      )}
                      {selectedInquiry.linkedinLink && (
                        <a href={safeHref(selectedInquiry.linkedinLink)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 dark:bg-blue-950/30 px-2 py-1 rounded hover:underline">
                          <Linkedin className="w-3 h-3" /> LinkedIn
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Section 2: Service Interest */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <Target className="w-4 h-4" />
                    Interesi për Shërbimin
                  </h4>
                  <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                    <div>
                      <span className="text-xs text-muted-foreground">Shërbimet e zgjedhura</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {selectedInquiry.servicesInterestedIn?.map(s => (
                          <Badge key={s} className="bg-primary/10 text-primary">{s}</Badge>
                        ))}
                      </div>
                    </div>
                    <InfoRow icon={Target} label="Objektivi kryesor" value={selectedInquiry.mainGoal} />
                    <div>
                      <span className="text-xs text-muted-foreground">Përshkrimi i nevojës</span>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{selectedInquiry.projectNeedDescription}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Sfida kryesore</span>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{selectedInquiry.currentMainChallenge}</p>
                    </div>
                    <InfoRow icon={User} label="Ka punuar me agjenci" value={selectedInquiry.hasWorkedWithAgency || '—'} />
                    {selectedInquiry.whatHaveYouTried && (
                      <div>
                        <span className="text-xs text-muted-foreground">Çfarë ka provuar</span>
                        <p className="text-sm mt-1 whitespace-pre-wrap">{selectedInquiry.whatHaveYouTried}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 3: Budget & Timeline */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <DollarSign className="w-4 h-4" />
                    Buxheti & Afati
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/30 rounded-lg p-4">
                    <div>
                      <span className="text-xs text-muted-foreground">Buxheti</span>
                      <div className="mt-1">{getBudgetBadge(selectedInquiry.budgetRange)}</div>
                    </div>
                    <InfoRow icon={Clock} label="Afati" value={selectedInquiry.timeline} />
                    <InfoRow icon={AlertCircle} label="Urgjent" value={selectedInquiry.isUrgent || '—'} />
                    <InfoRow icon={User} label="Vendimmarrësi" value={selectedInquiry.decisionMaker} />
                    <InfoRow icon={Phone} label="Kontakt i preferuar" value={selectedInquiry.preferredContactMethod || '—'} />
                  </div>
                </div>

                {/* Section 4: Materials */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">
                    <FolderOpen className="w-4 h-4" />
                    Materialet
                  </h4>
                  <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                    <InfoRow icon={FolderOpen} label="Ka materiale" value={selectedInquiry.hasExistingMaterials} />
                    {selectedInquiry.googleDriveLink && (
                      <div className="flex items-center gap-2">
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <a href={safeHref(selectedInquiry.googleDriveLink)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate">
                          {selectedInquiry.googleDriveLink}
                        </a>
                      </div>
                    )}
                    {selectedInquiry.secondGoogleDriveLink && (
                      <div className="flex items-center gap-2">
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <a href={safeHref(selectedInquiry.secondGoogleDriveLink)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate">
                          {selectedInquiry.secondGoogleDriveLink}
                        </a>
                      </div>
                    )}
                    {selectedInquiry.folderIncludes && selectedInquiry.folderIncludes.length > 0 && (
                      <div>
                        <span className="text-xs text-muted-foreground">Dosja përfshin</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {selectedInquiry.folderIncludes.map(f => (
                            <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedInquiry.hasBrandGuidelines && (
                      <InfoRow icon={Palette} label="Brand Guidelines" value={selectedInquiry.hasBrandGuidelines} />
                    )}
                  </div>
                </div>

                {/* Section 5: Service-Specific */}
                {selectedInquiry.servicesInterestedIn?.includes('Social Media Marketing') && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-purple-600">
                      <Share2 className="w-4 h-4" />
                      Social Media Marketing
                    </h4>
                    <div className="bg-purple-50/50 dark:bg-purple-950/10 rounded-lg p-4 space-y-3 border border-purple-100 dark:border-purple-900/30">
                      {selectedInquiry.smm_mainPlatforms && selectedInquiry.smm_mainPlatforms.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">Platformat</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {selectedInquiry.smm_mainPlatforms.map(p => (
                              <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      <InfoRow icon={Share2} label="Organik/Ads" value={selectedInquiry.smm_organicOrAds || '—'} />
                      <InfoRow icon={FolderOpen} label="Ka përmbajtje" value={selectedInquiry.smm_hasContent || '—'} />
                      <InfoRow icon={Calendar} label="Frekuenca" value={selectedInquiry.smm_postingFrequency || '—'} />
                      <InfoRow icon={User} label="Toni" value={selectedInquiry.smm_toneOfCommunication || '—'} />
                    </div>
                  </div>
                )}

                {selectedInquiry.servicesInterestedIn?.includes('Web Design') && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-blue-600">
                      <Globe className="w-4 h-4" />
                      Web Design
                    </h4>
                    <div className="bg-blue-50/50 dark:bg-blue-950/10 rounded-lg p-4 space-y-3 border border-blue-100 dark:border-blue-900/30">
                      <InfoRow icon={Globe} label="Ka website" value={selectedInquiry.web_hasExistingWebsite || '—'} />
                      {selectedInquiry.web_existingWebsiteLink && (
                        <div className="flex items-center gap-2">
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <a href={safeHref(selectedInquiry.web_existingWebsiteLink)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate">
                            {selectedInquiry.web_existingWebsiteLink}
                          </a>
                        </div>
                      )}
                      <InfoRow icon={Target} label="Qëllimi" value={selectedInquiry.web_mainPurpose || '—'} />
                      <InfoRow icon={FileText} label="Nr. faqeve" value={selectedInquiry.web_estimatedPages || '—'} />
                      <InfoRow icon={FolderOpen} label="Tekste/foto gati" value={selectedInquiry.web_hasTextsAndPhotos || '—'} />
                      {selectedInquiry.web_websitesYouLike && (
                        <div>
                          <span className="text-xs text-muted-foreground">Website-e shembull</span>
                          <p className="text-sm mt-1 whitespace-pre-wrap">{selectedInquiry.web_websitesYouLike}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {selectedInquiry.servicesInterestedIn?.includes('Paid Ads') && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-orange-600">
                      <Megaphone className="w-4 h-4" />
                      Paid Ads
                    </h4>
                    <div className="bg-orange-50/50 dark:bg-orange-950/10 rounded-lg p-4 space-y-3 border border-orange-100 dark:border-orange-900/30">
                      {selectedInquiry.ads_platforms && selectedInquiry.ads_platforms.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">Platformat</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {selectedInquiry.ads_platforms.map(p => (
                              <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      <InfoRow icon={Target} label="Konvertimi" value={selectedInquiry.ads_mainConversionAction || '—'} />
                      <InfoRow icon={DollarSign} label="Buxheti mujor" value={selectedInquiry.ads_monthlyBudget || '—'} />
                      <InfoRow icon={Megaphone} label="Ka bërë ads" value={selectedInquiry.ads_hasRunAdsBefore || '—'} />
                      {selectedInquiry.ads_pastResults && (
                        <div>
                          <span className="text-xs text-muted-foreground">Rezultate të kaluara</span>
                          <p className="text-sm mt-1 whitespace-pre-wrap">{selectedInquiry.ads_pastResults}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Linked Lead */}
                {selectedInquiry.leadId && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Lead i lidhur: <span className="text-foreground font-medium">{selectedInquiry.leadId.slice(0, 12)}...</span></span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Helper component for info rows
const InfoRow: React.FC<{
  icon: React.ElementType;
  label: string;
  value?: string;
  isLink?: string;
}> = ({ icon: Icon, label, value, isLink }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        {isLink ? (
          <a href={safeHref(isLink)} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline block truncate">{value}</a>
        ) : (
          <p className="text-sm">{value}</p>
        )}
      </div>
    </div>
  );
};

export default ServiceInquiriesView;

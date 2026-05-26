import { useState } from 'react';
import { ExternalLink, Copy, Globe, Building2, Waves, Search, Sparkles, Briefcase, Paintbrush, GraduationCap, Share2, Leaf, Trees } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { toast } from '../hooks/use-toast';

interface LandingPageEntry {
  id: string;
  title: string;
  description: string;
  path: string;
  category: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  gradient: string;
  status: 'active' | 'draft';
}

const LANDING_PAGES: LandingPageEntry[] = [
  {
    id: 'seo',
    title: 'SEO Landing Page',
    description: 'Paketa SEO për biznese — Starter, Growth, Pro, Enterprise.',
    path: '/seo',
    category: 'SEO',
    icon: Search,
    color: 'text-violet-600',
    gradient: 'from-violet-500 to-purple-600',
    status: 'active',
  },
  {
    id: 'real-estate',
    title: 'Real Estate',
    description: 'Paketa Social Media për agjenci real estate — 4 nivele çmimesh.',
    path: '/real-estate',
    category: 'Social Media',
    icon: Building2,
    color: 'text-emerald-600',
    gradient: 'from-emerald-500 to-teal-600',
    status: 'active',
  },
  {
    id: 'resorte',
    title: 'Resorte & Hotele',
    description: 'Paketa Social Media për resorte, hotele, dhe industrinë e turizmit.',
    path: '/resorte',
    category: 'Social Media',
    icon: Waves,
    color: 'text-cyan-600',
    gradient: 'from-cyan-500 to-blue-600',
    status: 'active',
  },
  {
    id: 'estetike',
    title: 'Estetikë & Beauty',
    description: 'Paketa Social Media për klinika estetike, sallone, dhe industrinë e bukurisë.',
    path: '/estetike',
    category: 'Social Media',
    icon: Sparkles,
    color: 'text-rose-500',
    gradient: 'from-rose-500 to-pink-600',
    status: 'active',
  },
  {
    id: 'recruit',
    title: 'Recruit & Staffing',
    description: 'Paketa Social Media për agjenci rekrutimi dhe kompani HR.',
    path: '/recruit',
    category: 'Social Media',
    icon: Briefcase,
    color: 'text-blue-600',
    gradient: 'from-blue-500 to-indigo-600',
    status: 'active',
  },
  {
    id: 'interior-design',
    title: 'Interior Design',
    description: 'Paketa Social Media për studio dizajni interieri dhe dizajnerë.',
    path: '/interior-design',
    category: 'Social Media',
    icon: Paintbrush,
    color: 'text-amber-600',
    gradient: 'from-amber-500 to-orange-600',
    status: 'active',
  },
  {
    id: 'arsim',
    title: 'Arsim & Qendra Kursesh',
    description: 'Paketa marketing për shkolla private, qendra kursesh dhe akademi.',
    path: '/arsim',
    category: 'Education',
    icon: GraduationCap,
    color: 'text-indigo-600',
    gradient: 'from-indigo-500 to-violet-600',
    status: 'active',
  },
  {
    id: 'social-media',
    title: 'Rrjete Sociale',
    description: 'Paketa Social Media për çdo biznes — Starter, Growth, Pro, Agency.',
    path: '/social-media',
    category: 'Social Media',
    icon: Share2,
    color: 'text-pink-600',
    gradient: 'from-pink-500 to-purple-600',
    status: 'active',
  },
  {
    id: 'masazh',
    title: 'Qendra Masazhesh',
    description: 'Paketa SEO + Social Media për qendra masazhesh dhe wellness — nga 800€/muaj.',
    path: '/masazh',
    category: 'SEO + Social Media',
    icon: Leaf,
    color: 'text-teal-600',
    gradient: 'from-teal-500 to-emerald-600',
    status: 'active',
  },
  {
    id: 'agroturizem',
    title: 'Agroturizëm',
    description: 'Paketa SEO + Social Media për agroturizme dhe ferma — me 2 fotoshooting profesionale/muaj, nga 800€/muaj.',
    path: '/agroturizem',
    category: 'SEO + Social Media',
    icon: Trees,
    color: 'text-emerald-700',
    gradient: 'from-amber-500 to-emerald-600',
    status: 'active',
  },
];

const CATEGORIES = ['Të gjitha', ...Array.from(new Set(LANDING_PAGES.map((p) => p.category)))];

export default function LandingPagesView() {
  const [filter, setFilter] = useState('');
  const [activeCategory, setActiveCategory] = useState('Të gjitha');

  const filtered = LANDING_PAGES.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(filter.toLowerCase()) ||
      p.category.toLowerCase().includes(filter.toLowerCase());
    const matchesCategory = activeCategory === 'Të gjitha' || p.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const copyUrl = (path: string) => {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url);
    toast({ title: 'URL u kopjua', description: url });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Landing Pages</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Të gjitha faqet landing të publikuara — shiko, kopjo URL, ose hap direkt.
          </p>
        </div>
        <Badge variant="secondary" className="w-fit">
          {filtered.length} / {LANDING_PAGES.length} faqe
        </Badge>
      </div>

      {/* Search + Category Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Kërko landing page..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-full border transition-all duration-200 ${
                activeCategory === cat
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((page) => (
          <div
            key={page.id}
            className="group relative rounded-2xl border bg-card shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden"
          >
            {/* Gradient strip top */}
            <div className={`h-1.5 bg-gradient-to-r ${page.gradient}`} />

            <div className="p-5 space-y-4">
              {/* Icon + title */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${page.gradient} flex items-center justify-center`}>
                    <page.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{page.title}</h3>
                    <Badge variant="outline" className="text-[10px] mt-0.5">
                      {page.category}
                    </Badge>
                  </div>
                </div>
                <Badge
                  variant={page.status === 'active' ? 'default' : 'secondary'}
                  className="text-[10px]"
                >
                  {page.status === 'active' ? 'Aktive' : 'Draft'}
                </Badge>
              </div>

              {/* Description */}
              <p className="text-xs text-muted-foreground leading-relaxed">
                {page.description}
              </p>

              {/* URL */}
              <div className="flex items-center gap-2 text-xs bg-muted/50 rounded-lg px-3 py-2">
                <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <code className="text-muted-foreground truncate flex-1">{page.path}</code>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <a
                  href={page.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Hap Faqen
                </a>
                <button
                  onClick={() => copyUrl(page.path)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border hover:bg-muted transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Kopjo URL
                </button>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full text-center py-16 text-muted-foreground">
            <Globe className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Asnjë landing page nuk u gjet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

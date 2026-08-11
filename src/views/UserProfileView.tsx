import React, { useState, useEffect, useRef } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useFileUpload } from '../hooks/useFileUpload';
import { usePermissions } from '../hooks/usePermissions';
import {
  User,
  Briefcase,
  MapPin,
  Phone,
  Award,
  Edit,
  Save,
  X,
  ChevronDown,
  Check,
  FlaskConical,
  Camera,
} from 'lucide-react';
import { phoneKeyDown } from '../lib/utils';
import { sortArchivedLast } from '../lib/projectArchive';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Switch } from '../components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../components/ui/dropdown-menu';
import type { UserProfile, Task, Project, Goal } from '../types';

// Demo profiles for testing different user roles
const DEMO_PROFILES = [
  {
    id: 'demo-admin',
    name: 'Admin Demo',
    email: 'admin@demo.com',
    role: 'Admin',
    jobTitle: 'System Administrator',
    department: 'IT',
    avatar: '👨‍💼',
  },
  {
    id: 'demo-manager',
    name: 'Manager Demo',
    email: 'manager@demo.com',
    role: 'Manager',
    jobTitle: 'Project Manager',
    department: 'Operations',
    avatar: '👩‍💻',
  },
  {
    id: 'demo-member',
    name: 'Member Demo',
    email: 'member@demo.com',
    role: 'Member',
    jobTitle: 'Developer',
    department: 'Web Development',
    avatar: '👨‍🔧',
  },
  {
    id: 'demo-viewer',
    name: 'Viewer Demo',
    email: 'viewer@demo.com',
    role: 'Viewer',
    jobTitle: 'Intern',
    department: 'Marketing',
    avatar: '👀',
  },
];

interface UserProfileViewProps {
  userId?: string; // If provided, shows another user's profile (admin/manager view)
}

// Some task/project descriptions are stored as HTML (e.g. auto-created leads/
// inquiries embed <p>/<br>). These list previews render as plain text, so strip the
// tags + decode entities instead of showing raw "<p>…</p>". Pure string ops (no DOM)
// so there's no XSS surface.
const stripHtml = (html?: string): string => {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
};

const UserProfileView: React.FC<UserProfileViewProps> = ({ userId }) => {
  const { user: currentUser } = useAuth();
  const { isAdmin, isOwner, isManager } = usePermissions();
  const canUseDemoMode = isAdmin || isOwner || isManager;
  const [isEditing, setIsEditing] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const { upload: uploadFile, uploading: avatarUploading } = useFileUpload();

  // Demo mode state
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [selectedDemoProfile, setSelectedDemoProfile] = useState(DEMO_PROFILES[0]);

  const targetUserId = userId || currentUser?.uid;
  
  // Get display user based on demo mode
  const displayUser = isDemoMode ? {
    uid: selectedDemoProfile.id,
    displayName: selectedDemoProfile.name,
    email: selectedDemoProfile.email,
  } : currentUser;

  // Fetch user profile
  const { data: profiles } = useCollection<UserProfile>('userProfiles', {
    where: [{ field: 'userId', operator: '==', value: targetUserId }]
  });
  const profile = profiles?.[0];

  // Fetch user's tasks, projects, and goals
  const { data: userTasks } = useCollection<Task>('tasks', {
    where: [{ field: 'assignedToUserId', operator: '==', value: targetUserId }],
    orderBy: { field: 'createdAt', direction: 'desc' }
  });

  const { data: allProjects } = useCollection<Project>('projects');
  const userProjects = React.useMemo(() => {
    if (!allProjects || !userTasks) return [];
    const projectIds = new Set(userTasks.map(t => t.projectId).filter(Boolean));
    return sortArchivedLast(allProjects.filter(p => projectIds.has(p.id)));
  }, [allProjects, userTasks]);

  const { data: userGoals } = useCollection<Goal>('goals', {
    where: [{ field: 'ownerId', operator: '==', value: targetUserId }],
    orderBy: { field: 'dueDate', direction: 'asc' }
  });

  // Mutations
  const profileMutation = useMutation<UserProfile>('userProfiles');

  // Initialize skills from profile
  useEffect(() => {
    if (profile?.skills) {
      try {
        setSkills(JSON.parse(profile.skills));
      } catch {
        setSkills([]);
      }
    }
  }, [profile]);

  const handleSaveProfile = async (formData: FormData) => {
    if (isDemoMode) return; // Prevent demo data overwriting real profile
    const jobTitle = formData.get('jobTitle') as string;
    const department = formData.get('department') as string;
    const bio = formData.get('bio') as string;
    const phoneNumber = formData.get('phoneNumber') as string;
    const location = formData.get('location') as string;

    const data = {
      userId: targetUserId!,
      displayName: displayUser?.displayName || '',
      jobTitle,
      department,
      bio,
      phoneNumber,
      location,
      skills: JSON.stringify(skills),
    };

    if (profile) {
      await profileMutation.update(profile.id, data);
    } else {
      await profileMutation.create(data);
    }

    setIsEditing(false);
  };

  const handleAddSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill('');
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setSkills(skills.filter(s => s !== skill));
  };

  // Get avatar URL: profile avatarUrl > Google photoURL > null
  const avatarUrl = profile?.avatarUrl || currentUser?.photoURL || null;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetUserId) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Foto duhet të jetë më e vogël se 5MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('Vetëm skedarë imazhi lejohen');
      return;
    }
    try {
      const result = await uploadFile(file, 'avatars');
      if (profile) {
        await profileMutation.update(profile.id, { avatarUrl: result.url });
      } else {
        await profileMutation.create({ userId: targetUserId, avatarUrl: result.url });
      }
    } catch {
      alert('Gabim gjatë ngarkimit të fotos. Provo përsëri.');
    }
  };

  const isOwnProfile = !userId || userId === currentUser?.uid;

  return (
    <div className="space-y-6">
      {/* Demo Mode Banner */}
      {isDemoMode && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FlaskConical className="w-5 h-5 text-amber-500" />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-400">Demo Mode Aktiv</p>
              <p className="text-sm text-amber-600 dark:text-amber-500">
                Po shikon si: <strong>{selectedDemoProfile.name}</strong> ({selectedDemoProfile.role})
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setIsDemoMode(false)}>
            Dil nga Demo
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-h2 text-foreground">
            {isOwnProfile ? 'Profili Im' : 'Profili i Përdoruesit'}
          </h1>
          <p className="text-body text-muted-foreground mt-1">
            {isDemoMode 
              ? `${selectedDemoProfile.jobTitle} · ${selectedDemoProfile.department}`
              : `${profile?.jobTitle || 'Nuk ka titull pune'} · ${profile?.department || 'Nuk ka departament'}`
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Demo Mode Toggle — only for Admin/Owner/Manager */}
          {canUseDemoMode && (
          <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
            <FlaskConical className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Demo Mode</span>
            <Switch
              checked={isDemoMode}
              onCheckedChange={setIsDemoMode}
            />
          </div>
          )}

          {/* Demo Profile Selector */}
          {isDemoMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <span className="text-lg">{selectedDemoProfile.avatar}</span>
                  <span>{selectedDemoProfile.name}</span>
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Zgjidh Profilin Demo</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {DEMO_PROFILES.map((demoProfile) => (
                  <DropdownMenuItem
                    key={demoProfile.id}
                    onClick={() => setSelectedDemoProfile(demoProfile)}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{demoProfile.avatar}</span>
                      <div>
                        <p className="font-medium">{demoProfile.name}</p>
                        <p className="text-xs text-muted-foreground">{demoProfile.role} · {demoProfile.department}</p>
                      </div>
                    </div>
                    {selectedDemoProfile.id === demoProfile.id && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {isOwnProfile && !isEditing && !isDemoMode && (
            <Button onClick={() => setIsEditing(true)}>
              <Edit className="w-4 h-4 mr-2" />
              Ndrysho Profilin
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="p-6 space-y-6 lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            {isDemoMode ? (
              <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-5xl">
                {selectedDemoProfile.avatar}
              </div>
            ) : (
              <div className="relative group mb-4">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Avatar"
                    className="w-24 h-24 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-12 h-12 text-primary" />
                  </div>
                )}
                {isOwnProfile && !isDemoMode && (
                  <>
                    <button
                      onClick={() => !avatarUploading && avatarInputRef.current?.click()}
                      className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      disabled={avatarUploading}
                    >
                      {avatarUploading
                        ? <span className="text-white text-xs">Duke ngarkuar...</span>
                        : <Camera className="w-6 h-6 text-white" />
                      }
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </>
                )}
              </div>
            )}
            <h2 className="text-h3 text-foreground">{displayUser?.displayName || 'User'}</h2>
            <p className="text-body-sm text-muted-foreground">{displayUser?.email}</p>
            {isDemoMode && (
              <Badge className="mt-2" variant="secondary">
                {selectedDemoProfile.role}
              </Badge>
            )}
          </div>

          {!isEditing ? (
            <div className="space-y-4">
              {/* Show demo profile info or real profile info */}
              {isDemoMode ? (
                <>
                  <div className="flex items-start gap-3">
                    <Briefcase className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Titulli i Punës</p>
                      <p className="text-sm text-muted-foreground">{selectedDemoProfile.jobTitle}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Award className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Departamenti</p>
                      <p className="text-sm text-muted-foreground">{selectedDemoProfile.department}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Vendndodhja</p>
                      <p className="text-sm text-muted-foreground">Tiranë, Shqipëri</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Telefoni</p>
                      <p className="text-sm text-muted-foreground">+355 69 XXX XXXX</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Bio</p>
                    <p className="text-sm text-muted-foreground">
                      Ky është një profil demo për të testuar funksionalitetet e sistemit si {selectedDemoProfile.role}.
                    </p>
                  </div>

                  <div className="pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Aftësitë</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">React</Badge>
                      <Badge variant="secondary">TypeScript</Badge>
                      <Badge variant="secondary">Project Management</Badge>
                    </div>
                  </div>

                  {/* Role Permissions Info */}
                  <div className="pt-4 border-t">
                    <p className="text-sm font-medium mb-2">Lejet e Rolit</p>
                    <div className="space-y-2 text-sm">
                      {selectedDemoProfile.role === 'Admin' && (
                        <div className="p-3 bg-green-500/10 rounded-lg text-green-700 dark:text-green-400">
                          <p className="font-medium">Akses i Plotë</p>
                          <p className="text-xs mt-1">Mund të menaxhosh të gjitha modulet, përdoruesit dhe cilësimet.</p>
                        </div>
                      )}
                      {selectedDemoProfile.role === 'Manager' && (
                        <div className="p-3 bg-blue-500/10 rounded-lg text-blue-700 dark:text-blue-400">
                          <p className="font-medium">Akses Menaxhimi</p>
                          <p className="text-xs mt-1">Mund të menaxhosh projektet, detyrat dhe ekipin.</p>
                        </div>
                      )}
                      {selectedDemoProfile.role === 'Member' && (
                        <div className="p-3 bg-amber-500/10 rounded-lg text-amber-700 dark:text-amber-400">
                          <p className="font-medium">Akses Standard</p>
                          <p className="text-xs mt-1">Mund të punosh me detyrat dhe projektet e caktuara.</p>
                        </div>
                      )}
                      {selectedDemoProfile.role === 'Viewer' && (
                        <div className="p-3 bg-gray-500/10 rounded-lg text-gray-700 dark:text-gray-400">
                          <p className="font-medium">Vetëm Lexim</p>
                          <p className="text-xs mt-1">Mund të shikosh informacionet por nuk mund të bësh ndryshime.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {profile?.jobTitle && (
                    <div className="flex items-start gap-3">
                      <Briefcase className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Titulli i Punës</p>
                        <p className="text-sm text-muted-foreground">{profile.jobTitle}</p>
                      </div>
                    </div>
                  )}

                  {profile?.department && (
                    <div className="flex items-start gap-3">
                      <Award className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Departamenti</p>
                        <p className="text-sm text-muted-foreground">{profile.department}</p>
                      </div>
                    </div>
                  )}

                  {profile?.location && (
                    <div className="flex items-start gap-3">
                      <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Vendndodhja</p>
                        <p className="text-sm text-muted-foreground">{profile.location}</p>
                      </div>
                    </div>
                  )}

                  {profile?.phoneNumber && (
                    <div className="flex items-start gap-3">
                      <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Telefoni</p>
                        <p className="text-sm text-muted-foreground">{profile.phoneNumber}</p>
                      </div>
                    </div>
                  )}

                  {profile?.bio && (
                    <div className="pt-4 border-t">
                      <p className="text-sm font-medium mb-2">Bio</p>
                      <p className="text-sm text-muted-foreground">{profile.bio}</p>
                    </div>
                  )}

                  {skills.length > 0 && (
                    <div className="pt-4 border-t">
                      <p className="text-sm font-medium mb-2">Aftësitë</p>
                      <div className="flex flex-wrap gap-2">
                        {skills.map(skill => (
                          <Badge key={skill} variant="secondary">{skill}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault();
              handleSaveProfile(new FormData(e.currentTarget));
            }} className="space-y-4">
              <div>
                <Label htmlFor="jobTitle">Job Title</Label>
                <Input id="jobTitle" name="jobTitle" defaultValue={profile?.jobTitle} />
              </div>

              <div>
                <Label htmlFor="department">Department</Label>
                <Input 
                  id="department" 
                  name="department" 
                  placeholder="e.g., SEO, Marketing, Web Development"
                  defaultValue={profile?.department} 
                />
              </div>

              <div>
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" defaultValue={profile?.location} />
              </div>

              <div>
                <Label htmlFor="phoneNumber">Phone Number</Label>
                <Input id="phoneNumber" name="phoneNumber" type="tel" inputMode="numeric" maxLength={20} onKeyDown={phoneKeyDown} defaultValue={profile?.phoneNumber} />
              </div>

              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea id="bio" name="bio" defaultValue={profile?.bio} />
              </div>

              <div>
                <Label>Skills</Label>
                <div className="flex gap-2 mb-2">
                  <Input 
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                    placeholder="Shto një aftësi"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSkill())}
                  />
                  <Button type="button" onClick={handleAddSkill}>Shto</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {skills.map(skill => (
                    <Badge key={skill} variant="secondary" className="cursor-pointer" onClick={() => handleRemoveSkill(skill)}>
                      {skill} <X className="w-3 h-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </Card>

        {/* Activity Tabs */}
        <Card className="p-6 lg:col-span-2">
          <Tabs defaultValue="tasks">
            <TabsList className="mb-4">
              <TabsTrigger value="tasks">Detyrat ({isDemoMode ? '5' : userTasks?.length || 0})</TabsTrigger>
              <TabsTrigger value="projects">Projektet ({isDemoMode ? '3' : userProjects.length})</TabsTrigger>
              <TabsTrigger value="goals">Objektivat ({isDemoMode ? '2' : userGoals?.length || 0})</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="space-y-3">
              {isDemoMode ? (
                // Demo tasks
                <>
                  {[
                    { id: '1', title: 'Përfundo dizajnin e faqes', status: 'Në Progres', priority: 'E Lartë', dueDate: '2026-03-15' },
                    { id: '2', title: 'Rishiko kodin e backend', status: 'Për të Bërë', priority: 'Mesatare', dueDate: '2026-03-20' },
                    { id: '3', title: 'Testo funksionalitetet e reja', status: 'Përfunduar', priority: 'E Ulët', dueDate: '2026-03-10' },
                    { id: '4', title: 'Dokumento API-të', status: 'Në Progres', priority: 'Mesatare', dueDate: '2026-03-18' },
                    { id: '5', title: 'Optimizo performancën', status: 'Për të Bërë', priority: 'E Lartë', dueDate: '2026-03-25' },
                  ].map(task => (
                    <div key={task.id} className="p-4 border rounded-lg">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium">{task.title}</h4>
                          <p className="text-sm text-muted-foreground">Detyrë demo për {selectedDemoProfile.role}</p>
                        </div>
                        <Badge>{task.status}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                        <span>Afati: {task.dueDate}</span>
                        <Badge variant="secondary">{task.priority}</Badge>
                      </div>
                    </div>
                  ))}
                </>
              ) : userTasks && userTasks.length > 0 ? (
                userTasks.map(task => (
                  <div key={task.id} className="p-4 border rounded-lg">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium">{task.title}</h4>
                        <p className="text-sm text-muted-foreground">{stripHtml(task.description)}</p>
                      </div>
                      <Badge>{task.status}</Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                      {task.endDate && <span>Afati: {new Date((task.endDate as any)?.toDate?.() ?? task.endDate).toLocaleDateString()}</span>}
                      {task.priority && <Badge variant="secondary">{task.priority}</Badge>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">Nuk ka detyra të caktuara</p>
              )}
            </TabsContent>

            <TabsContent value="projects" className="space-y-3">
              {isDemoMode ? (
                // Demo projects
                <>
                  {[
                    { id: '1', name: 'Faqja e Re Web', status: 'Aktiv', description: 'Ridizajnimi i faqes kryesore' },
                    { id: '2', name: 'Aplikacioni Mobile', status: 'Në Progres', description: 'Zhvillimi i aplikacionit iOS/Android' },
                    { id: '3', name: 'Sistemi CRM', status: 'Planifikuar', description: 'Implementimi i sistemit të ri CRM' },
                  ].map(project => (
                    <div key={project.id} className="p-4 border rounded-lg">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium">{project.name}</h4>
                          <p className="text-sm text-muted-foreground">{stripHtml(project.description)}</p>
                        </div>
                        <Badge>{project.status}</Badge>
                      </div>
                    </div>
                  ))}
                </>
              ) : userProjects.length > 0 ? (
                userProjects.map(project => (
                  <div key={project.id} className="p-4 border rounded-lg">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium">{project.name}</h4>
                        <p className="text-sm text-muted-foreground">{stripHtml(project.description)}</p>
                      </div>
                      <Badge>{project.status}</Badge>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">Nuk ka projekte</p>
              )}
            </TabsContent>

            <TabsContent value="goals" className="space-y-3">
              {isDemoMode ? (
                // Demo goals
                <>
                  {[
                    { id: '1', title: 'Rrit produktivitetin 20%', status: 'Në Rrugë', progress: 65, description: 'Objektiv tremujor' },
                    { id: '2', title: 'Mëso teknologji të reja', status: 'Në Rrezik', progress: 30, description: 'Certifikim profesional' },
                  ].map(goal => (
                    <div key={goal.id} className="p-4 border rounded-lg">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-medium">{goal.title}</h4>
                          <p className="text-sm text-muted-foreground">{stripHtml(goal.description)}</p>
                        </div>
                        <Badge>{goal.status}</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Progresi</span>
                          <span className="font-medium">{goal.progress}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full"
                            style={{ width: `${goal.progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : userGoals && userGoals.length > 0 ? (
                userGoals.map(goal => (
                  <div key={goal.id} className="p-4 border rounded-lg">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium">{goal.title}</h4>
                        <p className="text-sm text-muted-foreground">{stripHtml(goal.description)}</p>
                      </div>
                      <Badge>{goal.status}</Badge>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progresi</span>
                        <span className="font-medium">{goal.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full"
                          style={{ width: `${goal.progress || 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">Nuk ka objektiva</p>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
};

export default UserProfileView;

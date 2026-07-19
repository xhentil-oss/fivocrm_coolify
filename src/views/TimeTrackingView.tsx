import React, { useState, useEffect, useRef } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Clock, Play, Pause, Square, Plus, Timer, DollarSign, Tag, Calendar as CalendarIcon, TrendingUp } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import type { TimeEntry, Task, Project } from '../types';
import { useToast } from '../hooks/use-toast';
import { totalTrackedMinutes, entryDurationMinutes } from '../lib/timeTracking';

const TimeTrackingView: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<TimeEntry | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  // Pomodoro Timer State
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(0);
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false);
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const [isBreak, setIsBreak] = useState(false);
  const pomodoroIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pomodoroCompleteRef = useRef(false);

  // Running Timer State
  const [runningEntry, setRunningEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { data: timeEntries, loading: entriesLoading } = useCollection<TimeEntry>('timeEntries', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'startTime', direction: 'desc' }
  });
  const { data: tasks } = useCollection<Task>('tasks');
  const { data: projects } = useCollection<Project>('projects');
  const timeEntryMutation = useMutation<TimeEntry>('timeEntries');

  // Find running entry on mount
  useEffect(() => {
    if (timeEntries && user) {
      const running = timeEntries.find(entry => !entry.endTime && entry.userId === user.uid);
      if (running) {
        setRunningEntry(running);
        const elapsed = Math.floor((Date.now() - new Date(running.startTime).getTime()) / 1000);
        setElapsedSeconds(elapsed);
      }
    }
  }, [timeEntries, user]);

  // Timer interval for running entry
  useEffect(() => {
    if (runningEntry) {
      timerIntervalRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [runningEntry]);

  // Pomodoro timer interval
  useEffect(() => {
    if (isPomodoroRunning) {
      pomodoroCompleteRef.current = false;
      pomodoroIntervalRef.current = setInterval(() => {
        setPomodoroSeconds(prevSec => {
          if (prevSec === 0) {
            setPomodoroMinutes(prevMin => {
              if (prevMin === 0) {
                // Mark done — handlePomodoroComplete runs in a separate effect
                pomodoroCompleteRef.current = true;
                return 0;
              }
              return prevMin - 1;
            });
            return 59;
          }
          return prevSec - 1;
        });
      }, 1000);
    } else {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
      }
    }

    return () => {
      if (pomodoroIntervalRef.current) {
        clearInterval(pomodoroIntervalRef.current);
      }
    };
  }, [isPomodoroRunning]);

  // Detect completion separately to avoid stale closure in setState
  useEffect(() => {
    if (pomodoroMinutes === 0 && pomodoroSeconds === 59 && pomodoroCompleteRef.current && isPomodoroRunning) {
      pomodoroCompleteRef.current = false;
      handlePomodoroComplete();
    }
  }, [pomodoroMinutes, pomodoroSeconds, isPomodoroRunning]);

  const handlePomodoroComplete = () => {
    setIsPomodoroRunning(false);
    if (!isBreak) {
      setPomodoroCount(prev => prev + 1);
      // Play notification sound (optional)
      toast({ title: 'Pomodoro përfundoi! Kohë për një pushim.' });
      setIsBreak(true);
      setPomodoroMinutes(5); // 5 minute break
      setPomodoroSeconds(0);
    } else {
      toast({ title: 'Pushimi përfundoi! Gati për një Pomodoro tjetër?' });
      setIsBreak(false);
      setPomodoroMinutes(25);
      setPomodoroSeconds(0);
    }
  };

  const startPomodoro = () => {
    setIsPomodoroRunning(true);
  };

  const pausePomodoro = () => {
    setIsPomodoroRunning(false);
  };

  const resetPomodoro = () => {
    setIsPomodoroRunning(false);
    setPomodoroMinutes(25);
    setPomodoroSeconds(0);
    setIsBreak(false);
  };

  const startTimer = async (taskId?: string, projectId?: string, description?: string) => {
    if (!user) return;

    // Enforce a single running timer per user: close any entry left open from a
    // previous session/task first. Overlapping running timers were the root cause
    // of corrupt totals (a stop computed its duration against the wrong start).
    const myRunning = (timeEntries || []).filter(e => e.userId === user.uid && !e.endTime);
    for (const e of myRunning) {
      const endTimeVal = new Date();
      const start = new Date((e.startTime as any)?.toDate ? (e.startTime as any).toDate() : e.startTime);
      const duration = Math.max(0, Math.floor((endTimeVal.getTime() - start.getTime()) / 60000));
      await timeEntryMutation.update(e.id, { endTime: endTimeVal, duration });
    }

    const newEntry = await timeEntryMutation.create({
      userId: user.uid,
      taskId: taskId && taskId !== 'none' ? taskId : undefined,
      projectId: projectId && projectId !== 'none' ? projectId : undefined,
      description,
      startTime: new Date(),
      isBillable: false,
      isPomodoroSession: false,
    });

    setRunningEntry(newEntry);
    setElapsedSeconds(0);
  };

  const stopTimer = async () => {
    if (!runningEntry || !user) return;

    const endTime = new Date();
    const duration = Math.floor((endTime.getTime() - new Date(runningEntry.startTime).getTime()) / 60000);

    await timeEntryMutation.update(runningEntry.id, {
      endTime,
      duration,
    });

    setRunningEntry(null);
    setElapsedSeconds(0);
  };

  const handleCreateEntry = async (formData: FormData) => {
    if (!user) return;

    const taskId = formData.get('taskId') as string;
    const projectId = formData.get('projectId') as string;
    const description = formData.get('description') as string;
    const startTime = formData.get('startTime') as string;
    const endTime = formData.get('endTime') as string;
    const isBillable = formData.get('isBillable') === 'true';
    const hourlyRate = formData.get('hourlyRate') as string;
    const tags = formData.get('tags') as string;

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (!(end.getTime() > start.getTime())) {
      toast({ title: 'Koha e mbarimit duhet të jetë pas kohës së fillimit.', variant: 'destructive' });
      return;
    }
    const duration = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));

    await timeEntryMutation.create({
      userId: user.uid,
      taskId: taskId && taskId !== 'none' ? taskId : undefined,
      projectId: projectId && projectId !== 'none' ? projectId : undefined,
      description: description || undefined,
      startTime: start,
      endTime: end,
      duration,
      isBillable,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
      tags: tags ? JSON.stringify(tags.split(',').map(t => t.trim())) : undefined,
      isPomodoroSession: false,
    });

    setIsCreateDialogOpen(false);
  };

  const handleUpdateEntry = async (formData: FormData) => {
    if (!selectedEntry) return;

    const taskId = formData.get('taskId') as string;
    const projectId = formData.get('projectId') as string;
    const description = formData.get('description') as string;
    const startTime = formData.get('startTime') as string;
    const endTime = formData.get('endTime') as string;
    const isBillable = formData.get('isBillable') === 'true';
    const hourlyRate = formData.get('hourlyRate') as string;
    const tags = formData.get('tags') as string;

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (!(end.getTime() > start.getTime())) {
      toast({ title: 'Koha e mbarimit duhet të jetë pas kohës së fillimit.', variant: 'destructive' });
      return;
    }
    const duration = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));

    await timeEntryMutation.update(selectedEntry.id, {
      taskId: taskId && taskId !== 'none' ? taskId : undefined,
      projectId: projectId && projectId !== 'none' ? projectId : undefined,
      description: description || undefined,
      startTime: start,
      endTime: end,
      duration,
      isBillable,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
      tags: tags ? JSON.stringify(tags.split(',').map(t => t.trim())) : undefined,
    });

    setIsEditDialogOpen(false);
    setSelectedEntry(null);
  };

  const handleDeleteEntry = async (id: string) => {
    if (confirm('Je i sigurt që dëshiron të fshish këtë hyrje kohore?')) {
      await timeEntryMutation.remove(id);
    }
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDuration = (minutes: number) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  // Derive minutes from start/end (source of truth) — never the stale `duration` field.
  const totalMinutes = totalTrackedMinutes(timeEntries);
  const billableMinutes = totalTrackedMinutes(timeEntries?.filter(e => e.isBillable));
  const totalRevenue = timeEntries?.filter(e => e.isBillable && e.hourlyRate).reduce((sum, entry) => {
    const hours = entryDurationMinutes(entry) / 60;
    return sum + (hours * (entry.hourlyRate || 0));
  }, 0) || 0;

  if (entriesLoading) {
    return <div className="flex items-center justify-center h-96">Duke ngarkuar hyrjet e kohës...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-foreground">Gjurmimi i Kohës & Pomodoro</h1>
          <p className="text-body text-muted-foreground mt-1">
            {timeEntries?.length || 0} total entries · {formatDuration(totalMinutes)} tracked
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Hyrje Manuale
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Krijo Hyrje Kohore</DialogTitle>
            </DialogHeader>
            <TimeEntryForm onSubmit={handleCreateEntry} tasks={tasks || []} projects={projects || []} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
        <Card className="p-6 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-body-sm text-muted-foreground">Koha Totale</p>
            <Clock className="w-5 h-5 text-primary" />
          </div>
          <p className="text-h2 text-foreground font-medium">
            {formatDuration(totalMinutes)}
          </p>
        </Card>

        <Card className="p-6 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-body-sm text-muted-foreground">Koha e Faturueshme</p>
            <DollarSign className="w-5 h-5 text-success" />
          </div>
          <p className="text-h2 text-foreground font-medium">
            {formatDuration(billableMinutes)}
          </p>
        </Card>

        <Card className="p-6 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-body-sm text-muted-foreground">Të ardhura</p>
            <TrendingUp className="w-5 h-5 text-tertiary" />
          </div>
          <p className="text-h2 text-foreground font-medium">
            {totalRevenue.toLocaleString()} ALL
          </p>
        </Card>

        <Card className="p-6 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-body-sm text-muted-foreground">Pomodoros</p>
            <Timer className="w-5 h-5 text-error" />
          </div>
          <p className="text-h2 text-foreground font-medium">
            {pomodoroCount}
          </p>
        </Card>
      </div>

      <Tabs defaultValue="timer" className="space-y-6">
        <TabsList>
          <TabsTrigger value="timer">Kohëmatësi</TabsTrigger>
          <TabsTrigger value="pomodoro">Pomodoro</TabsTrigger>
          <TabsTrigger value="entries">Hyrjet e Kohës</TabsTrigger>
        </TabsList>

        <TabsContent value="timer" className="space-y-6">
          <Card className="p-8">
            <div className="text-center space-y-6">
              <div className="text-6xl font-mono font-bold text-foreground">
                {formatTime(elapsedSeconds)}
              </div>

              {runningEntry ? (
                <div className="space-y-4">
                  <p className="text-body text-muted-foreground">
                    {runningEntry.description || 'Duke gjurmuar kohën...'}
                  </p>
                  <div className="flex gap-3 justify-center">
                    <Button onClick={stopTimer} variant="destructive" size="lg">
                      <Square className="w-5 h-5 mr-2" />
                      Ndalo Kohëmatësin
                    </Button>
                  </div>
                </div>
              ) : (
                <QuickStartForm onStart={startTimer} tasks={tasks || []} projects={projects || []} />
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="pomodoro" className="space-y-6">
          <Card className="p-8">
            <div className="text-center space-y-6">
              <div className="space-y-2">
                <h3 className="text-h3 text-foreground">
                  {isBreak ? 'Koha e Pushimit' : 'Koha e Fokusit'}
                </h3>
                <div className="text-6xl font-mono font-bold text-foreground">
                  {pomodoroMinutes.toString().padStart(2, '0')}:{pomodoroSeconds.toString().padStart(2, '0')}
                </div>
              </div>

              <div className="flex gap-3 justify-center">
                {!isPomodoroRunning ? (
                  <Button onClick={startPomodoro} size="lg" className="bg-primary">
                    <Play className="w-5 h-5 mr-2" />
                    Start
                  </Button>
                ) : (
                  <Button onClick={pausePomodoro} size="lg" variant="outline">
                    <Pause className="w-5 h-5 mr-2" />
                    Pause
                  </Button>
                )}
                <Button onClick={resetPomodoro} size="lg" variant="outline">
                  <Square className="w-5 h-5 mr-2" />
                  Reset
                </Button>
              </div>

              <div className="pt-4 border-t">
                <p className="text-body-sm text-muted-foreground">
                  Përfunduar sot: <span className="font-semibold text-foreground">{pomodoroCount} Pomodoro</span>
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="entries" className="space-y-6">
          {/* Mobile: stacked cards (the 6-column table needs too much horizontal scroll) */}
          <div className="sm:hidden space-y-3">
            {timeEntries?.map((entry) => {
              const task = tasks?.find(t => t.id === entry.taskId);
              const project = projects?.find(p => p.id === entry.projectId);
              return (
                <Card key={entry.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground">{entry.description || 'Pa përshkrim'}</p>
                    {entry.endTime ? (
                      <span className="text-sm font-semibold whitespace-nowrap">{formatDuration(entry.duration || 0)}</span>
                    ) : (
                      <Badge variant="default">Aktive</Badge>
                    )}
                  </div>
                  {(task || project) && (
                    <p className="text-xs text-muted-foreground">{[task?.title, project?.name].filter(Boolean).join(' · ')}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(entry.startTime).toLocaleString()}</span>
                    {entry.isBillable ? (
                      <Badge className="bg-success-100 text-success-800">Faturueshme</Badge>
                    ) : (
                      <Badge variant="secondary">Jo-faturueshme</Badge>
                    )}
                    {entry.isPomodoroSession && (
                      <Badge variant="secondary"><Timer className="w-3 h-3 mr-1" />Pomodoro</Badge>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="flex-1" disabled={!entry.endTime} onClick={() => { setSelectedEntry(entry); setIsEditDialogOpen(true); }}>Ndrysho</Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handleDeleteEntry(entry.id)}>Fshi</Button>
                  </div>
                </Card>
              );
            })}
          </div>
          {/* Desktop: table */}
          <Card className="hidden sm:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Përshkrimi
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Detyra/Projekti
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Koha e Fillimit
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Kohëzgjatja
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Faturueshme
                    </th>
                    <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                      Veprime
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {timeEntries?.map((entry) => {
                    const task = tasks?.find(t => t.id === entry.taskId);
                    const project = projects?.find(p => p.id === entry.projectId);

                    return (
                      <tr
                        key={entry.id}
                        className="hover:bg-muted/50 transition-colors duration-fast"
                      >
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            <p className="text-body font-normal text-foreground">
                              {entry.description || 'Pa përshkrim'}
                            </p>
                            {entry.isPomodoroSession && (
                              <Badge variant="secondary" className="text-xs">
                                <Timer className="w-3 h-3 mr-1" />
                                Pomodoro ({entry.pomodoroCount || 0})
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            {task && (
                              <p className="text-body-sm text-foreground">{task.title}</p>
                            )}
                            {project && (
                              <p className="text-body-sm text-muted-foreground">{project.name}</p>
                            )}
                            {!task && !project && (
                              <p className="text-body-sm text-muted-foreground">-</p>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-body-sm text-foreground">
                          {new Date(entry.startTime).toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          {entry.endTime ? (
                            <span className="text-body font-semibold text-foreground">
                              {formatDuration(entry.duration || 0)}
                            </span>
                          ) : (
                            <Badge variant="default">Aktive</Badge>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {entry.isBillable ? (
                            <div className="space-y-1">
                              <Badge className="bg-success-100 text-success-800">Faturueshme</Badge>
                              {entry.hourlyRate && (
                                <p className="text-body-sm text-muted-foreground">
                                  {entry.hourlyRate} ALL/hr
                                </p>
                              )}
                            </div>
                          ) : (
                            <Badge variant="secondary">Jo-faturueshme</Badge>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedEntry(entry);
                                setIsEditDialogOpen(true);
                              }}
                              disabled={!entry.endTime}
                            >
                              Ndrysho
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteEntry(entry.id)}
                            >
                              Fshi
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {selectedEntry && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Ndrysho Hyrjen Kohore</DialogTitle>
            </DialogHeader>
            <TimeEntryForm
              onSubmit={handleUpdateEntry}
              tasks={tasks || []}
              projects={projects || []}
              initialData={selectedEntry}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

const QuickStartForm: React.FC<{
  onStart: (taskId?: string, projectId?: string, description?: string) => void;
  tasks: Task[];
  projects: Project[];
}> = ({ onStart, tasks, projects }) => {
  const [taskId, setTaskId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [description, setDescription] = useState('');

  const handleStart = () => {
    onStart(
      taskId || undefined,
      projectId || undefined,
      description || undefined
    );
  };

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <div>
        <Label htmlFor="quick-description">Çfarë po punon?</Label>
        <Input
          id="quick-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Shkruaj përshkrimin..."
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="quick-task">Detyra (Opsionale)</Label>
          <Select value={taskId} onValueChange={setTaskId}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh detyrën" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {tasks.map(task => (
                <SelectItem key={task.id} value={task.id}>
                  {task.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="quick-project">Projekti (Opsionale)</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh projektin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {projects.map(project => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button onClick={handleStart} size="lg" className="w-full bg-success">
        <Play className="w-5 h-5 mr-2" />
        Fillo Kohëmatësin
      </Button>
    </div>
  );
};

const TimeEntryForm: React.FC<{
  onSubmit: (data: FormData) => void;
  tasks: Task[];
  projects: Project[];
  initialData?: TimeEntry;
}> = ({ onSubmit, tasks, projects, initialData }) => {
  const [isBillable, setIsBillable] = useState(initialData?.isBillable || false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('isBillable', isBillable.toString());
    onSubmit(formData);
  };

  const formatDateTimeLocal = (date: Date) => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
      <div>
        <Label htmlFor="description">Përshkrimi</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initialData?.description}
          placeholder="Çfarë punove?"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="taskId">Detyra (Opsionale)</Label>
          <Select name="taskId" defaultValue={initialData?.taskId}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh detyrën" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {tasks.map(task => (
                <SelectItem key={task.id} value={task.id}>
                  {task.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="projectId">Projekti (Opsionale)</Label>
          <Select name="projectId" defaultValue={initialData?.projectId}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh projektin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {projects.map(project => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="startTime">Start Time *</Label>
          <Input
            id="startTime"
            name="startTime"
            type="datetime-local"
            required
            defaultValue={initialData ? formatDateTimeLocal(new Date(initialData.startTime)) : ''}
          />
        </div>

        <div>
          <Label htmlFor="endTime">End Time *</Label>
          <Input
            id="endTime"
            name="endTime"
            type="datetime-local"
            required
            defaultValue={initialData?.endTime ? formatDateTimeLocal(new Date(initialData.endTime)) : ''}
          />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="isBillable"
          checked={isBillable}
          onCheckedChange={setIsBillable}
        />
        <Label htmlFor="isBillable">Billable Time</Label>
      </div>

      {isBillable && (
        <div>
          <Label htmlFor="hourlyRate">Hourly Rate (ALL)</Label>
          <Input
            id="hourlyRate"
            name="hourlyRate"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initialData?.hourlyRate}
            placeholder="Enter hourly rate"
          />
        </div>
      )}

      <div>
        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input
          id="tags"
          name="tags"
          defaultValue={initialData?.tags ? JSON.parse(initialData.tags).join(', ') : ''}
          placeholder="development, meeting, design"
        />
      </div>

      <Button type="submit" className="w-full">
        {initialData ? 'Update Entry' : 'Create Entry'}
      </Button>
    </form>
  );
};

export default TimeTrackingView;

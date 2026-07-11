import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { GraduationCap, Plus, BookOpen, CheckCircle, Clock, Award, Video, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CATEGORIES = [
  { value: "iicrc", label: "IICRC Standards" },
  { value: "sop", label: "Company SOP" },
  { value: "safety", label: "Safety / OSHA" },
  { value: "equipment", label: "Equipment Operation" },
  { value: "software", label: "Software / Titan Pro" },
];

const CONTENT_TYPES = [
  { value: "video", label: "Video", icon: "🎥" },
  { value: "pdf", label: "PDF Document", icon: "📄" },
  { value: "article", label: "Article", icon: "📝" },
  { value: "quiz", label: "Quiz Only", icon: "❓" },
];

export default function TechLMS() {
  const { toast } = useToast();
  const [tab, setTab] = useState("courses");
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showEnrollForm, setShowEnrollForm] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<any>(null);
  const [courseForm, setCourseForm] = useState({ title: "", description: "", category: "iicrc", content_url: "", content_type: "video", duration_mins: "", required_role: "all" });
  const [enrollForm, setEnrollForm] = useState({ employee_id: "", employee_name: "" });

  const { data: courses = [], isLoading: coursesLoading } = useQuery({ queryKey: ["/api/lms-courses"], queryFn: () => apiRequest("/api/lms-courses").then(r => r.json()) });
  const { data: enrollments = [] } = useQuery({ queryKey: ["/api/lms-enrollments"], queryFn: () => apiRequest("/api/lms-enrollments").then(r => r.json()) });
  const { data: employees = [] } = useQuery({ queryKey: ["/api/employees"], queryFn: () => apiRequest("/api/employees").then(r => r.json()) });

  const createCourseMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/lms-courses", { method: "POST", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lms-courses"] });
      setShowCourseForm(false);
      setCourseForm({ title: "", description: "", category: "iicrc", content_url: "", content_type: "video", duration_mins: "", required_role: "all" });
      toast({ title: "Course created" });
    },
  });

  const enrollMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/lms-enrollments", { method: "POST", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lms-enrollments"] });
      setShowEnrollForm(false);
      toast({ title: "Enrollment created" });
    },
  });

  const updateEnrollmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/lms-enrollments/${id}`, { method: "PATCH", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/lms-enrollments"] }),
  });

  const getEnrollmentForCourse = (courseId: number) =>
    enrollments.filter((e: any) => e.course_id === courseId);

  const completionRate = (courseId: number) => {
    const enrolled = getEnrollmentForCourse(courseId);
    if (!enrolled.length) return 0;
    return Math.round((enrolled.filter((e: any) => e.status === "completed").length / enrolled.length) * 100);
  };

  const statusColor = (s: string) => ({
    assigned: "bg-gray-100 text-gray-700",
    in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
  }[s] || "bg-gray-100 text-gray-700");

  // Per-employee completion stats
  const empStats = employees.map((emp: any) => {
    const empEnrollments = enrollments.filter((e: any) => e.employee_id === emp.id || e.employee_name === emp.name);
    const completed = empEnrollments.filter((e: any) => e.status === "completed").length;
    const total = empEnrollments.length;
    return { ...emp, completed, total, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-blue-500" />
            Tech Training &amp; Certification LMS
          </h1>
          <p className="text-sm text-muted-foreground mt-1">IICRC, SOP, safety, and equipment training for your team</p>
        </div>
        <Button onClick={() => setShowCourseForm(true)} className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-create-course">
          <Plus className="h-4 w-4 mr-2" /> Create Course
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Courses", val: courses.length, icon: <BookOpen className="h-4 w-4 text-blue-500" /> },
          { label: "Enrollments", val: enrollments.length, icon: <Award className="h-4 w-4 text-purple-500" /> },
          { label: "Completed", val: enrollments.filter((e: any) => e.status === "completed").length, icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
          { label: "In Progress", val: enrollments.filter((e: any) => e.status === "in_progress").length, icon: <Clock className="h-4 w-4 text-orange-500" /> },
        ].map(({ label, val, icon }) => (
          <Card key={label}><CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2 mb-1">{icon}<p className="text-xs text-muted-foreground">{label}</p></div>
            <p className="text-xl font-bold">{val}</p>
          </CardContent></Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="courses">Course Library</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
          <TabsTrigger value="team">Team Progress</TabsTrigger>
        </TabsList>

        {/* Courses Tab */}
        <TabsContent value="courses" className="space-y-3 mt-4">
          {coursesLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded animate-pulse" />)}</div>
          ) : courses.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <GraduationCap className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold">No courses yet</p>
              <p className="text-sm text-muted-foreground">Create your first training course</p>
            </CardContent></Card>
          ) : (
            courses.map((course: any) => {
              const enrolled = getEnrollmentForCourse(course.id).length;
              const pct = completionRate(course.id);
              const ct = CONTENT_TYPES.find(c => c.value === course.content_type);
              return (
                <Card key={course.id} data-testid={`card-course-${course.id}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="font-bold text-sm">{ct?.icon} {course.title}</span>
                          <Badge variant="outline" className="text-xs">{CATEGORIES.find(c => c.value === course.category)?.label || course.category}</Badge>
                          <Badge variant="outline" className="text-xs">{course.required_role === "all" ? "All Staff" : course.required_role}</Badge>
                        </div>
                        {course.description && <p className="text-xs text-muted-foreground">{course.description}</p>}
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          {course.duration_mins > 0 && <span><Clock className="h-3 w-3 inline mr-1" />{course.duration_mins} min</span>}
                          <span>{enrolled} enrolled</span>
                          {enrolled > 0 && <span className="text-green-600">{pct}% complete</span>}
                        </div>
                        {enrolled > 0 && <Progress value={pct} className="h-1 mt-2" />}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => { setSelectedCourse(course); setShowEnrollForm(true); }} data-testid={`button-enroll-${course.id}`}>Enroll Tech</Button>
                        {course.content_url && (
                          <a href={course.content_url} target="_blank" rel="noreferrer">
                            <Button size="sm" variant="ghost" className="text-xs w-full">Open Content</Button>
                          </a>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Enrollments Tab */}
        <TabsContent value="enrollments" className="space-y-3 mt-4">
          {enrollments.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No enrollments yet — enroll techs from the Course Library tab.</CardContent></Card>
          ) : (
            enrollments.map((enr: any) => {
              const course = courses.find((c: any) => c.id === enr.course_id);
              return (
                <Card key={enr.id} data-testid={`card-enrollment-${enr.id}`}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-sm">{enr.employee_name}</p>
                        <p className="text-xs text-muted-foreground">{course?.title || `Course #${enr.course_id}`}</p>
                        {enr.score !== null && <p className="text-xs text-blue-600">Score: {enr.score}%</p>}
                        {enr.completed_at && <p className="text-xs text-green-600">Completed: {new Date(enr.completed_at).toLocaleDateString()}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${statusColor(enr.status)}`}>{enr.status}</Badge>
                        {enr.status !== "completed" && (
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => updateEnrollmentMutation.mutate({ id: enr.id, data: { status: "completed", completed_at: new Date().toISOString(), score: 100 } })} data-testid={`button-complete-${enr.id}`}>Mark Complete</Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Team Progress */}
        <TabsContent value="team" className="space-y-3 mt-4">
          {empStats.map((emp: any) => (
            <Card key={emp.id} data-testid={`card-emp-${emp.id}`}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{emp.name}</p>
                      <Badge variant="outline" className="text-xs">{emp.role}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{emp.completed}/{emp.total} courses completed</p>
                    {emp.total > 0 && <Progress value={emp.pct} className="h-1 mt-1" />}
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${emp.pct === 100 ? "text-green-600" : emp.pct >= 50 ? "text-blue-600" : "text-red-500"}`}>{emp.pct}%</p>
                    {emp.pct === 100 && <Award className="h-4 w-4 text-yellow-500 ml-auto" />}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {empStats.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No employees found. Add employees in User Management.</CardContent></Card>}
        </TabsContent>
      </Tabs>

      {/* Create Course Dialog */}
      <Dialog open={showCourseForm} onOpenChange={setShowCourseForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Training Course</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Title *</label>
              <Input value={courseForm.title} onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. IICRC S500 Water Damage Basics" data-testid="input-title" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Description</label>
              <Textarea value={courseForm.description} onChange={e => setCourseForm(f => ({ ...f, description: e.target.value }))} className="h-16 text-sm" data-testid="textarea-desc" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Category</label>
                <Select value={courseForm.category} onValueChange={v => setCourseForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Content Type</label>
                <Select value={courseForm.content_type} onValueChange={v => setCourseForm(f => ({ ...f, content_type: v }))}>
                  <SelectTrigger data-testid="select-content-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTENT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.icon} {c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Content URL (video/PDF link)</label>
              <Input value={courseForm.content_url} onChange={e => setCourseForm(f => ({ ...f, content_url: e.target.value }))} placeholder="https://..." data-testid="input-content-url" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Duration (minutes)</label>
                <Input type="number" value={courseForm.duration_mins} onChange={e => setCourseForm(f => ({ ...f, duration_mins: e.target.value }))} placeholder="30" data-testid="input-duration" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Required For</label>
                <Select value={courseForm.required_role} onValueChange={v => setCourseForm(f => ({ ...f, required_role: v }))}>
                  <SelectTrigger data-testid="select-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Staff</SelectItem>
                    <SelectItem value="tech">Technicians</SelectItem>
                    <SelectItem value="sales">Sales</SelectItem>
                    <SelectItem value="office">Office</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => createCourseMutation.mutate({ ...courseForm, duration_mins: Number(courseForm.duration_mins) || 0, created_at: new Date().toISOString() })} disabled={createCourseMutation.isPending || !courseForm.title} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-submit-course">
                {createCourseMutation.isPending ? "Creating..." : "Create Course"}
              </Button>
              <Button variant="outline" onClick={() => setShowCourseForm(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Enroll Dialog */}
      <Dialog open={showEnrollForm} onOpenChange={setShowEnrollForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Enroll Tech in: {selectedCourse?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Select Employee</label>
              <Select value={enrollForm.employee_id} onValueChange={v => {
                const emp = employees.find((e: any) => String(e.id) === v);
                setEnrollForm({ employee_id: v, employee_name: emp?.name || "" });
              }}>
                <SelectTrigger data-testid="select-employee"><SelectValue placeholder="Choose tech..." /></SelectTrigger>
                <SelectContent>{employees.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => enrollMutation.mutate({ course_id: selectedCourse?.id, employee_id: Number(enrollForm.employee_id), employee_name: enrollForm.employee_name, status: "assigned", assigned_at: new Date().toISOString() })} disabled={enrollMutation.isPending || !enrollForm.employee_id} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-submit-enroll">
                {enrollMutation.isPending ? "Enrolling..." : "Enroll"}
              </Button>
              <Button variant="outline" onClick={() => setShowEnrollForm(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

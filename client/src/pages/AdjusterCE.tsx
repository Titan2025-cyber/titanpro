import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { GraduationCap, Plus, Users, Award, BookOpen, CheckCircle2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Course { id: number; title: string; category: string; creditHours: number; description: string; status: string; }
interface Enrollment { id: number; courseId: number; adjusterName: string; adjusterEmail: string; carrier: string; completedAt: string; score: number; certificateIssued: boolean; }

const CAT_COLORS: Record<string, string> = {
  water: "bg-blue-100 text-blue-700", fire: "bg-orange-100 text-orange-700",
  mold: "bg-green-100 text-green-700", storm: "bg-purple-100 text-purple-700",
  general: "bg-gray-100 text-gray-700",
};

function DeleteCourseBtn({ id, label }: { id: number; label: string }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/adjuster-courses/${id}`),
    onSuccess: () => {
      toast({ title: "Course Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/adjuster-courses"] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-delete-adjuster-courses-${id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this course?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-adjuster-courses-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteEnrollmentBtn({ id, label }: { id: number; label: string }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/adjuster-enrollments/${id}`),
    onSuccess: () => {
      toast({ title: "Enrollment Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/adjuster-enrollments"] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-delete-adjuster-enrollments-${id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this enrollment?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-adjuster-enrollments-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdjusterCE() {
  const { toast } = useToast();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [enrollForm, setEnrollForm] = useState({ adjusterName: "", adjusterEmail: "", carrier: "" });

  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ["/api/adjuster-courses"],
    queryFn: () => apiRequest("/api/adjuster-courses").then(r => r.json()),
  });

  const { data: enrollments = [] } = useQuery<Enrollment[]>({
    queryKey: ["/api/adjuster-enrollments"],
    queryFn: () => apiRequest("/api/adjuster-enrollments").then(r => r.json()),
  });

  const enrollMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/adjuster-enrollments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/adjuster-enrollments"] });
      setEnrollOpen(false);
      setEnrollForm({ adjusterName: "", adjusterEmail: "", carrier: "" });
      toast({ title: "Adjuster Enrolled", description: `${enrollForm.adjusterName} enrolled in ${selectedCourse?.title}` });
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, score }: { id: number; score: number }) =>
      apiRequest(`/api/adjuster-enrollments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completedAt: new Date().toISOString(), score, certificateIssued: true }) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/adjuster-enrollments"] }); toast({ title: "Certificate Issued" }); },
  });

  const published = courses.filter(c => c.status === "published");
  const totalCredits = enrollments.filter(e => e.completedAt).reduce((s, e) => {
    const course = courses.find(c => c.id === e.courseId);
    return s + (course?.creditHours || 0);
  }, 0);
  const uniqueAdjusters = new Set(enrollments.map(e => e.adjusterName)).size;
  const uniqueCarriers = new Set(enrollments.map(e => e.carrier).filter(Boolean)).size;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <GraduationCap className="w-7 h-7 text-blue-600" />
        <div>
          <h1 className="text-xl font-bold">Adjuster CE Portal</h1>
          <p className="text-sm text-muted-foreground">Free continuing education for adjusters in your territory — build trust, win first-call preference</p>
        </div>
      </div>

      {/* Why This Works */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-sm">
        <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">Strategy: Adjusters who receive CE credits from you are more likely to call you first on complex losses and approve borderline supplement items.</p>
        <p className="text-blue-700 dark:text-blue-400">This is how Paul Davis and BMS CAT build preferred vendor relationships — at zero acquisition cost.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Courses Available</p><p className="text-2xl font-bold text-blue-600">{published.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Adjusters Enrolled</p><p className="text-2xl font-bold">{uniqueAdjusters}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Carriers Reached</p><p className="text-2xl font-bold">{uniqueCarriers}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">CE Credits Issued</p><p className="text-2xl font-bold text-green-600">{totalCredits.toFixed(1)}</p></CardContent></Card>
      </div>

      {/* Courses */}
      <div>
        <h2 className="text-base font-semibold mb-3">Available Courses</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {published.map(course => {
            const courseEnrollments = enrollments.filter(e => e.courseId === course.id);
            const completed = courseEnrollments.filter(e => e.completedAt).length;
            return (
              <Card key={course.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{course.title}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">{course.description}</p>
                    </div>
                    <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium capitalize ${CAT_COLORS[course.category]}`}>{course.category}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Award className="w-3.5 h-3.5" />{course.creditHours} CE credit{course.creditHours !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{courseEnrollments.length} enrolled ({completed} completed)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      data-testid={`button-enroll-${course.id}`}
                      onClick={() => { setSelectedCourse(course); setEnrollOpen(true); }}
                      className="bg-blue-600 hover:bg-blue-700 text-white flex-1"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" />Enroll an Adjuster
                    </Button>
                    <DeleteCourseBtn id={course.id} label={course.title} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Enrollments */}
      <Card>
        <CardHeader><CardTitle className="text-base">Enrollment History</CardTitle></CardHeader>
        <CardContent className="p-0">
          {enrollments.length === 0 ? (
            <p className="text-center text-muted-foreground p-8">No enrollments yet. Enroll adjusters from the courses above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5">Adjuster</th>
                  <th className="text-left px-4 py-2.5">Carrier</th>
                  <th className="text-left px-4 py-2.5">Course</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Actions</th>
                </tr></thead>
                <tbody>
                  {enrollments.map(e => {
                    const course = courses.find(c => c.id === e.courseId);
                    return (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <p className="font-medium">{e.adjusterName}</p>
                          {e.adjusterEmail && <p className="text-xs text-muted-foreground">{e.adjusterEmail}</p>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{e.carrier || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{course?.title || `Course #${e.courseId}`}</td>
                        <td className="px-4 py-3">
                          {e.completedAt ? (
                            <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />Complete {e.certificateIssued ? "· Cert Issued" : ""}
                            </span>
                          ) : (
                            <span className="text-xs text-yellow-600 font-medium">In Progress</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {!e.completedAt && (
                              <Button size="sm" variant="outline" className="text-xs" onClick={() => completeMutation.mutate({ id: e.id, score: 100 })}>
                                <Award className="w-3 h-3 mr-1" />Issue Certificate
                              </Button>
                            )}
                            <DeleteEnrollmentBtn id={e.id} label={e.adjusterName} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enroll Dialog */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enroll Adjuster — {selectedCourse?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><Label>Adjuster Name</Label><Input data-testid="input-adjuster-name" value={enrollForm.adjusterName} onChange={e => setEnrollForm(f => ({ ...f, adjusterName: e.target.value }))} placeholder="John Smith" /></div>
            <div><Label>Email (optional)</Label><Input value={enrollForm.adjusterEmail} onChange={e => setEnrollForm(f => ({ ...f, adjusterEmail: e.target.value }))} placeholder="jsmith@statefarm.com" /></div>
            <div><Label>Carrier</Label><Input value={enrollForm.carrier} onChange={e => setEnrollForm(f => ({ ...f, carrier: e.target.value }))} placeholder="State Farm" /></div>
            <Button onClick={() => enrollMutation.mutate({ courseId: selectedCourse?.id, ...enrollForm })} disabled={!enrollForm.adjusterName || enrollMutation.isPending} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              Enroll Adjuster
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

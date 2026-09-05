import { Switch, Route, Router, Redirect } from "wouter";
import { lazy, Suspense } from "react";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Layout from "@/components/Layout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Pages — existing
import NotFound from "@/pages/not-found";

// Pages — Suite 3 new

// Pages — Suite 4 new

// Pages — Suite 5 new

// Pages — Suite 6 new


// Pages — Suite 7 (11 Upgrades)
import SessionTimeout from "@/components/SessionTimeout";
import OfflineIndicator from "@/components/OfflineIndicator";
import Login from "@/pages/Login";
import ForceEnroll2FA from "@/components/ForceEnroll2FA";
import ForcePinChange from "@/components/ForcePinChange";
import EnvBanner from "@/components/EnvBanner";
import CommandPalette from "@/components/CommandPalette";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PresenceTracker } from "@/lib/presence";
import { LocationTracker } from "@/lib/locationTracker";


// Lazy-loaded pages (code-split — each page downloads only when visited)
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const MyToday = lazy(() => import("@/pages/MyToday"));
const Jobs = lazy(() => import("@/pages/Jobs"));
const JobDetail = lazy(() => import("@/pages/JobDetail"));
const ClosedJobs = lazy(() => import("@/pages/ClosedJobs"));
const Estimates = lazy(() => import("@/pages/Estimates"));
const EstimateDetail = lazy(() => import("@/pages/EstimateDetail"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const Payments = lazy(() => import("@/pages/Payments"));
const Photos = lazy(() => import("@/pages/Photos"));
const PhotoSearch = lazy(() => import("@/pages/PhotoSearch"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const TrashPage = lazy(() => import("@/pages/Trash"));
const Scheduling = lazy(() => import("@/pages/Scheduling"));
const Technician = lazy(() => import("@/pages/Technician"));
const Messaging = lazy(() => import("@/pages/Messaging"));
const EmailPage = lazy(() => import("@/pages/Email"));
const Marketing = lazy(() => import("@/pages/Marketing"));
const Contacts = lazy(() => import("@/pages/Contacts"));
const PartnerPortal = lazy(() => import("@/pages/PartnerPortal"));
const PartnerPortalSetup = lazy(() => import("@/pages/PartnerPortalSetup"));
const CustomerPortal = lazy(() => import("@/pages/CustomerPortal"));
const PublicReport = lazy(() => import("@/pages/PublicReport"));
const SignDocument = lazy(() => import("@/pages/SignDocument"));
const PortalQR = lazy(() => import("@/pages/PortalQR"));
const Equipment = lazy(() => import("@/pages/Equipment"));
const JobCosting = lazy(() => import("@/pages/JobCosting"));
const Supplements = lazy(() => import("@/pages/Supplements"));
const CarrierScorecard = lazy(() => import("@/pages/CarrierScorecard"));
const CarrierHub = lazy(() => import("@/pages/CarrierHub"));
const SupplementHub = lazy(() => import("@/pages/SupplementHub"));
const XactimateHub = lazy(() => import("@/pages/XactimateHub"));
const AdjusterHub = lazy(() => import("@/pages/AdjusterHub"));
const TechnicianHub = lazy(() => import("@/pages/TechnicianHub"));
const DryingComplianceHub = lazy(() => import("@/pages/DryingComplianceHub"));
const SafetyHub = lazy(() => import("@/pages/SafetyHub"));
const SchedulingHub = lazy(() => import("@/pages/SchedulingHub"));
const ARHub = lazy(() => import("@/pages/ARHub"));
const HRHub = lazy(() => import("@/pages/HRHub"));
const ProfitabilityHub = lazy(() => import("@/pages/ProfitabilityHub"));
const PartnerHub = lazy(() => import("@/pages/PartnerHub"));
const MarketingHub = lazy(() => import("@/pages/MarketingHub"));
const EquipmentHub = lazy(() => import("@/pages/EquipmentHub"));
const CommsHub = lazy(() => import("@/pages/CommsHub"));
const PartnerROI = lazy(() => import("@/pages/PartnerROI"));
const LeadAttribution = lazy(() => import("@/pages/LeadAttribution"));
const FollowUps = lazy(() => import("@/pages/FollowUps"));
const Safety = lazy(() => import("@/pages/Safety"));
const LineItemLibrary = lazy(() => import("@/pages/LineItemLibrary"));
const Profitability = lazy(() => import("@/pages/Profitability"));
const WeeklyBilling = lazy(() => import("@/pages/WeeklyBilling"));
const DocumentBuilder = lazy(() => import("@/pages/DocumentBuilder"));
// MigrationCenter removed from routing (not part of workflow). Page file is
// preserved at client/src/pages/MigrationCenter.tsx for later restoration.
// const MigrationCenter = lazy(() => import("@/pages/MigrationCenter"));
const Reports = lazy(() => import("@/pages/Reports"));
// Consolidated hubs — collapse many previous top-level sidebar entries.
const ReportsHub = lazy(() => import("@/pages/ReportsHub"));
const PhotosHub = lazy(() => import("@/pages/PhotosHub"));
const IntakeHub = lazy(() => import("@/pages/IntakeHub"));
const SubcontractorsHub = lazy(() => import("@/pages/SubcontractorsHub"));
const TeamActivity = lazy(() => import("@/pages/TeamActivity"));
const AIAgentCenter = lazy(() => import("@/pages/AIAgentCenter"));
const AdjusterDB = lazy(() => import("@/pages/AdjusterDB"));
const ARaging = lazy(() => import("@/pages/ARaging"));
const EquipmentROI = lazy(() => import("@/pages/EquipmentROI"));
const InspectionChecklist = lazy(() => import("@/pages/InspectionChecklist"));
const ReviewRequests = lazy(() => import("@/pages/ReviewRequests"));
const CertTracker = lazy(() => import("@/pages/CertTracker"));
const PartnerScorecard = lazy(() => import("@/pages/PartnerScorecard"));
const ActivityLog = lazy(() => import("@/pages/ActivityLog"));
const SMS = lazy(() => import("@/pages/SMS"));
const JobTemplates = lazy(() => import("@/pages/JobTemplates"));
const AdjusterPortal = lazy(() => import("@/pages/AdjusterPortal"));
const AdjusterPortalView = lazy(() => import("@/pages/AdjusterPortalView"));
const TechNotifications = lazy(() => import("@/pages/TechNotifications"));
const XactimateImport = lazy(() => import("@/pages/XactimateImport"));
const AIEstimateReview = lazy(() => import("@/pages/AIEstimateReview"));
const ReferralDashboard = lazy(() => import("@/pages/ReferralDashboard"));
const CarrierARIntelligence = lazy(() => import("@/pages/CarrierARIntelligence"));
const AISupplementEngine = lazy(() => import("@/pages/AISupplementEngine"));
const CommTimeline = lazy(() => import("@/pages/CommTimeline"));
const IoTDryingDashboard = lazy(() => import("@/pages/IoTDryingDashboard"));
const IICRCCompliance = lazy(() => import("@/pages/IICRCCompliance"));
const EmergencyIntake = lazy(() => import("@/pages/EmergencyIntake"));
const ReferralProfitability = lazy(() => import("@/pages/ReferralProfitability"));
const EquipmentLifecycle = lazy(() => import("@/pages/EquipmentLifecycle"));
const MultilingualCrew = lazy(() => import("@/pages/MultilingualCrew"));
const SubrogationTracker = lazy(() => import("@/pages/SubrogationTracker"));
const StormMarketing = lazy(() => import("@/pages/StormMarketing"));
const DroneLiDAR = lazy(() => import("@/pages/DroneLiDAR"));
const QBSync = lazy(() => import("@/pages/QBSync"));
const JobCostLive = lazy(() => import("@/pages/JobCostLive"));
const ARFollowUp = lazy(() => import("@/pages/ARFollowUp"));
const LienWaivers = lazy(() => import("@/pages/LienWaivers"));
const TimeClock = lazy(() => import("@/pages/TimeClock"));
const DepartureChecklist = lazy(() => import("@/pages/DepartureChecklist"));
const AppointmentReminders = lazy(() => import("@/pages/AppointmentReminders"));
const CommandBI = lazy(() => import("@/pages/CommandBI"));
const EstimatorPerformance = lazy(() => import("@/pages/EstimatorPerformance"));
const HazmatFlags = lazy(() => import("@/pages/HazmatFlags"));
const XactAudit = lazy(() => import("@/pages/XactAudit"));
const OPRebuttal = lazy(() => import("@/pages/OPRebuttal"));
const SupplementTracker = lazy(() => import("@/pages/SupplementTracker"));
const GeneralConditions = lazy(() => import("@/pages/GeneralConditions"));
const AdjusterCE = lazy(() => import("@/pages/AdjusterCE"));
const ApprovedClaimsLibrary = lazy(() => import("@/pages/ApprovedClaimsLibrary"));
const FleetManager = lazy(() => import("@/pages/FleetManager"));
const CashFlowCalendar = lazy(() => import("@/pages/CashFlowCalendar"));
const PaymentPlans = lazy(() => import("@/pages/PaymentPlans"));
const SafetyChecklist = lazy(() => import("@/pages/SafetyChecklist"));
const NPSSurveys = lazy(() => import("@/pages/NPSSurveys"));
const TechScorecard = lazy(() => import("@/pages/TechScorecard"));
const XactimateAlert = lazy(() => import("@/pages/XactimateAlert"));
const InvoiceEscalation = lazy(() => import("@/pages/InvoiceEscalation"));
const SupplementAutoDraft = lazy(() => import("@/pages/SupplementAutoDraft"));
const FNOLChatbot = lazy(() => import("@/pages/FNOLChatbot"));
const ClaimFileChecker = lazy(() => import("@/pages/ClaimFileChecker"));
const CarrierEscalationAI = lazy(() => import("@/pages/CarrierEscalationAI"));
const PredictiveModel = lazy(() => import("@/pages/PredictiveModel"));
const IICRCDeviationLog = lazy(() => import("@/pages/IICRCDeviationLog"));
const COITracker = lazy(() => import("@/pages/COITracker"));
const Subcontractors = lazy(() => import("@/pages/Subcontractors"));
const TechLMS = lazy(() => import("@/pages/TechLMS"));
const DispatchMatrix = lazy(() => import("@/pages/DispatchMatrix"));
const GlobalSearch = lazy(() => import("@/pages/GlobalSearch"));
const CarrierClaimIntelligence = lazy(() => import("@/pages/CarrierClaimIntelligence"));
const TechCoach = lazy(() => import("@/pages/TechCoach"));
const SupplementAuditAI = lazy(() => import("@/pages/SupplementAuditAI"));
const CarrierCounterIntel = lazy(() => import("@/pages/CarrierCounterIntel"));
const PredictiveDrying = lazy(() => import("@/pages/PredictiveDrying"));
const EscalationOutbox = lazy(() => import("@/pages/EscalationOutbox"));
const StormCAT = lazy(() => import("@/pages/StormCAT"));
const MidJobMarginAlert = lazy(() => import("@/pages/MidJobMarginAlert"));
const AdjusterProfiler = lazy(() => import("@/pages/AdjusterProfiler"));
const CustomerClaimExplainer = lazy(() => import("@/pages/CustomerClaimExplainer"));
const StatuteDemandLetter = lazy(() => import("@/pages/StatuteDemandLetter"));
const CompetitiveBidIntel = lazy(() => import("@/pages/CompetitiveBidIntel"));
const VoiceToNote = lazy(() => import("@/pages/VoiceToNote"));
const PhotoClassifier = lazy(() => import("@/pages/PhotoClassifier"));
const MarketingSuite = lazy(() => import("@/pages/MarketingSuite"));
const PartnerValueDashboard = lazy(() => import("@/pages/PartnerValueDashboard"));
const RoutePlanner = lazy(() => import("@/pages/RoutePlanner"));
const BDCalendar = lazy(() => import("@/pages/BDCalendar"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));
const CarrierResponseTime = lazy(() => import("@/pages/CarrierResponseTime"));
const EquipmentAlerts = lazy(() => import("@/pages/EquipmentAlerts"));
const ProfitabilityByType = lazy(() => import("@/pages/ProfitabilityByType"));
const TechDailySummary = lazy(() => import("@/pages/TechDailySummary"));
const JobAgeAlerts = lazy(() => import("@/pages/JobAgeAlerts"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const UserManagement = lazy(() => import("@/pages/UserManagement"));
const Security = lazy(() => import("@/pages/Security"));
const NotificationSettings = lazy(() => import("@/pages/NotificationSettings"));
const Terms = lazy(() => import("@/pages/Terms"));
const Privacy = lazy(() => import("@/pages/Privacy"));

// Route matching must ignore any "?query" that lives inside the hash so that
// deep links like #/reports?report=weekly-billing&print=1 still match the
// /reports route. Pages that need the query params read them directly from
// window.location.hash, so stripping it here only affects path matching.
function useHashLocationNoQuery(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const [loc, navigate] = useHashLocation();
  const path = loc.includes("?") ? loc.slice(0, loc.indexOf("?")) : loc;
  return [path, navigate as any];
}

function PageLoader() {
  return (
    <div className="w-full flex items-center justify-center py-24" data-testid="page-loader">
      <div className="text-center space-y-2">
        <div className="w-8 h-8 rounded-lg bg-[hsl(var(--titan-red))] mx-auto animate-pulse" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}

function Page({ component: C, name }: { component: React.ComponentType; name: string }) {
  return (
    <ErrorBoundary name={name}>
      <C />
    </ErrorBoundary>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-2">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-red))] mx-auto animate-pulse" />
        <p className="text-sm text-muted-foreground">Loading Titan Pro…</p>
      </div>
    </div>
  );
  if (!user) return <Login />;
  // Force-enrollment gate: staff with a valid session but no 2FA configured
  // (e.g. cached session from before 2FA became mandatory) cannot proceed.
  if (user.twoFactorEnabled === false) return <ForceEnroll2FA />;
  // PIN gate (lower priority than 2FA): defensive fallback for a session whose
  // PIN is flagged for reset but that skipped the forced-change login step.
  if (user.mustChangePin === true) return <ForcePinChange />;
  return <><PresenceTracker /><LocationTracker />{children}</>;
}

function AppRoutes() {
  // Public routes that must render WITHOUT a staff login (e.g. the Terms of
  // Service linked from the login screen). Matched before the AuthGate.
  return (
    <Switch>
      <Route path="/terms" component={() => (
        <Suspense fallback={<PageLoader />}><Page component={Terms} name="Terms" /></Suspense>
      )} />
      <Route path="/privacy" component={() => (
        <Suspense fallback={<PageLoader />}><Page component={Privacy} name="Privacy" /></Suspense>
      )} />
      {/* Public customer/partner portals — reachable via QR code WITHOUT staff
         login. Each portal renders its own self-contained login gate. */}
      <Route path="/customer-portal" component={() => (
        <Suspense fallback={<PageLoader />}><Page component={CustomerPortal} name="CustomerPortal" /></Suspense>
      )} />
      <Route path="/partner-access" component={() => (
        <Suspense fallback={<PageLoader />}>
          <ErrorBoundary name="PartnerPortalPublic"><PartnerPortal partnerOnly /></ErrorBoundary>
        </Suspense>
      )} />
      {/* Public photo report viewer — no staff login required. The share
         token gates access on the server; the client just renders whatever
         the token endpoint returns. */}
      <Route path="/public/reports/:token" component={() => (
        <Suspense fallback={<PageLoader />}><Page component={PublicReport} name="PublicReport" /></Suspense>
      )} />
      {/* Remote e-signature link — opened from email. NO staff auth required. */}
      <Route path="/sign/:token" component={() => (
        <Suspense fallback={<PageLoader />}><Page component={SignDocument} name="SignDocument" /></Suspense>
      )} />
      <Route>
        <AuthenticatedRoutes />
      </Route>
    </Switch>
  );
}

// Landing router. Owners see the full Dashboard (revenue + Attention Today);
// everyone else sees MyToday. Rendered lazily via the same Suspense boundary
// as the routes list, so the initial paint is identical either way.
function SmartLanding() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  return isOwner ? <Dashboard /> : <MyToday />;
}

function AuthenticatedRoutes() {
  return (
    <AuthGate>
    <Layout>
      {/* Global ⌘K / Ctrl-K palette — mounted inside <Router> so it can
          navigate via wouter. Rendered as an overlay; no visible chrome
          until the shortcut opens it. */}
      <CommandPalette />
      <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Core */}
        {/* Landing router: owners land on the full Dashboard (KPIs +
            cross-company Attention Today); everyone else lands on
            My Today, which is scoped to what THEY personally need to
            touch. The full dashboard is always reachable at /dashboard
            and My Today at /my/today for anyone who wants either view. */}
        <Route path="/" component={() => <Page component={SmartLanding} name="Home" />} />
        <Route path="/dashboard" component={() => <Page component={Dashboard} name="Dashboard" />} />
        <Route path="/my/today" component={() => <Page component={MyToday} name="MyToday" />} />
        <Route path="/jobs" component={() => <Page component={Jobs} name="Jobs" />} />
        <Route path="/jobs/closed" component={() => <Page component={ClosedJobs} name="ClosedJobs" />} />
        <Route path="/jobs/:id" component={() => <Page component={JobDetail} name="JobDetail" />} />
        <Route path="/estimates" component={() => <Page component={Estimates} name="Estimates" />} />
        <Route path="/estimates/:id" component={() => <Page component={EstimateDetail} name="EstimateDetail" />} />
        <Route path="/invoices" component={() => <Page component={Invoices} name="Invoices" />} />
        <Route path="/payments" component={() => <Page component={Payments} name="Payments" />} />
        <Route path="/escalation-outbox" component={() => <Page component={EscalationOutbox} name="EscalationOutbox" />} />
        <Route path="/contacts" component={() => <Page component={Contacts} name="Contacts" />} />

        {/* Field Ops */}
        {/* Cross-job photo library search — must come BEFORE /photos so wouter
            matches the more-specific /photos/search first. */}
        {/* Photos Hub — tabs: capture | search | classify. Old URLs redirect. */}
        <Route path="/photos-hub" component={() => <Page component={PhotosHub} name="PhotosHub" />} />
        <Route path="/photos/search"><Redirect to="/photos-hub?tab=search" /></Route>
        <Route path="/photos"><Redirect to="/photos-hub?tab=capture" /></Route>
        <Route path="/photo-classifier"><Redirect to="/photos-hub?tab=classify" /></Route>
        {/* Analytics folds into the Reports & BI Hub. */}
        <Route path="/analytics"><Redirect to="/reports-hub?tab=analytics" /></Route>
        <Route path="/trash" component={() => <Page component={TrashPage} name="Trash" />} />
        {/* Schedule Calendar is a first-class Core route now (was previously a
            tab inside the Scheduling & Dispatch hub). Renders the Scheduling
            page directly so the sidebar entry loads without a redirect hop. */}
        <Route path="/scheduling" component={() => <Page component={Scheduling} name="Scheduling" />} />
        <Route path="/technician"><Redirect to="/technician-hub?tab=technician" /></Route>
        <Route path="/equipment"><Redirect to="/equipment-hub?tab=inventory" /></Route>
        <Route path="/inventory"><Redirect to="/equipment-hub?tab=consumables" /></Route>
        <Route path="/consumables"><Redirect to="/equipment-hub?tab=consumables" /></Route>
        <Route path="/equipment-roi"><Redirect to="/equipment-hub?tab=roi" /></Route>
        <Route path="/inspections" component={() => <Page component={InspectionChecklist} name="InspectionChecklist" />} />
        <Route path="/safety"><Redirect to="/safety-hub?tab=log" /></Route>
        <Route path="/certifications"><Redirect to="/technician-hub?tab=certs" /></Route>

        {/* Insurance — consolidated hubs */}
        <Route path="/carrier-hub" component={() => <Page component={CarrierHub} name="CarrierHub" />} />
        <Route path="/supplement-hub" component={() => <Page component={SupplementHub} name="SupplementHub" />} />
        <Route path="/xactimate-hub" component={() => <Page component={XactimateHub} name="XactimateHub" />} />
        <Route path="/adjuster-hub" component={() => <Page component={AdjusterHub} name="AdjusterHub" />} />

        {/* Field Ops / Finance / Business Dev / Equipment / Comms — consolidated hubs */}
        <Route path="/technician-hub" component={() => <Page component={TechnicianHub} name="TechnicianHub" />} />
        <Route path="/drying-hub" component={() => <Page component={DryingComplianceHub} name="DryingComplianceHub" />} />
        <Route path="/safety-hub" component={() => <Page component={SafetyHub} name="SafetyHub" />} />
        <Route path="/scheduling-hub" component={() => <Page component={SchedulingHub} name="SchedulingHub" />} />
        <Route path="/ar-hub" component={() => <Page component={ARHub} name="ARHub" />} />
        <Route path="/hr-hub" component={() => <Page component={HRHub} name="HRHub" />} />
        <Route path="/profitability-hub" component={() => <Page component={ProfitabilityHub} name="ProfitabilityHub" />} />
        <Route path="/partner-hub" component={() => <Page component={PartnerHub} name="PartnerHub" />} />
        <Route path="/marketing-hub" component={() => <Page component={MarketingHub} name="MarketingHub" />} />
        <Route path="/equipment-hub" component={() => <Page component={EquipmentHub} name="EquipmentHub" />} />
        <Route path="/comms-hub" component={() => <Page component={CommsHub} name="CommsHub" />} />

        {/* Legacy insurance routes — redirect into consolidated hubs (preserves bookmarks) */}
        <Route path="/supplements"><Redirect to="/supplement-hub?tab=active" /></Route>
        <Route path="/carrier-scorecard"><Redirect to="/carrier-hub?tab=scorecard" /></Route>
        <Route path="/adjusters"><Redirect to="/adjuster-hub?tab=database" /></Route>
        <Route path="/adjuster-portal"><Redirect to="/adjuster-hub?tab=portal" /></Route>
        <Route path="/adjuster-portal-view/:token" component={() => <Page component={AdjusterPortalView} name="AdjusterPortalView" />} />
        <Route path="/job-costing" component={() => <Page component={JobCosting} name="JobCosting" />} />
        <Route path="/line-items" component={() => <Page component={LineItemLibrary} name="LineItemLibrary" />} />
        <Route path="/xactimate-import"><Redirect to="/xactimate-hub?tab=import" /></Route>
        <Route path="/ai-estimate-review"><Redirect to="/xactimate-hub?tab=ai-review" /></Route>

        {/* Business Dev */}
        <Route path="/lead-attribution"><Redirect to="/reports-hub?tab=attribution" /></Route>
        <Route path="/partner-roi"><Redirect to="/partner-hub?tab=roi" /></Route>
        <Route path="/partner-scorecard"><Redirect to="/partner-hub?tab=scorecard" /></Route>
        <Route path="/route-planner" component={() => <Page component={RoutePlanner} name="RoutePlanner" />} />
        <Route path="/bd-calendar" component={() => <Page component={BDCalendar} name="BDCalendar" />} />
        <Route path="/referral-dashboard"><Redirect to="/partner-hub?tab=referrals" /></Route>
        <Route path="/follow-ups" component={() => <Page component={FollowUps} name="FollowUps" />} />
        <Route path="/reviews" component={() => <Page component={ReviewRequests} name="ReviewRequests" />} />
        <Route path="/marketing"><Redirect to="/marketing-hub?tab=overview" /></Route>

        {/* Finance */}
        <Route path="/profitability"><Redirect to="/profitability-hub?tab=overview" /></Route>
        <Route path="/weekly-billing" component={() => <Page component={WeeklyBilling} name="WeeklyBilling" />} />
        <Route path="/document-builder" component={() => <Page component={DocumentBuilder} name="DocumentBuilder" />} />
        {/* Reports & BI Hub — tabs: overview | analytics | command-bi | predictive | nps | attribution.
            /reports keeps its direct route so existing deep links like
            #/reports?report=weekly-billing&print=1 still function. */}
        <Route path="/reports-hub" component={() => <Page component={ReportsHub} name="ReportsHub" />} />
        <Route path="/reports" component={() => <Page component={Reports} name="Reports" />} />
        <Route path="/team-activity" component={() => <Page component={TeamActivity} name="TeamActivity" />} />
        <Route path="/ai-agent" component={() => <Page component={AIAgentCenter} name="AIAgentCenter" />} />
        <Route path="/ar-aging"><Redirect to="/ar-hub?tab=aging" /></Route>

        {/* Comms */}
        <Route path="/messaging"><Redirect to="/comms-hub?tab=messaging" /></Route>
        <Route path="/email"><Redirect to="/comms-hub?tab=email" /></Route>
        <Route path="/sms"><Redirect to="/comms-hub?tab=sms" /></Route>

        {/* Tools */}
        <Route path="/job-templates" component={() => <Page component={JobTemplates} name="JobTemplates" />} />
        <Route path="/activity" component={() => <Page component={ActivityLog} name="ActivityLog" />} />
        <Route path="/tech-notifications" component={() => <Page component={TechNotifications} name="TechNotifications" />} />

        {/* Suite 4 — Intelligence */}
        <Route path="/carrier-ar"><Redirect to="/ar-hub?tab=carrier-ar" /></Route>
        <Route path="/referral-profitability"><Redirect to="/partner-hub?tab=referral-profit" /></Route>
        <Route path="/equipment-lifecycle"><Redirect to="/equipment-hub?tab=lifecycle" /></Route>

        {/* Suite 4 — Insurance */}
        <Route path="/ai-supplement"><Redirect to="/supplement-hub?tab=engine" /></Route>
        <Route path="/subrogation"><Redirect to="/supplement-hub?tab=subrogation" /></Route>

        {/* Suite 4 — Field Tech */}
        <Route path="/iot-drying"><Redirect to="/drying-hub?tab=iot" /></Route>
        <Route path="/iicrc-compliance"><Redirect to="/drying-hub?tab=iicrc" /></Route>
        {/* Intake Hub — tabs: emergency | fnol | voice. */}
        <Route path="/intake-hub" component={() => <Page component={IntakeHub} name="IntakeHub" />} />
        <Route path="/emergency-intake"><Redirect to="/intake-hub?tab=emergency" /></Route>
        <Route path="/multilingual" component={() => <Page component={MultilingualCrew} name="MultilingualCrew" />} />

        {/* Suite 4 — Comms + Marketing */}
        <Route path="/comm-timeline"><Redirect to="/comms-hub?tab=timeline" /></Route>
        <Route path="/storm-marketing"><Redirect to="/marketing-hub?tab=storm" /></Route>
        <Route path="/drone-lidar" component={() => <Page component={DroneLiDAR} name="DroneLiDAR" />} />

        {/* Suite 5 */}
        <Route path="/qb-sync" component={() => <Page component={QBSync} name="QBSync" />} />
        <Route path="/job-cost-live"><Redirect to="/profitability-hub?tab=live-costs" /></Route>
        <Route path="/ar-followup"><Redirect to="/ar-hub?tab=followup" /></Route>
        <Route path="/lien-waivers" component={() => <Page component={LienWaivers} name="LienWaivers" />} />
        <Route path="/time-clock" component={() => <Page component={TimeClock} name="TimeClock" />} />
        <Route path="/departure-checklist"><Redirect to="/scheduling-hub?tab=departure" /></Route>
        <Route path="/appointment-reminders"><Redirect to="/scheduling-hub?tab=reminders" /></Route>
        <Route path="/command-bi"><Redirect to="/reports-hub?tab=command-bi" /></Route>
        <Route path="/estimator-performance"><Redirect to="/profitability-hub?tab=estimators" /></Route>
        <Route path="/hazmat-flags"><Redirect to="/safety-hub?tab=hazmat" /></Route>

        {/* Suite 6 */}
        <Route path="/xact-audit"><Redirect to="/xactimate-hub?tab=audit" /></Route>
        <Route path="/op-rebuttal"><Redirect to="/supplement-hub?tab=op-rebuttal" /></Route>
        <Route path="/supplement-tracker"><Redirect to="/supplement-hub?tab=tracker" /></Route>
        <Route path="/general-conditions"><Redirect to="/supplement-hub?tab=general-conditions" /></Route>
        <Route path="/adjuster-ce"><Redirect to="/adjuster-hub?tab=ce" /></Route>
        <Route path="/approved-claims"><Redirect to="/supplement-hub?tab=approved-claims" /></Route>
        <Route path="/fleet" component={() => <Page component={FleetManager} name="FleetManager" />} />

        {/* Suite 7 — 11 Upgrades */}
        <Route path="/carrier-response-time"><Redirect to="/carrier-hub?tab=response-time" /></Route>
        <Route path="/equipment-alerts"><Redirect to="/equipment-hub?tab=alerts" /></Route>
        <Route path="/profitability-by-type"><Redirect to="/profitability-hub?tab=by-type" /></Route>
        <Route path="/tech-daily"><Redirect to="/technician-hub?tab=daily" /></Route>
        <Route path="/job-age-alerts" component={() => <Page component={JobAgeAlerts} name="JobAgeAlerts" />} />

        {/* User Management */}
        <Route path="/user-management" component={() => <Page component={UserManagement} name="UserManagement" />} />
        <Route path="/security" component={() => <Page component={Security} name="Security" />} />
        <Route path="/notification-settings" component={() => <Page component={NotificationSettings} name="NotificationSettings" />} />
        <Route path="/audit-log" component={() => <Page component={AuditLog} name="AuditLog" />} />
        <Route path="/integrations" component={() => <Page component={Integrations} name="Integrations" />} />
        {/* /settings landed on a raw dev-facing 404. Redirect to Integrations,
            the primary Admin → Tools landing page. Fixed 2026-08-14. */}
        <Route path="/settings"><Redirect to="/integrations" /></Route>

        {/* Portals (staff-side admin views — public customer/partner portals live
           in AppRoutes above, reachable via QR code without staff login) */}
        <Route path="/partner-portal-setup" component={() => <Page component={PartnerPortalSetup} name="PartnerPortalSetup" />} />
        <Route path="/partner-portal" component={() => <Page component={PartnerPortal} name="PartnerPortal" />} />
        <Route path="/portal-qr" component={() => <Page component={PortalQR} name="PortalQR" />} />


        {/* Suite 24 — New Features */}
        <Route path="/cash-flow" component={() => <Page component={CashFlowCalendar} name="CashFlowCalendar" />} />
        <Route path="/payment-plans" component={() => <Page component={PaymentPlans} name="PaymentPlans" />} />
        <Route path="/safety-checklist"><Redirect to="/safety-hub?tab=checklist" /></Route>
        <Route path="/nps-surveys"><Redirect to="/reports-hub?tab=nps" /></Route>
        <Route path="/tech-scorecard"><Redirect to="/technician-hub?tab=scorecard" /></Route>
        <Route path="/xactimate-alert"><Redirect to="/xactimate-hub?tab=alerts" /></Route>
        <Route path="/invoice-escalation" component={() => <Page component={InvoiceEscalation} name="InvoiceEscalation" />} />
        <Route path="/supplement-autodraft"><Redirect to="/supplement-hub?tab=draft" /></Route>
        <Route path="/fnol-chatbot"><Redirect to="/intake-hub?tab=fnol" /></Route>
        <Route path="/claim-file-checker"><Redirect to="/supplement-hub?tab=file-checker" /></Route>
        <Route path="/carrier-escalation-ai"><Redirect to="/carrier-hub?tab=escalation" /></Route>
        <Route path="/predictive-model"><Redirect to="/reports-hub?tab=predictive" /></Route>
        <Route path="/iicrc-deviations"><Redirect to="/drying-hub?tab=deviations" /></Route>
        {/* Subcontractors Hub — tabs: roster | coi. */}
        <Route path="/subcontractors-hub" component={() => <Page component={SubcontractorsHub} name="SubcontractorsHub" />} />
        <Route path="/coi-tracker"><Redirect to="/subcontractors-hub?tab=coi" /></Route>
        <Route path="/subcontractors"><Redirect to="/subcontractors-hub?tab=roster" /></Route>
        <Route path="/tech-lms"><Redirect to="/technician-hub?tab=lms" /></Route>
        <Route path="/dispatch-matrix"><Redirect to="/scheduling-hub?tab=dispatch" /></Route>
        <Route path="/global-search" component={() => <Page component={GlobalSearch} name="GlobalSearch" />} />
        <Route path="/carrier-claim-intel"><Redirect to="/carrier-hub?tab=claim-intel" /></Route>
        <Route path="/tech-coach"><Redirect to="/technician-hub?tab=coach" /></Route>
        <Route path="/supplement-audit-ai"><Redirect to="/supplement-hub?tab=audit" /></Route>
        <Route path="/carrier-counter-intel"><Redirect to="/carrier-hub?tab=counter-intel" /></Route>
        <Route path="/predictive-drying"><Redirect to="/drying-hub?tab=predictive" /></Route>
        <Route path="/storm-cat"><Redirect to="/marketing-hub?tab=storm-cat" /></Route>
        <Route path="/margin-alert"><Redirect to="/profitability-hub?tab=margin-alert" /></Route>
        <Route path="/adjuster-profiler"><Redirect to="/adjuster-hub?tab=profiler" /></Route>
        <Route path="/claim-explainer"><Redirect to="/supplement-hub?tab=explainer" /></Route>
        <Route path="/statute-demand"><Redirect to="/ar-hub?tab=statute" /></Route>
        <Route path="/bid-intel"><Redirect to="/supplement-hub?tab=bid-intel" /></Route>
        <Route path="/voice-note"><Redirect to="/intake-hub?tab=voice" /></Route>
        <Route path="/marketing-suite"><Redirect to="/marketing-hub?tab=suite" /></Route>
        <Route path="/partner-value"><Redirect to="/partner-hub?tab=value" /></Route>
        <Route component={NotFound} />
      </Switch>
      </Suspense>
    </Layout>
    </AuthGate>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Non-production banner — hidden entirely on the live site. Rendered
            above the Router so it appears on the login screen and every
            authenticated view. */}
        <EnvBanner />
        {/* hrefs transform: hash routing means <Link href="/jobs/16"> would
            render as <a href="/jobs/16">, which breaks right-click / middle-
            click / Cmd-click "open in new tab" — the fresh tab loads the
            root path with no hash and lands on the dashboard. Prepending "#"
            to the rendered href fixes all three, without changing in-page
            navigation (wouter still intercepts left-clicks). Added 2026-08-15. */}
        <Router hook={useHashLocationNoQuery} hrefs={(path) => "#" + path}>
          <AppRoutes />
        </Router>
        <SessionTimeout />
        <OfflineIndicator />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

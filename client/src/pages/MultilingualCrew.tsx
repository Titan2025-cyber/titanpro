import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Volume2, FileText, CheckCircle } from "lucide-react";

// Translations for key restoration field terms
const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    language: "English",
    waterDamage: "Water Damage",
    fireDamage: "Fire/Smoke Damage",
    moldRemediation: "Mold Remediation",
    stormDamage: "Storm Damage",
    moistureReading: "Moisture Reading",
    targetWme: "Target WME %",
    dryingLog: "Drying Log",
    affectedArea: "Affected Area",
    equipment: "Equipment",
    dehumidifier: "Dehumidifier",
    airMover: "Air Mover",
    airScrubber: "Air Scrubber",
    protectiveGear: "Protective Gear Required",
    containment: "Containment Area",
    evacuate: "Evacuate the area",
    callSupervisor: "Call supervisor immediately",
    dailyLog: "Complete daily moisture log",
    photoRequired: "Photos required before and after",
    safeToEnter: "Safe to enter",
    notSafeToEnter: "NOT safe to enter — electrical hazard",
    antimicrobial: "Antimicrobial application required",
    hepaVacuum: "HEPA vacuum all surfaces",
    workComplete: "Work complete — ready for inspection",
    readingAboveTarget: "Reading above target — continue drying",
    readingAtTarget: "Reading at target — drying goal achieved",
    jobNumber: "Job Number",
    techName: "Technician Name",
    date: "Date",
    location: "Location",
    notes: "Notes / Observations",
    signature: "Technician Signature",
    iicrcS500: "IICRC S500 Water Damage Protocol",
    iicrcS520: "IICRC S520 Mold Remediation Protocol",
    iicrcS700: "IICRC S700 Fire & Smoke Protocol",
  },
  es: {
    language: "Español",
    waterDamage: "Daños por Agua",
    fireDamage: "Daños por Fuego/Humo",
    moldRemediation: "Remediación de Moho",
    stormDamage: "Daños por Tormenta",
    moistureReading: "Lectura de Humedad",
    targetWme: "% Objetivo de WME",
    dryingLog: "Registro de Secado",
    affectedArea: "Área Afectada",
    equipment: "Equipo",
    dehumidifier: "Deshumidificador",
    airMover: "Movedor de Aire",
    airScrubber: "Purificador de Aire",
    protectiveGear: "Se Requiere Equipo de Protección",
    containment: "Área de Contención",
    evacuate: "Evacue el área",
    callSupervisor: "Llame al supervisor inmediatamente",
    dailyLog: "Complete el registro de humedad diario",
    photoRequired: "Se requieren fotos antes y después",
    safeToEnter: "Seguro para entrar",
    notSafeToEnter: "NO es seguro entrar — riesgo eléctrico",
    antimicrobial: "Se requiere aplicación antimicrobiana",
    hepaVacuum: "Aspire todas las superficies con HEPA",
    workComplete: "Trabajo completo — listo para inspección",
    readingAboveTarget: "Lectura por encima del objetivo — continúe secando",
    readingAtTarget: "Lectura en el objetivo — meta de secado alcanzada",
    jobNumber: "Número de Trabajo",
    techName: "Nombre del Técnico",
    date: "Fecha",
    location: "Ubicación",
    notes: "Notas / Observaciones",
    signature: "Firma del Técnico",
    iicrcS500: "Protocolo IICRC S500 para Daños por Agua",
    iicrcS520: "Protocolo IICRC S520 para Remediación de Moho",
    iicrcS700: "Protocolo IICRC S700 para Fuego y Humo",
  },
  pt: {
    language: "Português",
    waterDamage: "Danos por Água",
    fireDamage: "Danos por Fogo/Fumaça",
    moldRemediation: "Remediação de Mofo",
    stormDamage: "Danos por Tempestade",
    moistureReading: "Leitura de Umidade",
    targetWme: "% Alvo de WME",
    dryingLog: "Registro de Secagem",
    affectedArea: "Área Afetada",
    equipment: "Equipamento",
    dehumidifier: "Desumidificador",
    airMover: "Movedor de Ar",
    airScrubber: "Purificador de Ar",
    protectiveGear: "Equipamento de Proteção Necessário",
    containment: "Área de Contenção",
    evacuate: "Evacue a área",
    callSupervisor: "Ligue para o supervisor imediatamente",
    dailyLog: "Complete o registro diário de umidade",
    photoRequired: "Fotos necessárias antes e depois",
    safeToEnter: "Seguro para entrar",
    notSafeToEnter: "NÃO é seguro entrar — risco elétrico",
    antimicrobial: "Aplicação antimicrobiana necessária",
    hepaVacuum: "Aspire todas as superfícies com HEPA",
    workComplete: "Trabalho completo — pronto para inspeção",
    readingAboveTarget: "Leitura acima do alvo — continue secando",
    readingAtTarget: "Leitura no alvo — meta de secagem atingida",
    jobNumber: "Número do Trabalho",
    techName: "Nome do Técnico",
    date: "Data",
    location: "Localização",
    notes: "Notas / Observações",
    signature: "Assinatura do Técnico",
    iicrcS500: "Protocolo IICRC S500 para Danos por Água",
    iicrcS520: "Protocolo IICRC S520 para Remediação de Mofo",
    iicrcS700: "Protocolo IICRC S700 para Fogo e Fumaça",
  },
  ht: {
    language: "Kreyòl Ayisyen",
    waterDamage: "Domaj Dlo",
    fireDamage: "Domaj Dife/Lafimen",
    moldRemediation: "Remèdyasyon Mwazi",
    stormDamage: "Domaj Tanpèt",
    moistureReading: "Lekti Imidite",
    targetWme: "Pousantaj Sib WME",
    dryingLog: "Jounal Sechaj",
    affectedArea: "Zòn Ki Afekte",
    equipment: "Ekipman",
    dehumidifier: "Dezimidifikateur",
    airMover: "Souflè Lè",
    airScrubber: "Pirifye Lè",
    protectiveGear: "Ekipman Pwoteksyon Obligatwa",
    containment: "Zòn Kontansyon",
    evacuate: "Kite zòn nan",
    callSupervisor: "Rele sipèvizè imedyatman",
    dailyLog: "Ranpli jounal imidite chak jou",
    photoRequired: "Foto obligatwa anvan ak apre",
    safeToEnter: "San danje pou antre",
    notSafeToEnter: "PA san danje pou antre — risk elektrik",
    antimicrobial: "Aplikasyon antimikwobyen obligatwa",
    hepaVacuum: "Aspire tout sifas yo ak HEPA",
    workComplete: "Travay fini — pare pou enspeksyon",
    readingAboveTarget: "Lekti pi wo pase sib — kontinye seche",
    readingAtTarget: "Lekti nan sib — bi sechaj atenn",
    jobNumber: "Nimewo Travay",
    techName: "Non Teknisyen",
    date: "Dat",
    location: "Kote",
    notes: "Nòt / Obsèvasyon",
    signature: "Siyati Teknisyen",
    iicrcS500: "Pwotokòl IICRC S500 pou Domaj Dlo",
    iicrcS520: "Pwotokòl IICRC S520 pou Remèdyasyon Mwazi",
    iicrcS700: "Pwotokòl IICRC S700 pou Dife ak Lafimen",
  },
};

const FIELD_GROUPS = [
  { title: "Loss Types", keys: ["waterDamage", "fireDamage", "moldRemediation", "stormDamage"] },
  { title: "Equipment", keys: ["equipment", "dehumidifier", "airMover", "airScrubber"] },
  { title: "Documentation", keys: ["jobNumber", "techName", "date", "location", "moistureReading", "targetWme", "dryingLog", "affectedArea", "notes", "signature"] },
  { title: "Safety Instructions", keys: ["protectiveGear", "containment", "evacuate", "callSupervisor", "safeToEnter", "notSafeToEnter"] },
  { title: "Field Prompts", keys: ["dailyLog", "photoRequired", "antimicrobial", "hepaVacuum", "workComplete", "readingAboveTarget", "readingAtTarget"] },
  { title: "IICRC Standards", keys: ["iicrcS500", "iicrcS520", "iicrcS700"] },
];

export default function MultilingualCrew() {
  const [lang, setLang] = useState("es");
  const [showBilingual, setShowBilingual] = useState(true);

  const T = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const EN = TRANSLATIONS.en;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Multilingual Field Interface</h1>
          <p className="text-sm text-muted-foreground">IICRC terminology and field prompts in Spanish, Portuguese, and Haitian Creole for your crew</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger className="w-44" data-testid="select-language"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="es">🇪🇸 Español</SelectItem>
              <SelectItem value="pt">🇧🇷 Português</SelectItem>
              <SelectItem value="ht">🇭🇹 Kreyòl Ayisyen</SelectItem>
              <SelectItem value="en">🇺🇸 English</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setShowBilingual(b => !b)} data-testid="button-toggle-bilingual">
            <Globe className="w-4 h-4 mr-1" />{showBilingual ? "Translation only" : "Show English too"}
          </Button>
        </div>
      </div>

      <div className="bg-[hsl(var(--titan-blue)/0.1)] border border-[hsl(var(--titan-blue)/0.3)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
          <span className="font-semibold">Field Guide — {T.language}</span>
          <Badge variant="outline" className="text-xs">Titan Restoration LLC · 706-922-0154</Badge>
        </div>
        <p className="text-sm text-muted-foreground">All IICRC-standard terminology pre-translated. Notes entered in {T.language} are auto-translated to English for carrier submission.</p>
      </div>

      {FIELD_GROUPS.map(group => (
        <Card key={group.title}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{group.title}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {group.keys.map(key => (
                <div key={key} className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/30 transition-colors" data-testid={`term-${key}`}>
                  {showBilingual && (
                    <div className="w-1/2 min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">English</p>
                      <p className="text-sm">{EN[key]}</p>
                    </div>
                  )}
                  <div className={showBilingual ? "w-1/2 min-w-0" : "flex-1"}>
                    {showBilingual && <p className="text-xs text-muted-foreground mb-0.5">{T.language}</p>}
                    <p className={`text-sm font-medium ${key === "notSafeToEnter" ? "text-red-600 dark:text-red-400" : key === "safeToEnter" ? "text-green-600 dark:text-green-400" : ""}`}>{T[key]}</p>
                  </div>
                  {(key === "notSafeToEnter" || key === "evacuate" || key === "callSupervisor") && (
                    <Badge variant="destructive" className="text-xs shrink-0">⚠️ Safety</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Quick reference card */}
      <Card className="border-2 border-[hsl(var(--titan-red)/0.5)]">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-[hsl(var(--titan-red))]" />Quick Reference — Safety Critical ({T.language})</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {["evacuate", "callSupervisor", "notSafeToEnter", "protectiveGear"].map(key => (
              <div key={key} className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded p-3">
                <p className="text-xs text-red-600 dark:text-red-400 font-medium mb-0.5">{EN[key]}</p>
                <p className="font-bold text-red-800 dark:text-red-300">{T[key]}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t text-center">
            <p className="text-sm font-bold">Titan Restoration LLC</p>
            <p className="text-sm text-muted-foreground">Emergency: 706-922-0154 · titanrestorationllc.com</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

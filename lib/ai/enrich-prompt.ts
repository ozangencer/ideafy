import type { Voice } from "@/lib/types";
import { buildVoicePrompt } from "@/lib/prompts/voice-style";

export interface EnrichPromptInput {
  currentValue: string;
  /** Project voice. Colors the register; the four sections below are fixed. */
  voice?: Voice;
  projectMd: string | null;
  memoryMd: string | null;
  projectFileLabel: string;
  memoryFileLabel: string | null;
}

export function buildEnrichPrompt(input: EnrichPromptInput): string {
  const {
    currentValue,
    voice,
    projectMd,
    memoryMd,
    projectFileLabel,
    memoryFileLabel,
  } = input;

  const trimmed = currentValue.trim();

  const sections: string[] = [
    "Sen bir kanban kartının kısa description'ını, ürün bağlamını kullanarak somut, gözlemlenebilir ve demo'lanabilir bir feature spec'ine dönüştürüyorsun.",
    "",
    "KISA DESCRIPTION:",
    trimmed,
    "",
  ];

  sections.push(
    projectMd
      ? `ÜRÜN BAĞLAMI (${projectFileLabel}):\n${projectMd}`
      : `ÜRÜN BAĞLAMI (${projectFileLabel}): (yok)`
  );
  sections.push("");
  sections.push(
    memoryMd && memoryFileLabel
      ? `PROJE HAFIZASI (${memoryFileLabel}):\n${memoryMd}`
      : "PROJE HAFIZASI: (yok)"
  );
  sections.push("");

  sections.push(
    "Kurallar:",
    "- Sadece zenginleştirilmiş markdown döndür, açıklama/önsöz yazma.",
    "- Bağlamda olmayan teknik detayı uydurma; emin olmadığın kararları 'Open Questions' bölümüne taşı.",
    "- TÜM çıktıyı (bölüm başlıkları dahil) girdinin dilinde yaz. Girdi İngilizce ise başlıklar İngilizce, Türkçe ise Türkçe olsun. Diller karışmasın.",
    "- Maksimum ~300 kelime. Madde işaretlerini cömertçe kullan, paragrafları kısa tut.",
    "",
    "Çıktı yapısı (başlık etiketlerini girdinin diline çevir, sırayı koru):",
    "1. Problem / Why — 1-3 cümle: kullanıcı için neden değerli, hangi acıyı çözüyor.",
    "2. Expected Behavior — gözlemlenebilir davranışları madde madde yaz. Edge case'leri, opsiyonel alanları, görsel kuralları (renk, ikon, durum) açıkça belirt. 'Nice-to-have' veya 'second pass' olan maddeleri etiketle.",
    "3. Important Scope Note — SADECE proje bağlamında, yeni özellikle karıştırılma riski olan mevcut bir alan/özellik/davranış varsa bu bölümü ekle. Mevcut olanı ismiyle anıp yeni olanın ondan hangi tek cümlelik farkla ayrıldığını net söyle. Çakışma riski yoksa bu bölümü tamamen atla.",
    "4. Open Questions — bağlamdan çıkarılamayan, kullanıcıya sorulması gereken kararlar. Yoksa atla."
  );

  // The project's voice, appended last so it colors the register without
  // touching the four sections above. This text lands on the card beside the
  // plan and the opinion, both of which already speak in this voice; leaving
  // enrichment out would put three tones in one modal.
  sections.push("", buildVoicePrompt(voice, "description"));

  return sections.join("\n");
}

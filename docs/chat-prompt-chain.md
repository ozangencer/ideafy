# Chat UI Prompt Chain Architecture

Bu doküman, card modal'daki chat UI'ın nasıl çalıştığını, mesaj devamlılığının nasıl sağlandığını ve Claude'a gönderilen prompt yapısını açıklar.

## Genel Akış

```
[User Message] → [Frontend] → [API: chat-stream] → [Claude CLI] → [Streaming Response] → [Database] → [UI Update]
```

## 1. Chat Devamlılığı (Conversation History)

### Database Yapısı

Tüm mesajlar `conversations` tablosunda saklanır:

```typescript
// lib/db/schema.ts
conversations = {
  id: string,           // UUID
  cardId: string,       // Hangi kart
  sectionType: string,  // "detail" | "opinion" | "solution" | "tests"
  role: string,         // "user" | "assistant"
  content: string,      // Mesaj içeriği
  mentions: string,     // JSON array - @mention verileri
  toolCalls: string,    // JSON array - tool kullanımları
  createdAt: string     // ISO timestamp
}
```

### Conversation Key

Her kart+section kombinasyonu için ayrı bir conversation history tutulur:

```typescript
const conversationKey = `${cardId}-${sectionType}`;
// Örnek: "abc123-opinion", "abc123-tests"
```

### History Yükleme

Tab değiştiğinde veya modal açıldığında history API'den çekilir:

```typescript
// lib/kanban-store/slices/conversation.ts
fetchConversation: async (cardId, sectionType) => {
  const response = await fetch(`/api/cards/${cardId}/conversations?section=${sectionType}`);
  const messages = await response.json();
  // Store'a kaydedilir
}
```

## 2. Mesaj Gönderme Akışı

### Frontend (ConversationInput)

```
[TipTap Editor] → [Enter veya Send buton] → onSend(content, mentions)
```

- Mesaj içeriği HTML veya plain text olabilir
- Görsel eklenebilir (base64 olarak)
- @mention'lar (kartlar, dokümanlar, skill'ler) parse edilir

### Store Action

```typescript
// lib/kanban-store/slices/conversation.ts
sendMessage: async (cardId, sectionType, content, mentions, projectPath, currentSectionContent) => {
  // 1. AbortController oluştur (iptal için)
  // 2. Streaming message state'i başlat
  // 3. POST /api/cards/{cardId}/chat-stream
  // 4. SSE stream'i oku ve UI'ı güncelle
  // 5. Bitince conversation'ı yeniden fetch et
}
```

### API Route (chat-stream)

```typescript
// app/api/cards/[id]/chat-stream/route.ts
POST /api/cards/{cardId}/chat-stream

Body:
{
  sectionType: "detail" | "opinion" | "solution" | "tests",
  content: string,          // Kullanıcı mesajı
  mentions: MentionData[],  // @mention verileri
  projectPath: string,      // Proje klasör yolu
  currentSectionContent: string  // Section'ın mevcut içeriği
}
```

## 3. Prompt Yapısı

Claude'a gönderilen prompt şu parçalardan oluşur:

```
[System Prompt] + [Conversation History] + [User Message]
```

### System Prompt (Section'a göre değişir)

Her section için farklı bir system prompt kullanılır:

#### Detail Section
```
You are helping improve a development task description.

CURRENT CARD CONTEXT:
- Card ID: PRJ-42
- Card UUID: abc-123-uuid
- Title: "Feature title"
- Project: Project Name

IMPORTANT: When updating this card, use the UUID directly.

Current description: (section içeriği)

Provide helpful suggestions, clarifications, or improvements.
```

#### Opinion Section
```
You are a senior software architect evaluating a development task.

CURRENT CARD CONTEXT:
- Card ID: PRJ-42
- Card UUID: abc-123-uuid
- Title: "Feature title"
- Project: Project Name

Current opinion: (section içeriği)

## Product Narrative (Brand Context)
[docs/product-narrative.md içeriği - varsa]

---

Provide technical analysis, identify potential challenges...
```

#### Solution Section
```
You are helping plan the implementation of a development task.
...
Help refine the implementation approach, suggest patterns...
```

#### Tests Section
```
You are a QA engineer helping write test scenarios...
...
Suggest test cases covering happy paths, edge cases...
```

### Conversation History

Son 10 mesaj context olarak eklenir:

```typescript
function buildConversationContext(messages: ConversationMessage[]): string {
  const context = messages
    .slice(-10)
    .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n\n");

  return `\n\nPrevious conversation:\n${context}`;
}
```

### Final Prompt

```typescript
const fullPrompt = `${systemPrompt}${conversationContext}\n\nUser: ${userMessage}`;
```

## 4. Claude CLI Çağrısı

```typescript
const claudeProcess = spawn(getClaudePath(), [
  "-p", fullPrompt,
  "--print",
  "--output-format", "stream-json",
  "--verbose",
  "--allowedTools", "Read",
  "--add-dir", IMAGES_TEMP_DIR
], {
  cwd: projectPath,
  env: getClaudeEnv(),
});
```

### Parametreler:
- `-p`: Prompt
- `--print`: Sadece output, interactive değil
- `--output-format stream-json`: Streaming JSON formatı
- `--verbose`: Detaylı output
- `--allowedTools Read`: Sadece dosya okuma izni
- `--add-dir`: Görsel dosyaları için temp klasör

## 5. Streaming Response

API, Server-Sent Events (SSE) formatında stream döner:

```typescript
// Event tipleri
{ type: "start", data: { pid, messageId } }
{ type: "text", data: "response text chunk" }
{ type: "thinking", data: "thinking content" }
{ type: "tool_use", data: { name: "Read", input: {...} } }
{ type: "tool_result", data: { name: "Read", output: "..." } }
{ type: "close", data: { code, messageId } }
```

### Frontend Handling

```typescript
// Stream okunurken
switch (event.type) {
  case "text":
    // UI'daki streaming message'a ekle
    appendToStreamingMessage(event.data);
    break;
  case "tool_use":
    // Tool kullanımı göster
    setActiveToolCall({ name, status: "running" });
    break;
  case "close":
    // Conversation'ı yeniden fetch et
    await fetchConversation(cardId, sectionType);
    break;
}
```

## 6. Database Kayıt

### User Message (hemen kaydedilir)

```typescript
await db.insert(conversations).values({
  id: uuidv4(),
  cardId,
  sectionType,
  role: "user",
  content,
  mentions: JSON.stringify(mentions),
  createdAt: new Date().toISOString(),
});
```

### Assistant Message (stream bitince kaydedilir)

```typescript
// Claude process kapandığında
await db.insert(conversations).values({
  id: assistantMessageId,
  cardId,
  sectionType,
  role: "assistant",
  content: fullResponse.trim(),
  toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
  createdAt: new Date().toISOString(),
});
```

## 7. Görsel Desteği

Chat'e yapıştırılan görseller:

1. Base64 olarak TipTap editor'da saklanır
2. API'ye gönderilirken extract edilir
3. Temp dosya olarak kaydedilir
4. Claude'a dosya yolu olarak bildirilir
5. Claude `Read` tool ile görseli okur

```typescript
function extractAndSaveImages(content: string): { textContent: string; imagePaths: string[] } {
  // Base64 img tag'lerini bul
  // Her birini temp dosyaya kaydet
  // Yolları döndür
}
```

## 8. Process Management

Her card+section için tek bir Claude process çalışabilir:

```typescript
const processKey = `${cardId}-${sectionType}`;

// Önceki process varsa öldür
const existing = getProcess(processKey);
if (existing) {
  killProcess(processKey);
}

// Yeni process'i kaydet
registerProcess(processKey, claudeProcess, {
  cardId,
  sectionType,
  processType: "chat",
  cardTitle: card.title,
  startedAt: new Date().toISOString(),
});
```

## 9. İptal ve Detach

### Cancel
Stream tamamen iptal edilir:
```typescript
cancelConversation: () => {
  controller.abort();
  set({ isLoading: false, streamingMessage: null });
}
```

### Detach
Modal kapatılsa bile process arka planda devam eder:
```typescript
detachConversation: () => {
  // Process'i öldürme, sadece UI state'i temizle
  set({ isLoading: false, streamingMessage: null });
}
```

## Dosya Referansları

| Dosya | Açıklama |
|-------|----------|
| `app/api/cards/[id]/chat-stream/route.ts` | Ana chat API endpoint |
| `app/api/cards/[id]/conversations/route.ts` | CRUD API for messages |
| `lib/kanban-store/slices/conversation.ts` | Zustand store slice |
| `components/board/card-modal/sections/conversation-panel.tsx` | Chat UI container |
| `components/board/card-modal/sections/conversation-input.tsx` | Message input |
| `components/board/card-modal/sections/conversation-message.tsx` | Message display |

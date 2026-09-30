import { v4 as uuidv4 } from "uuid";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type {
  ActivityEventRecord,
  CardRecord,
  ChatSessionRecord,
  ConversationRecord,
} from "@/lib/db/schema";

// A week is long enough to cover "I deleted these yesterday" and short enough
// that the table never becomes a second copy of the board.
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface TrashPayload {
  card: CardRecord;
  conversations: ConversationRecord[];
  chatSessions: ChatSessionRecord[];
  activityEvents: ActivityEventRecord[];
}

export type RestoreResult =
  | { ok: true; card: CardRecord }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Deletes a card the same way the board always has — conversations and chat
 * sessions go by cascade, activity rows by hand — but writes everything it is
 * about to drop into card_trash first, in the same transaction, so a crash
 * between the two can't lose the card without leaving the snapshot.
 * Returns false when the card doesn't exist.
 */
export function trashCard(id: string): boolean {
  const now = new Date();
  return db.transaction((tx) => {
    const card = tx.select().from(schema.cards).where(eq(schema.cards.id, id)).get();
    if (!card) return false;

    const payload: TrashPayload = {
      card,
      conversations: tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.cardId, id))
        .all(),
      chatSessions: tx
        .select()
        .from(schema.chatSessions)
        .where(eq(schema.chatSessions.cardId, id))
        .all(),
      activityEvents: tx
        .select()
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.cardId, id))
        .all(),
    };

    tx.insert(schema.cardTrash)
      .values({
        id: uuidv4(),
        cardId: id,
        payload: JSON.stringify(payload),
        deletedAt: now.toISOString(),
      })
      .run();

    tx.delete(schema.cards).where(eq(schema.cards.id, id)).run();
    // Drop matching activity inbox rows so the bell doesn't keep orphan
    // entries that 404 on click.
    tx.delete(schema.activityEvents).where(eq(schema.activityEvents.cardId, id)).run();

    tx.delete(schema.cardTrash)
      .where(
        lt(
          schema.cardTrash.deletedAt,
          new Date(now.getTime() - TRASH_RETENTION_MS).toISOString()
        )
      )
      .run();

    return true;
  });
}

/**
 * Puts the most recently trashed copy of a card back under its original id
 * and task number, along with its chat history. Refuses (409) rather than
 * overwriting when the id is live again or the task number has since gone to
 * another card — two IDE-42s on one board is worse than a failed undo.
 */
export function restoreCard(cardId: string): RestoreResult {
  return db.transaction((tx) => {
    const entry = tx
      .select()
      .from(schema.cardTrash)
      .where(eq(schema.cardTrash.cardId, cardId))
      .orderBy(desc(schema.cardTrash.deletedAt))
      .get();
    if (!entry) {
      return { ok: false, status: 404, error: "Nothing to restore for this card" } as const;
    }

    const payload = JSON.parse(entry.payload) as TrashPayload;
    const { card } = payload;

    const live = tx.select({ id: schema.cards.id }).from(schema.cards).where(eq(schema.cards.id, cardId)).get();
    if (live) {
      return { ok: false, status: 409, error: "Card already exists" } as const;
    }

    if (card.projectId && card.taskNumber !== null) {
      const taken = tx
        .select({ id: schema.cards.id })
        .from(schema.cards)
        .where(
          and(
            eq(schema.cards.projectId, card.projectId),
            eq(schema.cards.taskNumber, card.taskNumber),
            ne(schema.cards.id, cardId)
          )
        )
        .get();
      if (taken) {
        return {
          ok: false,
          status: 409,
          error: `Task number ${card.taskNumber} is already used by another card`,
        } as const;
      }
    }

    // Groups have no foreign key; if the chain was deleted meanwhile, the card
    // comes back ungrouped instead of pointing at nothing.
    let groupId = card.groupId;
    if (groupId) {
      const group = tx
        .select({ id: schema.cardGroups.id })
        .from(schema.cardGroups)
        .where(eq(schema.cardGroups.id, groupId))
        .get();
      if (!group) groupId = null;
    }

    // Deleting a card took it out of the run queue; undoing the delete brings
    // the card back, not its place in line.
    const restored: CardRecord = { ...card, groupId, queuePosition: null };
    tx.insert(schema.cards).values(restored).run();
    for (const row of payload.conversations) {
      tx.insert(schema.conversations).values(row).onConflictDoNothing().run();
    }
    for (const row of payload.chatSessions) {
      tx.insert(schema.chatSessions).values(row).onConflictDoNothing().run();
    }
    for (const row of payload.activityEvents) {
      tx.insert(schema.activityEvents).values(row).onConflictDoNothing().run();
    }

    tx.delete(schema.cardTrash).where(eq(schema.cardTrash.id, entry.id)).run();

    return { ok: true, card: restored } as const;
  });
}

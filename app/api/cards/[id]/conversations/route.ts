import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations, chatSessions } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { SectionType, ConversationMessage } from "@/lib/types";

// GET - Fetch conversation history for a card section
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: cardId } = await params;
    const { searchParams } = new URL(request.url);
    const sectionType = searchParams.get("section") as SectionType | null;

    if (!sectionType) {
      return NextResponse.json(
        { error: "section parameter is required" },
        { status: 400 }
      );
    }

    const messages = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.cardId, cardId),
          eq(conversations.sectionType, sectionType)
        )
      )
      .orderBy(asc(conversations.createdAt));

    // Parse JSON fields
    const parsedMessages: ConversationMessage[] = messages.map((msg) => ({
      id: msg.id,
      cardId: msg.cardId,
      sectionType: msg.sectionType as SectionType,
      role: msg.role as "user" | "assistant",
      content: msg.content,
      mentions: msg.mentions ? JSON.parse(msg.mentions) : [],
      toolCalls: msg.toolCalls ? JSON.parse(msg.toolCalls) : undefined,
      createdAt: msg.createdAt,
    }));

    return NextResponse.json(parsedMessages);
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}

// POST - Add a new message to conversation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: cardId } = await params;
    const body = await request.json();
    const { sectionType, role, content, mentions, toolCalls } = body;

    if (!sectionType || !role || !content) {
      return NextResponse.json(
        { error: "sectionType, role, and content are required" },
        { status: 400 }
      );
    }

    const newMessage = {
      id: uuidv4(),
      cardId,
      sectionType,
      role,
      content,
      mentions: mentions ? JSON.stringify(mentions) : null,
      toolCalls: toolCalls ? JSON.stringify(toolCalls) : null,
      createdAt: new Date().toISOString(),
    };

    await db.insert(conversations).values(newMessage);

    // Return parsed message
    const responseMessage: ConversationMessage = {
      id: newMessage.id,
      cardId: newMessage.cardId,
      sectionType: newMessage.sectionType as SectionType,
      role: newMessage.role as "user" | "assistant",
      content: newMessage.content,
      mentions: mentions || [],
      toolCalls: toolCalls || undefined,
      createdAt: newMessage.createdAt,
    };

    return NextResponse.json(responseMessage);
  } catch (error) {
    console.error("Failed to add conversation message:", error);
    return NextResponse.json(
      { error: "Failed to add message" },
      { status: 500 }
    );
  }
}

// DELETE - Clear conversation history for a section
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: cardId } = await params;
    const { searchParams } = new URL(request.url);
    const sectionType = searchParams.get("section") as SectionType | null;

    if (!sectionType) {
      return NextResponse.json(
        { error: "section parameter is required" },
        { status: 400 }
      );
    }

    await db
      .delete(conversations)
      .where(
        and(
          eq(conversations.cardId, cardId),
          eq(conversations.sectionType, sectionType)
        )
      );

    // Also clear CLI session mapping so next message starts fresh
    await db
      .delete(chatSessions)
      .where(
        and(
          eq(chatSessions.cardId, cardId),
          eq(chatSessions.sectionType, sectionType)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to clear conversations:", error);
    return NextResponse.json(
      { error: "Failed to clear conversations" },
      { status: 500 }
    );
  }
}

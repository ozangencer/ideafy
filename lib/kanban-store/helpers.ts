import { Card } from "../types";

export const nowIso = () => new Date().toISOString();

export const replaceCardById = (cards: Card[], id: string, updated: Card) =>
  cards.map((card) => (card.id === id ? updated : card));

export const updateCardById = (
  cards: Card[],
  id: string,
  updates: Partial<Card>
) =>
  cards.map((card) =>
    card.id === id ? { ...card, ...updates } : card
  );

export const addUniqueId = (ids: string[], id: string) =>
  ids.includes(id) ? ids : [...ids, id];

export const removeId = (ids: string[], id: string) =>
  ids.filter((existing) => existing !== id);

export const parseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
};
